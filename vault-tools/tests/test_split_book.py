"""split_book 纯函数测试。不需要真 epub,只测能从 toc/html 直接推断的部分。"""
import io
import sys
import subprocess
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import split as split_book


# ── slugify ─────────────────────────────────────────────────

def test_slugify_basic():
    # 章节文件是「<号> <标题>.md」：标题里的空白保留成一个空格
    assert split_book.slugify("第1章 消化知识") == "第1章 消化知识"
    assert split_book.slugify("  2.4  文档和图  ") == "2.4 文档和图"
    assert split_book.slugify("Domain-Driven  Design") == "Domain-Driven Design"
    assert split_book.slugify("") == "untitled"
    # 全是文件系统禁用字符 → 剥完是空 → "untitled"
    assert split_book.slugify("///") == "untitled"
    # 普通标点保留为 slug(不是字母数字的"软"字符)
    assert split_book.slugify("....") == "...."
    print("✓ slugify basic")


def test_slugify_strips_forbidden():
    # 文件系统禁用字符
    s = split_book.slugify("a/b\\c:d*e?f\"g<h>i|j")
    for ch in '/\\:*?"<>|':
        assert ch not in s, f"未剥离: {ch}"
    print("✓ slugify strips forbidden chars")


def test_chapter_filename():
    assert split_book.chapter_filename(3, "第3章 绑定模型") == "3 第3章 绑定模型.md"
    assert split_book.chapter_filename(12, "a/b") == "12 ab.md"
    assert split_book.WHOLE_NAME == "1 全文.md"
    print("✓ chapter_filename")


def test_slugify_truncates():
    s = split_book.slugify("a" * 100)
    assert len(s) <= 50
    assert not split_book.slugify("a" * 49 + " b").endswith(" ")
    print("✓ slugify truncates")


# ── html_to_md ──────────────────────────────────────────────

def test_html_to_md_paragraph():
    md = split_book.html_to_md("<p>hello</p>")
    assert "hello" in md
    print("✓ html_to_md p")


def test_html_to_md_heading():
    md = split_book.html_to_md("<h2>title</h2>")
    assert md.startswith("## title")
    print("✓ html_to_md h2")


def test_html_to_md_ordered_list():
    md = split_book.html_to_md("<ol><li>a</li><li>b</li></ol>")
    assert "1. a" in md
    assert "2. b" in md
    print("✓ html_to_md ol")


def test_html_to_md_unordered_list():
    md = split_book.html_to_md("<ul><li>a</li></ul>")
    assert "- a" in md
    print("✓ html_to_md ul")


def test_html_to_md_image():
    md = split_book.html_to_md('<div><img alt="cap" src="../Images/x.jpeg"/></div>')
    assert "![cap](../Images/x.jpeg)" in md
    print("✓ html_to_md img")


def test_html_to_md_toc_backlink_drops_link_only():
    """目录回链 a 里包着章节标题:链接符号剥掉,文字保留。"""
    md = split_book.html_to_md(
        '<h2><a href="part0000.xhtml#toc11">第1章 消化知识</a></h2>'
    )
    # 不能有 [](part0000.xhtml#toc11) 链接符号
    assert 'part0000.xhtml' not in md
    # 文字保留为 h2 标题
    assert "第1章 消化知识" in md
    print("✓ html_to_md drops toc back-link")


def test_html_to_md_external_link_kept():
    """外部链接保留 [text](href) 形式。"""
    md = split_book.html_to_md('<p><a href="https://example.com">x</a></p>')
    assert "[x](https://example.com)" in md
    print("✓ html_to_md keeps external link")


def test_html_to_md_skip_svg():
    """svg 块整体跳过。"""
    md = split_book.html_to_md(
        '<div><svg><image xlink:href="cover.jpeg"/></svg>before</div>'
    )
    assert "cover.jpeg" not in md
    assert "before" in md
    print("✓ html_to_md skips svg")


# ── _walk_toc / classify_toc ───────────────────────────────

def _sec(title, href, kids=None):
    """构造一个伪 toc 节点。ebooklib 实际是 Link 类,我们用 namedtuple 等价物。"""
    from types import SimpleNamespace
    s = SimpleNamespace(title=title, href=href)
    if kids is not None:
        return (s, kids)
    return s


