"""wiki book qc：书级质检六条，每条一个反例，合规书零问题。

跑： python3 vault-tools/tests/test_book_qc.py
"""

import io
import shutil
import sys
import tempfile
import unicodedata
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import qc  # noqa: E402

IMG = "raw/book/甲/images"          # 书图目录（素材图随素材走）
REL = "../images"                  # 章节里的引用写法：相对章节文件
INDEX = ("---\ntitle: 甲\nmaterial_status: proofread\ncreated: 2026-10-13\n---\n\n# 甲\n\n## 章节进度\n\n"
         "- [ ] 1 一 → `章节/1 一.md`\n- [x] 2 二 → `章节/2 二.md`\n\n"
         "## 整理记录\n\n- 1 补图 ✓ · 梳理 ✓\n- 2 补图 ✓ · 梳理 ✓\n\n## 知识沉淀\n\n- （暂无）\n")


class TestQc(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.book = self.root / "raw/book/甲"
        self.img = self.root / IMG
        self.w("甲.md", INDEX)
        self.w("章节/1 一.md", f"# 一\n\n正文。\n\n![图 1.1 甲]({REL}/1-001.png)\n")
        self.w("章节/2 二.md", f"# 二\n\n正文 $x^2$。\n\n![图 2.1]({REL}/a%20b.png)\n")
        self.img.mkdir(parents=True, exist_ok=True)
        (self.img / "1-001.png").write_bytes(b"png")
        (self.img / "a b.png").write_bytes(b"png")

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, text):
        p = self.book / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def probs(self):
        return qc.problems(self.root, "甲")          # 不带书名号也认

    @unittest.skipUnless(shutil.which("node"), "需要 Node")
    def test_合规书零问题(self):
        self.assertEqual(self.probs(), [])

    def test_md_校验没跑成算不通过(self):
        with mock.patch.object(qc.check, "run_validate_md", return_value=(None, "需要 Node")):
            got = self.probs()
        self.assertIn("md 语法校验没跑成：需要 Node", got)

    @unittest.skipUnless(shutil.which("node"), "需要 Node")
    def test_run_退出码(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(qc.run(self.root, "甲"), 0)
        self.w("章节/3 三.md", "# 三\n")
        with redirect_stdout(buf):
            self.assertEqual(qc.run(self.root, "甲"), 1)
        self.assertIn("质检通过", buf.getvalue())
        self.assertIn("处问题", buf.getvalue())

    def test_没有书(self):
        self.assertTrue(any("没有这本书" in p for p in qc.problems(self.root, "乙")))

    def test_清单与章节对不上(self):
        self.w("章节/3 三.md", "# 三\n")
        self.assertTrue(any("3" in p and "清单" in p for p in self.probs()))

    def test_整理记录缺梳理(self):
        self.w("甲.md", INDEX.replace("- 2 补图 ✓ · 梳理 ✓", "- 2 补图 ✓"))
        self.assertTrue(any("2" in p and "梳理" in p for p in self.probs()))

    def test_乱码与页标记残留(self):
        self.w("章节/1 一.md", f"# 一\n\n坏\ufffd字 \ue000\n\n<!-- PDF 第 3 页 -->\n\n![]({REL}/1-001.png)\n")
        got = self.probs()
        self.assertTrue(any("乱码" in p for p in got), got)
        self.assertTrue(any("页标记" in p for p in got), got)

    def test_图片缺失与未引用(self):
        (self.img / "1-001.png").unlink()
        (self.img / "多余.png").write_bytes(b"png")
        got = self.probs()
        self.assertTrue(any("图片不存在" in p and "1-001.png" in p for p in got), got)
        self.assertTrue(any("没被引用" in p and "多余.png" in p for p in got), got)

    def test_NFD文件名的图(self):
        nfc = "图\u00e9甲.png"                      # 汉字无分解形式，用 é 才有 NFC≠NFD
        nfd = unicodedata.normalize("NFD", nfc)
        self.assertNotEqual(nfd, nfc)
        (self.img / nfd).write_bytes(b"png")
        self.w("章节/1 一.md", f"# 一\n\n![图]({REL}/图\u00e9甲.png)\n\n![图 1.1 甲]({REL}/1-001.png)\n")
        got = self.probs()
        hit = [p for p in got if unicodedata.normalize("NFC", p).find(nfc) >= 0]
        self.assertEqual(hit, [], got)                 # 既不报「图片不存在」也不报「没被引用」

    def test_尖括号路径含空格(self):
        self.w("章节/2 二.md", f"# 二\n\n正文。\n\n![图](<{REL}/a b.png>)\n")
        self.assertEqual(self.probs(), [])

    @unittest.skipUnless(shutil.which("node"), "需要 Node")
    def test_PDF_没切章(self):
        for f in (self.book / "章节").glob("*.md"):
            f.unlink()
        shutil.rmtree(self.img)
        self.w("章节/1 全文.md", "# 甲\n\n正文。\n")
        self.w("甲.md", "---\ntitle: 甲\ncreated: 2026-10-13\n---\n\n# 甲\n\n## 章节进度\n\n"
               "- [ ] 1 全文 → `章节/1 全文.md`\n\n## 整理记录\n\n- 1 补图 ✓ 0 张 · 梳理 ✓\n")
        got = self.probs()
        self.assertTrue(any("还没切章" in p and "wiki book cut" in p for p in got), got)

    def test_md_语法错(self):
        self.w("章节/2 二.md", f"# 二\n\n```js\n没闭合\n\n![]({REL}/a%20b.png)\n")
        got = self.probs()
        self.assertTrue(any("围栏未闭合" in p for p in got), got)

    def img_probs(self):
        return [p for p in self.probs() if "图片" in p or "没被引用" in p]

    def test_图片_title_三种写法都认(self):
        self.w("章节/1 一.md", f"# 一\n\n![]({REL}/1-001.png 't')\n")
        self.w("章节/2 二.md", f"# 二\n\n![](<{REL}/a b.png> (t))\n")
        self.assertEqual(self.img_probs(), [])

    def test_远程与内联图不当本地文件(self):
        self.w("章节/1 一.md", f"# 一\n\n![]({REL}/1-001.png)\n\n"
               "![](data:image/png;base64,AAAA) ![](HTTP://x.org/y.png) ![](//cdn.x.org/z.png)\n")
        self.assertEqual(self.img_probs(), [])

    def test_从根写的图片路径单独报(self):
        self.w("章节/1 一.md", f"# 一\n\n![]({REL}/1-001.png) ![](/images/x.png)\n")
        self.assertTrue(any("别以 / 开头" in p and "/images/x.png" in p for p in self.probs()))

    def test_章号重复报(self):
        self.w("章节/1 另一.md", "# 另一\n")
        self.assertTrue(any("章号重复" in p and "1" in p for p in self.probs()))

    def test_同章多条记录报(self):
        self.w("甲.md", INDEX.replace("- 1 补图 ✓ · 梳理 ✓", "- 1 补图 ✓\n- 1 补图 ✓ · 梳理 ✓"))
        self.assertTrue(any("1" in p and "不止一行" in p for p in self.probs()))


    def test_号前缀冲突(self):
        self.w("章节/1.1 甲.md", "# 甲\n")
        self.assertTrue(any("章节号冲突" in p and "1.1" in p for p in self.probs()))

    def test_书图还在章节_images(self):
        (self.book / "章节/images").mkdir()
        (self.book / "章节/images/x.png").write_bytes(b"png")
        self.assertTrue(any("章节/images" in p and "wiki book images" in p for p in self.probs()))

    def test_书图目录里多一张没引用(self):
        (self.img / "多余.png").write_bytes(b"png")
        self.assertTrue(any("没被引用" in p and "多余.png" in p for p in self.probs()))

    def test_别处的图不归本书_qc_管(self):
        other = self.root / "raw/book/乙/images"
        other.mkdir(parents=True)
        (other / "x.png").write_bytes(b"png")
        self.assertFalse(any("乙" in p for p in self.probs()))

    def test_缺_created(self):
        self.w("甲.md", INDEX.replace("created: 2026-10-13\n", ""))
        self.assertTrue(any("created" in p for p in self.probs()))

    def test_记录_2_1_与_2_10_不串(self):
        self.w("章节/2 二.md", "# 二\n")
        (self.book / "章节/2 二.md").rename(self.book / "章节/2.1 甲.md")
        self.w("章节/2.10 癸.md", "# 癸\n")
        idx = INDEX.replace("- [x] 2 二 → `章节/2 二.md`", "- [ ] 2.1 甲\n- [ ] 2.10 癸")
        idx = idx.replace("- 2 补图 ✓ · 梳理 ✓", "- 2.10 补图 ✓ · 梳理 ✓")
        self.w("甲.md", idx)
        got = self.probs()
        self.assertTrue(any("2.1" in p and "梳理" in p and "2.10" not in p for p in got), got)
        self.assertFalse(any("2.10" in p and "整理记录" in p for p in got), got)


class TestQcSpaceName(unittest.TestCase):
    """书名带空格：图目录 raw/book/<书名>/images/ 带空格，qc 的「不存在 / 没被引用」两头都要认。"""

    def test_带空格的书名(self):
        root = Path(tempfile.mkdtemp()).resolve()
        try:
            name = "Domain-Driven Design"
            book = root / "raw/book" / name
            (book / "章节").mkdir(parents=True)
            (book / f"{name}.md").write_text(
                f"---\ntitle: {name}\ncreated: 2026-09-06\n---\n\n## 章节进度\n\n- [ ] 1 一\n\n"
                "## 整理记录\n\n- 1 补图 ✓ · 梳理 ✓\n", encoding="utf-8")
            (book / "章节/1 一.md").write_text(
                "# 一\n\n![](../images/1-001.png)\n", encoding="utf-8")
            img = book / "images"
            img.mkdir(parents=True)
            (img / "1-001.png").write_bytes(b"png")
            with mock.patch.object(qc.check, "run_validate_md", return_value=({"syntax": [], "fence": []}, "")):
                self.assertEqual(qc.problems(root, name), [])
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
