"""wiki document fetch —— 按源类型抓取网页，正文落 raw/document/，图片落该篇 raw/document/<日期>/<名>/images/。

源类型由 ADAPTERS 决定：每个适配器认自己的 host、自己抽元数据和正文。
认不出的 host 直接报错，不做"通用兜底"——宁可明确失败，也不要静默把一篇
质量不明的东西塞进只进不改的 raw/。
"""

import gzip
import json
import mimetypes
import os
import re
import subprocess
import time
from datetime import date
from email.message import Message
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from core import repo

# 转换过程中的哨兵：块间隔与硬换行。正文里不会出现这两个控制字符。
_BLOCK = "\x00"
_LINE = "\x01"

_BLOCK_TAGS = {"p", "div", "section", "article", "header", "footer",
               "h1", "h2", "h3", "h4", "h5", "h6",
               "ul", "ol", "blockquote", "pre", "table", "tr"}
_SKIP_TAGS = {"script", "style", "noscript", "svg"}


class _Converter(HTMLParser):
    """HTML → Markdown。够用就行：覆盖正文里真正会出现的标签。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip = 0            # 位于 script/style 内的深度
        self._pre = 0             # 位于 pre 内的深度
        self._hrefs = []          # a 的 href 栈（None 表示没有 href）
        self._lists = []          # 列表栈：None=ul，int=ol 的当前序号
        self._quotes = []         # blockquote 的起始下标栈

    # ── 工具 ────────────────────────────────────────────────
    def _push(self, s):
        if s:
            self.parts.append(s)

    @staticmethod
    def _attr(attrs, name):
        for k, v in attrs:
            if k == name:
                return v
        return None

    # ── 标签 ────────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return

        if tag == "br":
            self._push(_LINE)
        elif tag == "hr":
            self._push(_BLOCK); self._push("---"); self._push(_BLOCK)
        elif tag == "img":
            src = self._attr(attrs, "data-src") or self._attr(attrs, "src")
            if src:
                self._push(_BLOCK); self._push(f"![]({src})"); self._push(_BLOCK)
        elif tag in ("strong", "b"):
            self._push("**")
        elif tag in ("em", "i"):
            self._push("*")
        elif tag == "code":
            if not self._pre:
                self._push("`")
        elif tag == "pre":
            self._pre += 1
            self._push(_BLOCK); self._push("```\n")
        elif tag == "a":
            href = self._attr(attrs, "href")
            self._hrefs.append(href)
            if href:
                self._push("[")
        elif tag in ("ul", "ol"):
            self._lists.append(0 if tag == "ol" else None)
            self._push(_BLOCK)
        elif tag == "li":
            n = self._lists[-1] if self._lists else None
            if n is None:
                prefix = "- "
            else:
                self._lists[-1] = n + 1
                prefix = f"{n + 1}. "
            self._push(_LINE); self._push(prefix)
        elif tag == "blockquote":
            self._push(_BLOCK)
            self._quotes.append(len(self.parts))
        elif tag.startswith("h") and tag[1:] in ("1", "2", "3", "4", "5", "6"):
            self._push(_BLOCK); self._push("#" * int(tag[1:]) + " ")
        elif tag in _BLOCK_TAGS:
            self._push(_BLOCK)

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return

        if tag in ("strong", "b"):
            self._push("**")
        elif tag in ("em", "i"):
            self._push("*")
        elif tag == "code":
            if not self._pre:
                self._push("`")
        elif tag == "pre":
            self._pre = max(0, self._pre - 1)
            self._push("\n```"); self._push(_BLOCK)
        elif tag == "a":
            href = self._hrefs.pop() if self._hrefs else None
            if href:
                self._push(f"]({href})")
        elif tag in ("ul", "ol"):
            if self._lists:
                self._lists.pop()
            self._push(_BLOCK)
        elif tag == "li":
            pass                                   # 收尾交给下一个 li 的 _LINE
        elif tag == "blockquote":
            start = self._quotes.pop() if self._quotes else len(self.parts)
            inner = _normalize("".join(self.parts[start:]))
            del self.parts[start:]
            if inner:
                self._push("\n".join(f"> {ln}" if ln else ">"
                                     for ln in inner.split("\n")))
            self._push(_BLOCK)
        elif tag in _BLOCK_TAGS:
            self._push(_BLOCK)

    def handle_data(self, data):
        if self._skip:
            return
        if self._pre:
            self._push(data)
            return
        self._push(re.sub(r"[ \t\r\n ]+", " ", data))


def _normalize(raw: str) -> str:
    """哨兵还原成换行，再压掉空白噪音。"""
    text = raw.replace(_LINE, "\n").replace(_BLOCK, "\n\n")
    text = "\n".join(ln.strip() for ln in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def html_to_markdown(html: str) -> str:
    c = _Converter()
    c.feed(html)
    c.close()
    return _normalize("".join(c.parts))


# ── 源类型 ──────────────────────────────────────────────────

class UnknownSource(Exception):
    """认不出源类型——不做兜底，让调用方明确失败。"""


class ExtractFailed(Exception):
    """认出了源类型但抽不到正文——多半是站点改版，该修适配器了。"""


class Article:
    """一篇抓来的文章。

    正文有三种给法，三选一：

    - `body_html`：交给 html_to_markdown 转。绝大多数站点走这条。
    - `body_url`：指向一份现成的 markdown 原文，另取一次（gist）。
    - `body_md`：markdown 已经在手上，页面里就带着（Palantir 文档把
      markdown 源码整份塞在 __NEXT_DATA__ 里）。

    后两种存在的理由一样：源站本身就存 markdown 时，转一趟 HTML 再转回来
    只会丢代码块标注和嵌套层级。
    """

    __slots__ = ("title", "author", "published", "body_html", "body_url", "body_md")

    def __init__(self, title, author, published, body_html, body_url=None, body_md=None):
        self.title = title
        self.author = author
        self.published = published
        self.body_html = body_html
        self.body_url = body_url
        self.body_md = body_md


def _meta(html, prop):
    m = re.search(rf'<meta[^>]+property=["\']{re.escape(prop)}["\'][^>]*content=["\'](.*?)["\']',
                  html, re.S)
    if not m:
        m = re.search(rf'<meta[^>]+content=["\'](.*?)["\'][^>]*property=["\']{re.escape(prop)}["\']',
                      html, re.S)
    return unescape(m.group(1)).strip() if m else None


_SCRIPT_RE = re.compile(r"<(script|style)\b.*?</\1\s*>", re.S | re.I)


class _DivMatcher(HTMLParser):
    """找出某个 <div> 的配对闭合位置。

    页尾标记是会变的，标签层级不会。但层级必须由真正的解析器来数——正则数
    `<div` 会把属性值里的字符串（`title="像 <div 的"`）和 HTML 注释里的
    `</div>` 一并算进去，前者让正文吞掉页尾，后者让正文提前截断。
    """

    def __init__(self, open_at, tag="div"):
        super().__init__(convert_charrefs=False)
        self.open_at = open_at          # 目标开标签的字符下标
        self.tag = tag                  # 要配对的标签名
        self.body_start = None          # 它的 > 之后
        self.close_start = None         # 配对闭标签的 < 处
        self._depth = 0

    def _offset(self):
        line, col = self.getpos()
        return self._line_offsets[line - 1] + col

    def feed_text(self, text):
        self._line_offsets, pos = [], 0
        for ln in text.split("\n"):
            self._line_offsets.append(pos)
            pos += len(ln) + 1
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag != self.tag:
            return
        off = self._offset()
        if self.body_start is None:
            if off == self.open_at:
                self.body_start = off + len(self.get_starttag_text())
                self._depth = 1
            return
        if self.close_start is None:
            self._depth += 1

    def handle_endtag(self, tag):
        if tag != self.tag or self.body_start is None or self.close_start is not None:
            return
        self._depth -= 1
        if self._depth == 0:
            self.close_start = self._offset()


def _div_inner(html, tag_start, tag="div"):
    """取出 <tag ...> 与其配对 </tag> 之间的内容。没有闭合就吃到结尾。"""
    m = _DivMatcher(tag_start, tag)
    m.feed_text(html)
    if m.body_start is None:                      # 解析器没认出这个标签，退回朴素切法
        return html[html.index(">", tag_start) + 1:]
    return html[m.body_start:m.close_start if m.close_start is not None else len(html)]


class WeChatAdapter:
    name = "wechat"
    label = "微信公众号"
    HOSTS = ("mp.weixin.qq.com",)

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse(html):
        title = _meta(html, "og:title") or ""
        m = re.search(r'var\s+nickname\s*=\s*htmlDecode\(\s*"(.*?)"\s*\)', html)
        author = unescape(m.group(1)) if m else (_meta(html, "og:article:author") or "")

        published = ""
        m = re.search(r'var\s+ct\s*=\s*"(\d+)"', html)
        if m:
            published = date.fromtimestamp(int(m.group(1))).isoformat()

        # 元数据藏在 script 里，得先取完再剥 script，否则 nickname / ct 就没了
        stripped = _SCRIPT_RE.sub("", html)
        i = stripped.find('id="js_content"')
        if i == -1:
            raise ExtractFailed("找不到 id=\"js_content\" 的正文容器——微信可能改版了，"
                                "去插件包 vault-tools/lib/document/fetch.py 的 WeChatAdapter.parse 修抽取锚点")
        body = _div_inner(stripped, stripped.rfind("<", 0, i))
        if not body.strip():
            raise ExtractFailed("正文容器是空的")
        return Article(title, author, published, body)


class _GistPage(HTMLParser):
    """从 gist 页面里数出文件名，并取出「Created」后面那个时刻。

    用真正的解析器而不是正则：属性值里的字符串和注释都能骗过正则，数错文件
    数就会让多文件 gist 被当成单文件静默归档。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.filenames = []
        self.created = ""
        self._in_name = 0        # 位于 <strong itemprop="name"> 内的深度
        self._in_link = False
        self._saw_created = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        # 只认紧贴在「Created」后面的那个 relative-time：页面上还有评论的时刻
        if tag == "relative-time" and self._saw_created and not self.created:
            self.created = a.get("datetime", "")
        self._saw_created = False

        if tag == "strong" and a.get("itemprop") == "name":
            self._in_name = 1
        elif self._in_name:
            if tag == "a":
                self._in_link = True
            elif tag == "strong":
                self._in_name += 1

    def handle_endtag(self, tag):
        if tag == "a":
            self._in_link = False
        elif tag == "strong" and self._in_name:
            self._in_name -= 1

    def handle_data(self, data):
        if self._in_name and self._in_link:
            name = data.strip()
            if name:
                self.filenames.append(name)
        elif "Created" in data:
            self._saw_created = True


