"""顶层规则：库根只允许七个固定目录 + 白名单文件；固定目录豁免空文件夹。

跑： python3 vault-tools/tests/test_top_rule.py
"""

import io
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from core import repo  # noqa: E402


class TestTop(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        for d in repo.FIXED_DIRS:
            (self.root / d).mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_rule(self, fn):
        out = repo.Out()
        buf = io.StringIO()
        with redirect_stdout(buf):
            fn(self.root, out)
        return out.errors, buf.getvalue()

    def test_七个固定目录(self):
        self.assertEqual(repo.FIXED_DIRS, ["经历", "认知", "学习", "知识", "系统", "asset", "raw"])

    def test_齐全且只有白名单_通过(self):
        (self.root / "README.md").write_text("x", encoding="utf-8")
        (self.root / "skills-lock.json").write_text("{}", encoding="utf-8")
        (self.root / ".claude").mkdir()
        (self.root / ".DS_Store").write_text("", encoding="utf-8")
        self.assertEqual(self.run_rule(check._check_top)[0], 0)
        self.assertEqual(repo.top_extras(self.root), [])

    def test_缺固定目录_报错(self):
        (self.root / "asset").rmdir()
        n, text = self.run_rule(check._check_top)
        self.assertEqual(n, 1)
        self.assertIn("asset/", text)

    def test_白名单外条目_报错(self):
        (self.root / "drafts").mkdir()
        (self.root / "todo.txt").write_text("x", encoding="utf-8")
        (self.root / "README.txt").write_text("x", encoding="utf-8")
        n, _ = self.run_rule(check._check_top)
        self.assertEqual(n, 3)
        self.assertEqual(repo.top_extras(self.root), ["README.txt", "drafts", "todo.txt"])

    def test_同名但类型不对也算多余(self):
        (self.root / "README.md").mkdir()           # 目录不是白名单文件
        shutil.rmtree(self.root / "raw")
        (self.root / "raw").write_text("x", encoding="utf-8")   # 文件不是固定目录
        self.assertEqual(repo.top_extras(self.root), ["README.md", "raw"])

    def test_固定目录豁免空文件夹(self):
        (self.root / "知识" / "空的").mkdir()
        n, text = self.run_rule(check._check_hygiene)
        self.assertEqual(n, 1)
        self.assertIn("知识/空的/", text)
        self.assertNotIn("asset/", text)


if __name__ == "__main__":
    unittest.main()
