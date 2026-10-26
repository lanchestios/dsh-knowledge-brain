"""wiki check 遇到四区非 UTF-8 的 md：报「编码：」一条并返回 1，不出 traceback、不再跑后面的规则。

跑： python3 vault-tools/tests/test_check_encoding.py
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
from _vault import fill_top  # noqa: E402


class TestEncoding(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def check(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check.run(self.root)
        return rc, buf.getvalue()

    def test_四区_GBK_页报编码错(self):
        # 不调 fix_folders：它会读 md、先崩；编码错后 run() 直接返回，.folder.json 缺一项不影响
        p = self.root / "知识" / "坏页.md"
        p.write_bytes("---\ntitle: 坏页\n---\n\n# 坏页\n中文正文\n".encode("gbk"))
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertIn("编码：不是 UTF-8 —— 知识/坏页.md", text)
        self.assertNotIn("结构：", text, "编码错后不该再跑后面的规则")

    def test_编码错与版本错一起报(self):
        (self.root / ".wiki" / "wiki.json").unlink()
        (self.root / "知识" / "坏页.md").write_bytes("中文".encode("gbk"))
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertIn("版本：", text)
        self.assertIn("编码：不是 UTF-8 —— 知识/坏页.md", text)

    def test_raw_下_GBK_仍不报(self):
        p = self.root / "raw" / "document" / "2026-10-13" / "x.md"
        p.parent.mkdir(parents=True)
        p.write_bytes("中文".encode("gbk"))
        rc, text = self.check()
        self.assertEqual(rc, 0, text)
        self.assertNotIn("编码：", text)


if __name__ == "__main__":
    unittest.main()
