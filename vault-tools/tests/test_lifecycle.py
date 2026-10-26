"""status（OKF §5.4 生命周期）与 progress（书的阅读进度）。

两者不是一回事，status 也不表达确认状态——那只看 verified。

跑： python3 vault-tools/tests/test_lifecycle.py
"""

import contextlib
import io
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
from book import read as book_read  # noqa: E402
from page import mark as page_mark  # noqa: E402
from core import repo  # noqa: E402
from _vault import fill_top, fix_folders  # noqa: E402


class TestStatusField(unittest.TestCase):
    """status: draft | stable | deprecated，缺省即 stable。"""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def page(self, body):
        p = self.dir / "x.md"
        p.write_text(f"---\n{body}\n---\n\n正文\n", encoding="utf-8")
        return fm.parse(p)

    def test_缺省是_stable(self):
        self.assertEqual(self.page("title: 甲").status, "stable")

    def test_读出显式的值(self):
        self.assertEqual(self.page("status: draft").status, "draft")

    def test_合法值只有三个(self):
        self.assertEqual(repo.STATUSES, ["draft", "stable", "deprecated"])

    def test_非法值被校验挡下(self):
        self.assertTrue(repo.status_problem("published"))

    def test_合法值不报问题(self):
        for s in repo.STATUSES:
            self.assertIsNone(repo.status_problem(s))

    def test_空值当缺省处理(self):
        self.assertIsNone(repo.status_problem(""))


class TestProgressField(unittest.TestCase):
    """书的阅读进度改名 progress，把 status 让给 OKF。"""

    def test_合法值(self):
        self.assertEqual(repo.PROGRESSES, ["未读", "在读", "读完", "搁置"])

    def test_非法值被挡下(self):
        self.assertTrue(repo.progress_problem("看了一半"))

    def test_合法值不报问题(self):
        for v in repo.PROGRESSES:
            self.assertIsNone(repo.progress_problem(v))


class TestMaterialStatusField(unittest.TestCase):
    """material_status 由素材类型决定，和页面 lifecycle status 正交。"""

    def test_书籍状态词表(self):
        rel = "raw/book/甲/甲.md"
        for value in repo.BOOK_MATERIAL_STATUSES:
            self.assertIsNone(repo.material_status_problem(rel, value))
        self.assertTrue(repo.material_status_problem(rel, "pending_distillation"))
        self.assertTrue(repo.material_status_problem(rel, ""))

    def test_普通页面不使用素材状态机(self):
        self.assertIsNone(repo.material_status_problem("知识/甲.md", None))


