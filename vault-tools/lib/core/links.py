"""双链（[[目标#锚|标签]]）的唯一实现：语法、解析、改写。check / orphans / page 命令 / observe / upgrade 共用。

规则（与插件 src/core/vault/graph.ts 的 resolveName 一致，两边用 tests/link_cases.json 对齐）：
- 只有沉淀区（经历 / 认知 / 学习 / 知识 / 系统）页的正文双链算数；目标也只能是沉淀区的页。raw/ 里的双链不管。
- 目标含 / 是路径形式：从区根起的节点路径，不带 .md，文件夹页写到文件夹为止；否则是裸名（页名）。
- 路径按节点精确查；裸名只在全库沉淀区唯一时命中，重名即歧义——不按位置猜。
"""

import re
import unicodedata
from pathlib import Path

from core import repo

LINK_RE = re.compile(r"\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]")
_FENCE = re.compile(r"^\s*(```|~~~)")


def deposit_pages(root: Path) -> list:
    root = Path(root)
    return [p for p in repo.iter_md(root) if repo.in_deposit(repo.rel(root, p))]


def node_path(root: Path, p: Path) -> str:
    """沉淀区 md 的节点路径：文件夹页（X/X.md 或 .folder.json 改指的页）= 文件夹路径，否则去 .md。"""
    r = repo.rel(Path(root), p)
    if repo.is_folder_page(Path(p)):
        return r.rsplit("/", 1)[0]
    return r[:-3] if r.endswith(".md") else r


class Index:
    """沉淀区的节点路径表与名字表，外加 raw/ 的名字表（判「指到沉淀区外」用）。"""

    def __init__(self, root: Path):
        root = Path(root)
        self.root = root
        self.paths = {}
        self.names = {}
        self.raw = {}
        for p in repo.iter_md(root):
            r = repo.rel(root, p)
            if repo.in_deposit(r):
                key = node_path(root, p)
                self.paths[key] = p
                for name in {key.rsplit("/", 1)[-1], p.stem}:      # 改指的页：自己的名字也能链
                    lst = self.names.setdefault(name, [])
                    if key not in lst:
                        lst.append(key)
            elif r.startswith(f"{repo.RAW}/"):
                self.raw.setdefault(p.stem, []).append(r)

    def resolve(self, target: str):
        t = target.strip()
        if "/" in t:
            if t in self.paths:
                return "ok", t
            if t.split("/", 1)[0] not in repo.DEPOSIT_DIRS:
                return "outside", None
            return "missing", None
        keys = self.names.get(t, [])
        if len(keys) == 1:
            return "ok", keys[0]
        if len(keys) > 1:
            return "ambiguous", sorted(keys)
        if t in self.raw:
            return "outside", None
        return "missing", None

    def unique(self, key: str) -> bool:
        """这个节点的名字（路径最后一段）在沉淀区里只有它一个。"""
        return self.names.get(key.rsplit("/", 1)[-1], []) == [key]


def split_fm(text: str):
    """(frontmatter 块含首尾 ---, 其后正文)；没有 frontmatter 时块为空串。"""
    if not text.startswith("---\n"):
        return "", text
    end = text.find("\n---", 4)
    if end == -1:
        return "", text
    end += len("\n---")
    return text[:end], text[end:]


def _map_prose(body: str, fn) -> str:
    """逐行走正文的散文部分（跳过 ```/~~~ 围栏与行内反引号），对每个散文片段调 fn(seg) -> seg。同插件 walkProse。"""
    lines = body.split("\n")
    fence = False
    for i, line in enumerate(lines):
        if _FENCE.match(line):
            fence = not fence
            continue
        if fence or "[[" not in line:
            continue
        parts = line.split("`")
        for j in range(0, len(parts), 2):
            parts[j] = fn(parts[j])
        lines[i] = "`".join(parts)
    return "\n".join(lines)


def links_in(body: str) -> list:
    """正文散文里的每条双链：(目标, 锚, 标签)，锚与标签缺省为空串，目标已去首尾空白。"""
    out = []

    def grab(seg):
        for m in LINK_RE.finditer(seg):
            t = m.group(1).strip()
            if t:
                out.append((t, (m.group(2) or "")[1:], m.group(3) or ""))
        return seg
    _map_prose(body, grab)
    return out


