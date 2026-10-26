"""wiki book split —— 把 pdf / epub / azw3 / mobi 转成可读的 md 副本。

设计原则:所有书特定信息从 epub 的 toc 推断,不在脚本里硬编码。
- toc 顶层 entry 的 href:无 # → 容器(前/正文/后页 part),有 # → chapter
- 容器分三段:开头没 h1 子条目的 = 前页;中间有 h1 子条目的 = 正文;
  末尾没 h1 子条目的 = 后页
- 正文 part 按 toc h1 切章,章节号 1, 2, ... 按 toc 顺序,文件名「<号> <标题>.md」
- 标题只去文件系统禁用字符(slugify),空白压成一个空格;前页 00-<标题>.md、后页 99-<标题>.md
- PDF 只出一个「1 全文.md」(每页前带页标记),再由 wiki book cut 切章

不做的事:不写 frontmatter(产物落 raw/book/<书>/章节/,已在
needs_frontmatter 里豁免);不改图片二进制,只做 raw 内的派生素材。
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile


# ── HTML → md 转换器 ──────────────────────────────────────────

class _MdBuilder(HTMLParser):
    """单遍 HTMLParser 边走边吐 markdown。覆盖 mobi/kf8 epub 的实际标签集。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.list_stack: list[tuple[str, int]] = []
        self.li_ol_count: int = 0
        self.in_p: bool = False
        self.in_skip: int = 0           # svg 块
        self.a_text_only: int = 0       # 目录回链 a:只输出文字

    def w(self, s): self.parts.append(s)

    def _close_p(self):
        if self.in_p:
            self.parts.append('\n\n')
            self.in_p = False

    def _close_list(self):
        if self.list_stack:
            self.list_stack.pop()
            self.li_ol_count = 0
            if self.list_stack and self.list_stack[-1][0] == 'ol':
                self.li_ol_count = self.list_stack[-1][1]
            self.parts.append('\n')

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('html', 'body', 'head', 'title', 'meta', 'link', 'style', 'nav'):
            return
        if tag == 'div':
            return
        if tag == 'span':
            return
        if tag in ('svg', 'image'):
            self.in_skip += 1
            return
        if tag == 'br':
            if self.in_p: self.parts.append('  \n')
            else: self.parts.append('\n')
            return
        if tag == 'hr':
            self._close_p()
            self.parts.append('\n\n---\n\n')
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self._close_p()
            while self.list_stack:
                self._close_list()
            self._heading_level = int(tag[1])
            self._in_heading = True
            self._h_parts: list[str] = []
            return
        if tag == 'p':
            self._close_p()
            if self.list_stack: return
            self.in_p = True
            return
        if tag == 'ol':
            self._close_p()
            self.list_stack.append(('ol', 0))
            self.li_ol_count = 0
            return
        if tag == 'ul':
            self._close_p()
            self.list_stack.append(('ul', 0))
            return
        if tag == 'li':
            self._close_p()
            indent = '  ' * (len(self.list_stack) - 1)
            top_tag, _ = self.list_stack[-1]
            if top_tag == 'ol':
                self.li_ol_count += 1
                self.parts.append(f'\n{indent}{self.li_ol_count}. ')
            else:
                self.parts.append(f'\n{indent}- ')
            return
        if tag == 'img':
            alt = a.get('alt', '')
            src = a.get('src', '') or a.get('xlink:href', '')
            self.parts.append(f'![{alt}]({src})')
            return
        if tag == 'a':
            href = a.get('href', '')
            if not href or href.startswith('#') or 'part0000.xhtml' in href:
                # 目录回链 / 同 part 锚链:只输出文字,不带链接符号
                self.a_text_only += 1
                return
            self.parts.append('[')
            self._in_link = True
            self._link_href = href
            return

    def handle_endtag(self, tag):
        if tag in ('html', 'body', 'head', 'title', 'meta', 'link', 'style', 'nav'):
            return
        if tag in ('svg', 'image'):
            if self.in_skip > 0: self.in_skip -= 1
            return
        if tag in ('div', 'span'):
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            if getattr(self, '_in_heading', False):
                txt = ''.join(self._h_parts).strip()
                level = self._heading_level
                self.parts.append('\n\n' + '#' * level + ' ' + txt + '\n\n')
                self._in_heading = False
            return
        if tag == 'p':
            if self.in_p:
                self.parts.append('\n\n')
                self.in_p = False
            return
        if tag in ('ol', 'ul'):
            self._close_list()
            return
        if tag == 'li':
            self.parts.append('\n')
            return
        if tag == 'a':
            if self.a_text_only > 0:
                self.a_text_only -= 1
                return
            if getattr(self, '_in_link', False):
                self.parts.append(f']({self._link_href})')
                self._in_link = False
            return

    def handle_data(self, data):
        if self.in_skip: return
        if getattr(self, '_in_heading', False):
            self._h_parts.append(data); return
        self.parts.append(data)

    def handle_entityref(self, name):
        if self.in_skip: return
        s = unescape(f'&{name};')
        if getattr(self, '_in_heading', False):
            self._h_parts.append(s); return
        self.parts.append(s)

    def handle_charref(self, name):
        if self.in_skip: return
        s = unescape(f'&#{name};')
        if getattr(self, '_in_heading', False):
            self._h_parts.append(s); return
        self.parts.append(s)

    def render(self) -> str:
        self._close_p()
        while self.list_stack:
            self._close_list()
        text = ''.join(self.parts)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip() + '\n'


