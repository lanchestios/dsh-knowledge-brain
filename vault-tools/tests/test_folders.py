"""沉淀区文件夹配置（.folder.json）的补齐与校验：scan 排除规则、reconcile 补漏 / 删多 / 改类型 / 保留 order /
新条目接在最后 / 一致不写盘 / 解析失败与同名冲突不写盘、check_dir 的每条必填与报错文案、sync 补祖先与只认沉淀区。

跑： python3 vault-tools/tests/test_folders.py
"""

import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import conf  # noqa: E402
from core import folders  # noqa: E402

FM = "---\ntitle: {t}\ndescription: \ntags: []\nsource: []\ncreated: 2026-10-12\nupdated: 2026-10-12\n---\n\n{t} 的正文。\n"
F = lambda o: {"type": "folder", "ext": "folder", "order": o}
MD = lambda o: {"type": "file", "ext": "md", "order": o}


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, text=None):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM.format(t=p.stem) if text is None else text, encoding="utf-8")
        return p

    def j(self, rel, data):
        return self.w(rel + "/" + conf.FOLDER_CONF, json.dumps(data, ensure_ascii=False))

    def read(self, rel):
        return json.loads((self.root / rel / conf.FOLDER_CONF).read_text(encoding="utf-8"))

    def rec(self, rel):
        with redirect_stdout(io.StringIO()):
            return folders.reconcile(self.root, self.root / rel)

    def errs(self, rel):
        return folders.check_dir(self.root, self.root / rel)


class TestScan(Base):
    def test_split_name_按最后一个点(self):
        self.assertEqual(folders.split_name("a.b.md"), ("a.b", "md"))
        self.assertEqual(folders.split_name("Makefile"), ("Makefile", ""))
        self.assertEqual(folders.split_name("支付.md"), ("支付", "md"))

    def test_排除自身页_隐藏_folder_json_文件夹的_ext_是_folder(self):
        self.w("知识/K/K.md")
        self.w("知识/K/子.md")
        self.w("知识/K/.gitkeep", "")
        self.j("知识/K", {"index": "K", "children": {}})
        (self.root / "知识/K/.隐藏").mkdir()
        (self.root / "知识/K/子目录").mkdir()
        self.w("知识/K/脚本.py", "print(1)\n")
        got, clash = folders.scan(self.root / "知识/K")
        self.assertEqual(got, {"子": {"type": "file", "ext": "md"}, "子目录": {"type": "folder", "ext": "folder"},
                               "脚本": {"type": "file", "ext": "py"}})
        self.assertEqual(clash, [])

    def test_index_改指时排除改指的那篇_同名页照列(self):
        self.j("知识/K", {"index": "概览", "children": {}})
        self.w("知识/K/概览.md")
        self.w("知识/K/K.md")
        got, _ = folders.scan(self.root / "知识/K")
        self.assertEqual(set(got), {"K"})

    def test_index_指向不存在的页时按文件夹名(self):
        self.j("知识/K", {"index": "没有", "children": {}})
        self.w("知识/K/K.md")
        self.assertEqual(folders.scan(self.root / "知识/K")[0], {})

    def test_去掉扩展名同名是冲突(self):
        self.w("知识/K/K.md")
        self.w("知识/K/脚本.md")
        self.w("知识/K/脚本.py", "x\n")
        got, clash = folders.scan(self.root / "知识/K")
        self.assertEqual(clash, [("脚本", ["脚本.md", "脚本.py"])])
        self.assertNotIn("脚本", got)


