"""check 只读：run 不收 fix；各 _check_* 的「违规怎么改」不再指向已删的功能；断键报错不再提 --fix。

跑： python3 vault-tools/tests/test_check_readonly.py
"""

import inspect
import io
import re
import shutil
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

GONE = re.compile(r"--fix|fix-folders|new skeleton|new domain")


class TestReadonly(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_run_不收_fix(self):
        with self.assertRaises(TypeError):
            check.run(self.root, fix=True)

    def test_docstring_不指向已删的功能(self):
        for name, fn in inspect.getmembers(check, inspect.isfunction):
            if name.startswith("_check_"):
                self.assertIsNone(GONE.search(fn.__doc__ or ""), name)
        self.assertIsNone(GONE.search(check.__doc__ or ""))

    def test_文件夹配置的修法_讲清空对象_逗号与不列本页(self):
        doc = check._check_folder_conf.__doc__
        self.assertIn('"children": {}', doc, "叶子文件夹是空对象，补条目要写进花括号里")
        self.assertIn("逗号", doc, "JSON 手改最常见的错是逗号")
        self.assertIn("不列", doc, "文件夹自己的页与 . 开头的不列进 children")

    def test_断键报错不提_fix(self):
        (self.root / ".wiki" / "anchors.conf").write_text("[学习/没有这页]\n", encoding="utf-8")
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check.run(self.root)
        self.assertEqual(rc, 1)
        self.assertIn("学习/没有这页 指向不存在的节点", buf.getvalue())
        self.assertNotIn("--fix", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