class GistAdapter:
    name = "gist"
    label = "GitHub Gist"
    HOSTS = ("gist.github.com",)

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse(html):
        title = _meta(html, "og:title")
        page_url = _meta(html, "og:url")
        if not title or not page_url:
            raise ExtractFailed("gist 页面上找不到 og:title / og:url——GitHub 可能改版了，"
                                "去插件包 vault-tools/lib/document/fetch.py 的 GistAdapter.parse 修抽取锚点")

        p = _GistPage()
        p.feed(html)
        p.close()

        if not p.filenames:
            raise ExtractFailed("gist 页面上数不出文件名——GitHub 可能改版了，"
                                "去插件包 vault-tools/lib/document/fetch.py 的 GistAdapter.parse 修抽取锚点")
        if len(p.filenames) > 1:
            raise ExtractFailed(
                f"这是个多文件 gist（{'、'.join(p.filenames)}），本适配器只处理单文件。\n"
                f"  /raw 不带文件名时只返回第一个文件，归档下来会是残缺素材。"
                f"raw/ 只进不改，宁可现在失败。")

        # 作者就是 gist 的 owner，藏在 URL 路径的第一段里
        author = urlparse(page_url).path.strip("/").split("/")[0]
        # 正文取 /raw 的 markdown 原文；页面上那份是渲染过的 HTML，转回来会走样
        return Article(title, author, p.created[:10], "", page_url.rstrip("/") + "/raw")