class TestReconcile(Base):
    def test_缺文件就建_字段写全_按名字编号(self):
        self.w("知识/K/K.md")
        self.w("知识/K/乙.md")
        self.w("知识/K/甲.md")
        (self.root / "知识/K/丙").mkdir()
        self.assertEqual(self.rec("知识/K"), (True, []))
        self.assertEqual(self.read("知识/K"), {"index": "K", "children": {"丙": F(1), "乙": MD(2), "甲": MD(3)}})
        text = (self.root / "知识/K" / conf.FOLDER_CONF).read_text(encoding="utf-8")
        self.assertEqual(text.splitlines()[3], '    "丙": {"type": "folder", "ext": "folder", "order": 1},', "一个子节点一行")

    def test_补漏_删多_改类型_保留_order_去掉不认识的字段(self):
        self.w("知识/K/K.md")
        self.w("知识/K/a.md")
        (self.root / "知识/K/b").mkdir()
        self.j("知识/K", {"children": {"a": {"order": 5, "color": "red"}, "b": {"type": "file", "ext": "md", "order": 2},
                                       "幽灵": {"order": 3}}, "extra": 1})
        self.assertEqual(self.rec("知识/K"), (True, []))
        self.assertEqual(self.read("知识/K"), {"index": "K", "children": {"a": MD(5), "b": F(2)}})

    def test_新条目接在本层最大_order_之后(self):
        self.w("知识/K/K.md")
        for n in ("a", "b", "新2", "新1"):
            self.w(f"知识/K/{n}.md")
        self.j("知识/K", {"index": "K", "children": {"a": MD(10), "b": MD(3)}})
        self.rec("知识/K")
        self.assertEqual(self.read("知识/K")["children"], {"a": MD(10), "b": MD(3), "新1": MD(11), "新2": MD(12)})

    def test_order_重复或不合法的接在最后_重复时先写的留下(self):
        self.w("知识/K/K.md")
        for n in ("a", "b", "c", "d"):
            self.w(f"知识/K/{n}.md")
        self.j("知识/K", {"index": "K", "children": {"a": MD(2), "b": MD(2), "c": {**MD(1), "order": 1.5},
                                                     "d": {**MD(1), "order": True}}})
        self.rec("知识/K")
        self.assertEqual(self.read("知识/K")["children"], {"a": MD(2), "b": MD(3), "c": MD(4), "d": MD(5)})

    def test_index_改指的保留_指向不存在的回到文件夹名(self):
        self.w("知识/K/概览.md")
        self.j("知识/K", {"index": "概览", "children": {}})
        self.assertEqual(self.rec("知识/K"), (False, []))
        self.j("知识/K", {"index": "没有", "children": {}})
        self.w("知识/K/K.md")
        self.rec("知识/K")
        self.assertEqual(self.read("知识/K"), {"index": "K", "children": {"概览": MD(1)}})

    def test_一致时不写盘(self):
        self.w("知识/K/K.md")
        self.w("知识/K/a.md")
        self.rec("知识/K")
        f = self.root / "知识/K" / conf.FOLDER_CONF
        f.write_text(json.dumps(self.read("知识/K")), encoding="utf-8")       # 内容一致、写法不同
        before = f.read_text(encoding="utf-8")
        self.assertEqual(self.rec("知识/K"), (False, []))
        self.assertEqual(f.read_text(encoding="utf-8"), before)

    def test_解析失败与同名冲突不写盘_返回_problems(self):
        self.w("知识/K/K.md")
        f = self.w("知识/K/" + conf.FOLDER_CONF, '{"index": "K",}')
        changed, problems = self.rec("知识/K")
        self.assertFalse(changed)
        self.assertRegex(problems[0], r"^文件夹配置：知识/K/\.folder\.json 解析失败 —— JSON 语法错误")
        self.assertEqual(f.read_text(encoding="utf-8"), '{"index": "K",}')
        self.w("知识/J/J.md")
        self.w("知识/J/x.md")
        self.w("知识/J/x.py", "1\n")
        self.assertEqual(self.rec("知识/J"), (False, ["文件夹配置：知识/J/ 有同名的 —— x.md、x.py（去掉扩展名后都叫 x，改掉一个的名字）"]))
        self.assertFalse((self.root / "知识/J" / conf.FOLDER_CONF).exists())

    def test_引号_数字样_无扩展名的名字原样读回(self):
        self.w("知识/K/K.md")
        for n in ("2024.md", "true.md", "1.5.md", "a\"b'c.md", "Makefile"):
            self.w("知识/K/" + n, "x\n")
        self.rec("知识/K")
        kids = self.read("知识/K")["children"]
        self.assertEqual(set(kids), {"2024", "true", "1.5", "a\"b'c", "Makefile"})
        self.assertEqual(kids["Makefile"]["ext"], "")
        self.assertEqual(self.errs("知识/K"), [])


