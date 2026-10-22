"""links：双链解析（与插件共用 link_cases.json）、散文抽取、改写、check / orphans 接线。

跑： python3 vault-tools/tests/test_links.py
"""

import io
import json
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
from page import new as page_new  # noqa: E402
from core import links  # noqa: E402
from page import query as page_query  # noqa: E402
from core import repo  # noqa: E402
from page import restructure  # noqa: E402
from _vault import fill_top  # noqa: E402

CASES = json.loads((HERE / "link_cases.json").read_text(encoding="utf-8"))
FM = "---\ntitle: {t}\ndescription: x\ntags: []\nsource: []\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n{t} 的正文。\n{body}"


def build(root: Path, pages):
    for spec in pages:
        rel, _, text = spec.partition("=")
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text if text else f"---\ntitle: {p.stem}\n---\n", encoding="utf-8")


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)


class TestResolve(Base):
    def test_共享用例(self):
        build(self.root, CASES["pages"])
        ix = links.Index(self.root)
        for target, state, value in CASES["cases"]:
            with self.subTest(target=target):
                got = ix.resolve(target)
                self.assertEqual(got[0], state)
                if state == "ok":
                    self.assertEqual(got[1], value)
                elif state == "ambiguous":
                    self.assertEqual(got[1], value)

    def test_unique(self):
        build(self.root, CASES["pages"])
        ix = links.Index(self.root)
        self.assertTrue(ix.unique("知识/ML"))
        self.assertFalse(ix.unique("系统/订单/项目树"))

    def test_node_path(self):
        build(self.root, CASES["pages"])
        self.assertEqual(links.node_path(self.root, self.root / "知识/ML/ML.md"), "知识/ML")
        self.assertEqual(links.node_path(self.root, self.root / "知识/K/概览.md"), "知识/K")
        self.assertEqual(links.node_path(self.root, self.root / "知识/ML/损失.md"), "知识/ML/损失")


class TestProse(Base):
    def test_links_in_跳过围栏与行内代码_拆锚与标签(self):
        body = "见 [[甲]]、[[乙#节|别名]]\n```\n[[围栏]]\n```\n~~~\n[[波浪]]\n~~~\n行内 `[[代码]]` 与 [[丙|丙丙]]\n"
        self.assertEqual(links.links_in(body), [("甲", "", ""), ("乙", "节", "别名"), ("丙", "", "丙丙")])

    def test_split_fm(self):
        self.assertEqual(links.split_fm("---\na: 1\n---\n正文 [[x]]\n"), ("---\na: 1\n---", "\n正文 [[x]]\n"))
        self.assertEqual(links.split_fm("没有头 [[x]]\n"), ("", "没有头 [[x]]\n"))

    def test_rewrite_links_只改沉淀区正文_不碰_frontmatter_与_raw(self):
        build(self.root, ["知识/甲.md", "raw/document/2026-10-01/a.md"])
        (self.root / "知识/乙.md").write_text("---\ntitle: '[[甲]]'\n---\n见 [[甲#节|别]] 与 `[[甲]]`\n", encoding="utf-8")
        (self.root / "raw/document/2026-10-01/a.md").write_text("[[甲]]\n", encoding="utf-8")

        def fn(page, target, anchor, label):
            if target != "甲":
                return None
            return f"[[知识/甲{('#' + anchor) if anchor else ''}{('|' + label) if label else ''}]]"
        changed = links.rewrite_links(self.root, fn)
        self.assertEqual([links.node_path(self.root, p) for p in changed], ["知识/乙"])
        self.assertEqual((self.root / "知识/乙.md").read_text(encoding="utf-8"),
                         "---\ntitle: '[[甲]]'\n---\n见 [[知识/甲#节|别]] 与 `[[甲]]`\n")
        self.assertEqual((self.root / "raw/document/2026-10-01/a.md").read_text(encoding="utf-8"), "[[甲]]\n")