def test_walk_toc_flat():
    toc = [
        _sec("目录", "Text/part0000.xhtml"),
        _sec("第1章", "Text/part0001.xhtml#bw1"),
    ]
    flat = split_book._walk_toc(toc)
    assert len(flat) == 2
    assert flat[0]['level'] == 0
    assert flat[0]['title'] == "目录"
    print("✓ walk_toc")


def test_classify_simple_book():
    """经典 DDD 结构:目录/前页/正文part(part内含h1 chapter)/后页"""
    toc = [
        _sec("目录",     "Text/part0000.xhtml"),
        _sec("扉页",     "Text/part0001.xhtml"),
        _sec("Part 1",   "Text/part0010.xhtml", [
            _sec("Ch 1", "Text/part0010.xhtml#bw1"),
            _sec("Ch 2", "Text/part0010.xhtml#bw2"),
        ]),
        _sec("Part 2",   "Text/part0011.xhtml", [
            _sec("Ch 3", "Text/part0011.xhtml#bw3"),
        ]),
        _sec("索引",     "Text/part0020.xhtml"),
    ]
    flat = split_book._walk_toc(toc)
    s = split_book.classify_toc(flat)
    assert len(s['front_parts']) == 2   # 目录 + 扉页
    assert len(s['body_parts']) == 2    # Part 1 + Part 2
    assert s['body_parts'][0]['chapters'][0]['title'] == "Ch 1"
    assert len(s['back_parts']) == 1    # 索引
    assert s['front_parts'][0]['file'] == 'part0000.xhtml'
    assert s['front_parts'][0]['title'] == "目录"
    print("✓ classify simple book")


def test_classify_no_back():
    """没有后页的情况。"""
    toc = [
        _sec("P1", "Text/part0001.xhtml", [
            _sec("C1", "Text/part0001.xhtml#bw1"),
        ]),
    ]
    flat = split_book._walk_toc(toc)
    s = split_book.classify_toc(flat)
    assert len(s['body_parts']) == 1
    assert len(s['back_parts']) == 0
    print("✓ classify no-back")


def test_classify_no_body():
    """没正文 part(全部是前/后页):classify 必须能识别出'找不到正文'。"""
    toc = [
        _sec("扉页", "Text/part0001.xhtml"),
        _sec("致谢", "Text/part0002.xhtml"),
    ]
    flat = split_book._walk_toc(toc)
    s = split_book.classify_toc(flat)
    assert len(s['body_parts']) == 0
    print("✓ classify no-body")


# ── _slice_by_anchors ─────────────────────────────────────

def test_slice_by_anchors_basic():
    html = (
        '<h1>part</h1>'
        '<p>preamble</p>'
        '<h2 id="bw1">ch 1</h2>'
        '<p>c1 body</p>'
        '<h2 id="bw2">ch 2</h2>'
        '<p>c2 body</p>'
    )
    slices = split_book._slice_by_anchors(html, ['bw1', 'bw2'])
    assert len(slices) == 3
    assert slices[0][0] is None
    assert "preamble" in slices[0][1]
    assert slices[1][0] == 'bw1'
    assert "ch 1" in slices[1][1] and "c1 body" in slices[1][1]
    assert slices[2][0] == 'bw2'
    assert "ch 2" in slices[2][1] and "c2 body" in slices[2][1]
    # 不能让 bw2 的段包含 bw1 之后的尾段
    assert "c1 body" not in slices[2][1]
    print("✓ slice_by_anchors basic")


def test_slice_by_anchors_includes_open_tag():
    """切点必须在 <h2 ... id="..."> 的 < 处,不能从 id 前开始丢 <h2 头。"""
    html = '<h2 class="x" id="bw1">t</h2><p>body</p>'
    slices = split_book._slice_by_anchors(html, ['bw1'])
    assert slices[0][0] == 'bw1'
    # 切片里必须含完整的 <h2 ... id="bw1"> 开标签
    assert '<h2 class="x" id="bw1">' in slices[0][1]
    print("✓ slice_by_anchors preserves <h2 open tag")


def test_slice_by_anchors_missing():
    """锚链 ID 不存在 → 整个返回 (None, body)。"""
    html = '<p>just body</p>'
    slices = split_book._slice_by_anchors(html, ['nope'])
    assert len(slices) == 1
    assert slices[0] == (None, html)
    print("✓ slice_by_anchors missing")