class TestWiring(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        # 规则二要求 认知/ 铺齐四类，每类还得有同名 index，否则 check 先被结构挡下
        self._index(self.root / repo.THOUGHT, "认知")
        for c in repo.THOUGHT_CATEGORIES:
            self._index(self.root / repo.THOUGHT / c, c)
        fill_top(self.root)

    @staticmethod
    def _index(d: Path, name: str):
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.md").write_text(
            f"---\ntitle: {name}\ndescription: \ntags: []\nsource: []\n"
            f"created: 2026-09-06\nupdated: 2026-09-06\n---\n\n{name} 的正文。\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root)

    def quiet(self, fn, *a, **k):
        with contextlib.redirect_stdout(io.StringIO()):
            return fn(*a, **k)

    def test_新建的页是_draft_因为它还是空壳(self):
        self.quiet(page_new.new_node, self.root, "知识/甲", "甲", by="claude")
        self.assertEqual(fm.parse(self.root / "知识" / "甲.md").status, "draft")

    def test_新建的页正文不带一级标题(self):
        # 阅读器标题栏显示页名，正文再写 # 标题 是重复（check 的语法规则也拦）
        self.quiet(page_new.new_node, self.root, "知识/甲", "甲", by="claude")
        text = (self.root / "知识" / "甲.md").read_text(encoding="utf-8")
        self.assertNotIn("\n# ", text)
        self.assertTrue(text.endswith("---\n"), repr(text[-40:]))

    def test_书的阅读进度记在_progress_上(self):
        self.quiet(book_new.new_book, self.root, "甲", by="claude")
        page = fm.parse(repo.index_of(self.root / repo.RAW / "book" / "甲"))
        self.assertEqual(page.fields.get("progress"), "未读")

    def test_书同时有_status_因为两个轴正交(self):
        """进度页本身也是一个页，也有「写完没有」这个问题。"""
        self.quiet(book_new.new_book, self.root, "甲", by="claude")
        page = fm.parse(repo.index_of(self.root / repo.RAW / "book" / "甲"))
        self.assertEqual(page.status, "draft")
        self.assertEqual(page.fields.get("progress"), "未读")

    def test_章节全勾完_progress_变读完(self):
        self.quiet(book_new.new_book, self.root, "甲", by="claude")   # 只铺了 1
        fm.set_scalar(repo.index_of(self.root / repo.RAW / "book" / "甲"), "material_status", "readable")
        self.quiet(book_read.read, self.root, "甲", "1")
        page = fm.parse(repo.index_of(self.root / repo.RAW / "book" / "甲"))
        self.assertEqual(page.fields.get("progress"), "读完")

    def test_还有章节没勾时_progress_是在读(self):
        self.quiet(book_new.new_book, self.root, "甲", by="claude")
        fm.set_scalar(repo.index_of(self.root / repo.RAW / "book" / "甲"), "material_status", "readable")
        idx = repo.index_of(self.root / repo.RAW / "book" / "甲")
        idx.write_text(idx.read_text(encoding="utf-8") + "\n- [ ] 2\n", encoding="utf-8")
        self.quiet(book_read.read, self.root, "甲", "1")
        self.assertEqual(fm.parse(idx).fields.get("progress"), "在读")

    def test_status_排在_progress_之前(self):
        got = fm.render({"title": "甲", "status": "draft", "progress": "在读"})
        keys = [ln.split(":")[0] for ln in got.splitlines() if ":" in ln]
        self.assertLess(keys.index("status"), keys.index("progress"))

    def _knowledge(self, name, fm_body):
        d = self.root / "知识"
        d.mkdir(exist_ok=True)
        (d / "知识.md").write_text(
            "---\ntitle: 所知\ndescription: \ntags: []\nsource: []\n"
            "created: 2026-09-06\nupdated: 2026-09-06\n---\n\n所知的正文。\n", encoding="utf-8")
        p = d / f"{name}.md"
        p.write_text(f"---\n{fm_body}\n---\n\n{name} 的正文。\n", encoding="utf-8")
        fix_folders(self.root)            # 直接写的页：补齐 .folder.json
        return p

    def test_check_挡下非法的_status(self):
        self._knowledge("甲", "title: 甲\ndescription: \ntags: []\nsource: []\n"
                             "status: 已发布\ncreated: 2026-09-06\nupdated: 2026-09-06")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = check.run(self.root)
        self.assertEqual(rc, 1)
        self.assertIn("生命周期", buf.getvalue())      # 确保是被 status 挡下的
        self.assertIn("已发布", buf.getvalue())

    def test_check_放行没有_status_的页(self):
        self._knowledge("甲", "title: 甲\ndescription: \ntags: []\nsource: []\n"
                             "created: 2026-09-06\nupdated: 2026-09-06")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = check.run(self.root)
        self.assertEqual(rc, 0, buf.getvalue())

    def test_check_不查书籍_material_status(self):
        self.quiet(book_new.new_book, self.root, "甲", by="claude")
        p = repo.index_of(self.root / repo.RAW / "book" / "甲")
        fm.set_scalar(p, "material_status", "distilling")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = check.run(self.root)
        self.assertEqual(rc, 0, buf.getvalue())

    def test_mark_改状态(self):
        self.quiet(page_new.new_node, self.root, "知识/甲", "甲", by="claude")
        p = self.root / "知识" / "甲.md"
        self.quiet(page_mark.mark, self.root, str(p), "stable")
        self.assertEqual(fm.parse(p).status, "stable")

    def test_mark_拒绝非法值(self):
        self.quiet(page_new.new_node, self.root, "知识/甲", "甲", by="claude")
        p = self.root / "知识" / "甲.md"
        self.assertEqual(self.quiet(page_mark.mark, self.root, str(p), "published"), 1)
        self.assertEqual(fm.parse(p).status, "draft")

    def test_mark_不碰_verified(self):
        self.quiet(page_new.new_node, self.root, "知识/甲", "甲", by="claude")
        p = self.root / "知识" / "甲.md"
        fm.append_verified(p, "human:a", "2026-09-06")
        self.quiet(page_mark.mark, self.root, str(p), "deprecated")
        self.assertEqual(fm.parse(p).verified, [{"by": "human:a", "at": "2026-09-06"}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
