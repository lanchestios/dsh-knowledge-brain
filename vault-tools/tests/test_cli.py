"""wiki 入口按作用域分派：每条命令走到原函数；缺参报本命令用法；未知 / 旧名一律「未知」退出码 2；check 不收参数。

跑： python3 vault-tools/tests/test_cli.py
"""

import importlib.machinery
import importlib.util
import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))

from page import anchor  # noqa: E402
from check import check  # noqa: E402
from document import fetch  # noqa: E402
from document import fidelity  # noqa: E402
from page import restructure  # noqa: E402
from book import split as split_book  # noqa: E402
from upgrade import upgrade  # noqa: E402
from book import deposit as book_deposit  # noqa: E402
from book import list as book_list  # noqa: E402
from book import images as book_images  # noqa: E402
from book import new as book_new  # noqa: E402
from book import read as book_read  # noqa: E402
from book import status as book_status  # noqa: E402
from document import add as document_add  # noqa: E402
from document import cover as document_cover  # noqa: E402
from document import list as document_list  # noqa: E402
from page import mark as page_mark  # noqa: E402
from page import new as page_new  # noqa: E402
from page import query as page_query  # noqa: E402
from page import verify as page_verify  # noqa: E402
import stamp  # noqa: E402
import tree  # noqa: E402

_loader = importlib.machinery.SourceFileLoader("wiki_cli", str(HERE.parent / "bin" / "wiki"))
_spec = importlib.util.spec_from_loader("wiki_cli", _loader)
cli = importlib.util.module_from_spec(_spec)
_loader.exec_module(cli)

# (argv, 模块, 函数名, 期望的位置参数（ROOT 换成库根）, 期望的关键字参数)
ROOT = object()
ROUTES = [
    (["upgrade"], upgrade, "run", (ROOT,), {}),
    (["check"], check, "run", (ROOT,), {}),
    (["tree", "--write"], tree, "tree", (ROOT,), {"write": True}),
    (["stamp", "--all", "--by", "ai:x"], stamp, "stamp", (ROOT,), {"all_files": True, "by": "ai:x"}),
    (["page", "new", "知识/甲", "甲", "--by", "ai:x"], page_new, "new_node", (ROOT, "知识/甲", "甲"), {"by": "ai:x"}),
    (["page", "move", "知识/甲.md", "知识/乙.md"], restructure, "move", (ROOT, "知识/甲.md", "知识/乙.md"), {"where": None, "ref": None}),
    (["page", "move", "知识/甲.md", "知识/丙/", "--before", "知识/丙/丁.md"], restructure, "move",
     (ROOT, "知识/甲.md", "知识/丙/"), {"where": "before", "ref": "知识/丙/丁.md"}),
    (["page", "move", "知识/甲.md", "知识/丙/", "--first"], restructure, "move", (ROOT, "知识/甲.md", "知识/丙/"), {"where": "first", "ref": None}),
    (["page", "order", "知识/甲.md", "--after", "知识/乙.md"], restructure, "order", (ROOT, "知识/甲.md", "after", "知识/乙.md"), {}),
    (["page", "order", "知识/甲.md", "--last"], restructure, "order", (ROOT, "知识/甲.md", "last", None), {}),
    (["page", "mark", "知识/甲.md", "draft"], page_mark, "mark", (ROOT, "知识/甲.md", "draft"), {}),
    (["page", "verify", "知识/甲.md", "--by", "human:x"], page_verify, "verify", (ROOT, "知识/甲.md", "human:x"), {}),
    (["page", "anchor", "学习/a.md", "学习/b.md"], anchor, "run", (ROOT, ["学习/a.md", "学习/b.md"]), {}),
    (["page", "tags"], page_query, "tags", (ROOT, None), {}),
    (["page", "tags", "数据"], page_query, "tags", (ROOT, "数据"), {}),
    (["page", "orphans"], page_query, "orphans", (ROOT,), {}),
    (["page", "unverified"], page_query, "unverified", (ROOT,), {}),
    (["document", "add", "a.pdf", "b.md"], document_add, "add_raw", (ROOT, ["a.pdf", "b.md"]), {}),
    (["document", "fetch", "https://x.y/z", "--type", "lark", "--node"], fetch, "run", (ROOT, "https://x.y/z", "lark", "node"), {}),
    (["document", "fetch", "https://x.y/z"], fetch, "run", (ROOT, "https://x.y/z", None, "space"), {}),
    (["document", "list", "2026-10-12", "--pending"], document_list, "raw", (ROOT, "2026-10-12"), {"pending": True}),
    (["document", "list"], document_list, "raw", (ROOT, None), {"pending": False}),
    (["document", "cover", "raw/document/d/a.md", "done", "--detail", "x"], document_cover, "cover",
     (ROOT, "raw/document/d/a.md", "done"), {"detail": "x"}),
    (["document", "cover", "raw/document/d/a.md"], document_cover, "cover", (ROOT, "raw/document/d/a.md", None), {"detail": None}),
    (["document", "fidelity", "raw/document/d/a.md", "知识/甲.md"], fidelity, "run", (ROOT, "raw/document/d/a.md", "知识/甲.md"), {}),
    (["book", "new", "《甲》", "--by", "ai:x"], book_new, "new_book", (ROOT, "《甲》"), {"by": "ai:x"}),
    (["book", "split", "a.epub", "out"], split_book, "run", ("a.epub", "out"), {}),
    (["book", "read", "甲", "1"], book_read, "read", (ROOT, "甲", "1"), {}),
    (["book", "deposit", "甲", "1", "--done"], book_deposit, "deposit", (ROOT, "甲", "1"), {"done": True}),
    (["book", "deposit", "甲", "1"], book_deposit, "deposit", (ROOT, "甲", "1"), {"done": False}),
    (["book", "list"], book_list, "books", (ROOT,), {}),
    (["book", "images", "甲"], book_images, "move", (ROOT, "甲"), {}),
    (["book", "status", "《甲》"], book_status, "status", (ROOT, "《甲》", None), {"error": None}),
    (["book", "status", "《甲》", "text"], book_status, "status", (ROOT, "《甲》", "text"), {"error": None}),
    (["book", "status", "《甲》", "init", "--error", "扫描版"], book_status, "status", (ROOT, "《甲》", "init"),
     {"error": "扫描版"}),
]