class _NextData(HTMLParser):
    """取出 <script id="__NEXT_DATA__"> 里那段 JSON。

    用解析器而不是正则找这个 script：标签上还挂着 crossorigin 等属性，属性
    顺序和有无都会变，正则匹配 `id="__NEXT_DATA__">` 这种形状一改版就失手。
    script 在 HTMLParser 里走 CDATA 模式，JSON 原样进 handle_data，不会被
    实体转换弄坏。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._grab = False
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self._grab = True

    def handle_endtag(self, tag):
        if tag == "script":
            self._grab = False

    def handle_data(self, data):
        if self._grab:
            self.chunks.append(data)


def absolutize(md, base):
    """把 markdown 里的相对地址按 base 补成绝对地址。

    图片必须补，否则 _http_get 拿一个 `/docs/x.png` 或 `images/x.png` 去请求
    会直接失败，正文里就永久留下一条断链。链接一并补，归档件才点得开。

    用 urljoin 而不是字符串拼接：相对地址有两种形状——带前导斜杠的站内绝对
    路径（`/docs/x`）和不带的同目录相对路径（`images/x.png`），后者必须相对
    **页面所在目录**解析，拼字符串会拼错。纯锚点（`#section`）不动。
    """
    def sub(m):
        url = m.group(1)
        if not url or url.startswith("#"):
            return m.group(0)
        return m.group(0).replace(url, urljoin(base, url), 1)
    return re.sub(r"\]\(([^)\s]*)\)", sub, md)


class PalantirAdapter:
    """Palantir 官方文档（docs.palantir.com 现已并入 palantir.com/docs）。

    页面是 Next.js 服务端渲染的，但不去解渲染后的 DOM——__NEXT_DATA__ 里
    `pageProps.markdown` 就是这一页的 **markdown 源码**，比任何 HTML 反转都干净。
    """

    name = "palantir"
    label = "Palantir 官方文档"
    HOSTS = ("palantir.com", "www.palantir.com")
    ORIGIN = "https://palantir.com"

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse(html):
        p = _NextData()
        p.feed(html)
        p.close()
        if not p.chunks:
            raise ExtractFailed("页面里没有 __NEXT_DATA__——Palantir 可能改了渲染方式，"
                                "去插件包 vault-tools/lib/document/fetch.py 的 PalantirAdapter.parse 修抽取锚点")
        try:
            props = json.loads("".join(p.chunks))["props"]["pageProps"]
        except (ValueError, KeyError) as e:
            raise ExtractFailed(f"__NEXT_DATA__ 解不出 props.pageProps（{e}）——"
                                "去插件包 vault-tools/lib/document/fetch.py 的 PalantirAdapter.parse 修抽取锚点")

        body = props.get("markdown")
        if not body or not body.strip():
            raise ExtractFailed("pageProps 里没有 markdown 正文——这一页可能不是文档页")

        # "Documentation | Ontology building > Overview" → "Ontology building · Overview"
        raw_title = ((props.get("metadata") or {}).get("data") or {}).get("pageTitle") or ""
        title = raw_title.split("|", 1)[-1].strip()
        title = " · ".join(s.strip() for s in title.split(">") if s.strip())
        if not title:
            m = re.search(r"^#\s+(.+)$", body, re.M)
            title = m.group(1).strip() if m else ""

        # 官方文档不署名、也不标发布日期，留空比编一个强
        return Article(title, "Palantir", "", "",
                       body_md=absolutize(body, PalantirAdapter.ORIGIN))


class _MartinFowlerPage(HTMLParser):
    """martinfowler.com 一页里要的三样：meta、作者、正文容器的位置。

    meta 不能走 _meta()——这个站写的是 `content = 'x' property = 'y'`：等号
    两侧带空格、属性顺序颠倒、单引号。_meta 的正则要求 `content="` 紧挨着，
    在这个站上一条都匹配不到。解析器不在乎这些。

    作者取 `rel="author"` 的锚点文字，不硬编码成 Martin Fowler——/articles/
    下有大量客座作者（Data Mesh 那两篇是 Zhamak Dehghani 写的），署错人比
    留空更糟。
    """

    BODY_CLASS = "paperBody"

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.author = ""
        self.body_at = None
        self._in_author = False

    def _offset(self):
        line, col = self.getpos()
        return self._line_offsets[line - 1] + col

    def feed_text(self, text):
        self._line_offsets, pos = [], 0
        for ln in text.split("\n"):
            self._line_offsets.append(pos)
            pos += len(ln) + 1
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"].strip())
        elif tag == "div" and self.body_at is None:
            # class 是空格分隔的**词表**，不是一个字符串：/bliki/ 下是
            # `class='paperBody'`，/articles/ 下是 `class='paperBody deep'`。
            # 拿整串做等值比较会漏掉后者。
            if self.BODY_CLASS in a.get("class", "").split():
                self.body_at = self._offset()
        elif tag == "a" and a.get("rel") == "author" and not self.author:
            self._in_author = True

    def handle_endtag(self, tag):
        if tag == "a":
            self._in_author = False

    def handle_data(self, data):
        if self._in_author and data.strip() and not self.author:
            self.author = data.strip()


class MartinFowlerAdapter:
    """martinfowler.com —— /bliki/ 的词条与 /articles/ 的长文。

    正文容器 `div.paperBody` 对两种路径都成立。正文在适配器内就转成 markdown
    并补好地址，因为补地址要用页面自己的 URL 当 base，而 run() 那边拿不到。
    """

    name = "martinfowler"
    label = "martinfowler.com"
    HOSTS = ("martinfowler.com", "www.martinfowler.com")

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse(html):
        p = _MartinFowlerPage()
        p.feed_text(html)

        if p.body_at is None:
            raise ExtractFailed(
                f"找不到 class=\"{_MartinFowlerPage.BODY_CLASS}\" 的正文容器"
                "——站点可能改版了，去插件包 vault-tools/lib/document/fetch.py 的 MartinFowlerAdapter 修抽取锚点")

        page_url = p.meta.get("og:url")
        if not page_url:
            raise ExtractFailed("页面上没有 og:url——补不了相对地址，宁可失败也不往 raw/ 里留断链")

        body = _div_inner(_SCRIPT_RE.sub("", html), p.body_at)
        if not body.strip():
            raise ExtractFailed("正文容器是空的")

        # 「bliki: Bounded Context」→「Bounded Context」
        title = (p.meta.get("og:title") or "").removeprefix("bliki:").strip()

        # og:article:modified_time 形如 '2014-01-15 09:08:00 -0500'，取日期部分
        published = (p.meta.get("og:article:modified_time") or "")[:10]
        if not repo.is_iso_date(published):
            published = ""

        return Article(title, p.author, published, "",
                       body_md=absolutize(html_to_markdown(body), page_url))


# ── 飞书 ────────────────────────────────────────────────────

FEISHU_API = "https://open.feishu.cn/open-apis"

# docx 的 block_type 编号 → 这里怎么渲染。飞书文档没有把编号写在一处，
# 这张表是照实际返回的数据核出来的；不认识的编号一律留可见标记（见 _fs_block），
# 绝不静默丢内容——素材只进不改，丢了就永远发现不了。
_FS_HEADING = {3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9}
_FS_TEXTLIKE = ("text", "bullet", "ordered", "code", "quote", "todo",
                "heading1", "heading2", "heading3", "heading4", "heading5",
                "heading6", "heading7", "heading8", "heading9",
                "page", "source_synced")


_FS_STYLE_KEYS = ("bold", "italic", "strikethrough", "inline_code")


def _fs_merge_runs(elements):
    """把相邻且样式相同的 text_run 并成一个。

    飞书会把一句话切成多个 run（编辑历史留下的碎片），逐个包样式会产出
    `**A****B**` 这种东西——两个粗体挨在一起，markdown 渲染器看到的是四个
    星号，结果既不粗也多出符号。必须先合并再包。
    """
    out = []
    for e in elements or []:
        if "text_run" not in e:
            out.append(e)
            continue
        r = e["text_run"]
        st = r.get("text_element_style") or {}
        sig = tuple(bool(st.get(k)) for k in _FS_STYLE_KEYS) + \
            (((st.get("link") or {}).get("url")),)
        if out and "text_run" in out[-1] and out[-1].get("_sig") == sig:
            out[-1]["text_run"]["content"] = \
                out[-1]["text_run"].get("content", "") + r.get("content", "")
            continue
        out.append({"text_run": dict(r), "_sig": sig})
    return out


def fs_elements_to_md(elements):
    """飞书的 elements 数组 → 一行 markdown（行内样式与链接）。"""
    out = []
    for e in _fs_merge_runs(elements):
        if "text_run" in e:
            r = e["text_run"]
            s = r.get("content", "")
            st = r.get("text_element_style") or {}
            if not s:
                continue
            # 样式只包非空白部分，否则 `** 粗体 **` 在 markdown 里不生效
            lead = s[:len(s) - len(s.lstrip())]
            trail = s[len(s.rstrip()):]
            s = s.strip()
            if not s:
                out.append(lead + trail)
                continue
            # 行内代码与强调不叠加：代码里的星号不该被当成语法
            if st.get("inline_code"):
                s = f"`{s}`"
            else:
                if st.get("bold"):
                    s = f"**{s}**"
                if st.get("italic"):
                    s = f"*{s}*"
                if st.get("strikethrough"):
                    s = f"~~{s}~~"
            link = (st.get("link") or {}).get("url")
            if link:
                s = f"[{s}]({unquote(link)})"
            out.append(lead + s + trail)
        elif "equation" in e:
            out.append(f"${e['equation'].get('content', '').strip()}$")
        elif "mention_doc" in e:
            m = e["mention_doc"]
            out.append(f"[{m.get('title') or '飞书文档'}]({unquote(m.get('url', ''))})")
        elif "mention_user" in e:
            out.append(f"@{e['mention_user'].get('user_id', '某人')}")
    return "".join(out)


def _fs_text_of(block):
    """取一个 block 自带的那行文字，不管它挂在哪个键下。"""
    for k in _FS_TEXTLIKE:
        if k in block:
            return fs_elements_to_md((block[k] or {}).get("elements"))
    return ""


class _FsCtx:
    """渲染一篇 docx 要用到的外部信息，收成一个对象免得层层传参。

    `table` 是可选的取表回调 `(kind, token) -> [[单元格, ...], ...]`；
    给了就把多维表格与电子表格的内容内联成 markdown 表，没给（或取失败）
    就退回一条带可点链接的标记。
    """

    __slots__ = ("media_url", "board_url", "base", "table")

    def __init__(self, media_url, board_url, base="", table=None):
        self.media_url = media_url
        self.board_url = board_url
        self.base = base.rstrip("/")
        self.table = table

    def link(self, kind, token):
        """bitable / sheet 这类外部制品的可点链接。token 形如 <app>_<tbl>。"""
        head, _, tail = token.partition("_")
        if kind == "bitable":
            u = f"{self.base}/base/{head}" + (f"?table={tail}" if tail else "")
        else:
            u = f"{self.base}/sheets/{head}" + (f"?sheet={tail}" if tail else "")
        return u if self.base else token


def _fs_block(block, by_id, depth, ordinal, ctx):
    """渲染一个 block（含其子块），返回若干行。"""
    t = block.get("block_type")
    kids = [by_id[c] for c in block.get("children", []) or [] if c in by_id]

    def render_kids(d):
        return _fs_children(kids, by_id, d, ctx)

    if t == 1:                                    # page：标题另有其处，只渲染子块
        return render_kids(0)
    if t == 2:
        return [_fs_text_of(block)] + render_kids(depth)
    if t in _FS_HEADING:
        return ["#" * _FS_HEADING[t] + " " + _fs_text_of(block)] + render_kids(depth)
    if t == 12:
        pad = "  " * depth
        return [f"{pad}- {_fs_text_of(block)}"] + render_kids(depth + 1)
    if t == 13:
        pad = "  " * depth
        return [f"{pad}{ordinal}. {_fs_text_of(block)}"] + render_kids(depth + 1)
    if t == 14:
        code = block.get("code") or {}
        lang = _FS_LANG.get((code.get("style") or {}).get("language"), "")
        return [f"```{lang}", _fs_text_of(block), "```"]
    if t == 15:
        return [f"> {_fs_text_of(block)}"]
    if t == 17:
        done = ((block.get("todo") or {}).get("style") or {}).get("done")
        return [f"{'  ' * depth}- [{'x' if done else ' '}] {_fs_text_of(block)}"] + render_kids(depth + 1)
    if t == 22:
        return ["---"]
    if t == 19:                                   # callout：整块转引用，emoji 留在首行
        emoji = (block.get("callout") or {}).get("emoji_id")
        inner = render_kids(0)
        head = f"> **{emoji}**" if emoji else None
        lines = ([head] if head else []) + [("> " + ln if ln else ">") for ln in inner]
        return lines
    if t == 34:                                   # quote_container
        return [("> " + ln if ln else ">") for ln in render_kids(0)]
    if t == 49:                                   # source_synced：同步块，内容照渲染
        return render_kids(depth)
    if t == 31:
        return _fs_table(block, by_id, ctx)
    if t == 32:                                   # table_cell 由 _fs_table 负责
        return render_kids(0)
    if t == 27:
        token = (block.get("image") or {}).get("token", "")
        return [f"![]({ctx.media_url(token)})"] if token else []
    if t == 43:
        token = (block.get("board") or {}).get("token", "")
        # 画板是图形内容，导成图片；导不出时 run() 会在原位留失败注释
        return [f"![飞书画板]({ctx.board_url(token)})"] if token else []
    if t in (24, 25):
        # grid（分栏）与 grid_column 只是排版容器，内容全在子块里。
        # 早先漏了这两个，三处分栏的正文被整段丢掉。
        return render_kids(depth)
    if t == 40:
        return _fs_add_ons(block)
    if t == 50:
        r = block.get("reference_synced") or {}
        return [f"<!-- 引用同步块：源文档 {r.get('source_document_id', '?')} "
                f"的块 {r.get('source_block_id', '?')}，内容以源文档为准 -->"]
    if t == 51:
        return ["<!-- 子页面列表：各子页已各自归档，此处不重复 -->"]
    if t == 18:
        return _fs_external_table(ctx, "bitable", (block.get("bitable") or {}).get("token", ""))
    if t == 30:
        return _fs_external_table(ctx, "sheet", (block.get("sheet") or {}).get("token", ""))
    txt = _fs_text_of(block)
    marker = f"<!-- 飞书 block_type={t} 未支持，原文有内容未转换 -->"
    return ([txt] if txt else []) + [marker] if txt else [marker]


def _fs_flatten_cell(v):
    """bitable 的单元格值形状很多：字符串、数字、{link,text}、[{text},...]。"""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, dict):
        return str(v.get("text") or v.get("link") or v.get("name") or "")
    if isinstance(v, list):
        return " ".join(x for x in (_fs_flatten_cell(i) for i in v) if x)
    return str(v)


def _fs_grid_table(rows, caption):
    """二维数组 → markdown 表格。首行当表头，空单元格补空串。"""
    rows = [[("" if c is None else str(c)).replace("|", "\\|").replace("\n", " ")
             for c in r] for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = [f"<!-- {caption} -->",
           "| " + " | ".join(rows[0]) + " |",
           "|" + "---|" * width]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return out


def _fs_external_table(ctx, kind, token):
    """多维表格 / 电子表格：能取到就内联，取不到就留可点链接。

    这两类不在文档里，是独立制品，各需自己的权限。取不到时**必须留标记**——
    它们装的往往是字段清单、状态机这类实质内容，静默跳过等于丢文档的一半。
    """
    label = "多维表格（bitable）" if kind == "bitable" else "电子表格（sheet）"
    link = ctx.link(kind, token)
    if ctx.table and token:
        try:
            rows = ctx.table(kind, token)
        except Exception:
            rows = None
        if rows:
            return _fs_grid_table(rows, f"{label}，取自 {link}")
    return [f"<!-- {label}：{link} —— 未取到内容（需对应权限），请点链接查看 -->"]


def _fs_add_ons(block):
    """文档小组件（add_ons）：时间轴、流程条这类，正文藏在 record 的 JSON 里。

    只取 items 里的 title / text / time——那是用户真写进去的字。取不到就留标记，
    不要静默丢：这类块在这份知识库里有十三处。
    """
    rec = (block.get("add_ons") or {}).get("record") or ""
    try:
        items = (json.loads(rec) or {}).get("items") or []
    except ValueError:
        items = []
    lines = []
    for it in items:
        title = (it.get("title") or "").strip()
        extra = " · ".join(x for x in ((it.get("time") or "").strip(),
                                       (it.get("text") or "").strip()) if x)
        if title or extra:
            lines.append(f"- {title}" + (f"（{extra}）" if extra else ""))
    if not lines:
        return ["<!-- 文档小组件（add_ons）：没有可提取的文字 -->"]
    return ["<!-- 文档小组件（add_ons），原文是图形化的时间轴/流程条 -->"] + lines


_FS_LANG = {1: "", 8: "bash", 9: "c", 12: "csharp", 22: "go", 24: "html", 27: "java",
            28: "javascript", 29: "json", 43: "python", 49: "shell", 52: "sql",
            53: "swift", 56: "typescript", 60: "yaml", 63: "markdown"}


def _fs_children(kids, by_id, depth, ctx):
    """一串同级 block：有序列表在同级内自己数号。"""
    lines, n = [], 0
    for k in kids:
        n = n + 1 if k.get("block_type") == 13 else 0
        part = _fs_block(k, by_id, depth, n or 1, ctx)
        if lines and part:
            lines.append("")
        lines += part
    return lines


def _fs_table(block, by_id, ctx):
    """飞书表格 → markdown 表格。合并单元格转不了，退化成按格取文。"""
    tbl = block.get("table") or {}
    prop = tbl.get("property") or {}
    cols = prop.get("column_size") or 1
    cells = tbl.get("cells") or []
    texts = []
    for cid in cells:
        cell = by_id.get(cid)
        inner = _fs_children([by_id[c] for c in (cell or {}).get("children", []) or []
                              if c in by_id], by_id, 0, ctx) if cell else []
        # 单元格里换行会撑破表格，压成一行
        texts.append(" ".join(x.strip() for x in inner if x.strip()).replace("|", "\\|"))
    rows = [texts[i:i + cols] for i in range(0, len(texts), cols)]
    if not rows:
        return []
    out = []
    if prop.get("header_row"):
        out.append("| " + " | ".join(rows[0]) + " |")
        out.append("|" + "---|" * cols)
        rest = rows[1:]
    else:
        out.append("|" + "   |" * cols)
        out.append("|" + "---|" * cols)
        rest = rows
    for r in rest:
        out.append("| " + " | ".join(r + [""] * (cols - len(r))) + " |")
    return out


def feishu_doc_to_md(blocks, media_url=lambda t: t, board_url=lambda t: t,
                     base="", table=None):
    """一篇 docx 的 block 列表（扁平）→ markdown。

    block 之间的父子关系只在 `children` 里，返回顺序不保证是阅读顺序，
    所以必须先建索引再从 page 块往下走。
    """
    by_id = {b["block_id"]: b for b in blocks if b.get("block_id")}
    roots = [b for b in blocks if b.get("block_type") == 1]
    if not roots:
        # 没有 page 块（理论上不该发生）：退到「没有父亲的块」当根
        child_ids = {c for b in blocks for c in (b.get("children") or [])}
        roots = [b for b in blocks if b.get("block_id") not in child_ids]
    ctx = _FsCtx(media_url, board_url, base, table)
    lines = []
    for r in roots:
        lines += _fs_block(r, by_id, 0, 1, ctx)
    # 收敛多余空行
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


class FeishuAdapter:
    """飞书知识库（wiki）与云文档（docx）。

    和别的适配器不同，它**自己联网**：飞书要 Bearer token，而且一个知识库
    URL 对应的是一棵节点树而不是一篇文章。所以它实现 `expand()`，由 run()
    循环归档每个节点。

    凭据只从环境变量读，不落仓库：
        FEISHU_APP_ID / FEISHU_APP_SECRET
    需要的应用权限：wiki:wiki:readonly + docx:document:readonly
    （文档里有图片还要 drive:drive:readonly）。
    """

    name = "feishu"
    label = "飞书知识库"
    HOSTS = ("feishu.cn", "larksuite.com")

    @classmethod
    def match(cls, url):
        host = (urlparse(url).hostname or "").lower()
        return any(host == h or host.endswith("." + h) for h in cls.HOSTS)

    # ── 网络 ──
    _cached = None            # (token, 过期时刻)，一次抓取里复用

    @classmethod
    def _token(cls):
        now = time.time()
        if cls._cached and cls._cached[1] > now + 60:
            return cls._cached[0]
        tok, ttl = cls._new_token()
        cls._cached = (tok, now + ttl)
        return tok

    @staticmethod
    def _new_token():
        app_id = os.environ.get("FEISHU_APP_ID")
        secret = os.environ.get("FEISHU_APP_SECRET")
        if not app_id or not secret:
            raise ExtractFailed(
                "缺少飞书凭据：请设 FEISHU_APP_ID 与 FEISHU_APP_SECRET 环境变量"
                "（自建应用的 App ID / Secret，别写进仓库）")
        body = json.dumps({"app_id": app_id, "app_secret": secret}).encode()
        req = Request(f"{FEISHU_API}/auth/v3/tenant_access_token/internal",
                      data=body, headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
        if d.get("code") != 0 or not d.get("tenant_access_token"):
            raise ExtractFailed(f"取 tenant_access_token 失败：{d.get('msg')}")
        return d["tenant_access_token"], d.get("expire", 7200)

    @classmethod
    def _get(cls, path, token):
        req = Request(f"{FEISHU_API}{path}", headers={"Authorization": f"Bearer {token}"})
        try:
            with urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
        except Exception as e:
            body = getattr(e, "read", lambda: b"")() or b""
            try:
                d = json.loads(body)
            except ValueError:
                raise ExtractFailed(f"请求 {path} 失败：{e}")
        if d.get("code") != 0:
            raise ExtractFailed(f"飞书接口 {path.split('?')[0]} 返回 {d.get('code')}：{d.get('msg')}")
        return d.get("data") or {}

    @classmethod
    def _paged(cls, path, token, key="items"):
        """翻页取全部。飞书的 page_token 走 query，注意 path 可能已带参数。"""
        items, page = [], None
        while True:
            sep = "&" if "?" in path else "?"
            url = path + (f"{sep}page_token={page}" if page else "")
            d = cls._get(url, token)
            items += d.get(key) or []
            if not d.get("has_more"):
                return items
            page = d.get("page_token")
            time.sleep(0.15)          # 飞书有 QPS 限制，慢一点比被限流好

    # ── 编排 ──
    @staticmethod
    def _node_token(url):
        m = re.search(r"/(?:wiki|docx|docs)/([A-Za-z0-9]+)", url)
        if not m:
            raise ExtractFailed(f"URL 里认不出飞书节点 token：{url}")
        return m.group(1)

    @classmethod
    def _walk(cls, space, token, parent=None):
        """从 parent 往下列出所有后代节点（parent=None 即整个空间的顶层）。"""
        out = []
        path = f"/wiki/v2/spaces/{space}/nodes?page_size=50"
        if parent:
            path += f"&parent_node_token={parent}"
        for k in cls._paged(path, token):
            out.append(k)
            if k.get("has_child"):
                out += cls._walk(space, token, k["node_token"])
        return out

    @staticmethod
    def _is_docx(url):
        """URL 指的是云文档单篇，还是知识库里的一个节点。

        两种 token 不是一个东西：`/wiki/<node_token>` 得先换 space 再换
        obj_token，而 `/docx/<document_id>` 拿到的**就是** obj_token。混用的
        表现是 get_node 报「取不到节点」，而那份文档其实好好地在那儿。
        """
        return bool(re.search(r"/docx/[A-Za-z0-9]+", url))

    @classmethod
    def _doc_article(cls, obj_token, title, host, auth, label="飞书知识库"):
        """取一篇 docx 的全部块并转成 markdown。两条路共用。"""
        blocks = cls._paged(
            f"/docx/v1/documents/{obj_token}/blocks"
            f"?page_size=500&document_revision_id=-1", auth)
        body = feishu_doc_to_md(blocks, cls._media_url, cls._board_url,
                                base=f"https://{host}",
                                table=lambda k, tk: cls._table(k, tk, auth))
        return Article(title or obj_token, label, "", "", body_md=body)

    @classmethod
    def expand(cls, url, scope="space"):
        """返回 [(节点链接, Article), ...]。两种 URL 分两条路。

        `/docx/<id>` 是**云文档单篇**：没有节点树，直接取块，返回一篇。它不经
        get_node——那个接口只认 wiki 节点。

        `/wiki/<token>` 是**知识库**里某一页的链接，从它拿不到「知识库根」——
        所以默认 scope="space"：先用它换出 space_id，再从空间顶层整棵遍历。
        只要那一页及其子树时传 scope="node"（CLI 的 --node）。

        这里踩过一次：一开始只从给定节点往下走，结果 57 个节点里只下了 2 个，
        而调用者以为下的是整个知识库。
        """
        token = cls._token()
        head = cls._node_token(url)
        host = urlparse(url).hostname

        if cls._is_docx(url):
            meta = cls._get(f"/docx/v1/documents/{head}", token)
            title = ((meta.get("document") or {}).get("title") or "").strip()
            return [(url, cls._doc_article(head, title, host, token, "飞书云文档"))]

        node = (cls._get(f"/wiki/v2/spaces/get_node?token={head}", token) or {}).get("node")
        if not node:
            raise ExtractFailed(f"取不到知识库节点 {head}，确认应用已被加入该知识库的成员")
        space = node["space_id"]

        if scope == "space":
            nodes = cls._walk(space, token)
        else:
            nodes = [node] + cls._walk(space, token, node["node_token"])

        base = f"https://{host}/wiki/"
        out = []
        for n in nodes:
            if n.get("obj_type") != "docx":
                out.append((base + n["node_token"],
                            Article(n.get("title") or n["node_token"], "飞书知识库", "",
                                    "", body_md=f"<!-- 节点类型 {n.get('obj_type')}，"
                                                f"不是 docx 文档，未导出正文 -->")))
                continue
            out.append((base + n["node_token"],
                        cls._doc_article(n["obj_token"], n.get("title"), host, token)))
        return out

    @staticmethod
    def _media_url(token):
        return f"{FEISHU_API}/drive/v1/medias/{token}/download"

    @classmethod
    def _table(cls, kind, token, auth):
        """取多维表格 / 电子表格的内容，返回二维数组；取不到返回 None。

        两类的 token 都是 `<制品>_<子表>` 的拼接，先切开再各走各的接口。
        """
        head, _, tail = token.partition("_")
        if not head or not tail:
            return None
        if kind == "bitable":
            fields = cls._paged(f"/bitable/v1/apps/{head}/tables/{tail}"
                                f"/fields?page_size=200", auth)
            names = [f.get("field_name", "") for f in fields]
            recs = cls._paged(f"/bitable/v1/apps/{head}/tables/{tail}"
                              f"/records?page_size=200", auth)
            rows = [names]
            for r in recs:
                cells = []
                for n in names:
                    cells.append(_fs_flatten_cell((r.get("fields") or {}).get(n)))
                rows.append(cells)
            return rows if len(rows) > 1 else None
        meta = cls._get(f"/sheets/v3/spreadsheets/{head}/sheets/{tail}", auth)
        grid = ((meta.get("sheet") or {}).get("grid_properties") or {})
        rows_n = min(int(grid.get("row_count") or 0), 500) or 500
        cols_n = min(int(grid.get("column_count") or 0), 26) or 26
        last = chr(ord("A") + max(cols_n - 1, 0))
        d = cls._get(f"/sheets/v2/spreadsheets/{head}/values/"
                     f"{tail}!A1:{last}{rows_n}", auth)
        return ((d.get("valueRange") or {}).get("values")) or None

    @staticmethod
    def _board_url(token):
        """画板（whiteboard）导成图片。和普通图片不是同一个接口。"""
        return f"{FEISHU_API}/board/v1/whiteboards/{token}/download_as_image"

    @classmethod
    def image_get(cls, url):
        """带鉴权取图——飞书的图片地址不是公开可访问的。"""
        token = cls._token()
        req = Request(url, headers={"Authorization": f"Bearer {token}"})
        with urlopen(req, timeout=60) as r:
            return r.read(), r.headers.get("Content-Type")


_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I)


class _ImgAttrs(HTMLParser):
    """取**单个** <img> 标签的属性。

    只喂一个标签进来，不拿它解析整篇文档：属性值里可能带 `>`，用正则摘属性会
    摘错；而整篇 markdown 交给 HTMLParser 又会被非 HTML 的部分弄乱。所以用
    正则框出标签边界、用解析器读标签内部，各用其所长。
    """

    def __init__(self):
        super().__init__()
        self.attrs = {}

    def handle_starttag(self, tag, attrs):
        if tag == "img" and not self.attrs:
            self.attrs = {k.lower(): (v or "") for k, v in attrs}


def html_imgs_to_md(md):
    """把 HTML 的 <img> 换成 markdown 图片。

    GitHub 的 README 惯用 <img> 配 <p align="center"> 做排版，而 image_urls /
    rewrite_images 只认 markdown 的 `![]()`。不换的话两件事同时失手：相对 src
    补不成绝对地址（变断链），图片也不会被下载（留原站外链）——而仓库对图片的
    硬规则正是「素材图随素材落 raw/，绝不留原站外链」。丢掉的只是居中排版。
    """
    def sub(m):
        p = _ImgAttrs()
        p.feed(m.group(0))
        p.close()
        src = p.attrs.get("src", "").strip()
        if not src:
            return m.group(0)
        return f"![{p.attrs.get('alt', '').strip()}]({src})"
    return _IMG_TAG_RE.sub(sub, md)


class GitHubAdapter:
    """GitHub 仓库里的 markdown 源文件。

    走 expand 而不是 parse，两个理由：

    - `parse(html)` 拿不到 URL，而 owner / repo / ref / 路径全在 URL 里。GitHub
      的 blob 页是 JS 渲染的壳子，去刮它一改版就失手，URL 的形状却不会变。
    - 一个 `tree/` URL 天然对应一整个目录的文档，这正是 expand 的用途。

    正文用 `body_md` 而不是 `body_url`：相对链接必须在落盘前按 blob 基址补成
    绝对地址，而 `body_url` 的正文由 _save_one 取回后直接落盘，没有插手的机会。

    **`tree/` 是递归的。** 飞书适配器在这里踩过一次坑——只抓给定节点的直接
    子级，57 个节点里落了 2 个，而调用者以为抓的是整棵树。少抓而调用者不知道，
    比抓失败坏得多。

    两条已知边界，都是有意的：

    - **只认单段 ref**（分支名、tag、commit SHA）。`refs/heads/x` 或带斜杠的
      分支名会被当成「ref 第一段 + 路径」，不联网无法消歧。钉 SHA 时不受影响。
    - **不填发布时间**。逐文件取最后提交时间要 N 次 API 调用、撞未认证的限流，
      而拿 ref 自己的提交时间冒充某个文件的发布时间是错的。provenance 由原文
      链接里钉着的 ref 承担，抬头里另有抓取时间。
    """

    name = "github"
    label = "GitHub"
    HOSTS = ("github.com", "raw.githubusercontent.com")
    API = "https://api.github.com"

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse_url(url):
        """URL → (owner, repo, ref, path, kind)，kind 是 "blob" 或 "tree"。

        三种形状：

            github.com/<o>/<r>/blob/<ref>/<路径>            单篇
            github.com/<o>/<r>/tree/<ref>[/<路径>]          目录（递归）
            raw.githubusercontent.com/<o>/<r>/<ref>/<路径>  单篇
        """
        u = urlparse(url)
        parts = [unquote(x) for x in u.path.strip("/").split("/") if x]

        if u.hostname == "raw.githubusercontent.com":
            if len(parts) < 4:
                raise ExtractFailed(
                    "raw 链接至少要 <owner>/<repo>/<ref>/<路径> 四段，"
                    f"给的是 {url}")
            return parts[0], parts[1], parts[2], "/".join(parts[3:]), "blob"

        if len(parts) < 4 or parts[2] not in ("blob", "tree"):
            raise ExtractFailed(
                "只认这三种形状：\n"
                "    github.com/<owner>/<repo>/blob/<ref>/<路径>\n"
                "    github.com/<owner>/<repo>/tree/<ref>[/<路径>]\n"
                "    raw.githubusercontent.com/<owner>/<repo>/<ref>/<路径>\n"
                f"  给的是 {url}")

        kind = parts[2]
        path = "/".join(parts[4:])
        if kind == "blob" and not path:
            raise ExtractFailed(f"blob 链接缺文件路径：{url}")
        return parts[0], parts[1], parts[3], path, kind

    @staticmethod
    def title_for(repo_name, path):
        """归档标题。两处修整：

        - `/` 换成 ` · `——safe_filename 会把斜杠直接删掉，原样用路径会把
          packages/agent/README.md 挤成 packagesagentREADME.md。
        - 去掉结尾的 `.md`——archive() 落盘时自己会补扩展名，不去会得到
          「… README.md.md」。
        """
        if not path:
            return repo_name
        for ext in (".markdown", ".md"):
            if path.lower().endswith(ext):
                path = path[: -len(ext)]
                break
        return f"{repo_name} · " + path.replace("/", " · ")

    @staticmethod
    def raw_url(o, r, ref, path):
        return (f"https://raw.githubusercontent.com/{quote(o)}/{quote(r)}/"
                f"{quote(ref)}/{quote(path)}")

    @staticmethod
    def blob_base(o, r, ref, path):
        """相对链接的解析基址：该文件**所在目录**的 blob 地址。

        用 blob 而不是 raw 当基址，归档件里的相对链接才点得开成可读页面；
        末尾那个斜杠不能省，否则 urljoin 会把同目录相对地址解析到上一层。
        """
        d = path.rsplit("/", 1)[0] if "/" in path else ""
        return (f"https://github.com/{quote(o)}/{quote(r)}/blob/{quote(ref)}/"
                + (f"{quote(d)}/" if d else ""))

    @classmethod
    def md_paths(cls, tree, prefix):
        """从 git trees 的返回里挑出 prefix 下的 markdown 文件路径。

        纯函数，便于测试：联网的部分只负责把 tree 取回来。
        """
        pre = prefix.rstrip("/")
        out = []
        for item in tree:
            p = item.get("path", "")
            if item.get("type") != "blob" or not p.lower().endswith(".md"):
                continue
            if pre and not (p == pre or p.startswith(pre + "/")):
                continue
            out.append(p)
        return sorted(out)

    @classmethod
    def expand(cls, url, scope=None):
        """返回 [(该文件的 blob 链接, Article), ...]。

        `scope` 收下就扔——它是 CLI 为飞书留的开关（"space" / "node"），
        对 GitHub 没有意义。递归与否由 URL 是 blob 还是 tree 决定。
        """
        o, r, ref, path, kind = cls.parse_url(url)

        if kind == "blob":
            paths = [path]
        else:
            api = f"{cls.API}/repos/{quote(o)}/{quote(r)}/git/trees/{quote(ref)}?recursive=1"
            try:
                raw, _ = _http_get(api)
                data = json.loads(raw.decode("utf-8", "replace"))
            except Exception as e:
                raise ExtractFailed(f"取仓库文件树失败（{api}）：{e}")
            if data.get("truncated"):
                raise ExtractFailed(
                    f"{o}/{r}@{ref} 的文件树被 GitHub 截断了，列出来的不全。"
                    "raw/ 只进不改，宁可现在失败——请改用更深的 tree 路径"
                    "或逐个 blob 链接抓。")
            paths = cls.md_paths(data.get("tree", []), path)
            if not paths:
                raise ExtractFailed(
                    f"{o}/{r}@{ref} 的 {path or '仓库根'} 下没有 markdown 文件")

        items = []
        for p in paths:
            try:
                raw, _ = _http_get(cls.raw_url(o, r, ref, p))
            except Exception as e:
                raise ExtractFailed(f"取正文失败（{p}）：{e}")
            # 先把 <img> 转成 markdown，再补绝对地址——顺序反了就补不到 src
            body = absolutize(html_imgs_to_md(raw.decode("utf-8", "replace")),
                              cls.blob_base(o, r, ref, p))
            blob = (f"https://github.com/{quote(o)}/{quote(r)}/blob/"
                    f"{quote(ref)}/{quote(p)}")
            items.append((blob, Article(cls.title_for(r, p), f"{o}/{r}",
                                        None, "", body_md=body)))
        return items


# ── mariozechner.at ─────────────────────────────────────────


class _MarioZechnerPage(HTMLParser):
    """mariozechner.at 一页里要的两样：meta 与 <article> 的位置。

    meta 走解析器而不是 _meta()：这个站的 og 标签目前写法规矩，但正文容器
    只能靠解析器定位，顺手把 meta 一并收了，少一条会被改版骗过的正则。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.body_at = None

    def _offset(self):
        line, col = self.getpos()
        return self._line_offsets[line - 1] + col

    def feed_text(self, text):
        self._line_offsets, pos = [], 0
        for ln in text.split("\n"):
            self._line_offsets.append(pos)
            pos += len(ln) + 1
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"].strip())
        elif tag == "article" and self.body_at is None:
            self.body_at = self._offset()


