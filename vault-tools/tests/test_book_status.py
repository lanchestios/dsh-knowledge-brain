"""wiki book status：查 / 写词表内的值；写 readable 每次都当场过 qc。

跑： python3 vault-tools/tests/test_book_status.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import status as book_status  # noqa: E402
from core import frontmatter as fm  # noqa: E402

INDEX = ("---\ntitle: 甲\nmaterial_status: proofread\nmaterial_error: 旧错误\ncreated: 2026-10-13\nupdated: 2026-01-01\n---\n\n"
         "# 甲\n\n## 章节进度\n\n- [ ] 1 一 → `章节/1 一.md`\n\n"
         "## 整理记录\n\n- 1 补图 ✓ · 梳理 ✓\n")


class TestStatus(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.book = self.root / "raw/book/甲"
        (self.book / "章节").mkdir(parents=True)
        self.idx = self.book / "甲.md"
        self.idx.write_text(INDEX, encoding="utf-8")
        (self.book / "章节/1 一.md").write_text("# 一\n\n正文。\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root)

    def q(self, *a):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = book_status.status(self.root, *a)
        return rc, buf.getvalue()

    def field(self, k):
        return str(fm.parse(self.idx).fields.get(k, "")).strip('"')

    def test_查询(self):
        rc, text = self.q("甲")
        self.assertEqual(rc, 0)
        self.assertIn("proofread", text)

    def test_词表外拒写(self):
        rc, text = self.q("甲", "done")
        self.assertEqual(rc, 1)
        self.assertEqual(self.field("material_status"), "proofread")

    def test_写中间态清错误刷_updated(self):
        rc, _ = self.q("甲", "figures")
        self.assertEqual(rc, 0)
        self.assertEqual(self.field("material_status"), "figures")
        self.assertEqual(self.field("material_error"), "")
        self.assertNotEqual(self.field("updated"), "2026-01-01")

    def test_error_写进_material_error(self):
        rc, _ = self.q("甲", "init", "扫描版，待确认 AI 转写")
        self.assertEqual(rc, 0)
        self.assertEqual(self.field("material_status"), "init")
        self.assertEqual(self.field("material_error"), "扫描版，待确认 AI 转写")
        rc, text = self.q("甲")
        self.assertIn("material_error: 扫描版，待确认 AI 转写", text)
        rc, _ = self.q("甲", "text")                              # 不给 --error：非 failed 照旧清掉
        self.assertEqual(rc, 0)
        self.assertEqual(self.field("material_error"), "")

    def test_查询时说明里的引号与反斜杠还原(self):
        self.q("甲", "init", '坏 "引号" 与 \\ 反斜杠')
        rc, text = self.q("甲")
        self.assertEqual(rc, 0)
        self.assertIn('material_error: 坏 "引号" 与 \\ 反斜杠', text)

    @unittest.skipUnless(shutil.which("node"), "需要 Node")
    def test_readable_过质检才写_且每次都重跑(self):
        rc, text = self.q("甲", "readable")
        self.assertEqual(rc, 0, text)
        self.assertEqual(self.field("material_status"), "readable")
        (self.book / "章节/1 一.md").write_text("# 一\n\n坏�字\n", encoding="utf-8")
        rc, text = self.q("甲", "readable")
        self.assertEqual(rc, 1)
        self.assertIn("乱码", text)

    def test_readable_没过质检不写(self):
        (self.book / "章节/2 二.md").write_text("# 二\n", encoding="utf-8")   # 清单没有 2
        rc, text = self.q("甲", "readable")
        self.assertEqual(rc, 1)
        self.assertEqual(self.field("material_status"), "proofread")


if __name__ == "__main__":
    unittest.main()