# 必须带参数的命令：不带就打这条命令自己的用法、退出码 2
NEEDS_ARGS = [
    ["page", "new"], ["page", "grow"], ["page", "shrink"], ["page", "move", "a"], ["page", "mark", "a"],
    ["page", "verify"], ["page", "anchor"],
    ["page", "order"], ["page", "order", "知识/甲.md"], ["page", "order", "知识/甲.md", "--before"],
    ["document", "add"], ["document", "fetch"], ["document", "fetch", "https://x.y/z", "--type"],
    ["document", "cover"], ["document", "fidelity", "a"],
    ["book", "new"], ["book", "images"], ["book", "split", "a"], ["book", "read", "《甲》"], ["book", "deposit", "《甲》"],
    ["book", "status", "《甲》", "--error", "x"], ["book", "status", "《甲》", "init", "--error"],
]

# 旧名：一律不认识
OLD = [["add", "a.pdf"], ["fetch", "u"], ["new", "node", "知识/甲"], ["new", "domain", "域"], ["new", "skeleton"],
       ["list", "tags"], ["grow", "a"], ["shrink", "a"], ["move", "a", "b"], ["read", "甲", "1"],
       ["deposit", "甲", "1"], ["split-book", "a", "b"], ["anchor", "a"], ["verify", "a"], ["mark", "a", "draft"],
       ["cover", "a"], ["fidelity", "a", "b"], ["fix-folders", "--all"]]

