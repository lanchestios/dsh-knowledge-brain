"""文件夹页规则：沉淀区 X/X.md（.folder.json 可改指），raw 书页 《X》/《X》.md。

跑： python3 vault-tools/tests/test_folder_page.py
"""

import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from core import repo  # noqa: E402
from page import restructure  # noqa: E402

FM = "---\ntitle: {t}\ndescription: \ntags: []\nsource: []\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\n\n{t} 的正文。\n{body}"


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def page(self, rel, body=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM.format(t=p.stem, body=body), encoding="utf-8")
        return p

    def w(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def run_check(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check._check_structure(self.root, out := repo.Out())
        return out.errors, buf.getvalue()


class TestIndexOf(Base):
    def test_默认同名(self):
        d = self.root / "知识" / "ML"
        d.mkdir(parents=True)
        self.assertEqual(repo.index_of(d), d / "ML.md")

    def test_folder_json_改指(self):
        self.w("知识/ML/.folder.json", '{"index": "概览", "children": {}}')
        self.assertEqual(repo.index_of(self.root / "知识/ML"), self.root / "知识/ML/概览.md")

    def test_raw_书页是同名_md(self):
        d = self.root / "raw" / "book" / "《甲》"
        d.mkdir(parents=True)
        self.assertEqual(repo.index_of(d), d / "《甲》.md")

    def test_node_name_与_is_folder_page(self):
        p = self.page("知识/ML/ML.md")
        leaf = self.page("知识/ML/Loss.md")
        self.assertTrue(repo.is_folder_page(p))
        self.assertFalse(repo.is_folder_page(leaf))
        self.assertEqual(repo.node_name(p), "ML")
        self.w("知识/K/.folder.json", '{"index": "概览", "children": {}}')
        q = self.page("知识/K/概览.md")
        self.assertEqual(repo.node_name(q), "K")
        self.assertEqual(repo.node_name(self.root / "raw/book/《甲》/《甲》.md"), "《甲》")


class TestCheck(Base):
    def test_缺页报错_残留的_index_md_也按缺页报(self):
        (self.root / "知识" / "空").mkdir(parents=True)
        self.page("知识/空/子.md")
        self.page("知识/旧/旧.index.md")
        n, text = self.run_check()
        self.assertIn("文件夹缺页 —— 知识/空/", text)
        self.assertIn("文件夹缺页 —— 知识/旧/ 应有 旧.md", text)

    def test_改指的页可被双链且不当作平铺冲突(self):
        self.w("知识/K/.folder.json", '{"index": "概览", "children": {}}')
        self.page("知识/K/概览.md")
        self.page("知识/K/子.md", "见 [[K]] 与 [[概览]]\n")
        self.page("知识/知识.md")
        n, text = self.run_check()
        self.assertEqual(n, 0, text)
        out = repo.Out()
        with redirect_stdout(io.StringIO()):
            check._check_refs(self.root, out)
        self.assertEqual(out.errors, 0)

    def test_folder_json_index_指向不存在是错误(self):
        self.w("知识/K/.folder.json", '{"index": "没有", "children": {"子": {"type": "file", "ext": "md", "order": 1}, '
                                     '"幽灵": {"type": "file", "ext": "md", "order": 2}}}')
        self.page("知识/K/子.md")
        out = repo.Out()
        buf = io.StringIO()
        with redirect_stdout(buf):
            check._check_folder_conf(self.root, out)
        self.assertIn("index 指向不存在的文件", buf.getvalue())
        self.assertIn("列了不存在的 —— 幽灵", buf.getvalue(), "点名不存在的子节点现在是错误")
        self.assertGreaterEqual(out.errors, 2)


class TestRestructure(Base):
    def quiet(self, fn, *a):
        with redirect_stdout(io.StringIO()):
            return fn(*a)

    def test_grow_保持文件名(self):
        p = self.page("知识/X.md")
        self.assertEqual(self.quiet(restructure.grow, self.root, p), 0)
        self.assertTrue((self.root / "知识/X/X.md").is_file())

    def test_shrink_看磁盘_还有子项则拒绝_只剩自己的页与配置则收回(self):
        self.page("知识/X/X.md")
        self.page("知识/X/Y.md")
        self.w("知识/X/.folder.json", '{"index": "X", "children": {"Y": {"type": "file", "ext": "md", "order": 1}}}')
        self.assertEqual(self.quiet(restructure.shrink, self.root, self.root / "知识/X"), 1)
        (self.root / "知识/X/Y.md").unlink()
        self.assertEqual(self.quiet(restructure.shrink, self.root, self.root / "知识/X"), 0, "配置里还列着 Y 也照收：看的是磁盘")
        self.assertTrue((self.root / "知识/X.md").is_file())
        self.assertFalse((self.root / "知识/X").exists())

    def test_shrink_改指的页也收成_X_md(self):
        self.w("知识/X/.folder.json", '{"index": "概览", "children": {}}')
        self.page("知识/X/概览.md")
        self.assertEqual(self.quiet(restructure.shrink, self.root, self.root / "知识/X"), 0)
        self.assertTrue((self.root / "知识/X.md").is_file())

    def test_move_默认页跟随_改指页不动(self):
        self.page("知识/A/A.md")
        self.assertEqual(self.quiet(restructure.move, self.root, "知识/A", "知识/B"), 0)
        self.assertTrue((self.root / "知识/B/B.md").is_file())
        self.w("知识/C/.folder.json", '{"index": "概览", "children": {}}')
        self.page("知识/C/概览.md")
        self.assertEqual(self.quiet(restructure.move, self.root, "知识/C", "知识/D"), 0)
        self.assertTrue((self.root / "知识/D/概览.md").is_file())


if __name__ == "__main__":
    unittest.main()