class TestCheck(Base):
    def run_refs(self):
        out = repo.Out()
        buf = io.StringIO()
        with redirect_stdout(buf):
            check._check_refs(self.root, out)
        return buf.getvalue()

    def page(self, rel, body):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM.format(t=p.stem, body=body), encoding="utf-8")

    def test_三种报错与_raw_里的双链不管(self):
        build(self.root, CASES["pages"])
        self.page("知识/甲.md", "## 节\n")
        self.page("知识/引用者.md", "[[没有]] [[项目树]] [[素材甲]] [[系统/订单/项目树]] [[甲#节|别]]\n")
        (self.root / "raw/document/2026-10-01/素材甲.md").write_text("[[随便写的]]\n", encoding="utf-8")
        text = self.run_refs()
        self.assertIn("✗ 引用：双链指向的页面不存在 —— 知识/引用者.md → [[没有]]", text)
        self.assertIn("✗ 引用：双链同名歧义 —— 知识/引用者.md → [[项目树]]（候选：学习/项目树、系统/库存/项目树、系统/订单/项目树；写成路径形式）", text)
        self.assertIn("✗ 引用：双链只能指向沉淀区 —— 知识/引用者.md → [[素材甲]]（素材写进 source）", text)
        self.assertNotIn("系统/订单/项目树]]", text)
        self.assertNotIn("甲#节", text)
        self.assertNotIn("随便写的", text)

    def test_锚点对不上标题就报_同名标题按去重后缀算(self):
        build(self.root, CASES["pages"])
        self.page("知识/目标.md", "## 第一节：概览\n\n## 小结\n\n### 小结\n\n```\n## 围栏里的\n```\n")
        self.page("知识/引用者.md",
                  "[[目标#第一节：概览]] [[目标#小结]] [[目标#小结-1|再看]]\n"
                  "[[目标#没这节]] [[目标#小结-2]] [[目标#围栏里的]] [[没有#随便]]\n")
        text = self.run_refs()
        self.assertIn("✗ 引用：双链锚点在目标页找不到标题 —— 知识/引用者.md → [[目标#没这节]]", text)
        self.assertIn("✗ 引用：双链锚点在目标页找不到标题 —— 知识/引用者.md → [[目标#小结-2]]", text)
        self.assertIn("✗ 引用：双链锚点在目标页找不到标题 —— 知识/引用者.md → [[目标#围栏里的]]", text)
        for ok in ("第一节：概览]]", "#小结]]", "小结-1"):
            self.assertNotIn(ok, text)
        self.assertIn("[[没有]]", text, "目标页不存在照旧报页面不存在")
        self.assertNotIn("随便", text, "页都不存在就不再报锚点")

    @unittest.skipUnless(shutil.which("node"), "需要 node 跑插件同款 github-slugger")
    def test_slug_与插件_github_slugger_一致(self):
        cases = ["Hello World", "第一节：概览", "**加粗** 标题", "`code` 与 a_b", "C++ / Rust?",
                 "①②③ ½ ²", "emoji 🚀 here", "Ünïcödé — dash", "中文、标点。（括号）", "a  b",
                 "[链接](x.md)", "100% 完成！", "ℹ️ 提示", "Ⓐ 圈字母 🅰", "ⅷ roman", "α-β"]
        mod = HERE.parents[1] / "node_modules/github-slugger/index.js"
        if not mod.is_file():
            self.skipTest("没装 node_modules")
        js = f"import {{ slug }} from {json.dumps(mod.as_uri())};" \
             "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(x => slug(x))))"
        got = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(cases)],
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual([links.slug(c) for c in cases], json.loads(got))

    def test_raw_书页里的登记不报(self):
        build(self.root, CASES["pages"])
        (self.root / "raw/book/《书》/《书》.md").write_text(FM.format(t="《书》", body="- ch01\n    - [[没有这页]]\n"), encoding="utf-8")
        self.assertNotIn("没有这页", self.run_refs())


class TestOrphans(Base):
    def test_路径链也算有人链(self):
        fill_top(self.root)
        for rel in ("系统/订单/项目树/项目树.md", "系统/库存/项目树/项目树.md"):
            p = self.root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(FM.format(t="项目树", body=""), encoding="utf-8")
        (self.root / "系统/订单/订单.md").write_text(FM.format(t="订单", body="[[系统/订单/项目树]]\n"), encoding="utf-8")
        (self.root / "系统/订单/项目树/计划.md").write_text(FM.format(t="计划", body=""), encoding="utf-8")
        (self.root / "知识/引.md").write_text(FM.format(t="引", body="[[系统/订单/项目树/计划]]\n"), encoding="utf-8")
        buf = io.StringIO()
        with redirect_stdout(buf):
            page_query.orphans(self.root)
        self.assertNotIn("系统/订单/项目树/计划.md", buf.getvalue())