class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        self.cwd = os.getcwd()
        os.chdir(self.root)

    def tearDown(self):
        os.chdir(self.cwd)
        shutil.rmtree(self.root)

    def wiki(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(list(argv))
        return rc, buf.getvalue()


class TestRoutes(Base):
    def test_每条命令走到原函数(self):
        for argv, mod, fn, args, kwargs in ROUTES:
            with self.subTest(argv=argv), mock.patch.object(mod, fn, return_value=0) as m:
                rc, _ = self.wiki(*argv)
                self.assertEqual(rc, 0)
                want = tuple(self.root if a is ROOT else a for a in args)
                m.assert_called_once_with(*want, **kwargs)

    def test_grow_shrink_传绝对路径(self):
        for sub, fn in (("grow", "grow"), ("shrink", "shrink")):
            with self.subTest(sub=sub), mock.patch.object(restructure, fn, return_value=0) as m:
                self.assertEqual(self.wiki("page", sub, "知识/甲.md")[0], 0)
                m.assert_called_once_with(self.root, (self.root / "知识/甲.md").resolve())

    def test_返回值原样透传(self):
        with mock.patch.object(page_query, "orphans", return_value=1):
            self.assertEqual(self.wiki("page", "orphans")[0], 1)


class TestErrors(Base):
    def test_缺参_打本命令用法_退出码2(self):
        for argv in NEEDS_ARGS:
            with self.subTest(argv=argv):
                rc, text = self.wiki(*argv)
                self.assertEqual(rc, 2)
                self.assertIn(f"用法： wiki {argv[0]} {argv[1]}", text)

    def test_作用域内未知命令(self):
        for scope in ("page", "document", "book"):
            with self.subTest(scope=scope):
                rc, text = self.wiki(scope, "bogus")
                self.assertEqual(rc, 2)
                self.assertIn(f"未知命令：{scope} bogus", text)

    def test_旧名一律未知(self):
        for argv in OLD:
            with self.subTest(argv=argv):
                rc, text = self.wiki(*argv)
                self.assertEqual(rc, 2)
                self.assertIn(f"未知动作：{argv[0]}", text)

    def test_旧名在库外也报未知(self):
        outside = Path(tempfile.mkdtemp()).resolve()
        try:
            os.chdir(outside)
            rc, text = self.wiki("add", "a.pdf")
            self.assertEqual(rc, 2)
            self.assertIn("未知动作：add", text)
        finally:
            os.chdir(self.root)
            shutil.rmtree(outside)

    def test_check_不收参数_不跑校验(self):
        for extra in (["--fix"], ["知识"]):
            with self.subTest(extra=extra), mock.patch.object(check, "run", return_value=0) as m:
                rc, text = self.wiki("check", *extra)
                self.assertEqual(rc, 2)
                self.assertIn("用法： wiki check", text)
                m.assert_not_called()

    def test_作用域不带命令(self):
        outside = Path(tempfile.mkdtemp()).resolve()
        try:
            os.chdir(outside)                                   # 不在库里也不报「找不到仓库根」
            for scope in ("page", "document", "book"):
                with self.subTest(scope=scope):
                    rc, text = self.wiki(scope)
                    self.assertEqual(rc, 2)
                    self.assertIn("用法： wiki <命令>", text)
                    self.assertEqual(self.wiki(scope, "--help")[0], 0)
        finally:
            os.chdir(self.root)
            shutil.rmtree(outside)


class TestHelp(Base):
    def test_help_列出全部新命令(self):
        rc, text = self.wiki("--help")
        self.assertEqual(rc, 0)
        for cmd in ("init", "upgrade", "check", "tree", "stamp",
                    "page new", "page grow", "page shrink", "page move", "page order", "page mark", "page verify", "page anchor",
                    "page tags", "page orphans", "page unverified",
                    "document add", "document fetch", "document list", "document cover", "document fidelity",
                    "book new", "book split", "book read", "book deposit", "book list"):
            self.assertIn(f"wiki {cmd}", text, cmd)
        for gone in ("fix-folders", "new domain", "new skeleton", "--fix", "split-book"):
            self.assertNotIn(gone, text)


if __name__ == "__main__":
    unittest.main()