# ── PDF → md ───────────────────────────────────────────────

def test_pdf_to_md_uses_text_layer():
    with tempfile.TemporaryDirectory() as td:
        source = Path(td) / "book.pdf"
        source.write_bytes(b"pdf")
        out = Path(td) / "章节"
        proc = subprocess.CompletedProcess([], 0, ("第一页正文内容足够长，用来验证 PDF 的文字层可以稳定转换为 Markdown。" * 2 +
                                                   "\f第二页正文内容也足够长，并且保留页码边界供阅读时回查。" * 2).encode(), b"")
        with patch.object(split_book.shutil, "which", return_value="/usr/bin/pdftotext"), \
             patch.object(split_book.subprocess, "run", return_value=proc):
            assert split_book._pdf_to_md(str(source), str(out)) == 0
        text = (out / "1 全文.md").read_text(encoding="utf-8")
        assert "第一页正文" in text and "第二页正文" in text
        assert "PDF 第 2 页" in text


def _pdf_run(text: bytes):
    return subprocess.CompletedProcess([], 0, text, b"")


def _pdf(td, stdout):
    source = Path(td) / "book.pdf"
    source.write_bytes(b"pdf")
    out = Path(td) / "章节"
    buf = io.StringIO()
    with patch.object(split_book.shutil, "which", return_value="/usr/bin/pdftotext"), \
         patch.object(split_book.subprocess, "run", return_value=_pdf_run(stdout)), \
         redirect_stdout(buf):
        rc = split_book._pdf_to_md(str(source), str(out))
    return rc, out, buf.getvalue()


def test_pdf_scanned_exit_3():
    with tempfile.TemporaryDirectory() as td:
        rc, out, text = _pdf(td, b" \f \f" + ("正文" * 20).encode() + b"\f \f")   # 4 页里 3 页空
        assert rc == split_book.SCANNED_EXIT == 3
        assert "扫描版" in text and "3/4" in text
        assert not out.exists()


def test_pdf_scattered_blank_pages_not_scanned():
    with tempfile.TemporaryDirectory() as td:
        page = ("正文内容" * 10).encode()
        rc, out, _ = _pdf(td, page + b"\f \f" + page + b"\f" + page + b"\f")   # 末尾 \f 不算一页
        assert rc == 0
        body = (out / "1 全文.md").read_text(encoding="utf-8")
        assert "PDF 第 4 页" in body and "PDF 第 2 页" not in body   # 页号按 PDF 真实页序：空页不写、但占号


def test_pdf_trailing_formfeed_not_a_page():
    with tempfile.TemporaryDirectory() as td:
        rc, out, text = _pdf(td, ("短书正文" * 10).encode() + b"\f")
        assert rc == 0
        assert "（1 页）" in text
        assert "PDF 第 2 页" not in (out / "1 全文.md").read_text(encoding="utf-8")


def test_pdf_exactly_half_blank_not_scanned():
    """判据是空页「超过」一半；恰好一半照转。"""
    with tempfile.TemporaryDirectory() as td:
        page = ("正文内容" * 10).encode()
        rc, _, text = _pdf(td, page + b"\f \f" + page + b"\f \f")
        assert rc == 0, text
        assert "（4 页）" in text


def test_pdf_no_layout_flag():
    """-layout 会给每行加十几格缩进（渲成代码块），booklet 双栏还会逐行拼接左右两页；用默认阅读顺序。"""
    with tempfile.TemporaryDirectory() as td:
        source = Path(td) / "book.pdf"
        source.write_bytes(b"pdf")
        with patch.object(split_book.shutil, "which", return_value="/usr/bin/pdftotext"), \
             patch.object(split_book.subprocess, "run", return_value=_pdf_run(("正文" * 20).encode())) as run, \
             redirect_stdout(io.StringIO()):
            split_book._pdf_to_md(str(source), str(Path(td) / "章节"))
        args = run.call_args[0][0]
        assert "-layout" not in args
        assert args[-2:] == [str(source), "-"]


# ── main ───────────────────────────────────────────────────

def main():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
    print(f"\nRan {len(fns)} tests")


if __name__ == "__main__":
    main()