class TestCheckDir(Base):
    def setUp(self):
        super().setUp()
        self.w("知识/K/K.md")
        self.w("知识/K/a.md")
        (self.root / "知识/K/b").mkdir()

    def test_缺文件(self):
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/ 缺 .folder.json"])

    def test_写坏了(self):
        self.w("知识/K/" + conf.FOLDER_CONF, "{")
        self.assertRegex(self.errs("知识/K")[0], r"解析失败 —— JSON 语法错误（第 1 行")

    def test_字段全部必填_不认识的字段是错误(self):
        self.j("知识/K", {"children": {"a": {"type": "file", "order": 1}, "b": {**F(2), "color": "red"}}, "extra": 1})
        self.assertEqual(self.errs("知识/K"), [
            "文件夹配置：知识/K/.folder.json 缺字段 —— index",
            "文件夹配置：知识/K/.folder.json 有不认识的字段 —— extra",
            "文件夹配置：知识/K/.folder.json 的 a 缺字段 —— ext",
            "文件夹配置：知识/K/.folder.json 的 b 有不认识的字段 —— color",
        ])

    def test_漏了_多了_类型不对_扩展名不对(self):
        self.j("知识/K", {"index": "K", "children": {"a": {"type": "file", "ext": "txt", "order": 1},
                                                     "幽灵": MD(2)}})
        self.assertEqual(self.errs("知识/K"), [
            "文件夹配置：知识/K/.folder.json 的 a 扩展名不对 —— 写的 'txt'，实际 'md'",
            "文件夹配置：知识/K/.folder.json 列了不存在的 —— 幽灵",
            "文件夹配置：知识/K/.folder.json 漏了 —— b（folder / folder）",
        ])
        self.j("知识/K", {"index": "K", "children": {"a": MD(1), "b": {"type": "folder", "ext": "", "order": 2}}})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 b 扩展名不对 —— 写的 ''，实际 'folder'"])
        self.j("知识/K", {"index": "K", "children": {"a": F(1), "b": F(2)}})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 a 类型不对 —— 写的 folder，实际 file"])

    def test_order_必须是不重复的正整数(self):
        self.j("知识/K", {"index": "K", "children": {"a": MD(1), "b": F(1)}})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 order 1 重复 —— a、b"])
        for bad in (0, -1, 1.5, "1", True, None):
            self.j("知识/K", {"index": "K", "children": {"a": MD(1), "b": {**F(2), "order": bad}}})
            self.assertEqual(self.errs("知识/K"), [f"文件夹配置：知识/K/.folder.json 的 b 的 order 必须是正整数 —— 写的 {bad!r}"], bad)

    def test_index_必须指向存在的页(self):
        self.j("知识/K", {"index": "没有", "children": {"a": MD(1), "b": F(2)}})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 index 指向不存在的文件 —— 没有.md"])
        self.j("知识/K", {"index": "", "children": {"a": MD(1), "b": F(2)}})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 index 必须是页名（不带 .md 的字符串）"])

    def test_children_不是对象(self):
        self.j("知识/K", {"index": "K", "children": ["a"]})
        self.assertEqual(self.errs("知识/K"), ["文件夹配置：知识/K/.folder.json 的 children 必须是对象（子节点名: {type, ext, order}）"])

    def test_同名冲突(self):
        self.w("知识/K/a.py", "1\n")
        self.assertIn("文件夹配置：知识/K/ 有同名的 —— a.md、a.py（去掉扩展名后都叫 a，改掉一个的名字）", self.errs("知识/K"))

    def test_reconcile_之后_check_一定过(self):
        self.w("知识/K/b/b.md")
        self.j("知识/K", {"children": {"a": {"order": "x"}}, "extra": []})
        self.rec("知识/K")
        self.assertEqual(self.errs("知识/K"), [])


class TestSync(Base):
    def test_补给定路径所在文件夹及祖先直到区根(self):
        self.w("知识/知识.md")
        self.w("知识/A/A.md")
        self.w("知识/A/B/B.md")
        p = self.w("知识/A/B/新.md")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(folders.sync(self.root, [p]), [])
        for d in ("知识", "知识/A", "知识/A/B"):
            self.assertEqual(folders.check_dir(self.root, self.root / d), [], d)

    def test_区外与不存在的路径不管(self):
        self.w("raw/document/2026-10-12/x.md")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(folders.sync(self.root, [self.root / "raw/document/2026-10-12/x.md", self.root / "知识/没有"]), [])
        self.assertFalse((self.root / "raw/document/2026-10-12" / conf.FOLDER_CONF).exists())

    def test_fix_tree_补整个沉淀区(self):
        self.w("知识/知识.md")
        self.w("知识/A/A.md")
        self.w("系统/系统.md")
        with redirect_stdout(io.StringIO()):
            n, problems = folders.fix_tree(self.root)
        self.assertEqual((n, problems), (3, []))
        with redirect_stdout(io.StringIO()):
            self.assertEqual(folders.fix_tree(self.root), (0, []), "再跑一次无事可做")


if __name__ == "__main__":
    unittest.main()
