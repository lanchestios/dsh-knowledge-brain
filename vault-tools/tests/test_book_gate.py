"""书状态：新书写 init；非 readable 的书 read / deposit 一律拒。

跑： python3 vault-tools/tests/test_book_gate.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import new as book_new  # noqa: E402
from book import read as book_read  # noqa: E402
from book import deposit as book_deposit  # noqa: E402
from core import frontmatter as fm  # noqa: E402
from core import repo  # noqa: E402


class TestGate(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        self.q(book_new.new_book, self.root, "甲", by="claude")
        self.idx = repo.index_of(self.root / "raw/book/甲")

    def tearDown(self):
        shutil.rmtree(self.root)

    def q(self, fn, *a, **k):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = fn(*a, **k)
        return rc, buf.getvalue()

    def test_词表(self):
        self.assertEqual(repo.BOOK_MATERIAL_STATUSES,
                         ["unavailable", "init", "text", "figures", "proofread", "readable", "failed"])

    def test_新书是_init(self):
        self.assertEqual(fm.parse(self.idx).fields.get("material_status"), "init")
        self.assertFalse(repo.book_readable(self.idx))

    def test_book_dir_补书名号(self):
        name, d = repo.book_dir(self.root, "甲")
        self.assertEqual(name, "甲")
        self.assertEqual(d, self.root / "raw/book/甲")

    def test_非_readable_不能_read(self):
        for st in ("init", "text", "figures", "proofread", "failed"):
            fm.set_scalar(self.idx, "material_status", st)
            rc, text = self.q(book_read.read, self.root, "甲", "1")
            self.assertEqual(rc, 1, st)
            self.assertIn("还不可读", text)

    def test_book_dir_半边书名号与_NFD(self):
        import unicodedata
        for raw in ("甲", "《甲", "甲》", "《甲》", " 《甲》 "):
            self.assertEqual(repo.book_dir(self.root, raw)[0], "甲", raw)
        nfd = unicodedata.normalize("NFD", "é书")
        self.assertEqual(repo.book_dir(self.root, nfd)[0], "é书")

    def test_非_readable_不能_deposit(self):
        for st in ("init", "text", "figures", "proofread", "failed"):
            fm.set_scalar(self.idx, "material_status", st)
            for done in (False, True):
                rc, text = self.q(book_deposit.deposit, self.root, "甲", "1", done=done)
                self.assertEqual(rc, 1, (st, done))
                self.assertIn("还不可读", text)

    def test_进度页不是_UTF8_算不可读(self):
        self.idx.write_bytes("---\nmaterial_status: readable\n---\n中文".encode("gbk"))
        self.assertFalse(repo.book_readable(self.idx))

    def test_readable_可以_read(self):
        fm.set_scalar(self.idx, "material_status", '"readable"')     # TS 写带引号，也要认
        self.assertTrue(repo.book_readable(self.idx))
        rc, text = self.q(book_read.read, self.root, "甲", "1")
        self.assertEqual(rc, 0, text)


if __name__ == "__main__":
    unittest.main()
