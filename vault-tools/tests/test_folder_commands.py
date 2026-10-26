"""会改沉淀区目录内容的 wiki 命令跑完，.folder.json 跟着补齐：new node / skeleton、init、move（同层改名保留 order）、
grow、shrink；check 只报不补。

跑： python3 vault-tools/tests/test_folder_commands.py
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
from core import conf  # noqa: E402
from page import new as page_new  # noqa: E402
from core import folders  # noqa: E402
import init  # noqa: E402
from page import restructure  # noqa: E402
from _vault import fill_top  # noqa: E402



class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for k, v in {"user.name": "t", "user.email": "t@t"}.items():
            subprocess.run(["git", "-C", str(self.root), "config", k, v], check=True)
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def q(self, fn, *a, **kw):
        with redirect_stdout(io.StringIO()):
            return fn(*a, **kw)

    def clean(self):
        """沉淀区每个文件夹的 .folder.json 都与磁盘一致。"""
        errs = [e for d in folders.deposit_dirs(self.root) for e in folders.check_dir(self.root, d)]
        self.assertEqual(errs, [])

    def kids(self, rel):
        return conf.folder_conf(self.root / rel)["children"]

    def put(self, rel, children):
        conf.write_folder(self.root / rel / conf.FOLDER_CONF, {"index": Path(rel).name, "children": children})


class TestCommands(Base):
    def test_fill_top_骨架本身就一致(self):
        self.clean()

    def test_new_node_嵌套新建_各层都补上(self):
        self.assertEqual(self.q(page_new.new_node, self.root, "知识/A/B/C", "C", by="claude"), 0)
        self.clean()
        self.assertEqual(self.kids("知识/A/B")["C"], {"type": "file", "ext": "md", "order": 1})

    def test_move_同层改名保留_order_RF5(self):
        self.q(page_new.new_node, self.root, "知识/K/a", "a", by="claude")
        self.q(page_new.new_node, self.root, "知识/K/b", "b", by="claude")
        self.put("知识/K", {"a": {"type": "file", "ext": "md", "order": 2}, "b": {"type": "file", "ext": "md", "order": 1}})
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x"], check=True)
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.md", "知识/K/甲.md"), 0)
        self.clean()
        self.assertEqual(self.kids("知识/K")["甲"]["order"], 2, "改名后 order 还在")

    def test_move_文件夹改名_默认页跟随_index_改成新名(self):
        self.q(page_new.new_node, self.root, "知识/K", "K", by="claude")
        self.q(restructure.grow, self.root, self.root / "知识/K.md")       # 知识/K/K.md
        self.q(page_new.new_node, self.root, "知识/K/a", "a", by="claude")
        self.assertEqual(conf.folder_conf(self.root / "知识/K")["index"], "K", "前提：index 写的是默认名")
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x"], check=True)
        order = self.kids("知识")["K"]["order"]
        self.assertEqual(self.q(restructure.move, self.root, "知识/K", "知识/新K"), 0)
        self.assertTrue((self.root / "知识/新K/新K.md").is_file())
        self.assertEqual(conf.folder_conf(self.root / "知识/新K")["index"], "新K")
        self.assertEqual(self.kids("知识")["新K"]["order"], order, "父层 order 不变")
        self.clean()

    def test_move_换父层(self):
        self.q(page_new.new_node, self.root, "知识/K/a", "a", by="claude")
        self.q(page_new.new_node, self.root, "知识/J/J", "J", by="claude")
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.md", "知识/J"), 0)
        self.clean()
        self.assertEqual(self.kids("知识/J")["a"]["order"], max(v["order"] for v in self.kids("知识/J").values()),
                         "换父层：接在新父层最后")
        self.assertNotIn("a", self.kids("知识/K"))

    def test_grow_与_shrink(self):
        self.q(page_new.new_node, self.root, "知识/X", "X", by="claude")
        before = self.kids("知识")["X"]
        self.assertEqual(before["type"], "file")
        self.assertEqual(self.q(restructure.grow, self.root, self.root / "知识/X.md"), 0)
        self.clean()
        self.assertEqual(self.kids("知识")["X"], {"type": "folder", "ext": "folder", "order": before["order"]},
                         "长成文件夹：类型改了，先后不变")
        self.assertEqual(conf.folder_conf(self.root / "知识/X"), {"index": "X", "children": {}})
        self.assertEqual(self.q(restructure.shrink, self.root, self.root / "知识/X"), 0)
        self.clean()
        self.assertFalse((self.root / "知识/X").exists(), ".folder.json 随文件夹一起删")

    def test_shrink_有隐藏文件就拒绝_一个都不删(self):
        self.q(page_new.new_node, self.root, "知识/X", "X", by="claude")
        self.q(restructure.grow, self.root, self.root / "知识/X.md")      # 知识/X/X.md
        draft = self.root / "知识/X/.draft.md"
        draft.write_text("草稿\n", encoding="utf-8")
        (self.root / "知识/X/.att").mkdir()
        (self.root / "知识/X/.att/img.png").write_bytes(b"x")
        self.assertEqual(self.q(restructure.shrink, self.root, self.root / "知识/X"), 1)
        self.assertTrue(draft.is_file(), "隐藏文件不许删")
        self.assertTrue((self.root / "知识/X/X.md").is_file(), "拒绝时页不许挪走")

    def test_move_同层改名_非md与像布尔的名字也保留_order(self):
        (self.root / "知识/K").mkdir()
        (self.root / "知识/K/K.md").write_text("K 的正文。\n", encoding="utf-8")
        (self.root / "知识/K/a.txt").write_text("a\n", encoding="utf-8")
        (self.root / "知识/K/n.md").write_text("n 的正文。\n", encoding="utf-8")
        self.put("知识/K", {"a": {"type": "file", "ext": "txt", "order": 1}, "n": {"type": "file", "ext": "md", "order": 2}})
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x"], check=True)
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/a.txt", "知识/K/b.txt"), 0)
        self.assertEqual(self.q(restructure.move, self.root, "知识/K/n.md", "知识/K/true.md"), 0)
        self.clean()
        kids = self.kids("知识/K")
        self.assertEqual(kids["b"]["order"], 1, "a.txt → b.txt 保留 order")
        self.assertEqual(kids["true"]["order"], 2, "n.md → true.md 保留 order")

    def test_直接写的页_check_报出_补齐后即过(self):
        (self.root / "知识/野").mkdir()
        (self.root / "知识/野/野.md").write_text("---\ntitle: 野\ndescription: \ntags: []\nsource: []\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n野的正文。\n", encoding="utf-8")
        self.assertEqual(self.q(check.run, self.root), 1, "直接写的页：缺 .folder.json")
        self.assertFalse((self.root / "知识/野" / conf.FOLDER_CONF).exists(), "check 只读：不补")
        self.q(folders.fix_tree, self.root)
        self.assertEqual(self.q(check.run, self.root), 0)

class TestInit(unittest.TestCase):
    def test_init_建库后一致(self):
        root = Path(tempfile.mkdtemp()).resolve()
        try:
            r = self_q(init.build, root, "minimal")
            self.assertTrue(r["check_ok"], r["check_output"])
        finally:
            shutil.rmtree(root)


def self_q(fn, *a):
    with redirect_stdout(io.StringIO()):
        return fn(*a)


if __name__ == "__main__":
    unittest.main()
