"""收口：规则二的骨架只有一份定义，字段顺序只有一处生效。

跑： python3 vault-tools/tests/test_consolidation.py
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
import init  # noqa: E402
from core import frontmatter as fm  # noqa: E402
from core import repo  # noqa: E402


class TestFieldOrder(unittest.TestCase):
    """新增字段要落在规范位置，不能追加到末尾。

    加 description 时就栽在这里：set_scalar 把它插在 updated 后面，
    只能靠一次性脚本重排。修复得进代码库，不然下次加字段照样乱。
    """

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp()).resolve()
        self.p = self.dir / "x.md"

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write(self, body):
        self.p.write_text(f"---\n{body}\n---\n\n# 甲\n正文\n", encoding="utf-8")

    def keys(self):
        text = self.p.read_text(encoding="utf-8").split("\n")
        end = next(i for i in range(1, len(text)) if text[i].strip() == "---")
        return [l.split(":", 1)[0].strip() for l in text[1:end]
                if l.strip() and not l.lstrip().startswith("-")]

    def test_字段顺序只定义一处(self):
        self.assertEqual(fm.FIELD_ORDER[:4], ["title", "description", "tags", "source"])

    def test_新增字段插在规范位置而不是末尾(self):
        self.write("title: 甲\ntags: []\ncreated: 2026-09-06\nupdated: 2026-09-06")
        fm.set_scalar(self.p, "description", "摘要")
        self.assertEqual(self.keys(), ["title", "description", "tags", "created", "updated"])

    def test_新增_status_落在_source_之后(self):
        self.write("title: 甲\nsource: []\ncreated: 2026-09-06")
        fm.set_scalar(self.p, "status", "stable")
        self.assertEqual(self.keys(), ["title", "source", "status", "created"])

    def test_改已有字段不挪位置(self):
        self.write("title: 甲\ndescription: 旧\ntags: []\nupdated: 2026-09-06")
        fm.set_scalar(self.p, "description", "新")
        self.assertEqual(self.keys(), ["title", "description", "tags", "updated"])

    def test_不认识的字段仍然追加到末尾(self):
        self.write("title: 甲\nupdated: 2026-09-06")
        fm.set_scalar(self.p, "自定义", "x")
        self.assertEqual(self.keys()[-1], "自定义")

    def test_正文一字不动(self):
        self.write("title: 甲\nupdated: 2026-09-06")
        fm.set_scalar(self.p, "description", "摘要")
        self.assertTrue(self.p.read_text(encoding="utf-8").endswith("\n\n# 甲\n正文\n"))


class TestSkeletonSingleSource(unittest.TestCase):
    """规则二只有一份定义，建和校读同一处。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def quiet(self, fn, *a, **k):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*a, **k)
        return rc, buf.getvalue()

    def test_骨架规则可以按路径查(self):
        self.assertEqual(repo.skeleton_for("认知"), repo.THOUGHT_CATEGORIES)
        self.assertEqual(repo.skeleton_for("系统/某平台"), repo.DOMAIN_CATEGORIES)
        self.assertEqual(repo.skeleton_for("系统/某系统"), repo.SYSTEM_CATEGORIES)
        # 行业矩阵不钉骨架：先例长成只写在门面里，不进 check
        self.assertEqual(repo.skeleton_for("系统/教育行业矩阵"), [])
        self.assertEqual(repo.skeleton_for("raw/book/《甲》"), [])
        self.assertEqual(repo.skeleton_for("经历"), repo.EXPERIENCE_CATEGORIES)
        self.assertEqual(repo.skeleton_for("知识"), [])

    def test_new_skeleton_铺齐_thought_四类(self):
        self.quiet(init.new_skeleton, self.root, by="claude")
        for c in repo.THOUGHT_CATEGORIES:
            self.assertTrue(repo.index_of(self.root / repo.THOUGHT / c).is_file(), c)

    def test_new_skeleton_也铺顶层各区的_index(self):
        self.quiet(init.new_skeleton, self.root, by="claude")
        for d in (repo.EXPERIENCE, repo.THOUGHT, repo.KNOWLEDGE, repo.SYSTEM):
            self.assertTrue(repo.index_of(self.root / d).is_file(), d)

    def test_铺完之后_check_直接通过(self):
        self.quiet(init.new_skeleton, self.root, by="claude")
        for d in (repo.ASSET, repo.RAW):              # 顶层规则：容器目录 git 带不过去，建库时补
            (self.root / d).mkdir()
        rc, msg = self.quiet(check.run, self.root)
        self.assertEqual(rc, 0, msg)

    def test_可以重复跑_不覆盖已有内容(self):
        self.quiet(init.new_skeleton, self.root, by="claude")
        p = repo.index_of(self.root / repo.THOUGHT / repo.THOUGHT_CATEGORIES[0])
        p.write_text(p.read_text(encoding="utf-8") + "\n我写的内容\n", encoding="utf-8")
        self.quiet(init.new_skeleton, self.root, by="claude")
        self.assertIn("我写的内容", p.read_text(encoding="utf-8"))

class TestVocabularyNotHardcoded(unittest.TestCase):
    """词表值从 repo 取，不散在各处。"""

    def test_新建页的状态取自常量(self):
        self.assertEqual(repo.NEW_PAGE_STATUS, "draft")
        self.assertIn(repo.NEW_PAGE_STATUS, repo.STATUSES)

    def test_阅读进度的三个节点都有名字(self):
        for v in (repo.PROGRESS_UNREAD, repo.PROGRESS_READING, repo.PROGRESS_DONE):
            self.assertIn(v, repo.PROGRESSES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