def rewrite_links(root: Path, fn) -> list:
    """沉淀区每页正文的每条双链调 fn(页路径, 目标, 锚, 标签)，返回整条替换文本或 None（不动）。写回改过的页。"""
    changed = []
    for p in deposit_pages(root):
        text = p.read_text(encoding="utf-8")
        head, body = split_fm(text)

        def seg_fn(seg, p=p):
            def one(m):
                t = m.group(1).strip()
                if not t:
                    return m.group(0)
                r = fn(p, t, (m.group(2) or "")[1:], m.group(3) or "")
                return m.group(0) if r is None else r
            return LINK_RE.sub(one, seg)
        new = head + _map_prose(body, seg_fn)
        if new != text:
            p.write_text(new, encoding="utf-8")
            changed.append(p)
    return changed


# github-slugger（插件给标题配 id、给 [[页#锚]] 算 data-anchor 都用它）保留的字符：字母 / 记号 / 十进制与字母数字 /
# 连接标点，外加空格与连字符；另有几段圈字母（So 类）它也留。全码位与 node 版逐个对过，差别只剩 Unicode 版本新增的字。
_SLUG_KEEP_CATS = {"Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "Pc"}
_SLUG_KEEP_RANGES = ((0x24B6, 0x24E9), (0x1F130, 0x1F149), (0x1F150, 0x1F169), (0x1F170, 0x1F189))
_ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$")
_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")


def slug(text: str) -> str:
    """同 github-slugger 的具名 slug()：转小写、删掉不保留的字符、空格换连字符。"""
    def keep(c):
        if c in " -":
            return True
        o = ord(c)
        return unicodedata.category(c) in _SLUG_KEEP_CATS or any(a <= o <= b for a, b in _SLUG_KEEP_RANGES)
    return "".join(c for c in text.lower() if keep(c)).replace(" ", "-")


def heading_slugs(body: str) -> set:
    """正文（frontmatter 已剥）里每个标题的 id，同编辑器 deco.ts：取标题原文（ATX 剥前导 # 与尾闭合 #），
    同页重名按 GithubSlugger 加 -1、-2 后缀。围栏里的 # 行不算。"""
    seen, out = {}, set()

    def add(text):
        base = s = slug(text.strip())
        while s in seen:
            seen[base] += 1
            s = f"{base}-{seen[base]}"
        seen[s] = 0
        out.add(s)

    fence, para = False, None          # para：上一行是可做 Setext 标题正文的段落行
    for line in body.split("\n"):
        if _FENCE.match(line):
            fence, para = not fence, None
            continue
        if fence:
            continue
        m = _ATX.match(line)
        if m:
            add(re.sub(r"[ \t]+#+$", "", m.group(2) or ""))
            para = None
        elif para is not None and _SETEXT.match(line):
            add(para)
            para = None
        else:
            para = line if line.strip() else None
    return out


def render(target: str, anchor: str, label: str) -> str:
    return f"[[{target}{('#' + anchor) if anchor else ''}{('|' + label) if label else ''}]]"


def rewrite_after(root: Path, before: Index, moved=lambda k: k) -> list:
    """结构变动（建页、挪、grow、shrink）之后改写沉淀区双链，让每条原本解析成功的链仍指向原来那个节点。

    before 是变动前的 Index；moved 把变动前的节点路径映射到变动后（建页 / grow / shrink 是恒等）。
    原目标串变动后仍解析到同一节点就不动；否则裸名在新位置唯一时写名字，其余写路径。已是路径形式的不会被改回裸名。
    """
    after = Index(root)

    def fn(_page, target, anchor, label):
        state, old = before.resolve(target)
        if state != "ok":
            return None
        new = moved(old)
        if new not in after.paths:
            return None
        if after.resolve(target) == ("ok", new):
            return None
        name = new.rsplit("/", 1)[-1]
        want = name if "/" not in target and after.unique(new) else new
        return render(want, anchor, label)
    return rewrite_links(root, fn)
