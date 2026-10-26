"""章节号 1 / 1.1 下的 sync / read / deposit / list：分组行、数字排序、前缀安全。

跑： python3 vault-tools/tests/test_book_ids.py
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
from book import deposit as book_deposit  # noqa: E402
from book import list as book_list  # noqa: E402
from book import read as book_read  # noqa: E402

HEAD = "---\ntitle: 甲书\nmaterial_status: readable\nprogress: 未读\n---\n\n# 甲书\n\n"
TAIL = "\n## 知识沉淀\n\n- （暂无）\n"

# 与 test/books.test.js 的同名期望逐字相同（Python sync 与 TS syncChapterIndex 一致）
SYNC_EXPECTED = (
    "## 章节进度\n\n"
    "- [ ] 1 一 → `章节/1 一.md`\n"
    "### 2 第二部分\n"
    "- [ ] 2.1 甲 → `章节/2.1 甲.md`\n"
    "- [x] 2.2 乙 → `章节/2.2 乙.md`\n"
    "- [ ] 2.10 癸 → `章节/2.10 癸.md`\n"
)


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.book = self.root / "raw/book/甲书"
        (self.book / "章节").mkdir(parents=True)
        self.idx = self.book / "甲书.md"

    def tearDown(self):
        shutil.rmtree(self.root)

    def index(self, progress, deposits="- （暂无）\n"):
        self.idx.write_text(HEAD + "## 章节进度\n\n" + progress + "\n## 知识沉淀\n\n" + deposits, encoding="utf-8")

    def q(self, fn, *a, **k):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*a, **k)
        return rc, buf.getvalue()


class TestSync(Base):
    def files(self, *names):
        for n in names:
            (self.book / "章节" / n).write_text("# x\n", encoding="utf-8")

    def test_分组行保留_数字排序_勾按号保留(self):
        self.files("1 一.md", "2.1 甲.md", "2.10 癸.md", "2.2 乙.md", "00-前言.md")
        self.index("### 2 第二部分\n- [x] 2.2 乙\n- [ ] 9 旧的\n")
        rc, text = self.q(chapters.sync, self.root, "甲书")
        self.assertEqual(rc, 0, text)
        self.assertIn(SYNC_EXPECTED + "\n## 知识沉淀", self.idx.read_text(encoding="utf-8"))

    def test_没有分组行时补父号(self):
        self.files("3.1 甲.md", "3.2 乙.md", "4 丁.md")
        self.index("- [ ] 1\n")
        self.q(chapters.sync, self.root, "甲书")
        idx = self.idx.read_text(encoding="utf-8")
        self.assertIn("### 3\n- [ ] 3.1 甲 → `章节/3.1 甲.md`\n- [ ] 3.2 乙", idx)
        self.assertIn("- [ ] 4 丁 → `章节/4 丁.md`", idx)
        self.assertEqual(idx.count("### "), 1)


    def test_章节进度是最后一节时以单个换行结尾(self):
        self.files("1 一.md", "2.1 甲.md", "2.10 癸.md", "2.2 乙.md")
        self.idx.write_text(HEAD + "## 章节进度\n\n### 2 第二部分\n- [x] 2.2 乙\n", encoding="utf-8")
        self.q(chapters.sync, self.root, "甲书")
        self.assertTrue(self.idx.read_text(encoding="utf-8").endswith(SYNC_EXPECTED))
        self.assertFalse(self.idx.read_text(encoding="utf-8").endswith("\n\n"))


class TestReadDeposit(Base):
    ROWS = "- [ ] 1 一\n- [ ] 1.1 甲\n- [ ] 1.10 癸\n- [ ] 10 十\n"

    def test_read_只勾那一号(self):
        self.index(self.ROWS)
        rc, text = self.q(book_read.read, self.root, "甲书", "1.1")
        self.assertEqual(rc, 0, text)
        idx = self.idx.read_text(encoding="utf-8")
        self.assertIn("- [x] 1.1 甲", idx)
        for row in ("- [ ] 1 一", "- [ ] 1.10 癸", "- [ ] 10 十"):
            self.assertIn(row, idx)
        rc, _ = self.q(book_read.read, self.root, "甲书", "1")
        idx = self.idx.read_text(encoding="utf-8")
        self.assertIn("- [x] 1 一", idx)
        self.assertIn("- [ ] 10 十", idx)
        self.assertIn("- [ ] 1.10 癸", idx)

    def test_read_没有这一号或号格式不对(self):
        self.index(self.ROWS)
        self.assertEqual(self.q(book_read.read, self.root, "甲书", "9")[0], 1)
        rc, text = self.q(book_read.read, self.root, "甲书", "ch01")
        self.assertEqual(rc, 1)
        self.assertIn("1 / 1.1", text)

    def test_deposit_不被_1_10_误判(self):
        self.index("- [x] 1.1 甲\n- [x] 1.10 癸\n", deposits="- 1.10 癸 · 沉淀中\n")
        rc, text = self.q(book_deposit.deposit, self.root, "甲书", "1.1")
        self.assertEqual(rc, 0, text)
        self.assertIn("开始沉淀", text)
        self.assertIn("- 1.1 甲 · 沉淀中", self.idx.read_text(encoding="utf-8"))

    def test_deposit_1_不被_1_1_误判(self):
        # 「.」算词边界，旧的 \b 会把已有的 1.1 条目当成 1 的
        self.index("- [x] 1 一\n- [x] 1.1 甲\n", deposits="- 1.1 甲 · 沉淀中\n")
        rc, text = self.q(book_deposit.deposit, self.root, "甲书", "1")
        self.assertEqual(rc, 0, text)
        self.assertIn("开始沉淀", text)
        self.assertIn("- 1 一 · 沉淀中", self.idx.read_text(encoding="utf-8"))

    def test_list_按新号计数(self):
        self.index("- [x] 1.1 甲\n- [ ] 2 乙\n", deposits="- 1.1 甲 · 沉淀中\n- 2 乙 → `知识/`\n")
        rc, text = self.q(book_list.books, self.root)
        self.assertEqual(rc, 0, text)
        self.assertIn("沉淀中 1 · 完成 1", text)


if __name__ == "__main__":
    unittest.main()