class MarioZechnerAdapter:
    """mariozechner.at —— Mario Zechner 的个人博客，Pi 的设计理由出处。

    正文容器是 `<article>`，全页仅此一个；层级用 _div_inner 数，理由同
    martinfowler 那条——正则数标签会被属性值和注释骗到。

    发布时间取自 og:url 的 slug（`/posts/2025-11-30-pi-coding-agent/`）。
    页面正文里那行日期没有任何标记，`<time>` 和 `article:published_time`
    都没有；URL 的形状反而是这个站最稳的一处。取不到就留空，不猜。

    作者硬编码。这是单作者的个人站，页面上没有任何作者标记可读，而留空会把
    「谁说的」这条信息丢掉——取舍账全靠它。martinfowler 那边不敢硬编码是因为
    /articles/ 下有大量客座作者，这里没有这个结构。
    """

    name = "mariozechner"
    label = "mariozechner.at"
    HOSTS = ("mariozechner.at", "www.mariozechner.at")
    SLUG_DATE = re.compile(r"/posts/(\d{4}-\d{2}-\d{2})-")

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @staticmethod
    def parse(html):
        p = _MarioZechnerPage()
        p.feed_text(html)

        if p.body_at is None:
            raise ExtractFailed(
                "找不到 <article> 正文容器——站点可能改版了，"
                "去插件包 vault-tools/lib/document/fetch.py 的 MarioZechnerAdapter 修抽取锚点")

        page_url = p.meta.get("og:url")
        if not page_url:
            raise ExtractFailed("页面上没有 og:url——补不了相对地址，宁可失败也不往 raw/ 里留断链")

        body = _div_inner(_SCRIPT_RE.sub("", html), p.body_at, "article")
        if not body.strip():
            raise ExtractFailed("正文容器是空的")

        m = MarioZechnerAdapter.SLUG_DATE.search(urlparse(page_url).path)
        published = m.group(1) if m else ""
        if not repo.is_iso_date(published):
            published = ""

        return Article(p.meta.get("og:title") or "", "Mario Zechner", published, "",
                       body_md=absolutize(html_to_markdown(body), page_url))