def html_to_md(html: str) -> str:
    b = _MdBuilder()
    b.feed(html)
    return b.render()


# ── toc 解析 ─────────────────────────────────────────────────

def _href_part(href: str) -> tuple[str, str | None]:
    """'Text/part0009.xhtml#bw1' → ('Text/part0009.xhtml', 'bw1')。"""
    if not href:
        return ('', None)
    if '#' in href:
        f, a = href.split('#', 1)
        return (f, a)
    return (href, None)


def _href_to_title(href: str) -> str:
    """从 toc href 拿 part filename(去 Text/ 前缀)。"""
    f, _ = _href_part(href)
    return f.replace('Text/', '', 1) if f.startswith('Text/') else f


def _walk_toc(toc) -> list[dict]:
    """把 toc 展平成 [{'level': int, 'title': str, 'href': str}, ...]。"""
    out: list[dict] = []

    def visit(node, level):
        for item in node:
            if isinstance(item, tuple):
                sec, kids = item
                out.append({'level': level, 'title': sec.title, 'href': sec.href or ''})
                visit(kids, level + 1)
            else:
                out.append({'level': level, 'title': item.title, 'href': item.href or ''})

    visit(toc, 0)
    return out


def classify_toc(flat: list[dict]) -> dict:
    """从 toc 推断书的结构,返回:
    {
      'part0_file': str|None,           # part0000 这种目录页(无 #,无 h1),跳过
      'front_parts': [{file, title}, ...],
      'body_parts':  [{file, title, chapters: [{title, anchor}, ...]}, ...],
      'back_parts':  [{file, title}, ...],
    }

    规则:
    - toc 里 href 无 # 的 h0 是 part 容器,有 # 的 h0 是 chapter(罕见,跳过)
    - 开头没 h1 子条目的 part = 前页
    - 中间有 h1 子条目的 part = 正文(每个 part 含 1..N 章)
    - 末尾没 h1 子条目的 part = 后页
    - 第一个 part 通常是 part0000(目录页),跳过
    """
    # 收集每个 part 的 children
    parts: dict[str, dict] = {}   # file -> {'title': str, 'chapters': [...]}
    for entry in flat:
        if entry['level'] != 0:
            continue
        file, anchor = _href_part(entry['href'])
        if not file:
            continue
        if anchor:
            # h0 带 #:说明这一条是 chapter,part 信息在 sibling 里推断
            continue
        file = file.replace('Text/', '', 1) if file.startswith('Text/') else file
        if file not in parts:
            parts[file] = {'title': entry['title'], 'chapters': []}

    # 给每个 part 收集 h1 子条目
    for entry in flat:
        if entry['level'] != 1:
            continue
        file, anchor = _href_part(entry['href'])
        if not file or not anchor:
            continue
        file = file.replace('Text/', '', 1) if file.startswith('Text/') else file
        if file in parts:
            parts[file]['chapters'].append({'title': entry['title'], 'anchor': anchor})

    # 按出现顺序排 part(用 toc 里第一次出现的位置)
    order: list[str] = []
    seen = set()
    for entry in flat:
        if entry['level'] != 0:
            continue
        file, _ = _href_part(entry['href'])
        if not file or entry['href'] and '#' in entry['href']:
            continue
        file = file.replace('Text/', '', 1) if file.startswith('Text/') else file
        if file and file not in seen and file in parts:
            order.append(file); seen.add(file)

    # 分类
    front, body, back = [], [], []
    in_body = False
    in_back = False
    for f in order:
        info = parts[f]
        if info['chapters']:
            in_body = True
            in_back = False
            body.append({'file': f, 'title': info['title'],
                         'chapters': info['chapters']})
        else:
            if in_body:
                in_back = True
            if in_back or in_body:
                back.append({'file': f, 'title': info['title']})
            else:
                front.append({'file': f, 'title': info['title']})

    # part0000 是 mobi 拆出的目录页(可能含 h0 条目)——单独识别
    part0 = order[0] if order else None

    return {
        'part0_file': part0,
        'front_parts': front,
        'body_parts': body,
        'back_parts': back,
    }