class TestRewriteAfter(Base):
    def setUp(self):
        super().setUp()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for k, v in {"user.name": "t", "user.email": "t@t"}.items():
            subprocess.run(["git", "-C", str(self.root), "config", k, v], check=True)
        fill_top(self.root)

    def w(self, rel, body=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM.format(t=p.stem, body=body), encoding="utf-8")

    def body(self, rel):
        return links.split_fm((self.root / rel).read_text(encoding="utf-8"))[1]

    def q(self, fn, *a, **kw):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = fn(*a, **kw)
        return rc, buf.getvalue()

    def test_page_new_造出重名_原裸链改路径_锚点标签保留(self):
        self.w("系统/订单/项目树/项目树.md")
        self.w("系统/订单/订单.md", "[[项目树]] 与 [[项目树#里程碑|计划]]\n")
        rc, text = self.q(page_new.new_node, self.root, "系统/库存/项目树", "项目树", by="claude")
        self.assertEqual(rc, 0, text)
        self.assertIn("[[系统/订单/项目树]] 与 [[系统/订单/项目树#里程碑|计划]]", self.body("系统/订单/订单.md"))
        self.assertIn("系统/订单/订单.md", text, "输出列出改了哪些文件")

    def test_page_new_不重名不改(self):
        self.w("知识/甲.md")
        self.w("知识/引.md", "[[甲]]\n")
        self.q(page_new.new_node, self.root, "知识/乙", "乙", by="claude")
        self.assertIn("[[甲]]", self.body("知识/引.md"))

    def test_move_路径链跟着改_裸名按新名改(self):
        self.w("知识/A.md")
        self.w("知识/引.md", "[[A]] [[知识/A#节|甲]] [[AB]]\n")
        self.q(restructure.move, self.root, "知识/A.md", "知识/B.md")
        self.assertIn("[[B]] [[知识/B#节|甲]] [[AB]]", self.body("知识/引.md"))

    def test_move_挪出重名_改路径(self):
        self.w("系统/订单/项目树.md")
        self.w("学习/项目树临时.md")
        self.w("知识/引.md", "[[项目树]] [[项目树临时]]\n")
        self.q(restructure.move, self.root, "学习/项目树临时.md", "学习/项目树.md")
        self.assertIn("[[系统/订单/项目树]] [[学习/项目树]]", self.body("知识/引.md"))

    def test_move_挪后仍唯一_裸名保持(self):
        self.w("知识/A.md")
        self.w("知识/引.md", "[[A]]\n")
        self.q(restructure.move, self.root, "知识/A.md", "学习/A.md")
        self.assertIn("[[A]]", self.body("知识/引.md"))

    def test_挪文件夹_子页路径链跟着改(self):
        self.w("知识/A/A.md")
        self.w("知识/A/子.md")
        self.w("知识/引.md", "[[知识/A/子]] [[知识/A]] [[子]]\n")
        self.q(restructure.move, self.root, "知识/A", "知识/B")
        self.assertIn("[[知识/B/子]] [[知识/B]] [[子]]", self.body("知识/引.md"))

    def test_shrink_改指页(self):
        (self.root / "知识/K").mkdir(parents=True)
        (self.root / "知识/K/.folder.json").write_text('{"index": "概览", "children": {}}', encoding="utf-8")
        self.w("知识/K/概览.md")
        self.w("知识/引.md", "[[概览]] [[K]] [[知识/K]]\n")
        self.q(restructure.shrink, self.root, self.root / "知识/K")
        self.assertIn("[[K]] [[K]] [[知识/K]]", self.body("知识/引.md"))

    def test_grow_不改链(self):
        self.w("知识/X.md")
        self.w("知识/引.md", "[[X]] [[知识/X]]\n")
        self.q(restructure.grow, self.root, self.root / "知识/X.md")
        self.assertIn("[[X]] [[知识/X]]", self.body("知识/引.md"))

    def test_挪文件夹改长名_不把刚改好的路径链再改一遍(self):
        self.w("知识/甲/甲.md")
        self.w("知识/甲/子.md")
        self.w("知识/引.md", "[[知识/甲/子]] [[知识/甲]]\n")
        self.q(restructure.move, self.root, "知识/甲", "知识/甲乙")
        self.assertIn("[[知识/甲乙/子]] [[知识/甲乙]]", self.body("知识/引.md"))

    def test_挪文件夹_不误伤名字是它前缀延长的兄弟(self):
        self.w("知识/软件/软件.md")
        self.w("知识/软件工程/软件工程.md")
        self.w("知识/软件工程/x.md")
        p = self.root / "知识/引.md"
        p.write_text(FM.replace("source: []", "source:\n  - 知识/软件工程/x.md").format(t="引", body="[[知识/软件工程/x]] 与 `知识/软件工程/` 与 知识/软件/\n"), encoding="utf-8")
        self.q(restructure.move, self.root, "知识/软件", "知识/Y")
        t = p.read_text(encoding="utf-8")
        self.assertIn("  - 知识/软件工程/x.md", t)
        self.assertIn("[[知识/软件工程/x]] 与 `知识/软件工程/` 与 知识/Y/", t)

    def test_raw_里的链不动(self):
        self.w("知识/A.md")
        (self.root / "raw/document/2026-10-01").mkdir(parents=True)
        (self.root / "raw/document/2026-10-01/a.md").write_text("[[A]]\n", encoding="utf-8")
        self.q(restructure.move, self.root, "知识/A.md", "知识/B.md")
        self.assertEqual((self.root / "raw/document/2026-10-01/a.md").read_text(encoding="utf-8"), "[[A]]\n")


if __name__ == "__main__":
    unittest.main()
