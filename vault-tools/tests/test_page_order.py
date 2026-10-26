"""wiki page order：同父文件夹内挪先后，重编号 1..n；page move 带位置参数落到指定位置；移进自己报错。

跑： python3 vault-tools/tests/test_page_order.py
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

from core import conf  # noqa: E402
from page import new as page_new  # noqa: E402
from core import folders  # noqa: E402
from page import restructure  # noqa: E402
from _vault import fill_top  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for k, v in {"user.name": "t", "user.email": "t@t", "gc.auto": "0", "maintenance.auto": "false"}.items():   # 后台 gc 会和 tearDown 抢删 .git/objects
            subprocess.run(["git", "-C", str(self.root), "config", k, v], check=True)
        fill_top(self.root)
        for n in ("a", "b", "c"):
            self.q(page_new.new_node, self.root, f"知识/K/{n}", n, by="claude")
        (self.root / "知识/K/脚本.py").write_text("print(1)\n", encoding="utf-8")
        self.q(page_new.new_node, self.root, "知识/J/x", "x", by="claude")
        self.q(page_new.new_node, self.root, "知识/J/y", "y", by="claude")
        self.q(folders.sync, self.root, [self.root / "知识/K", self.root / "知识/J"])
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x"], check=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def q(self, fn, *a, **kw):
        with redirect_stdout(io.StringIO()):
            return fn(*a, **kw)

    def seq(self, rel):
        """父层 children 按 order 排好的键。"""
        kids = conf.folder_conf(self.root / rel)["children"]
        return [k for k, _ in sorted(kids.items(), key=lambda kv: kv[1]["order"])]

    def orders(self, rel):
        return sorted(v["order"] for v in conf.folder_conf(self.root / rel)["children"].values())

    def clean(self):
        errs = [e for d in folders.deposit_dirs(self.root) for e in folders.check_dir(self.root, d)]
        self.assertEqual(errs, [])


class TestOrder(Base):
    def test_前提_初始顺序(self):
        self.assertEqual(self.seq("知识/K"), ["a", "b", "c", "脚本"])

    def test_before_after_first_last(self):
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/c.md", "before", "知识/K/a.md"), 0)
        self.assertEqual(self.seq("知识/K"), ["c", "a", "b", "脚本"])
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/c.md", "after", "知识/K/b.md"), 0)
        self.assertEqual(self.seq("知识/K"), ["a", "b", "c", "脚本"])
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/b.md", "first"), 0)
        self.assertEqual(self.seq("知识/K"), ["b", "a", "c", "脚本"])
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/b.md", "last"), 0)
        self.assertEqual(self.seq("知识/K"), ["a", "c", "脚本", "b"])
        self.assertEqual(self.orders("知识/K"), [1, 2, 3, 4], "重编号 1..n")
        self.clean()

    def test_非md子项相对位置不变(self):
        self.q(restructure.order, self.root, "知识/K/a.md", "after", "知识/K/c.md")
        s = self.seq("知识/K")
        self.assertLess(s.index("c"), s.index("脚本"))
        self.assertEqual(s, ["b", "c", "a", "脚本"])

    def test_文件夹节点(self):
        self.assertEqual(self.q(restructure.order, self.root, "知识/J", "before", "知识/K"), 0)
        s = self.seq("知识")
        self.assertLess(s.index("J"), s.index("K"))
        self.clean()

    def test_顺序没变不写盘(self):
        f = self.root / "知识/K" / conf.FOLDER_CONF
        before = f.read_bytes()
        mtime = f.stat().st_mtime_ns
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/a.md", "before", "知识/K/b.md"), 0)
        self.assertEqual(f.read_bytes(), before)
        self.assertEqual(f.stat().st_mtime_ns, mtime)

    def test_跨父文件夹_区根_不存在_一律报错不动(self):
        f = self.root / "知识/K" / conf.FOLDER_CONF
        before = f.read_bytes()
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/a.md", "before", "知识/J/x.md"), 1)
        self.assertEqual(self.q(restructure.order, self.root, "知识", "first"), 1)
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/无.md", "first"), 1)
        self.assertEqual(self.q(restructure.order, self.root, "知识/K/a.md", "before", "知识/K/a.md"), 1)
        self.assertEqual(f.read_bytes(), before)


class TestMovePlace(Base):
    def test_带before落到指定位置(self):
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.md", "知识/J", "before", "知识/J/y.md"), 0)
        self.assertEqual(self.seq("知识/J"), ["x", "a", "y"])
        self.assertNotIn("a", self.seq("知识/K"))
        self.clean()

    def test_带first与不带位置(self):
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.md", "知识/J", "first"), 0)
        self.assertEqual(self.seq("知识/J")[0], "a")
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/b.md", "知识/J"), 0)
        self.assertEqual(self.seq("知识/J")[-1], "b", "不写位置：排最后（原行为）")
        self.clean()

    def test_兄弟不在目标文件夹_报错不动(self):
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.md", "知识/J", "before", "知识/K/b.md"), 1)
        self.assertTrue((self.root / "知识/K/a.md").is_file())

    def test_已移动但没排到指定位置_退出码非0(self):
        (self.root / "知识/J" / conf.FOLDER_CONF).write_text("{坏", encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out):
            rc = restructure.move(self.root, "知识/K/a.md", "知识/J", "first")
        self.assertEqual(rc, 1, "排序没成：不能报成功，界面要提示")
        self.assertTrue((self.root / "知识/J/a.md").is_file(), "文件照样移好")
        self.assertIn("已移动", out.getvalue())

    def test_文件夹移进自己或子孙_报错不动(self):
        self.q(page_new.new_node, self.root, "知识/K/子/z", "z", by="claude")
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "y"], check=True)
        self.assertEqual(self.q(restructure.move, self.root, "知识/K", "知识/K"), 1)
        self.assertEqual(self.q(restructure.move, self.root, "知识/K", "知识/K/子"), 1)
        self.assertTrue((self.root / "知识/K/子/z.md").is_file())
        self.assertFalse((self.root / "知识/K/子/K").exists())


if __name__ == "__main__":
    unittest.main()