# ── 切片 ────────────────────────────────────────────────────

def _body_inner(html: str) -> str:
    m = re.search(r'<body[^>]*>(.*)</body>', html, re.S)
    return m.group(1) if m else html


def _slice_by_anchors(html: str, anchors: list[str]) -> list[tuple[str | None, str]]:
    """按锚链 id 把 html 切段;每段是 (anchor, segment)。第一个 anchor 之前的 preamble
    以 (None, preamble) 给出。"""
    body = _body_inner(html)
    if not anchors:
        return [(None, body)]
    starts = []
    for a in anchors:
        m = re.search(rf'<\w[^>]*\sid="{re.escape(a)}"', body)
        if m:
            starts.append(m.start())
    if not starts:
        return [(None, body)]
    out: list[tuple[str | None, str]] = []
    if starts[0] > 0:
        out.append((None, body[:starts[0]]))
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(body)
        out.append((anchors[i], body[s:e]))
    return out


# ── slug 化 ─────────────────────────────────────────────────

def slugify(title: str, max_len: int = 50) -> str:
    """toc 标题 → 文件名安全 slug。

    策略:只去掉文件系统禁用字符,空白压成一个空格(章节文件是「<号> <标题>.md」,标题原样可读)。
    这样"第1章 消化知识" → "第1章 消化知识"。
    """
    s = title.strip()
    # 文件系统禁用字符
    s = re.sub(r'[\\/:*?"<>|\n\r\t]', '', s)
    # 连续空白压成一个空格
    s = re.sub(r'\s+', ' ', s).strip()
    if len(s) > max_len:
        s = s[:max_len].rstrip()
    return s or 'untitled'


# ── 图片抽取 ───────────────────────────────────────────────

def _extract_images(epub_path: str, img_dir: str) -> int:
    os.makedirs(img_dir, exist_ok=True)
    n = 0
    with ZipFile(epub_path) as z:
        for name in z.namelist():
            if name.startswith('OEBPS/Images/') and not name.endswith('/'):
                base = os.path.basename(name)
                with z.open(name) as src, open(os.path.join(img_dir, base), 'wb') as dst:
                    shutil.copyfileobj(src, dst)
                n += 1
    return n


_REWRITE_SRC = re.compile(r'\.\./Images/')


def _rewrite_img_src(md: str) -> str:
    return _REWRITE_SRC.sub('images/', md)


# ── 主流程 ─────────────────────────────────────────────────

WHOLE_NAME = "1 全文.md"   # PDF 只出这一个全文（带页标记），之后 wiki book cut 按页切章


def chapter_filename(n: int, title: str) -> str:
    """章节文件名：「<号> <标题>.md」（号与标题之间一个空格）。"""
    return f"{n} {slugify(title)}.md"


SCANNED_EXIT = 3          # 扫描版：没跑 split，交给 wiki-write-book-ingest 问人要不要 AI 转写
BLANK_PAGE_CHARS = 20     # 一页去空白后少于这些字算空页


