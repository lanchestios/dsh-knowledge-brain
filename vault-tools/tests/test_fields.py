"""description 字段：一句话摘要，给列表和未来的索引用。

跑： python3 vault-tools/tests/test_fields.py
"""

import io
import contextlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from book import new as book_new  # noqa: E402
from page import new as page_new  # noqa: E402
from core import frontmatter as fm  # noqa: E402
import init  # noqa: E402
from page import query as page_query  # noqa: E402
from core import repo  # noqa: E402


class TestDescriptionField(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        for c in repo.THOUGHT_CATEGORIES:
            (self.root / repo.THOUGHT / c).mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def page(self, body):
        p = self.root / "x.md"
        p.write_text(f"---\n{body}\n---\n\n正文\n", encoding="utf-8")
        return fm.parse(p)

    def test_page_暴露_description(self):
        self.assertEqual(self.page("description: 一句话").description, "一句话")

    def test_没有_description_时给空串(self):
        self.assertEqual(self.page("title: 甲").description, "")

    def test_渲染时_description_紧跟在_title_之后(self):
        got = fm.render({"title": "甲", "description": "摘要", "tags": ["x"]})
        keys = [ln.split(":")[0] for ln in got.splitlines() if ":" in ln]
        self.assertEqual(keys[:2], ["title", "description"])

    def test_空_description_渲染成空值而不是省略(self):
        self.assertIn("description:", fm.render({"title": "甲", "description": ""}))

    def test_新建的页带一个空的_description_等人填(self):
        page_new.new_node(self.root, "知识/甲", "甲", by="claude")
        page = fm.parse(self.root / "知识" / "甲.md")
        self.assertIn("description", page.fields)
        self.assertEqual(page.description, "")

    def test_新建的页立刻就能通过_check(self):
        """建页路径写出来的 frontmatter 必须自洽——不合规的页一建出来就是债。"""
        page_new.new_node(self.root, "知识/甲", "甲", by="claude")
        page = fm.parse(self.root / "知识" / "甲.md")
        self.assertEqual(repo.trust_problems(page.generated, page.verified), [])

    def test_新建的页_generated_at_是时间戳不是日期(self):
        page_new.new_node(self.root, "知识/乙", "乙", by="claude")
        at = fm.parse(self.root / "知识" / "乙.md").generated["at"]
        self.assertTrue(repo.is_iso_datetime(at), at)

    def test_新建的书也一样(self):
        book_new.new_book(self.root, "丙", by="claude")
        page = fm.parse(repo.index_of(self.root / repo.RAW / "book" / "丙"))
        self.assertEqual(repo.trust_problems(page.generated, page.verified), [])

    def test_check_把缺失的_description_当错误(self):
        (self.root / "知识").mkdir()
        (self.root / "知识" / "甲.md").write_text(
            "---\ntitle: 甲\ntags: []\nsource: []\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\n\n# 甲\n",
            encoding="utf-8")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = check.run(self.root)
        self.assertEqual(rc, 1)
        self.assertIn("description", buf.getvalue())

    def test_init_补的是空值不是页面名(self):
        (self.root / "知识").mkdir()
        p = self.root / "知识" / "甲.md"
        p.write_text("---\ntitle: 甲\ntags: []\nsource: []\ncreated: 2026-09-06\n"
                     "updated: 2026-09-06\n---\n\n# 甲\n", encoding="utf-8")
        init._frontmatter(self.root)
        self.assertEqual(fm.parse(p).description, "")

    def test_按标签列页时带上摘要(self):
        (self.root / "知识").mkdir()
        (self.root / "知识" / "甲.md").write_text(
            "---\ntitle: 甲\ndescription: 这是甲的摘要\ntags: [t]\nsource: []\n"
            "created: 2026-09-06\nupdated: 2026-09-06\n---\n\n# 甲\n", encoding="utf-8")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            page_query.tags(self.root, "t")
        self.assertIn("这是甲的摘要", buf.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
