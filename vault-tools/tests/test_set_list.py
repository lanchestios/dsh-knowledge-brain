"""frontmatter.set_list：列表字段整体改写，块列表的续行一并替换，其余一字不动。

跑： python3 vault-tools/tests/test_set_list.py
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import frontmatter as fm  # noqa: E402


class TestSetList(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        self.p = self.d / "a.md"

    def tearDown(self):
        shutil.rmtree(self.d)

    def w(self, fmtext):
        self.p.write_text(f"---\n{fmtext}\n---\n\n# A\n正文\n", encoding="utf-8")

    def test_块列表删成空(self):
        self.w("title: A\nsource:\n  - raw/x.md\n  - raw/y.md\nstatus: stable")
        self.assertTrue(fm.set_list(self.p, "source", []))
        self.assertEqual(self.p.read_text(encoding="utf-8"),
                         "---\ntitle: A\nsource: []\nstatus: stable\n---\n\n# A\n正文\n")

    def test_块列表留一条(self):
        self.w("title: A\nsource:\n  - raw/x.md\n  - raw/y.md\nstatus: stable")
        fm.set_list(self.p, "source", ["raw/y.md"])
        self.assertIn("source:\n  - raw/y.md\nstatus: stable", self.p.read_text(encoding="utf-8"))
        self.assertEqual(fm.parse(self.p).sources, ["raw/y.md"])

    def test_行内列表改写(self):
        self.w("title: A\nsource: [raw/x.md, raw/y.md]\nstatus: stable")
        fm.set_list(self.p, "source", ["raw/x.md"])
        self.assertEqual(fm.parse(self.p).sources, ["raw/x.md"])
        self.assertIn("status: stable", self.p.read_text(encoding="utf-8"))

    def test_没变就不写(self):
        self.w("title: A\nsource: []\nstatus: stable")
        self.assertFalse(fm.set_list(self.p, "source", []))

    def test_字段不存在按规范顺序插入(self):
        self.w("title: A\nstatus: stable")
        fm.set_list(self.p, "source", [])
        self.assertIn("title: A\nsource: []\nstatus: stable", self.p.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