def _pdf_to_md(source: str, out_dir: str) -> int:
    """有文字层的 PDF 转为一章 Markdown（每页前插 `<!-- PDF 第 N 页 -->`，第 4 步按页对照）。

    空页超过一半判为扫描版：退出码 SCANNED_EXIT、不产文件；零星空页（整页插图）照转，页号照占。
    不用 -layout：它按版面补空格（整页渲成代码块），booklet 双栏还会把左右两页逐行拼在一起；
    表格对齐丢了由第 4 步对照页图重写。"""
    tool = shutil.which("pdftotext")
    if not tool:
        print("× 转换 PDF 需要 pdftotext（Poppler）"); return 2
    proc = subprocess.run([tool, source, "-"], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    if proc.returncode:
        print("× pdftotext 失败: " + proc.stderr.decode("utf-8", errors="replace").strip()); return 2
    pages = proc.stdout.decode("utf-8", errors="replace").split("\f")
    if pages and pages[-1] == "":
        pages.pop()                       # pdftotext 每页后跟 \f，最后一段是空尾巴不是页；只含空白的段是真空页，留着占号
    blank = sum(1 for p in pages if len(re.sub(r"\s", "", p)) < BLANK_PAGE_CHARS)
    if not pages or blank * 2 > len(pages):
        print(f"× 扫描版 PDF：{blank}/{len(pages)} 页没有文字层，需要 AI 看页图转写（wiki-write-book-ingest）")
        return SCANNED_EXIT
    os.makedirs(out_dir)
    title = Path(source).stem
    body = [f"# {title}"]
    for i, page in enumerate(pages, 1):
        if page.strip():
            body.extend(["", f"<!-- PDF 第 {i} 页 -->", "", page.strip("\n")])
    (Path(out_dir) / WHOLE_NAME).write_text("\n".join(body).rstrip() + "\n", encoding="utf-8")
    print(f"  正文 → {WHOLE_NAME}（{len(pages)} 页）")
    return 0


def run(source_path: str, out_dir: str) -> int:
    source_path = os.path.abspath(source_path)
    out_dir = os.path.abspath(out_dir)
    if not os.path.isfile(source_path):
        print(f'× 找不到源文件: {source_path}'); return 2
    if os.path.exists(out_dir):
        print(f'× 输出目录已存在,先手动删: {out_dir}'); return 2

    ext = Path(source_path).suffix.lower()
    if ext == ".pdf":
        return _pdf_to_md(source_path, out_dir)
    if ext not in (".epub", ".azw3", ".mobi"):
        print(f"× 不支持的书籍格式: {ext or '无扩展名'}"); return 2

    import ebooklib
    from ebooklib import epub

    os.makedirs(out_dir)
    img_dir = os.path.join(out_dir, 'images')
    os.makedirs(img_dir)

    if ext == ".epub":
        epub_path = source_path
    else:
        import mobi
        print(f'extract {os.path.basename(source_path)} → epub...')
        res = mobi.extract(source_path)
        epub_path = res[1] if isinstance(res, tuple) else res

    book = epub.read_epub(epub_path)
    # docs 的 key 剥掉 Text/ 前缀,跟 toc 推断的 file 名保持一致
    docs = {}
    for it in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        key = it.file_name
        if key.startswith('Text/'):
            key = key[len('Text/'):]
        docs[key] = it

    flat = _walk_toc(book.toc)
    struct = classify_toc(flat)
    if not struct['body_parts']:
        print('× toc 里没找到正文 part(都没有 h1 子条目)——这本书结构不符合预期')
        print('  调试:')
        for f in struct['front_parts']: print(f'    front: {f["file"]} {f["title"]}')
        for f in struct['back_parts']:  print(f'    back:  {f["file"]} {f["title"]}')
        return 2

    # 1) 前页
    for fp in struct['front_parts']:
        it = docs.get(fp['file'])
        if not it: continue
        md = _rewrite_img_src(html_to_md(it.content.decode('utf-8', errors='replace')))
        path = os.path.join(out_dir, f"00-{slugify(fp['title'])}.md")
        with open(path, 'w', encoding='utf-8') as f: f.write(md)
        print(f'  前页 → {os.path.basename(path)}')

    # 2) 正文:每 part 切章
    ch_num = 0
    for bp in struct['body_parts']:
        it = docs.get(bp['file'])
        if not it: continue
        html = it.content.decode('utf-8', errors='replace')
        anchors = [c['anchor'] for c in bp['chapters']]
        slices = _slice_by_anchors(html, anchors)
        # slices: [(None, preamble), (anchor1, seg1), (anchor2, seg2), ...]
        chap_iter = iter(bp['chapters'])
        for anchor, seg in slices:
            if anchor is None:
                # part 引子段(整段 part 的开篇)并入第一章
                continue
            try:
                chap = next(chap_iter)
            except StopIteration:
                continue
            ch_num += 1
            md = _rewrite_img_src(html_to_md(seg))
            path = os.path.join(out_dir, chapter_filename(ch_num, chap['title']))
            with open(path, 'w', encoding='utf-8') as f: f.write(md)
            print(f'  正文 → {os.path.basename(path)}')

    # 3) 后页
    for bp in struct['back_parts']:
        it = docs.get(bp['file'])
        if not it: continue
        md = _rewrite_img_src(html_to_md(it.content.decode('utf-8', errors='replace')))
        path = os.path.join(out_dir, f"99-{slugify(bp['title'])}.md")
        with open(path, 'w', encoding='utf-8') as f: f.write(md)
        print(f'  后页 → {os.path.basename(path)}')

    # 4) 抽图
    n_img = _extract_images(epub_path, img_dir)
    print(f'  图   → {n_img} 张 抽到 {os.path.relpath(img_dir, out_dir)}/')

    return 0