class _PageIndex(HTMLParser):
    """一页里要的几样：meta、<title>、每个 <h1> 的文字、各开标签的位置。

    开标签位置按出现顺序记下（tag, id, class 词表, 偏移），正文锚点再从里面挑——
    同一个站不同栏目的容器不一样，挑法留给各适配器声明。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.tags, self.h1s = {}, [], []
        self.title = ""
        self._in = None                 # 正在收文字的标签：title 或 h1

    def _offset(self):
        line, col = self.getpos()
        return self._line_offsets[line - 1] + col

    def feed_text(self, text):
        self._line_offsets, pos = [], 0
        for ln in text.split("\n"):
            self._line_offsets.append(pos)
            pos += len(ln) + 1
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            if key and a.get("content"):
                self.meta.setdefault(key.lower(), a["content"].strip())
            return
        self.tags.append((tag, a.get("id") or "", (a.get("class") or "").split(), self._offset()))
        if tag in ("title", "h1"):
            self._in = tag
            if tag == "h1":
                self.h1s.append("")

    def handle_endtag(self, tag):
        if tag == self._in:
            self._in = None

    def handle_data(self, data):
        if self._in == "title":
            self.title += data
        elif self._in == "h1":
            self.h1s[-1] += data


class _ContainerAdapter:
    """靠「正文容器 + 几条元数据取法」就能抓干净的静态页，共用这一套。

    子类声明：

    - `HOSTS`：认的 host。
    - `BODY`：依次试的正文锚点 `(tag, "#id" 或 ".class")`，取第一个命中的；
      class 按空格分词匹配。一个都不中就报 ExtractFailed，不退回整页。
    - `BODY_END`：容器里正文之后还挂着按钮、版权栏时，从第一个命中的正则处截断。
    - `TITLE`：依次试的标题来源——`og:title` / `title` / `h1`（取最后一个非空
      h1，页头 logo 常占第一个）。`TITLE_STRIP` 是要从标题尾部剥掉的站名。
    - `AUTHOR`：作者取法，`meta:<name>` 或 `re:<带一组的正则>`；都不中时用
      `AUTHOR_FALLBACK`（机构官方文档没有个人作者，写机构名）。
    - `DATE`：日期正则列表，一组捕获「年 月 日」三段；取不到留空，不猜。

    这些站的正文都在服务端渲染好的 HTML 里。前端渲染的页（微信开放社区）
    抓下来容器是空的，照样报 ExtractFailed——不要为它加兜底。
    """

    name = label = ""
    HOSTS = ()
    BODY = ()
    BODY_END = ()
    TITLE = ("og:title", "title")
    TITLE_STRIP = ()
    AUTHOR = ()
    AUTHOR_FALLBACK = ""
    DATE = ()
    TAKES_URL = True                    # parse 要页面地址，用来补全相对图片地址

    @classmethod
    def match(cls, url):
        return urlparse(url).hostname in cls.HOSTS

    @classmethod
    def _title(cls, p):
        for src in cls.TITLE:
            if src == "h1":
                t = next((h.strip() for h in reversed(p.h1s) if h.strip()), "")
            elif src == "title":
                t = p.title.strip()
            else:
                t = p.meta.get(src, "")
            t = re.sub(r"\s+", " ", t)
            for s in cls.TITLE_STRIP:
                if t.endswith(s):
                    t = t[:-len(s)].rstrip()
            if t:
                return t
        return ""

    @classmethod
    def _author(cls, p, html):
        for src in cls.AUTHOR:
            kind, _, arg = src.partition(":")
            if kind == "meta":
                v = p.meta.get(arg, "")
            else:
                m = re.search(arg, html, re.S)
                v = unescape(m.group(1)) if m else ""
            if v.strip():
                return v.strip()
        return cls.AUTHOR_FALLBACK

    @classmethod
    def _date(cls, html):
        for pat in cls.DATE:
            m = re.search(pat, html)
            if m:
                d = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
                if repo.is_iso_date(d):
                    return d
        return ""

    @classmethod
    def parse(cls, html, url):
        stripped = _SCRIPT_RE.sub("", html)
        p = _PageIndex()
        p.feed_text(stripped)

        body = None
        for tag, sel in cls.BODY:
            for t, tid, tcls, at in p.tags:
                if t == tag and (tid == sel[1:] if sel[0] == "#" else sel[1:] in tcls):
                    body = _div_inner(stripped, at, tag)
                    break
            if body is not None:
                break
        if body is None:
            raise ExtractFailed(
                f"找不到正文容器（试过 {'、'.join(t + s for t, s in cls.BODY)}）——"
                f"站点可能改版了，去插件包 vault-tools/lib/document/fetch.py 的 {cls.__name__}.BODY 修抽取锚点")
        for pat in cls.BODY_END:
            m = re.search(pat, body)
            if m:
                body = body[:m.start()]
                break
        md = html_to_markdown(body)
        if not md.strip():
            raise ExtractFailed("正文容器是空的——多半是前端渲染的页，静态 HTML 里没有正文")

        # 元数据可能在 script 里（JSON-LD），从原始 HTML 取
        return Article(cls._title(p), cls._author(p, html), cls._date(html), "",
                       body_md=absolutize(md, url))


class WeChatPayDocAdapter(_ContainerAdapter):
    """微信支付商户文档中心与商户平台的规则页。

    文档中心（/doc/、/docs/）正文在 `#main-content`，更新时间写成
    「更新时间：2026.08.05」；商户平台的协议规则页正文在 `.container-bd`，
    日期写成「本协议最新修改日期：2026年8月24日」。两个站同属微信支付，
    pay.wechatpay.cn 是文档中心的新域名，页面结构相同。
    """

    name = "wechatpay-doc"
    label = "微信支付商户文档"
    HOSTS = ("pay.weixin.qq.com", "pay.wechatpay.cn")
    BODY = (("div", "#main-content"), ("div", ".container-bd"))
    TITLE = ("og:title", "title")
    TITLE_STRIP = ("|微信支付商户文档中心",)
    AUTHOR_FALLBACK = "微信支付"
    DATE = (r"更新时间：\s*(\d{4})\.(\d{1,2})\.(\d{1,2})",
            r"最新修改日期：\s*(\d{4})年(\d{1,2})月(\d{1,2})日")


class WeixinPageAdapter(_ContainerAdapter):
    """weixin.qq.com 的协议页（readtemplate）与 act.weixin.qq.com 的产品介绍页。

    协议页正文在 `.content_body`，产品页在 `.public`。两类页都不标日期；
    产品页的 <title> 是笼统的「解决方案」，标题取 h1。
    """

    name = "weixin"
    label = "微信官方页面"
    HOSTS = ("weixin.qq.com", "act.weixin.qq.com")
    BODY = (("div", ".content_body"), ("div", ".public"))
    TITLE = ("h1", "title")
    AUTHOR_FALLBACK = "微信支付"


class KfQQAdapter(_ContainerAdapter):
    """腾讯客服 FAQ（kf.qq.com/faq/）。正文在 `#faq_content`，页面不标日期。"""

    name = "kf-qq"
    label = "腾讯客服"
    HOSTS = ("kf.qq.com",)
    BODY = (("div", "#faq_content"),)
    TITLE = ("title",)
    TITLE_STRIP = ("- 腾讯客服",)
    AUTHOR_FALLBACK = "腾讯客服"


class WxDevDocAdapter(_ContainerAdapter):
    """微信开放文档（developers.weixin.qq.com 下的 /miniprogram/dev/ 等文档页）。

    正文在 `.page-inner`。同域的开放社区（/community/）是前端渲染的，静态
    HTML 里没有正文，抓它会按「容器为空」失败——这是预期行为。
    """

    name = "wx-devdoc"
    label = "微信开放文档"
    HOSTS = ("developers.weixin.qq.com",)
    BODY = (("div", ".page-inner"),)
    BODY_END = (r"<footer\b",)
    TITLE = ("title",)
    TITLE_STRIP = ("| 微信开放文档",)
    AUTHOR_FALLBACK = "微信开放平台"


class WoshipmAdapter(_ContainerAdapter):
    """人人都是产品经理（woshipm.com）。正文在 `.article--content`。

    作者与发布时间取 JSON-LD 里的 `author` / `datePublished`：页面上的作者名
    夹在一串 UI 标记里，JSON-LD 反而最稳。
    """

    name = "woshipm"
    label = "人人都是产品经理"
    HOSTS = ("www.woshipm.com", "woshipm.com")
    BODY = (("div", ".article--content"),)
    BODY_END = (r'<div class="article--copyright"',)       # 其后是点赞收藏与相关推荐
    TITLE = ("og:title", "title")
    TITLE_STRIP = ("– 人人都是产品经理", "| 人人都是产品经理")
    AUTHOR = (r're:"author"\s*:\s*"([^"]+)"',)
    DATE = (r'"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})',)


class BbtnewsAdapter(_ContainerAdapter):
    """北京商报（bbtnews.com.cn）。正文在 `#pageContent`，作者与日期在文章头的 span。"""

    name = "bbtnews"
    label = "北京商报"
    HOSTS = ("www.bbtnews.com.cn", "bbtnews.com.cn")
    BODY = (("div", "#pageContent"),)
    TITLE = ("title",)
    TITLE_STRIP = ("_北京商报",)
    AUTHOR = (r"re:<span>作者：\s*([^<]+?)\s*</span>",)
    AUTHOR_FALLBACK = "北京商报"
    DATE = (r"<span>(\d{4})-(\d{2})-(\d{2})</span>",)


class GmwAdapter(_ContainerAdapter):
    """光明网（gmw.cn，含 m. 移动版）。正文在 `#article_inbox`，日期取 meta publishdate。

    这个站不管请求头，照样回 gzip，解压在 _http_get 里做。
    """

    name = "gmw"
    label = "光明网"
    HOSTS = ("m.gmw.cn", "www.gmw.cn", "gmw.cn")
    BODY = (("div", "#article_inbox"),)
    TITLE = ("h1", "title")
    AUTHOR = ("meta:author",)
    AUTHOR_FALLBACK = "光明网"
    DATE = (r'name="publishdate"\s+content="(\d{4})-(\d{2})-(\d{2})"',)


class YicaiAdapter(_ContainerAdapter):
    """第一财经（yicai.com）。正文在 `#multi-text`，作者与日期在标题下一行。"""

    name = "yicai"
    label = "第一财经"
    HOSTS = ("www.yicai.com", "yicai.com")
    BODY = (("div", "#multi-text"),)
    TITLE = ("h1", "title")
    AUTHOR = (r"re:作者：([^&<]+)",)
    AUTHOR_FALLBACK = "第一财经"
    DATE = (r'<em class="f-fl">(\d{4})-(\d{2})-(\d{2})',)


class MpaypassAdapter(_ContainerAdapter):
    """移动支付网（mpaypass.com.cn，含 m. 移动版）。正文在 `.newslist-body`。"""

    name = "mpaypass"
    label = "移动支付网"
    HOSTS = ("m.mpaypass.com.cn", "www.mpaypass.com.cn", "mpaypass.com.cn")
    BODY = (("div", ".newslist-body"),)
    BODY_END = (r'<button[^>]*onClick="zan\(',)             # 点赞收藏按钮
    TITLE = ("title",)
    TITLE_STRIP = ("-移动支付网",)
    AUTHOR = (r'''re:newslist-body-authortext"><span[^>]*><a[^>]*>([^<]+)</a>''',)
    AUTHOR_FALLBACK = "移动支付网"
    DATE = (r'<span id="time">(\d{4})/(\d{1,2})/(\d{1,2})',)


class SalesforceDocAdapter(_ContainerAdapter):
    """Salesforce 开发者文档站（developer.salesforce.com）的指南页。

    正文页路径形态是 /docs/<guide>/<slug>.html（如 /docs/platform/api/guide/
    sforce-api-calls-convertlead.html），服务端渲染，容器在 main#maincontent。
    同域带 atlas 前缀的旧路径（/docs/atlas.en-us.api.meta/api/*.htm）与文档
    首页是前端渲染的壳——壳里同样有个空的 main#maincontent，抓它会按
    「容器为空」失败，这是预期行为，去站内面包屑找 /docs/<guide>/<slug>.html
    形态的正文页再抓。页面无 og:title、不标日期；<title> 尾部是
    「 | Salesforce Developers」。
    """

    name = "salesforce-doc"
    label = "Salesforce 开发者文档"
    HOSTS = ("developer.salesforce.com",)
    BODY = (("main", "#maincontent"),)
    TITLE = ("title",)
    TITLE_STRIP = (" | Salesforce Developers",)
    AUTHOR_FALLBACK = "Salesforce"


ADAPTERS = [WeChatAdapter, GistAdapter, PalantirAdapter, MartinFowlerAdapter,
            FeishuAdapter, GitHubAdapter, MarioZechnerAdapter,
            WeChatPayDocAdapter, WeixinPageAdapter, KfQQAdapter, WxDevDocAdapter,
            WoshipmAdapter, BbtnewsAdapter, GmwAdapter, YicaiAdapter, MpaypassAdapter,
            SalesforceDocAdapter]


def pick_adapter(url, forced=None):
    """选源类型：优先用 --type 强制指定，否则按 host 匹配。"""
    known = "、".join(a.name for a in ADAPTERS)
    if forced:
        for a in ADAPTERS:
            if a.name == forced:
                return a
        raise UnknownSource(f"没有名为 {forced} 的源类型（已有：{known}）")
    for a in ADAPTERS:
        if a.match(url):
            return a
    host = urlparse(url).hostname or url
    raise UnknownSource(
        f"没有适配 {host} 的源类型（已有：{known}）。\n"
        f"  要么用 --type <源类型> 强制指定，要么去插件包 vault-tools/lib/document/fetch.py 的 ADAPTERS 里加一个适配器。")


# ── 命名 ────────────────────────────────────────────────────

_FILENAME_BAD = r'[/\\:*?"<>|\x00-\x1f]'


def slugify(title, limit=40):
    """标题 → 目录名：只留中英数，截断。用作 raw/document/<日期>/ 下该篇的图片目录名。"""
    s = "".join(c for c in (title or "") if c.isalnum())
    return s[:limit] or "untitled"


def safe_filename(title):
    """标题 → 文件名：只去掉路径非法字符，其余原样保留可读性。"""
    return re.sub(_FILENAME_BAD, "", title or "").strip() or "untitled"


# ── 图片 ────────────────────────────────────────────────────

# alt 必须一起认：markdown 原文里的图片多半带 alt，只认空 alt 会让它漏过
# 下载，在只进不改的 raw/ 里永久留下一条原站外链。
_IMG_RE = re.compile(r"!\[(?P<alt>[^\]]*)\]\((?P<url>[^)\s]+)\)")

# 扩展名与 MIME 的对应关系交给 mimetypes，不自己维护表。


def image_urls(md):
    """正文里的图片地址，按出现顺序去重。"""
    seen, out = set(), []
    for m in _IMG_RE.finditer(md):
        u = m.group("url")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _ext_of(ctype):
    """MIME → 扩展名。mimetypes 顺带把 .jpeg 规范成 .jpg。"""
    return mimetypes.guess_extension(ctype) if ctype else None


def _bare_type(content_type):
    """从 Content-Type 头里摘掉参数：'image/webp; charset=binary' → 'image/webp'。"""
    msg = Message()
    msg["content-type"] = content_type
    return msg.get_content_type()


def ext_for(url, content_type=None):
    """定扩展名：URL 后缀 → 微信的 wx_fmt 参数 → Content-Type → 退回 .png。"""
    ext = _ext_of(mimetypes.guess_type(urlparse(url).path)[0])
    if ext:
        return ext
    fmt = parse_qs(urlparse(url).query).get("wx_fmt", [None])[0]
    if fmt:
        ext = _ext_of(mimetypes.guess_type(f"x.{fmt.lower()}")[0])
        if ext:
            return ext
    if content_type:
        ext = _ext_of(_bare_type(content_type))
        if ext:
            return ext
    return ".png"


def rewrite_images(md, mapping):
    """把正文里的原始图片地址换成本地路径；值为 None 表示没下下来。

    mapping 里是仓库根起的路径（image_dest 给的），原样落进正文——
    图片一律仓库根起引，理由见 repo.py 素材图随素材走的注释。
    """
    def sub(m):
        u = m.group("url")
        if u not in mapping:
            return m.group(0)
        local = mapping[u]
        if not local:
            return f"<!-- 图片下载失败: {u} -->"
        return f"![{m.group('alt')}]({local})"
    return _IMG_RE.sub(sub, md)


# ── 渲染 ────────────────────────────────────────────────────

def render(article, adapter, url, body_md, fetched_on):
    """拼出归档文件：抬头 + 分隔线 + 正文。"""
    def val(x):
        return x if x else "（未知）"

    head = [
        f"# {article.title or '（无标题）'}",
        "",
        f"- 源类型：{adapter.label}",
        f"- 来源：「{article.author}」" if article.author else "- 来源：（未知）",
        f"- 原文链接：{url}",
        f"- 发布时间：{val(article.published)}",
        f"- 抓取时间：{fetched_on}",
        f"- 适配器：{adapter.name}",
    ]
    return "\n".join(head) + "\n\n---\n\n" + body_md + "\n"


# ── 落盘 ────────────────────────────────────────────────────

def image_dest(root, day, slug, index, ext):
    """第 index 张图的绝对路径与仓库根起的相对路径。素材图随素材走，落在该篇自己的 images/ 下。"""
    rel_path = f"raw/document/{day}/{slug}/images/{index + 1:02d}{ext}"
    return Path(root) / rel_path, rel_path


def archive_path(day, title):
    """归档件在仓库里的位置。抽出来是因为正文改写要先知道页落在哪一层。"""
    return f"raw/document/{day}/{safe_filename(title)}.md"


def archive(root, day, title, text):
    """把正文写进 raw/document/<day>/，返回仓库根起的相对路径。"""
    rel_path = archive_path(day, title)
    target = Path(root) / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(rel_path)
    target.write_text(text, encoding="utf-8")
    gk = target.parent / ".gitkeep"
    if gk.exists():
        gk.unlink()
    return rel_path


# ── 编排（唯一碰网络的地方） ─────────────────────────────────

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def _http_get(url, timeout=30):
    try:
        req = Request(url, headers={"User-Agent": UA})
        with urlopen(req, timeout=timeout) as r:
            data = r.read()
            # 没发 Accept-Encoding 也有站照样回 gzip（光明网）
            if r.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            return data, r.headers.get("Content-Type")
    except (HTTPError, URLError) as e:
        # 有的站在 TLS 指纹层拦 python-urllib（加不加浏览器头都是 403，
        # curl 却能过，Salesforce 开发者文档站如此），退 curl 再试一次；
        # curl 不在或也失败，仍按原异常报——抓不到就是抓不到。
        try:
            r = subprocess.run(
                ["curl", "--compressed", "-sL", "-f", "--max-time", str(timeout), url],
                capture_output=True)
        except OSError:
            raise e
        if r.returncode != 0:
            raise e
        return r.stdout, None


def _save_one(root, out, adapter, article, url, day):
    """一篇文章：取正文 → 下图 → 归档。返回归档路径，已存在或失败则 None。"""
    rel_target = f"raw/document/{day}/{safe_filename(article.title)}.md"
    if (Path(root) / rel_target).exists():
        out.err(f"目标已存在：{rel_target}（raw/ 只进不改，要重抓请先手动删）")
        return None

    if article.body_md is not None:
        body = article.body_md
    elif article.body_url:
        try:
            raw_body, _ = _http_get(article.body_url)
        except Exception as e:
            out.err(f"取正文失败（{article.body_url}）：{e}")
            return None
        body = raw_body.decode("utf-8", "replace")
    else:
        body = html_to_markdown(article.body_html)

    # 源站的图片要鉴权时（飞书），用适配器自己的取法
    getter = getattr(adapter, "image_get", None) or _http_get
    slug = slugify(article.title)
    urls = image_urls(body)
    mapping, ok_n = {}, 0
    for i, u in enumerate(urls):
        try:
            data, ct = getter(u)
            dest, rel_img = image_dest(root, day, slug, i, ext_for(u, ct))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            mapping[u], ok_n = rel_img, ok_n + 1
        except Exception as e:
            out.warn(f"第 {i + 1} 张图片下载失败，正文留注释：{e}")
            mapping[u] = None
    if urls:
        out.ok(f"下载 {ok_n}/{len(urls)} 张图片 → raw/document/{day}/{slug}/images/")

    rel_path = archive(root, day, article.title,
                       render(article, adapter, url,
                              rewrite_images(body, mapping), day))
    out.ok(f"归档 → {rel_path}")
    return rel_path


def run(root, url, forced=None, scope=None):
    out = repo.Out()

    try:
        adapter = pick_adapter(url, forced)
    except UnknownSource as e:
        out.err(str(e))
        return 1
    out.info(f"源类型：{adapter.label}（{adapter.name}）")

    day = repo.today()

    # 一个 URL 对应一棵树的源（飞书知识库）：适配器自己联网，返回多篇
    if hasattr(adapter, "expand"):
        try:
            items = adapter.expand(url, scope) if scope else adapter.expand(url)
        except ExtractFailed as e:
            out.err(str(e))
            return 1
        out.ok(f"取到 {len(items)} 个节点")
        saved, failed = [], 0
        for node_url, article in items:
            out.info(f"「{article.title}」")
            got = _save_one(root, out, adapter, article, node_url, day)
            saved.append(got) if got else (failed := failed + 1)
        out.ok(f"归档 {len(saved)}/{len(items)} 篇 → raw/document/{day}/")
        if saved:
            out.info(f"下一步：wiki page new <路径> <标题> 写沉淀页，source 指向 {saved[0]}")
        return 1 if failed else 0

    try:
        raw, _ = _http_get(url)
    except Exception as e:
        out.err(f"抓取失败：{e}")
        return 1

    try:
        html = raw.decode("utf-8", "replace")
        article = adapter.parse(html, url) if getattr(adapter, "TAKES_URL", False) else adapter.parse(html)
    except ExtractFailed as e:
        out.err(str(e))
        return 1
    out.ok(f"抓取「{article.title}」（{article.author or '未知作者'} · "
           f"{article.published or '未知日期'}）")

    rel_path = _save_one(root, out, adapter, article, url, day)
    if not rel_path:
        return 1
    out.info(f"下一步：wiki page new <路径> <标题> 写沉淀页，source 指向 {rel_path}")
    return 0
