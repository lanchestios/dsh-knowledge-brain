"""wiki book cut / sync / crop。

跑： python3 vault-tools/tests/test_book_chapters.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import chapters  # noqa: E402
from book import crop as book_crop  # noqa: E402

try:
    import PIL  # noqa: F401
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

INDEX = ("---\ntitle: 甲\nmaterial_status: text\n---\n\n# 甲\n\n## 章节进度\n\n"
         "- [x] 1 全文 → `章节/1 全文.md`\n\n## 知识沉淀\n\n- （暂无）\n")
WHOLE = ("# 甲\n\n<!-- PDF 第 1 页 -->\n\n目录\n\n<!-- PDF 第 2 页 -->\n\n第一章正文\n\n"
         "<!-- PDF 第 3 页 -->\n\n续\n\n<!-- PDF 第 5 页 -->\n\n第二章正文\n")


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.book = self.root / "raw/book/甲"
        (self.book / "章节").mkdir(parents=True)
        self.idx = self.book / "甲.md"
        self.idx.write_text(INDEX, encoding="utf-8")
        (self.book / "章节/1 全文.md").write_text(WHOLE, encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root)

    def q(self, fn, *a):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*a)
        return rc, buf.getvalue()


class TestCut(Base):
    def test_按页切章并同步清单(self):
        rc, text = self.q(chapters.cut, self.root, "甲", ["2:开始", "4:继续"])
        self.assertEqual(rc, 0, text)
        names = sorted(p.name for p in (self.book / "章节").glob("*.md"))
        self.assertEqual(names, ["00-前页.md", "1 开始.md", "2 继续.md"])
        one = (self.book / "章节/1 开始.md").read_text(encoding="utf-8")
        self.assertTrue(one.startswith("# 开始\n"))
        self.assertIn("第一章正文", one)
        self.assertIn("<!-- PDF 第 3 页 -->", one)
        self.assertNotIn("第二章正文", one)
        self.assertIn("第二章正文", (self.book / "章节/2 继续.md").read_text(encoding="utf-8"))
        idx = self.idx.read_text(encoding="utf-8")
        self.assertIn("- [ ] 1 开始 → `章节/1 开始.md`", idx)   # 全文的勾不继承：切出的是新章，还没读
        self.assertIn("- [ ] 2 继续 → `章节/2 继续.md`", idx)
        self.assertNotIn("全文", idx)
        self.assertIn("## 知识沉淀", idx)

    def test_页号不递增拒绝(self):
        rc, _ = self.q(chapters.cut, self.root, "甲", ["4:乙", "2:甲"])
        self.assertEqual(rc, 1)
        self.assertTrue((self.book / "章节/1 全文.md").exists())

    def test_两章落在同一页标记拒绝(self):
        # 只有第 3、5 页有标记（第 4 页是空页）：4 与 5 都落到第 5 页标记上
        (self.book / "章节/1 全文.md").write_text(
            "# 甲\n\n<!-- PDF 第 3 页 -->\n\n前\n\n<!-- PDF 第 5 页 -->\n\n后\n", encoding="utf-8")
        rc, text = self.q(chapters.cut, self.root, "甲", ["4:甲", "5:乙"])
        self.assertEqual(rc, 1, text)
        self.assertIn("同一页标记", text)
        self.assertTrue((self.book / "章节/1 全文.md").exists())
        self.assertFalse((self.book / "章节/1 甲.md").exists())
        self.assertFalse((self.book / "章节/00-前页.md").exists())

    def test_第一章叫全文拒绝(self):
        rc, text = self.q(chapters.cut, self.root, "甲", ["2:全文"])
        self.assertEqual(rc, 1)
        self.assertIn("全文", text)
        self.assertTrue((self.book / "章节/1 全文.md").exists())

    def test_前页为空不写前页文件(self):
        rc, text = self.q(chapters.cut, self.root, "甲", ["1:开头"])
        self.assertEqual(rc, 0, text)
        self.assertFalse((self.book / "章节/00-前页.md").exists())

    def test_起始页超出末个页标记拒绝(self):
        rc, text = self.q(chapters.cut, self.root, "甲", ["2:甲", "9:乙"])
        self.assertEqual(rc, 1)
        self.assertIn("第 9 页", text)
        self.assertTrue((self.book / "章节/1 全文.md").exists())

    def test_已有别的章节文件拒绝(self):
        (self.book / "章节/3 旧.md").write_text("# 旧\n", encoding="utf-8")
        rc, text = self.q(chapters.cut, self.root, "甲", ["2:甲"])
        self.assertEqual(rc, 1)
        self.assertIn("3 旧.md", text)
        self.assertTrue((self.book / "章节/1 全文.md").exists())

    def test_缺章节进度节写盘前就拒(self):
        self.idx.write_text(INDEX.replace("## 章节进度", "## 阅读记录"), encoding="utf-8")
        rc, text = self.q(chapters.cut, self.root, "甲", ["2:甲"])
        self.assertEqual(rc, 1)
        self.assertIn("章节进度", text)
        self.assertTrue((self.book / "章节/1 全文.md").exists())
        self.assertFalse((self.book / "章节/1 甲.md").exists())

    def test_没有全文拒绝(self):
        (self.book / "章节/1 全文.md").unlink()
        rc, text = self.q(chapters.cut, self.root, "甲", ["1:甲"])
        self.assertEqual(rc, 1)
        self.assertIn("1 全文.md", text)


class TestSync(Base):
    def test_清单跟着文件走(self):
        (self.book / "章节/1 全文.md").unlink()
        (self.book / "章节/1 a b.md").write_text("# a\n", encoding="utf-8")
        (self.book / "章节/2 c.md").write_text("# c\n", encoding="utf-8")
        rc, text = self.q(chapters.sync, self.root, "甲")
        self.assertEqual(rc, 0, text)
        idx = self.idx.read_text(encoding="utf-8")
        self.assertIn("- [x] 1 a b → `章节/1 a b.md`", idx)   # 原来 1 勾过，按号保留
        self.assertIn("- [ ] 2 c → `章节/2 c.md`", idx)


class TestCrop(unittest.TestCase):
    def run_crop(self, page, box, out):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = book_crop.crop(str(page), box, str(out))
        return rc, buf.getvalue()

    def page(self, td, w=200, h=100):
        from PIL import Image
        p = Path(td) / "p.png"
        Image.new("RGB", (w, h), "white").save(p)
        return p

    @unittest.skipUnless(HAS_PIL, "需要 Pillow")
    def test_按比例裁(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "images" / "ch01-001.png"
            rc, text = self.run_crop(self.page(td), "0.25,0,0.75,0.5", out)
            self.assertEqual(rc, 0, text)
            self.assertEqual(Image.open(out).size, (100, 50))

    def test_框不合法拒绝(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _ = self.run_crop(Path(td) / "无.png", "0.5,0,0.2,1", Path(td) / "o.png")
            self.assertEqual(rc, 1)

    def test_非有限数拒绝(self):
        with tempfile.TemporaryDirectory() as td:
            for box in ("nan,0,1,1", "0,0,inf,1"):
                rc, text = self.run_crop(Path(td) / "无.png", box, Path(td) / "o.png")
                self.assertEqual(rc, 1, box)
                self.assertIn("有限数", text)

    @unittest.skipUnless(HAS_PIL, "需要 Pillow")
    def test_框整个在图外拒绝(self):
        with tempfile.TemporaryDirectory() as td:
            rc, text = self.run_crop(self.page(td), "300,0,400,10", Path(td) / "o.png")
            self.assertEqual(rc, 1)
            self.assertIn("在页图外", text)

    @unittest.skipUnless(HAS_PIL, "需要 Pillow")
    def test_不是图片拒绝(self):
        with tempfile.TemporaryDirectory() as td:
            bad = Path(td) / "p.png"
            bad.write_bytes(b"not an image")
            rc, text = self.run_crop(bad, "0,0,0.5,0.5", Path(td) / "o.png")
            self.assertEqual(rc, 1)
            self.assertIn("读不了页图", text)


if __name__ == "__main__":
    unittest.main()
