"""fetch.py 的单元测试 —— 只测纯函数，不碰网络。

跑： python3 vault-tools/tests/test_fetch.py
"""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from document import fetch  # noqa: E402


class TestHtmlToMarkdown(unittest.TestCase):
    """HTML → Markdown 的结构化转换。"""

    def md(self, html):
        return fetch.html_to_markdown(html)

    def test_标题按层级转成井号(self):
        self.assertEqual(self.md("<h1>大标题</h1>"), "# 大标题")
        self.assertEqual(self.md("<h3>小标题</h3>"), "### 小标题")

    def test_段落之间空一行(self):
        self.assertEqual(self.md("<p>第一段</p><p>第二段</p>"), "第一段\n\n第二段")

    def test_br_转成硬换行而不是分段(self):
        self.assertEqual(self.md("<p>上句<br>下句</p>"), "上句\n下句")

    def test_加粗和斜体(self):
        self.assertEqual(self.md("<p><strong>粗</strong>和<em>斜</em></p>"), "**粗**和*斜*")

    def test_b_和_i_等同于_strong_和_em(self):
        self.assertEqual(self.md("<p><b>粗</b><i>斜</i></p>"), "**粗***斜*")

    def test_链接转成行内形式(self):
        self.assertEqual(self.md('<p>见<a href="https://e.com">这里</a></p>'),
                         "见[这里](https://e.com)")

    def test_没有_href_的_a_只留文字(self):
        self.assertEqual(self.md("<p>见<a>这里</a></p>"), "见这里")

    def test_无序列表(self):
        self.assertEqual(self.md("<ul><li>甲</li><li>乙</li></ul>"), "- 甲\n- 乙")

    def test_有序列表按序号编号(self):
        self.assertEqual(self.md("<ol><li>甲</li><li>乙</li><li>丙</li></ol>"),
                         "1. 甲\n2. 乙\n3. 丙")

    def test_引用块每行加尖括号(self):
        self.assertEqual(self.md("<blockquote><p>被引的话</p></blockquote>"), "> 被引的话")

    def test_代码块用三反引号围起来(self):
        self.assertEqual(self.md("<pre><code>x = 1</code></pre>"), "```\nx = 1\n```")

    def test_行内代码用单反引号(self):
        self.assertEqual(self.md("<p>调用 <code>foo()</code></p>"), "调用 `foo()`")

    def test_分隔线(self):
        self.assertEqual(self.md("<p>上</p><hr><p>下</p>"), "上\n\n---\n\n下")

    def test_图片保留原始地址等待后续改写(self):
        self.assertEqual(self.md('<p><img src="https://e.com/a.png"></p>'),
                         "![](https://e.com/a.png)")

    def test_微信图片取_data_src_而不是占位的_src(self):
        html = '<p><img src="data:image/gif;base64,R0lGOD" data-src="https://e.com/real.png"></p>'
        self.assertEqual(self.md(html), "![](https://e.com/real.png)")

    def test_实体与不换行空格被还原(self):
        self.assertEqual(self.md("<p>a&amp;b&nbsp;c</p>"), "a&b c")

    def test_script_与_style_的内容被丢弃(self):
        html = "<p>正文</p><script>var x = 1;</script><style>p{color:red}</style>"
        self.assertEqual(self.md(html), "正文")

    def test_连续多个空行压成一个(self):
        self.assertEqual(self.md("<p>上</p><p></p><p></p><p>下</p>"), "上\n\n下")

    def test_section_套娃不产生多余空行(self):
        html = "<section><section><p>只有一段</p></section></section>"
        self.assertEqual(self.md(html), "只有一段")


WECHAT_FIXTURE = """<!DOCTYPE html><html><head>
<meta property="og:title" content="了解下 OKF" />
<meta property="og:article:author" content="Duang的碎碎记" />
</head><body>
<script>var nickname = htmlDecode("Duang的碎碎记");var ct = "1783857109";</script>
<div class="rich_media_content" id="js_content"><p>正文第一段</p></div>
<div class="rich_media_tool">点赞</div>
</body></html>"""


class TestAdapterDispatch(unittest.TestCase):
    """源类型的识别与强制指定。"""

    def test_公众号链接命中_wechat_适配器(self):
        a = fetch.pick_adapter("https://mp.weixin.qq.com/s/C-0Ab1nq")
        self.assertEqual(a.name, "wechat")

    def test_适配器带中文标签用于输出(self):
        self.assertEqual(fetch.pick_adapter("https://mp.weixin.qq.com/s/x").label, "微信公众号")

    def test_认不出的_host_直接报错不做兜底(self):
        with self.assertRaises(fetch.UnknownSource):
            fetch.pick_adapter("https://example.com/post/1")

    def test_报错信息里带上可选的源类型(self):
        with self.assertRaises(fetch.UnknownSource) as cm:
            fetch.pick_adapter("https://example.com/post/1")
        self.assertIn("wechat", str(cm.exception))

    def test_强制指定源类型可以绕过_host_匹配(self):
        a = fetch.pick_adapter("https://example.com/x", forced="wechat")
        self.assertEqual(a.name, "wechat")

    def test_强制指定一个不存在的源类型也报错(self):
        with self.assertRaises(fetch.UnknownSource):
            fetch.pick_adapter("https://mp.weixin.qq.com/s/x", forced="douban")

    def test_salesforce_文档页命中_salesforce_doc_适配器(self):
        a = fetch.pick_adapter(
            "https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-convertlead.html")
        self.assertEqual(a.name, "salesforce-doc")

    def test_salesforce_正文容器抽取与标题剥站名(self):
        html = ('<html><head><title>convertLead() | Core Calls '
                '| Salesforce Developers</title></head><body>'
                '<main role="main" id="maincontent">'
                '<p>Converts a Lead into another object.</p>'
                '</main><footer>site chrome</footer></body></html>')
        a = fetch.SalesforceDocAdapter.parse(html, "https://developer.salesforce.com/docs/platform/api/guide/x.html")
        self.assertEqual(a.title, "convertLead() | Core Calls")
        self.assertEqual(a.author, "Salesforce")
        self.assertIn("Converts a Lead", a.body_md)
        self.assertNotIn("site chrome", a.body_md)


