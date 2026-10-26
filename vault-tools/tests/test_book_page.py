"""书进度页 raw/book/X/X.md：书页识别只认书目录；书目录缺页报缺页；book new 写新名。

跑： python3 vault-tools/tests/test_book_page.py
"""

import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE))

from check import check  # noqa: E402
from book import new as book_new  # noqa: E402
from core import frontmatter as fm  # noqa: E402
import init  # noqa: E402
from core import links  # noqa: E402
from core import repo  # noqa: E402
from upgrade import upgrade  # noqa: E402
from _vault import fill_top, fix_folders  # noqa: E402

FM = "---\ntitle: {t}\ndescription: x\ntags: []\nsource: {src}\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n# {t}\n{body}"
BOOK = "---\ntitle: 甲\ndescription: x\ntags: []\nsource: []\nstatus: draft\nmaterial_status: readable\nprogress: 未读\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n# 甲\n"


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def q(self, fn, *a, **kw):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = fn(*a, **kw)
        return rc, buf.getvalue()


class TestBookPage(Base):
    def test_书目录的页是同名_md(self):
        d = self.root / "raw/book/甲"
        d.mkdir(parents=True)
        self.assertEqual(repo.index_of(d), d / "甲.md")
        p = self.w("raw/book/甲/甲.md", BOOK)
        self.assertTrue(repo.is_folder_page(p))
        self.assertEqual(repo.node_name(p), "甲")

    def test_书目录以外的同名_md_不是书页(self):
        p = self.w("raw/document/2026-10-01/2026-10-01.md", "# x\n")
        self.assertFalse(repo.is_folder_page(p))
        self.assertEqual(repo.node_name(p), "2026-10-01")
        c = self.w("raw/book/甲/章节/章节.md", "# x\n")
        self.assertFalse(repo.is_folder_page(c), "书目录的子目录不是书目录")

    def test_书的素材状态词表认新名(self):
        rel = "raw/book/甲/甲.md"
        self.assertIsNone(repo.material_status_problem(rel, repo.BOOK_MATERIAL_STATUSES[0]))
        self.assertTrue(repo.material_status_problem(rel, "pending_distillation"))
        self.assertIsNone(repo.material_status_problem("raw/book/甲/章节/x.md", ""), "章节不是书页")

    def test_book_new_写新名(self):
        rc, text = self.q(book_new.new_book, self.root, "乙", by="claude")
        self.assertEqual(rc, 0, text)
        self.assertTrue((self.root / "raw/book/乙/乙.md").is_file())
        self.assertFalse((self.root / "raw/book/乙/乙.index.md").exists())

    def test_check_书目录缺页不挡开库(self):
        self.w("raw/book/甲/甲.index.md", BOOK)
        rc, text = self.q(check.run, self.root)
        self.assertEqual(rc, 0, text)
        self.assertNotIn("文件夹缺页", text)

    def test_双链不再剥_index(self):
        self.w("知识/甲.md", FM.format(t="甲", src="[]", body=""))
        self.assertEqual(links.Index(self.root).resolve("甲.index")[0], "missing")


if __name__ == "__main__":
    unittest.main()