class TestWeChatAdapter(unittest.TestCase):
    """微信公众号的抽取锚点。"""

    def setUp(self):
        self.art = fetch.WeChatAdapter.parse(WECHAT_FIXTURE)

    def test_标题取自_og_title(self):
        self.assertEqual(self.art.title, "了解下 OKF")

    def test_作者取自_nickname_变量(self):
        self.assertEqual(self.art.author, "Duang的碎碎记")

    def test_发布日期由_ct_时间戳换算(self):
        self.assertEqual(self.art.published, "2026-07-12")

    def test_正文只取_js_content_不含页尾工具栏(self):
        self.assertIn("正文第一段", self.art.body_html)
        self.assertNotIn("点赞", self.art.body_html)

    def test_抽不到正文时报错而不是产出空文件(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.WeChatAdapter.parse("<html><body>什么都没有</body></html>")


class TestSlugAndFilename(unittest.TestCase):
    """标题 → 目录名 / 文件名。"""

    def test_slug_去掉空格和标点只留中英数(self):
        self.assertEqual(fetch.slugify("了解下 OKF — Open Knowledge Format（开放知识格式）"),
                         "了解下OKFOpenKnowledgeFormat开放知识格式")

    def test_slug_保留中英数(self):
        self.assertEqual(fetch.slugify("Hello 世界 2026!"), "Hello世界2026")

    def test_slug_截断到四十字(self):
        self.assertEqual(len(fetch.slugify("字" * 100)), 40)

    def test_slug_全是标点时退回默认名(self):
        self.assertEqual(fetch.slugify("！！！"), "untitled")

    def test_文件名去掉路径非法字符(self):
        self.assertEqual(fetch.safe_filename("a/b:c*d?e"), "abcde")

    def test_文件名保留中文与括号破折号(self):
        self.assertEqual(fetch.safe_filename("了解下 OKF — Format（格式）"),
                         "了解下 OKF — Format（格式）")


class TestGistAdapter(unittest.TestCase):
    """GitHub Gist：元数据从页面抽，正文另取 /raw 的原始 markdown。"""

    HEAD = ('<meta property="og:title" content="llm-wiki">'
            '<meta property="og:url" content="https://gist.github.com/karpathy/442a6b">')
    NAME = ('<strong itemprop="name" class="css-truncate-target mr-1">'
            '<a href="/karpathy/442a6b">llm-wiki.md</a></strong>')
    CREATED = ('<div class="note m-0">Created '
               '<relative-time tense="past" datetime="2026-04-04T16:25:13Z">'
               'April 4, 2026 16:25</relative-time></div>')

    def page(self, head=None, name=None, created=None):
        return (head if head is not None else self.HEAD) + \
               (name if name is not None else self.NAME) + \
               (created if created is not None else self.CREATED)

    def test_认得_gist_的_host(self):
        self.assertTrue(fetch.GistAdapter.match(
            "https://gist.github.com/karpathy/442a6b"))
        self.assertFalse(fetch.GistAdapter.match("https://github.com/karpathy/nanoGPT"))

    def test_标题取_og_title(self):
        self.assertEqual(fetch.GistAdapter.parse(self.page()).title, "llm-wiki")

    def test_作者取_og_url_路径里的_owner(self):
        self.assertEqual(fetch.GistAdapter.parse(self.page()).author, "karpathy")

    def test_发布时间取创建时刻的日期部分(self):
        self.assertEqual(fetch.GistAdapter.parse(self.page()).published, "2026-04-04")

    def test_正文地址指向_raw_而不是内联_html(self):
        art = fetch.GistAdapter.parse(self.page())
        self.assertEqual(art.body_url, "https://gist.github.com/karpathy/442a6b/raw")
        self.assertFalse(art.body_html)

    def test_多文件_gist_直接报错而不是只归档第一个(self):
        """/raw 不带文件名只返回第一个文件，静默吞掉其余的就是往 raw/ 里塞残缺素材。"""
        two = self.NAME + ('<strong itemprop="name">'
                           '<a href="/karpathy/442a6b">notes.md</a></strong>')
        with self.assertRaises(fetch.ExtractFailed):
            fetch.GistAdapter.parse(self.page(name=two))

    def test_抽不到标题就报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.GistAdapter.parse(self.page(head=""))

    def test_抽不到文件名就报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.GistAdapter.parse(self.page(name=""))

    def test_没有创建时刻时发布时间留空而不是报错(self):
        self.assertEqual(fetch.GistAdapter.parse(self.page(created="")).published, "")

    def test_注册进_ADAPTERS(self):
        self.assertIn(fetch.GistAdapter, fetch.ADAPTERS)
        self.assertIs(fetch.pick_adapter("https://gist.github.com/karpathy/442a6b"),
                      fetch.GistAdapter)


class TestPalantirAdapter(unittest.TestCase):
    """Palantir 官方文档：markdown 源码整份塞在 __NEXT_DATA__ 里，直接取。"""

    MD = ("![头图](/docs/resources/foundry/ontology/header.png)\n\n"
          "# Ontology building\n\n"
          "See [object types](/docs/foundry/object-link-types/object-types-overview/) "
          "and [learn.palantir.com ↗](https://learn.palantir.com/x).\n")

    def page(self, markdown=MD, page_title="Documentation | Ontology building > Overview",
             wrap=True):
        props = {"props": {"pageProps": {"markdown": markdown,
                                         "metadata": {"data": {"pageTitle": page_title}}}}}
        body = json.dumps(props)
        if not wrap:
            return "<html><body>没有 NEXT_DATA</body></html>"
        return ('<html><body><div>正文占位</div>'
                '<script id="__NEXT_DATA__" type="application/json" crossorigin="">'
                + body + "</script></body></html>")

    def test_认得_palantir_的_host(self):
        self.assertTrue(fetch.PalantirAdapter.match(
            "https://palantir.com/docs/foundry/ontology/overview/"))
        self.assertTrue(fetch.PalantirAdapter.match(
            "https://www.palantir.com/docs/foundry/ontology/overview"))
        self.assertFalse(fetch.PalantirAdapter.match("https://learn.palantir.com/x"))

    def test_正文取_markdown_源码而不是渲染后的_html(self):
        art = fetch.PalantirAdapter.parse(self.page())
        self.assertIn("# Ontology building", art.body_md)
        self.assertFalse(art.body_html)
        self.assertIsNone(art.body_url)

    def test_标题去掉_Documentation_前缀并把面包屑连起来(self):
        self.assertEqual(fetch.PalantirAdapter.parse(self.page()).title,
                         "Ontology building · Overview")

    def test_没有_pageTitle_时退回正文的一级标题(self):
        self.assertEqual(fetch.PalantirAdapter.parse(self.page(page_title="")).title,
                         "Ontology building")

    def test_站内相对地址补成绝对地址(self):
        """图片不补成绝对地址，_http_get 会直接失败，raw/ 里永久留一条断链。"""
        md = fetch.PalantirAdapter.parse(self.page()).body_md
        self.assertIn("(https://palantir.com/docs/resources/foundry/ontology/header.png)", md)
        self.assertIn("(https://palantir.com/docs/foundry/object-link-types/"
                      "object-types-overview/)", md)

    def test_已经是绝对地址的外链不动(self):
        md = fetch.PalantirAdapter.parse(self.page()).body_md
        self.assertIn("(https://learn.palantir.com/x)", md)
        self.assertNotIn("palantir.comhttps", md)

    def test_补完地址后图片能被收集到(self):
        art = fetch.PalantirAdapter.parse(self.page())
        self.assertEqual(fetch.image_urls(art.body_md),
                         ["https://palantir.com/docs/resources/foundry/ontology/header.png"])

    def test_官方文档不署名也不标日期(self):
        art = fetch.PalantirAdapter.parse(self.page())
        self.assertEqual(art.author, "Palantir")
        self.assertEqual(art.published, "")

    def test_没有_NEXT_DATA_就报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.PalantirAdapter.parse(self.page(wrap=False))

    def test_不是文档页_没有_markdown_就报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.PalantirAdapter.parse(self.page(markdown=""))

    def test_注册进_ADAPTERS(self):
        self.assertIn(fetch.PalantirAdapter, fetch.ADAPTERS)
        self.assertIs(fetch.pick_adapter("https://palantir.com/docs/foundry/ontology/overview/"),
                      fetch.PalantirAdapter)


class TestMartinFowlerAdapter(unittest.TestCase):
    """martinfowler.com：meta 写法古怪，作者可能是客座作者，正文地址是相对路径。"""

    # 注意这个站的写法：等号两侧带空格、单引号、content 在 property 前面
    META = ("<meta content = 'bliki: Bounded Context' property = 'og:title'>"
            "<meta content = 'https://martinfowler.com/bliki/BoundedContext.html'"
            " property = 'og:url'>"
            "<meta content = '2014-01-15 09:08:00 -0500'"
            " property = 'og:article:modified_time'>")
    AUTHOR = ("<address class = 'name'>"
              "<a href = 'https://twitter.com/zhamakd' rel = 'author'>Zhamak Dehghani</a>"
              "</address>")
    BODY = ("<div class = 'paperBody'>"
            "<p>Bounded Context is a central pattern.</p>"
            "<img src = 'images/boundedContext/sketch.png'>"
            "<p><a href = '/bliki/UbiquitousLanguage.html'>UL</a></p>"
            "</div>")

    def page(self, meta=None, author=None, body=None):
        return ("<html><head>" + (self.META if meta is None else meta) + "</head><body>"
                + "<div class = 'nav'>导航不该进正文</div>"
                + (self.AUTHOR if author is None else author)
                + (self.BODY if body is None else body)
                + "<footer>页尾</footer></body></html>")

    def test_认得_host(self):
        self.assertTrue(fetch.MartinFowlerAdapter.match(
            "https://martinfowler.com/bliki/BoundedContext.html"))
        self.assertTrue(fetch.MartinFowlerAdapter.match(
            "https://www.martinfowler.com/articles/data-mesh-principles.html"))
        self.assertFalse(fetch.MartinFowlerAdapter.match("https://thoughtworks.com/x"))

    def test_meta_的空格与属性顺序不影响抽取(self):
        """_meta() 的正则要求 content=" 紧挨着，在这个站上一条都匹配不到。"""
        art = fetch.MartinFowlerAdapter.parse(self.page())
        self.assertEqual(art.title, "Bounded Context")

    def test_标题去掉_bliki_前缀(self):
        self.assertEqual(fetch.MartinFowlerAdapter.parse(self.page()).title, "Bounded Context")

    def test_作者取_rel_author_而不是硬编码站主(self):
        """/articles/ 下有大量客座作者，署成 Martin Fowler 就错了。"""
        self.assertEqual(fetch.MartinFowlerAdapter.parse(self.page()).author, "Zhamak Dehghani")

    def test_没有作者锚点时留空(self):
        self.assertEqual(fetch.MartinFowlerAdapter.parse(self.page(author="")).author, "")

    def test_发布日期取_modified_time_的日期部分(self):
        self.assertEqual(fetch.MartinFowlerAdapter.parse(self.page()).published, "2014-01-15")

    def test_日期形状不对就留空而不是写脏值(self):
        bad = self.META.replace("2014-01-15 09:08:00 -0500", "some time in 2014")
        self.assertEqual(fetch.MartinFowlerAdapter.parse(self.page(meta=bad)).published, "")

    def test_正文只取_paperBody_不含导航与页尾(self):
        md = fetch.MartinFowlerAdapter.parse(self.page()).body_md
        self.assertIn("Bounded Context is a central pattern", md)
        self.assertNotIn("导航不该进正文", md)
        self.assertNotIn("页尾", md)

    def test_同目录相对图片按页面所在目录补全(self):
        """`images/x.png` 必须相对 /bliki/ 解析，拼 origin 会拼成 /images/x.png。"""
        md = fetch.MartinFowlerAdapter.parse(self.page()).body_md
        self.assertIn("https://martinfowler.com/bliki/images/boundedContext/sketch.png", md)

    def test_站内绝对路径也补全(self):
        md = fetch.MartinFowlerAdapter.parse(self.page()).body_md
        self.assertIn("https://martinfowler.com/bliki/UbiquitousLanguage.html", md)

    def test_容器带多个_class_也认得(self):
        """/articles/ 下是 class='paperBody deep'，拿整串做等值比较会漏掉。"""
        multi = self.BODY.replace("class = 'paperBody'", "class = 'paperBody deep'")
        md = fetch.MartinFowlerAdapter.parse(self.page(body=multi)).body_md
        self.assertIn("Bounded Context is a central pattern", md)

    def test_没有正文容器就报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.MartinFowlerAdapter.parse(self.page(body="<div class = 'other'>x</div>"))

    def test_没有_og_url_就报错而不是留一堆断链(self):
        no_url = self.META.replace(
            "<meta content = 'https://martinfowler.com/bliki/BoundedContext.html'"
            " property = 'og:url'>", "")
        with self.assertRaises(fetch.ExtractFailed):
            fetch.MartinFowlerAdapter.parse(self.page(meta=no_url))

    def test_注册进_ADAPTERS(self):
        self.assertIn(fetch.MartinFowlerAdapter, fetch.ADAPTERS)
        self.assertIs(fetch.pick_adapter("https://martinfowler.com/bliki/BoundedContext.html"),
                      fetch.MartinFowlerAdapter)


class TestAbsolutize(unittest.TestCase):
    """相对地址补全：两种形状，加一个不该动的。"""

    BASE = "https://martinfowler.com/bliki/BoundedContext.html"

    def test_同目录相对路径相对页面目录解析(self):
        self.assertEqual(fetch.absolutize("![](images/x.png)", self.BASE),
                         "![](https://martinfowler.com/bliki/images/x.png)")

    def test_站内绝对路径相对站点根解析(self):
        self.assertEqual(fetch.absolutize("[a](/articles/y.html)", self.BASE),
                         "[a](https://martinfowler.com/articles/y.html)")

    def test_纯锚点不动(self):
        self.assertEqual(fetch.absolutize("[z](#sec)", self.BASE), "[z](#sec)")

    def test_已经是绝对地址的外链不动(self):
        self.assertEqual(fetch.absolutize("[e](https://e.com/q)", self.BASE),
                         "[e](https://e.com/q)")


class TestArticleBodyUrl(unittest.TestCase):
    """body_url 是「正文已是 markdown，去这儿取」的信号，默认没有。"""

    def test_默认为空(self):
        self.assertIsNone(fetch.Article("标题", "作者", "2026-01-01", "<p>x</p>").body_url)

    def test_body_md_默认为空(self):
        self.assertIsNone(fetch.Article("标题", "作者", "2026-01-01", "<p>x</p>").body_md)


class TestImages(unittest.TestCase):
    """正文里的图片：收集、定扩展名、改写成本地路径。"""

    def test_按出现顺序收集图片地址(self):
        md = "![](https://e.com/a.png)\n文字\n![](https://e.com/b.png)"
        self.assertEqual(fetch.image_urls(md), ["https://e.com/a.png", "https://e.com/b.png"])

    def test_重复出现的图片只算一张(self):
        md = "![](https://e.com/a.png)\n![](https://e.com/a.png)"
        self.assertEqual(fetch.image_urls(md), ["https://e.com/a.png"])

    def test_没有图片时返回空(self):
        self.assertEqual(fetch.image_urls("纯文字"), [])

    def test_扩展名优先取_url_路径后缀(self):
        self.assertEqual(fetch.ext_for("https://e.com/a.JPEG", None), ".jpg")

    def test_扩展名其次取微信的_wx_fmt_参数(self):
        self.assertEqual(fetch.ext_for("https://e.com/640?wx_fmt=png&from=appmsg", None), ".png")

    def test_扩展名再次取_content_type(self):
        self.assertEqual(fetch.ext_for("https://e.com/640", "image/webp"), ".webp")

    def test_扩展名都取不到时退回_png(self):
        self.assertEqual(fetch.ext_for("https://e.com/640", None), ".png")

    def test_改写成仓库根起的本地路径(self):
        """落进正文的是仓库根起的路径，不带 `../`（理由见 repo.ASSET_REF_RE）。"""
        md = "![](https://e.com/a.png)"
        got = fetch.rewrite_images(md, {"https://e.com/a.png": "raw/document/2026-09-06/x/images/01.png"})
        self.assertEqual(got, "![](raw/document/2026-09-06/x/images/01.png)")

    def test_没下下来的图片原位留注释而不是断链(self):
        md = "上\n![](https://e.com/a.png)\n下"
        got = fetch.rewrite_images(md, {"https://e.com/a.png": None})
        self.assertEqual(got, "上\n<!-- 图片下载失败: https://e.com/a.png -->\n下")

    def test_带_alt_的图片也算图片(self):
        """markdown 原文里的图片多半带 alt；漏掉就会在 raw/ 里留原站外链。"""
        md = "![一张图](https://e.com/a.png)"
        self.assertEqual(fetch.image_urls(md), ["https://e.com/a.png"])

    def test_改写保留_alt(self):
        md = "![一张图](https://e.com/a.png)"
        got = fetch.rewrite_images(md, {"https://e.com/a.png": "raw/document/2026-09-06/x/images/01.png"})
        self.assertEqual(got, "![一张图](raw/document/2026-09-06/x/images/01.png)")

    def test_带_alt_的图片没下下来同样留注释(self):
        md = "![一张图](https://e.com/a.png)"
        got = fetch.rewrite_images(md, {"https://e.com/a.png": None})
        self.assertEqual(got, "<!-- 图片下载失败: https://e.com/a.png -->")


class TestRender(unittest.TestCase):
    """归档文件的抬头。"""

    def setUp(self):
        art = fetch.Article("了解下 OKF", "Duang的碎碎记", "2026-07-12", "")
        self.text = fetch.render(art, fetch.WeChatAdapter,
                                 "https://mp.weixin.qq.com/s/X", "正文", "2026-09-06")

    def test_首行是标题(self):
        self.assertEqual(self.text.split("\n")[0], "# 了解下 OKF")

    def test_抬头带源类型中文名(self):
        self.assertIn("- 源类型：微信公众号", self.text)

    def test_抬头带适配器名字方便日后改版时回查(self):
        self.assertIn("- 适配器：wechat", self.text)

    def test_抬头带来源与链接与两个时间(self):
        for line in ("- 来源：「Duang的碎碎记」",
                     "- 原文链接：https://mp.weixin.qq.com/s/X",
                     "- 发布时间：2026-07-12",
                     "- 抓取时间：2026-09-06"):
            self.assertIn(line, self.text)

    def test_抬头与正文之间用分隔线隔开(self):
        self.assertIn("\n\n---\n\n正文", self.text)

    def test_抽不到的字段留白而不是写_None(self):
        art = fetch.Article("标题", "", "", "")
        text = fetch.render(art, fetch.WeChatAdapter, "https://x", "正文", "2026-09-06")
        self.assertNotIn("None", text)
        self.assertIn("- 发布时间：（未知）", text)


class TestPaths(unittest.TestCase):
    """落盘位置：raw/document/<日期>/，图在该篇 raw/document/<日期>/<名>/images/。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = Path(self.tmp).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_图片编号从零一开始且补零(self):
        _, rel = fetch.image_dest(self.root, "2026-09-06", "文章", 0, ".png")
        self.assertEqual(rel, "raw/document/2026-09-06/文章/images/01.png")

    def test_第十一张图片编号不补零溢出(self):
        _, rel = fetch.image_dest(self.root, "2026-09-06", "文章", 10, ".jpg")
        self.assertEqual(rel, "raw/document/2026-09-06/文章/images/11.jpg")

    def test_归档写进当天的素材目录并返回相对路径(self):
        rel = fetch.archive(self.root, "2026-09-06", "了解下 OKF", "正文内容\n")
        self.assertEqual(rel, "raw/document/2026-09-06/了解下 OKF.md")
        self.assertEqual((self.root / rel).read_text(encoding="utf-8"), "正文内容\n")

    def test_归档不覆盖同名素材(self):
        fetch.archive(self.root, "2026-09-06", "同名", "第一次")
        with self.assertRaises(FileExistsError):
            fetch.archive(self.root, "2026-09-06", "同名", "第二次")

    def test_归档时标题里的斜杠不会被当成子目录(self):
        rel = fetch.archive(self.root, "2026-09-06", "a/b", "x")
        self.assertEqual(rel, "raw/document/2026-09-06/ab.md")


class TestContentBoundary(unittest.TestCase):
    """正文边界靠配对 div 层级，不靠猜页尾标记。"""

    def wrap(self, inner, tail):
        return f'<body><div id="js_content">{inner}</div>{tail}</body>'

    def test_正文里嵌套的_div_不会提前截断(self):
        html = self.wrap("<p>上</p><div><p>中</p></div><p>下</p>", "")
        body = fetch.WeChatAdapter.parse(html).body_html
        for t in ("上", "中", "下"):
            self.assertIn(t, body)

    def test_闭合之后的页面_chrome_全部丢掉(self):
        html = self.wrap("<p>正文</p>",
                         '<script>var x=1;</script><div>预览时标签不可点</div>')
        body = fetch.WeChatAdapter.parse(html).body_html
        self.assertIn("正文", body)
        self.assertNotIn("预览时标签不可点", body)
        self.assertNotIn("var x=1", body)

    def test_正文没有闭合时退到文档结尾而不是崩掉(self):
        html = '<body><div id="js_content"><p>正文</p>'
        self.assertIn("正文", fetch.WeChatAdapter.parse(html).body_html)

    def test_真实页面尾部不会漏进残缺标签(self):
        html = self.wrap('<p>欢迎点赞</p><p style="display:none;"><mp-style-type/></p>',
                         '<script>var first_sceen__time = 1;</script></div><div>预览时标签不可点</div>')
        md = fetch.html_to_markdown(fetch.WeChatAdapter.parse(html).body_html)
        self.assertNotIn("<div", md)
        self.assertNotIn("预览时标签不可点", md)


class TestParserRobustness(unittest.TestCase):
    """HTML 抽取在刁钻输入下的行为。"""

    def test_meta_里带尖括号的值不会被截断(self):
        html = '<meta property="og:title" content="a > b" /><div id="js_content"><p>x</p></div>'
        self.assertEqual(fetch.WeChatAdapter.parse(html).title, "a > b")

    def test_meta_属性顺序任意(self):
        html = ('<meta content="标题在前" charset="x" property="og:title">'
                '<div id="js_content"><p>x</p></div>')
        self.assertEqual(fetch.WeChatAdapter.parse(html).title, "标题在前")

    def test_属性值里出现_div_字样不影响正文边界(self):
        html = ('<div id="js_content"><p title="像 <div 的字符串">正文</p></div>'
                '<div>页尾</div>')
        body = fetch.WeChatAdapter.parse(html).body_html
        self.assertIn("正文", body)
        self.assertNotIn("页尾", body)

    def test_注释里的_div_不会让正文提前截断(self):
        html = ('<div id="js_content"><p>甲</p><!-- </div> --><p>乙</p></div>'
                '<div>页尾</div>')
        body = fetch.WeChatAdapter.parse(html).body_html
        self.assertIn("甲", body)
        self.assertIn("乙", body)          # 提前截断的话乙就没了
        self.assertNotIn("页尾", body)

    def test_content_type_带参数也能定出扩展名(self):
        self.assertEqual(fetch.ext_for("https://e.com/640", "image/webp; charset=binary"), ".webp")

    def test_大小写混写的_content_type(self):
        self.assertEqual(fetch.ext_for("https://e.com/640", "IMAGE/PNG"), ".png")



def _blk(bid, btype, key=None, text=None, children=None, **extra):
    """造一个飞书 block。text 走 text_run，样式默认全 false。"""
    b = {"block_id": bid, "block_type": btype}
    if children:
        b["children"] = children
    if key:
        b[key] = dict(extra)
        if text is not None:
            b[key]["elements"] = [{"text_run": {"content": text, "text_element_style": {}}}]
    elif extra:
        b.update(extra)
    return b


class TestFeishuElements(unittest.TestCase):
    """飞书 elements → 行内 markdown。"""

    def md(self, elements):
        return fetch.fs_elements_to_md(elements)

    def run_(self, content, **style):
        return [{"text_run": {"content": content, "text_element_style": style}}]

    def test_纯文本原样输出(self):
        self.assertEqual(self.md(self.run_("你好")), "你好")

    def test_粗体与斜体叠加(self):
        self.assertEqual(self.md(self.run_("x", bold=True, italic=True)), "***x***")

    def test_行内代码不再叠加强调(self):
        # 代码里的星号不该被当成语法
        self.assertEqual(self.md(self.run_("a*b", inline_code=True, bold=True)), "`a*b`")

    def test_链接的_url_会解转义(self):
        got = self.md(self.run_("站点", link={"url": "https%3A%2F%2Fx.com%2Fa"}))
        self.assertEqual(got, "[站点](https://x.com/a)")

    def test_相邻同样式的碎片先合并再包样式(self):
        # 飞书会把一句话切成多个 run，逐个包会产出 **A****B**，渲染成四个星号
        els = self.run_("DDD 是一种", bold=True) + self.run_("软件设计方法论", bold=True)
        self.assertEqual(self.md(els), "**DDD 是一种软件设计方法论**")

    def test_样式切换处不合并(self):
        els = self.run_("普通") + self.run_("粗", bold=True) + self.run_("普通2")
        self.assertEqual(self.md(els), "普通**粗**普通2")

    def test_不同样式的相邻元素各自包(self):
        els = self.run_("a", bold=True) + self.run_("b", italic=True)
        self.assertEqual(self.md(els), "**a***b*")

    def test_样式不包住前后空白(self):
        # `** 粗 **` 在 markdown 里不生效，空白必须留在标记外面
        self.assertEqual(self.md(self.run_(" 粗 ", bold=True)), " **粗** ")

    def test_链接相同才合并(self):
        els = (self.run_("A", link={"url": "http%3A%2F%2Fa"})
               + self.run_("B", link={"url": "http%3A%2F%2Fb"}))
        self.assertEqual(self.md(els), "[A](http://a)[B](http://b)")

    def test_多个元素直接相连不补空格(self):
        self.assertEqual(self.md(self.run_("DDD ") + self.run_("很好", bold=True)),
                         "DDD **很好**")

    def test_空内容的元素被跳过(self):
        self.assertEqual(self.md(self.run_("") + self.run_("x")), "x")


class TestFeishuDocToMd(unittest.TestCase):
    """飞书 docx block 树 → markdown。"""

    def test_从_page_块往下走而不是按返回顺序(self):
        # 接口返回顺序不保证是阅读顺序，只能靠 children 建树
        blocks = [
            _blk("t2", 2, "text", "第二段"),
            _blk("p", 1, "page", "标题", children=["t1", "t2"]),
            _blk("t1", 2, "text", "第一段"),
        ]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "第一段\n\n第二段")

    def test_page_块自己的标题不进正文(self):
        blocks = [_blk("p", 1, "page", "标题", children=["a"]),
                  _blk("a", 2, "text", "正文")]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "正文")

    def test_各级标题转成对应井号(self):
        blocks = [_blk("p", 1, "page", "T", children=["h1", "h3"]),
                  _blk("h1", 3, "heading1", "一级"),
                  _blk("h3", 5, "heading3", "三级")]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "# 一级\n\n### 三级")

    def test_有序列表在同级内自己数号(self):
        blocks = [_blk("p", 1, "page", "T", children=["a", "b", "c"]),
                  _blk("a", 13, "ordered", "甲"),
                  _blk("b", 13, "ordered", "乙"),
                  _blk("c", 13, "ordered", "丙")]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "1. 甲\n\n2. 乙\n\n3. 丙")

    def test_无序列表的子项按层缩进(self):
        blocks = [_blk("p", 1, "page", "T", children=["a"]),
                  _blk("a", 12, "bullet", "父", children=["b"]),
                  _blk("b", 12, "bullet", "子")]
        self.assertIn("  - 子", fetch.feishu_doc_to_md(blocks))

    def test_callout_整块转成引用(self):
        blocks = [_blk("p", 1, "page", "T", children=["c"]),
                  _blk("c", 19, "callout", None, children=["t"], emoji_id="pushpin"),
                  _blk("t", 2, "text", "注意")]
        got = fetch.feishu_doc_to_md(blocks)
        self.assertIn("> **pushpin**", got)
        self.assertIn("> 注意", got)

    def test_同步块的内容照常渲染(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  _blk("s", 49, "source_synced", "同步块", children=["t"]),
                  _blk("t", 2, "text", "被同步的正文")]
        self.assertIn("被同步的正文", fetch.feishu_doc_to_md(blocks))

    def test_表格按列数切行并生成表头分隔(self):
        cells = ["c1", "c2", "c3", "c4"]
        blocks = [_blk("p", 1, "page", "T", children=["tb"]),
                  {"block_id": "tb", "block_type": 31,
                   "table": {"cells": cells,
                             "property": {"column_size": 2, "header_row": True}}}]
        for i, txt in enumerate(["名", "值", "a", "1"]):
            blocks.append(_blk(f"c{i+1}", 32, "table_cell", None, children=[f"x{i+1}"]))
            blocks.append(_blk(f"x{i+1}", 2, "text", txt))
        got = fetch.feishu_doc_to_md(blocks)
        self.assertIn("| 名 | 值 |", got)
        self.assertIn("|---|---|", got)
        self.assertIn("| a | 1 |", got)

    def test_单元格里的竖线被转义(self):
        blocks = [_blk("p", 1, "page", "T", children=["tb"]),
                  {"block_id": "tb", "block_type": 31,
                   "table": {"cells": ["c1"], "property": {"column_size": 1}}},
                  _blk("c1", 32, "table_cell", None, children=["x1"]),
                  _blk("x1", 2, "text", "a|b")]
        self.assertIn("a\\|b", fetch.feishu_doc_to_md(blocks))

    def test_画板转成图片并走画板专用地址(self):
        # 画板不是普通图片，导出接口不同，不能混用 media 地址
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 43, "board": {"token": "TOK123"}}]
        got = fetch.feishu_doc_to_md(blocks,
                                     media_url=lambda t: f"MEDIA/{t}",
                                     board_url=lambda t: f"BOARD/{t}")
        self.assertEqual(got, "![飞书画板](BOARD/TOK123)")

    def test_画板没有_token_时不产出空图片(self):
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 43, "board": {}}]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "")

    def test_画板与普通图片各走各的接口(self):
        blocks = [_blk("p", 1, "page", "T", children=["i", "b"]),
                  {"block_id": "i", "block_type": 27, "image": {"token": "IMG"}},
                  {"block_id": "b", "block_type": 43, "board": {"token": "BRD"}}]
        got = fetch.feishu_doc_to_md(blocks, lambda t: f"MEDIA/{t}", lambda t: f"BOARD/{t}")
        self.assertIn("![](MEDIA/IMG)", got)
        self.assertIn("![飞书画板](BOARD/BRD)", got)

    def test_分栏容器渲染子块而不是丢掉(self):
        # 早先漏了 grid/grid_column，三处分栏的正文被整段丢掉
        blocks = [_blk("p", 1, "page", "T", children=["g"]),
                  _blk("g", 24, "grid", None, children=["c1", "c2"], column_size=2),
                  _blk("c1", 25, "grid_column", None, children=["t1"]),
                  _blk("t1", 2, "text", "左栏"),
                  _blk("c2", 25, "grid_column", None, children=["t2"]),
                  _blk("t2", 2, "text", "右栏")]
        got = fetch.feishu_doc_to_md(blocks)
        self.assertIn("左栏", got)
        self.assertIn("右栏", got)

    def test_小组件从_record_里取出条目文字(self):
        import json as _json
        rec = _json.dumps({"items": [{"title": "上体验课", "text": "", "time": ""},
                                     {"title": "私聊转化", "text": "备注", "time": "T+1"}]})
        blocks = [_blk("p", 1, "page", "T", children=["a"]),
                  {"block_id": "a", "block_type": 40, "add_ons": {"record": rec}}]
        got = fetch.feishu_doc_to_md(blocks)
        self.assertIn("- 上体验课", got)
        self.assertIn("- 私聊转化（T+1 · 备注）", got)

    def test_小组件_record_坏掉时留标记不炸(self):
        blocks = [_blk("p", 1, "page", "T", children=["a"]),
                  {"block_id": "a", "block_type": 40, "add_ons": {"record": "{坏的"}}]
        self.assertIn("没有可提取的文字", fetch.feishu_doc_to_md(blocks))

    def test_多维表格能内联成表格(self):
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 18, "bitable": {"token": "APP_tbl1"}}]
        got = fetch.feishu_doc_to_md(
            blocks, base="https://my.feishu.cn",
            table=lambda k, tk: [["字段", "描述"], ["id", "消息 ID"]])
        self.assertIn("| 字段 | 描述 |", got)
        self.assertIn("| id | 消息 ID |", got)

    def test_电子表格能内联且空单元格补空(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  {"block_id": "s", "block_type": 30, "sheet": {"token": "SS_sht"}}]
        got = fetch.feishu_doc_to_md(
            blocks, base="https://my.feishu.cn",
            table=lambda k, tk: [["字段", "描述", None], ["id", None, None]])
        self.assertIn("| 字段 | 描述 |  |", got)
        self.assertIn("| id |  |  |", got)

    def test_全空的行被丢掉(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  {"block_id": "s", "block_type": 30, "sheet": {"token": "SS_sht"}}]
        got = fetch.feishu_doc_to_md(
            blocks, table=lambda k, tk: [["a"], [None, None], ["b"]])
        self.assertNotIn("|  |\n|  |", got)
        self.assertIn("| b |", got)

    def test_取表失败时退回链接标记而不是崩掉(self):
        def boom(kind, token):
            raise RuntimeError("没权限")
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 18, "bitable": {"token": "APP_tbl1"}}]
        got = fetch.feishu_doc_to_md(blocks, base="https://my.feishu.cn", table=boom)
        self.assertIn("未取到内容", got)
        self.assertIn("https://my.feishu.cn/base/APP?table=tbl1", got)

    def test_bitable_的链接型单元格取_text(self):
        self.assertEqual(fetch._fs_flatten_cell({"link": "http://a", "text": "标题"}), "标题")
        self.assertEqual(fetch._fs_flatten_cell({"link": "http://a"}), "http://a")

    def test_bitable_的多值单元格拼起来(self):
        self.assertEqual(fetch._fs_flatten_cell([{"text": "甲"}, {"text": "乙"}]), "甲 乙")

    def test_单元格里的换行压成空格免得撑破表格(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  {"block_id": "s", "block_type": 30, "sheet": {"token": "SS_s"}}]
        got = fetch.feishu_doc_to_md(blocks, table=lambda k, tk: [["a\nb"], ["c"]])
        self.assertIn("| a b |", got)

    def test_多维表格标记里带可点链接(self):
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 18,
                   "bitable": {"token": "APPTOKEN_tblXYZ"}}]
        got = fetch.feishu_doc_to_md(blocks, base="https://my.feishu.cn")
        self.assertIn("https://my.feishu.cn/base/APPTOKEN?table=tblXYZ", got)

    def test_电子表格标记里带可点链接(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  {"block_id": "s", "block_type": 30,
                   "sheet": {"token": "SSTOKEN_sht1"}}]
        got = fetch.feishu_doc_to_md(blocks, base="https://my.feishu.cn")
        self.assertIn("https://my.feishu.cn/sheets/SSTOKEN?sheet=sht1", got)

    def test_没给站点时外部制品退回裸_token(self):
        blocks = [_blk("p", 1, "page", "T", children=["b"]),
                  {"block_id": "b", "block_type": 18, "bitable": {"token": "TOK_tbl"}}]
        self.assertIn("TOK_tbl", fetch.feishu_doc_to_md(blocks))

    def test_子页面列表不重复归档只留说明(self):
        blocks = [_blk("p", 1, "page", "T", children=["s"]),
                  {"block_id": "s", "block_type": 51, "sub_page_list": {"wiki_token": "W1"}}]
        self.assertIn("各子页已各自归档", fetch.feishu_doc_to_md(blocks))

    def test_引用同步块指回源文档(self):
        blocks = [_blk("p", 1, "page", "T", children=["r"]),
                  {"block_id": "r", "block_type": 50,
                   "reference_synced": {"source_block_id": "B9", "source_document_id": "D9"}}]
        got = fetch.feishu_doc_to_md(blocks)
        self.assertIn("D9", got)
        self.assertIn("B9", got)

    def test_不认识的块类型也留标记(self):
        # 素材只进不改，丢了内容永远发现不了
        blocks = [_blk("p", 1, "page", "T", children=["u"]),
                  {"block_id": "u", "block_type": 777}]
        self.assertIn("block_type=777", fetch.feishu_doc_to_md(blocks))

    def test_图片走适配器给的鉴权地址(self):
        blocks = [_blk("p", 1, "page", "T", children=["i"]),
                  {"block_id": "i", "block_type": 27, "image": {"token": "IMG1"}}]
        got = fetch.feishu_doc_to_md(blocks, lambda t: f"https://api/{t}/download")
        self.assertEqual(got, "![](https://api/IMG1/download)")

    def test_没有_page_块时退到无父节点当根(self):
        blocks = [_blk("a", 2, "text", "孤立段")]
        self.assertEqual(fetch.feishu_doc_to_md(blocks), "孤立段")

    def test_连续空行被收敛(self):
        blocks = [_blk("p", 1, "page", "T", children=["a", "b"]),
                  _blk("a", 2, "text", ""),
                  _blk("b", 2, "text", "正文")]
        self.assertNotIn("\n\n\n", fetch.feishu_doc_to_md(blocks))


class TestFeishuAdapter(unittest.TestCase):
    """适配器的选取与 URL 解析，不碰网络。"""

    def test_认飞书与_lark_的各级域名(self):
        for u in ("https://my.feishu.cn/wiki/ABC", "https://x.larksuite.com/docx/D1",
                  "https://feishu.cn/wiki/Z"):
            self.assertTrue(fetch.FeishuAdapter.match(u), u)

    def test_不认别家域名(self):
        self.assertFalse(fetch.FeishuAdapter.match("https://palantir.com/docs/x"))

    def test_从_wiki_与_docx_链接里取节点_token(self):
        self.assertEqual(
            fetch.FeishuAdapter._node_token("https://my.feishu.cn/wiki/Izc123?from=copy"),
            "Izc123")
        self.assertEqual(
            fetch.FeishuAdapter._node_token("https://my.feishu.cn/docx/OYF9"), "OYF9")

    def test_取不出_token_时明确报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.FeishuAdapter._node_token("https://my.feishu.cn/")

    def test_区分_docx_单篇与_wiki_节点(self):
        self.assertTrue(fetch.FeishuAdapter._is_docx("https://x.feishu.cn/docx/Gq6y?from=copy"))
        self.assertFalse(fetch.FeishuAdapter._is_docx("https://x.feishu.cn/wiki/Gq6y"))
        self.assertFalse(fetch.FeishuAdapter._is_docx("https://x.feishu.cn/docs/Gq6y"))

    def test_docx_链接只抓一篇且不走_get_node(self):
        """docx token 不是 wiki 节点 token，问 get_node 只会白报一次错。"""
        A = fetch.FeishuAdapter
        calls = []
        old = (A._token, A._get, A._paged)
        A._token = classmethod(lambda cls: "TOK")
        def fake_get(cls, path, auth):
            calls.append(path)
            if path.startswith("/docx/v1/documents/OYF9") and "blocks" not in path:
                return {"document": {"title": "  某平台设计  "}}
            raise AssertionError(f"不该请求 {path}")
        A._get = classmethod(fake_get)
        A._paged = classmethod(lambda cls, path, auth, key="items": [
            {"block_id": "r", "block_type": 1, "children": ["c"]},
            {"block_id": "c", "block_type": 2, "text": {"elements": [
                {"text_run": {"content": "正文"}}]}},
        ])
        try:
            got = A.expand("https://example.feishu.cn/docx/OYF9?from=copylink")
        finally:
            A._token, A._get, A._paged = old
        self.assertEqual(len(got), 1)
        url, art = got[0]
        self.assertEqual(url, "https://example.feishu.cn/docx/OYF9?from=copylink")
        self.assertEqual(art.title, "某平台设计")      # 标题两头的空白要去掉
        self.assertEqual(art.author, "飞书云文档")     # 与知识库那条路区分开
        self.assertIn("正文", art.body_md)
        self.assertFalse([c for c in calls if "get_node" in c])

    def test_docx_取不到标题时退回_token(self):
        A = fetch.FeishuAdapter
        old = (A._token, A._get, A._paged)
        A._token = classmethod(lambda cls: "TOK")
        A._get = classmethod(lambda cls, path, auth: {"document": {}})
        A._paged = classmethod(lambda cls, path, auth, key="items": [])
        try:
            got = A.expand("https://x.feishu.cn/docx/OYF9")
        finally:
            A._token, A._get, A._paged = old
        self.assertEqual(got[0][1].title, "OYF9")

    def test_缺凭据时报错说清要设哪两个环境变量(self):
        import os
        old = {k: os.environ.pop(k, None) for k in ("FEISHU_APP_ID", "FEISHU_APP_SECRET")}
        try:
            with self.assertRaises(fetch.ExtractFailed) as cm:
                fetch.FeishuAdapter._token()
            self.assertIn("FEISHU_APP_ID", str(cm.exception))
        finally:
            for k, v in old.items():
                if v is not None:
                    os.environ[k] = v


class TestGitHubAdapter(unittest.TestCase):
    """GitHub 适配器 —— 只测 URL 解析与路径挑选，不联网。"""

    def test_命中两个_host(self):
        self.assertTrue(fetch.GitHubAdapter.match(
            "https://github.com/o/r/blob/main/README.md"))
        self.assertTrue(fetch.GitHubAdapter.match(
            "https://raw.githubusercontent.com/o/r/main/README.md"))
        self.assertFalse(fetch.GitHubAdapter.match("https://gist.github.com/o/abc"))

    def test_gist_仍然归_gist_适配器而不是被_github_抢走(self):
        # 两个适配器的 host 不同，但 ADAPTERS 的顺序不能让 github 抢走 gist
        a = fetch.pick_adapter("https://gist.github.com/mario/abc123")
        self.assertEqual(a.name, "gist")

    def test_blob_链接解析出五元组(self):
        self.assertEqual(
            fetch.GitHubAdapter.parse_url(
                "https://github.com/earendil-works/pi/blob/71dca87/packages/agent/README.md"),
            ("earendil-works", "pi", "71dca87", "packages/agent/README.md", "blob"))

    def test_tree_链接解析出目录与_tree_类型(self):
        self.assertEqual(
            fetch.GitHubAdapter.parse_url(
                "https://github.com/o/r/tree/main/packages/coding-agent/docs"),
            ("o", "r", "main", "packages/coding-agent/docs", "tree"))

    def test_tree_链接可以只到仓库根(self):
        self.assertEqual(
            fetch.GitHubAdapter.parse_url("https://github.com/o/r/tree/main"),
            ("o", "r", "main", "", "tree"))

    def test_raw_链接解析成_blob(self):
        self.assertEqual(
            fetch.GitHubAdapter.parse_url(
                "https://raw.githubusercontent.com/o/r/abc123/docs/x.md"),
            ("o", "r", "abc123", "docs/x.md", "blob"))

    def test_blob_链接缺文件路径直接报错(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.GitHubAdapter.parse_url("https://github.com/o/r/blob/main")

    def test_认不出的路径形状直接报错不猜(self):
        for bad in ("https://github.com/o/r",
                    "https://github.com/o/r/commits/main/x.md",
                    "https://raw.githubusercontent.com/o/r/main"):
            with self.assertRaises(fetch.ExtractFailed):
                fetch.GitHubAdapter.parse_url(bad)

    def test_标题把斜杠换成间隔号(self):
        # safe_filename 会删掉斜杠，原样用路径会挤成 packagesagentREADME.md
        t = fetch.GitHubAdapter.title_for("pi", "packages/agent/README.md")
        self.assertEqual(t, "pi · packages · agent · README")
        self.assertNotIn("/", fetch.safe_filename(t))

    def test_标题去掉结尾的_md_免得落盘成两层扩展名(self):
        # archive() 自己会补 .md，不去会得到「… README.md.md」
        self.assertTrue(
            fetch.archive_path("2026-01-01",
                               fetch.GitHubAdapter.title_for("pi", "docs/x.md"))
            .endswith("pi · docs · x.md"))
        self.assertEqual(fetch.GitHubAdapter.title_for("pi", "docs/X.MARKDOWN"),
                         "pi · docs · X")

    def test_只去结尾的_md_不碰路径中间的(self):
        self.assertEqual(fetch.GitHubAdapter.title_for("pi", "md/a.md"), "pi · md · a")

    def test_仓库根的标题就是仓库名(self):
        self.assertEqual(fetch.GitHubAdapter.title_for("pi", ""), "pi")

    def test_相对链接的基址是文件所在目录且带尾斜杠(self):
        base = fetch.GitHubAdapter.blob_base("o", "r", "main", "docs/a/x.md")
        self.assertEqual(base, "https://github.com/o/r/blob/main/docs/a/")
        # 尾斜杠不能省：否则同目录相对地址会被解析到上一层
        self.assertEqual(fetch.absolutize("[y](y.md)", base),
                         "[y](https://github.com/o/r/blob/main/docs/a/y.md)")

    def test_仓库根文件的基址不带多余路径段(self):
        self.assertEqual(fetch.GitHubAdapter.blob_base("o", "r", "main", "README.md"),
                         "https://github.com/o/r/blob/main/")

    def test_只挑_markdown_的_blob(self):
        tree = [
            {"type": "blob", "path": "docs/a.md"},
            {"type": "blob", "path": "docs/b.ts"},
            {"type": "tree", "path": "docs/sub"},
            {"type": "blob", "path": "docs/sub/c.md"},
        ]
        self.assertEqual(fetch.GitHubAdapter.md_paths(tree, "docs"),
                         ["docs/a.md", "docs/sub/c.md"])

    def test_tree_是递归的(self):
        # 少抓而调用者不知道，比抓失败坏得多（飞书适配器踩过的坑）
        tree = [{"type": "blob", "path": "d/x.md"},
                {"type": "blob", "path": "d/e/f/y.md"}]
        self.assertEqual(fetch.GitHubAdapter.md_paths(tree, "d"),
                         ["d/e/f/y.md", "d/x.md"])

    def test_前缀不做子串匹配(self):
        tree = [{"type": "blob", "path": "docs/a.md"},
                {"type": "blob", "path": "docs-old/b.md"}]
        self.assertEqual(fetch.GitHubAdapter.md_paths(tree, "docs"), ["docs/a.md"])

    def test_空前缀取全仓(self):
        tree = [{"type": "blob", "path": "a.md"},
                {"type": "blob", "path": "x/b.md"}]
        self.assertEqual(fetch.GitHubAdapter.md_paths(tree, ""), ["a.md", "x/b.md"])

    def test_大写扩展名也算_markdown(self):
        tree = [{"type": "blob", "path": "README.MD"}]
        self.assertEqual(fetch.GitHubAdapter.md_paths(tree, ""), ["README.MD"])



class TestHtmlImgsToMd(unittest.TestCase):
    """GitHub 的 README 用 <img> 排版，得转成 markdown 才会被下载与改写。"""

    def test_img_转成_markdown_图片(self):
        self.assertEqual(fetch.html_imgs_to_md('<img src="a.png">'), "![](a.png)")

    def test_保留_alt(self):
        self.assertEqual(fetch.html_imgs_to_md('<img alt="图" src="a.png">'),
                         "![图](a.png)")

    def test_属性顺序与自闭合都认(self):
        self.assertEqual(fetch.html_imgs_to_md('<img src="a.png" alt="x" />'),
                         "![x](a.png)")

    def test_大写标签也认(self):
        self.assertEqual(fetch.html_imgs_to_md('<IMG SRC="a.png">'), "![](a.png)")

    def test_转完能被_absolutize_补成绝对地址(self):
        md = fetch.html_imgs_to_md('<p align="center"><img src="docs/x.png"></p>')
        out = fetch.absolutize(md, "https://github.com/o/r/blob/main/")
        self.assertIn("https://github.com/o/r/blob/main/docs/x.png", out)

    def test_转完能被_image_urls_认出来(self):
        # 不转的话图片下不下来，归档件里就永久留一条原站外链
        self.assertEqual(fetch.image_urls('<img src="https://x/a.png">'), [])
        self.assertEqual(
            fetch.image_urls(fetch.html_imgs_to_md('<img src="https://x/a.png">')),
            ["https://x/a.png"])

    def test_没有_src_的标签原样留下(self):
        self.assertEqual(fetch.html_imgs_to_md("<img alt='空'>"), "<img alt='空'>")

    def test_不碰别的标签(self):
        self.assertEqual(fetch.html_imgs_to_md("<p>文字</p>"), "<p>文字</p>")

    def test_一段里多个_img_都转(self):
        self.assertEqual(
            fetch.html_imgs_to_md('<img src="a.png"><img src="b.png">'),
            "![](a.png)![](b.png)")


class TestMarioZechnerAdapter(unittest.TestCase):
    """mariozechner.at：正文容器是 <article>，发布时间只在 URL 的 slug 里。"""

    META = ('<meta property="og:title" content="What I learned building a coding agent">'
            '<meta property="og:url"'
            ' content="https://mariozechner.at/posts/2025-11-30-pi-coding-agent/">')
    BODY = ("<article>"
            "<p>pi runs in full YOLO mode.</p>"
            "<div>嵌套的 div 不该提前截断正文</div>"
            "<img src='media/header.png'>"
            "<p><a href='/posts/2025-11-02-what-if-you-dont-need-mcp/'>MCP</a></p>"
            "</article>")

    def page(self, meta=None, body=None):
        return ("<html><head>" + (self.META if meta is None else meta) + "</head><body>"
                + "<nav>导航不该进正文</nav>"
                + (self.BODY if body is None else body)
                + "<footer>页尾不该进正文</footer></body></html>")

    def test_认得_host(self):
        self.assertTrue(fetch.MarioZechnerAdapter.match(
            "https://mariozechner.at/posts/2025-11-30-pi-coding-agent/"))
        self.assertTrue(fetch.MarioZechnerAdapter.match(
            "https://www.mariozechner.at/posts/x/"))
        self.assertFalse(fetch.MarioZechnerAdapter.match("https://pi.dev/docs/latest"))

    def test_抽出标题与作者(self):
        a = fetch.MarioZechnerAdapter.parse(self.page())
        self.assertEqual(a.title, "What I learned building a coding agent")
        self.assertEqual(a.author, "Mario Zechner")

    def test_发布时间取自_slug(self):
        self.assertEqual(fetch.MarioZechnerAdapter.parse(self.page()).published,
                         "2025-11-30")

    def test_slug_不带日期就留空_不猜(self):
        meta = ('<meta property="og:title" content="X">'
                '<meta property="og:url" content="https://mariozechner.at/about/">')
        self.assertEqual(fetch.MarioZechnerAdapter.parse(self.page(meta=meta)).published, "")

    def test_正文只取_article_里的(self):
        md = fetch.MarioZechnerAdapter.parse(self.page()).body_md
        self.assertIn("YOLO", md)
        self.assertIn("嵌套的 div 不该提前截断正文", md)
        self.assertNotIn("导航不该进正文", md)
        self.assertNotIn("页尾不该进正文", md)

    def test_相对地址补成绝对(self):
        md = fetch.MarioZechnerAdapter.parse(self.page()).body_md
        self.assertIn(
            "https://mariozechner.at/posts/2025-11-30-pi-coding-agent/media/header.png", md)
        self.assertIn(
            "https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/", md)

    def test_没有_article_就失败(self):
        with self.assertRaises(fetch.ExtractFailed):
            fetch.MarioZechnerAdapter.parse(self.page(body="<div>没有 article</div>"))

    def test_没有_og_url_就失败(self):
        meta = '<meta property="og:title" content="X">'
        with self.assertRaises(fetch.ExtractFailed):
            fetch.MarioZechnerAdapter.parse(self.page(meta=meta))


class TestDivInnerTagParam(unittest.TestCase):
    """_div_inner 现在收标签名——加 mariozechner 适配器时从 div 专用泛化而来。"""

    def test_默认仍是_div(self):
        html = "<div class='a'><p>里</p></div>外"
        self.assertEqual(fetch._div_inner(html, 0), "<p>里</p>")

    def test_按给的标签配对(self):
        html = "<article><div>里</div></article>外"
        self.assertEqual(fetch._div_inner(html, 0, "article"), "<div>里</div>")


if __name__ == "__main__":
    unittest.main(verbosity=2)
