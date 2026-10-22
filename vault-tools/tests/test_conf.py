"""conf.py：两份 JSON 配置的读写、路径类配置随 move 维护；restructure 的路径边界。

跑： python3 -m unittest vault-tools/tests/test_conf.py -v
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

import json  # noqa: E402

from core import conf  # noqa: E402
from core import repo  # noqa: E402
from page import restructure  # noqa: E402


class Quiet(repo.Out):
    def __init__(self):
        super().__init__()
        self.lines = []

    def ok(self, m): self.lines.append(m)
    def info(self, m): self.lines.append(m)
    def warn(self, m): self.lines.append(m)
    def err(self, m):
        self.errors += 1
        self.lines.append(m)


class TestReplacePath(unittest.TestCase):
    r = staticmethod(restructure._replace_path)

    def test_一级目录名只在后跟斜杠时算路径(self):
        self.assertEqual(self.r("见 `work/域/x.md`", "work", "工作"), "见 `工作/域/x.md`")
        for s in ["a framework b", "network/x", "workflow", "at work.", "rework/x"]:
            self.assertEqual(self.r(s, "work", "工作"), s)

    def test_前面紧挨汉字仍命中(self):
        self.assertEqual(self.r("放进knowledge/机器学习", "knowledge", "知识"), "放进知识/机器学习")

    def test_外部仓库路径不命中(self):
        s = "github.com/karpathy/nanochat/blob/master/knowledge/muonh.md"
        self.assertEqual(self.r(s, "knowledge", "知识"), s)

    def test_多段路径的尾部边界(self):
        self.assertEqual(self.r("a/X.md 与 a/X.mdx", "a/X.md", "b/X.md"), "b/X.md 与 a/X.mdx")
        self.assertEqual(self.r("a/X/y 与 a/Xy", "a/X", "b/X"), "b/X/y 与 a/Xy")


class TempRepo(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for k, v in {"user.name": "t", "user.email": "t@t"}.items():
            subprocess.run(["git", "-C", str(self.root), "config", k, v], check=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, text=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def j(self, rel, data):
        return self.w(rel, json.dumps(data, ensure_ascii=False))

    def read(self, rel):
        return json.loads((self.root / rel).read_text(encoding="utf-8"))

    def commit(self):
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x"], check=True)


class TestConfigs(TempRepo):
    def test_folder_conf_读原始对象_写错报错(self):
        self.j("knowledge/ML/.folder.json", {"index": "概览", "children": {"Loss": {"type": "file", "ext": "md", "order": 2}}})
        self.assertEqual(conf.folder_conf(self.root / "knowledge/ML")["index"], "概览")
        self.assertIsNone(conf.folder_conf(self.root / "knowledge"))
        self.w("knowledge/ML/.folder.json", '{"index": "概览",}')
        with self.assertRaisesRegex(ValueError, "JSON 语法错误（第 1 行"):
            conf.folder_conf(self.root / "knowledge/ML")
        self.w("knowledge/ML/.folder.json", '["a"]')
        with self.assertRaisesRegex(ValueError, "顶层必须是对象"):
            conf.folder_conf(self.root / "knowledge/ML")

    def test_folder_index_缺省同文件夹名(self):
        d = self.root / "knowledge/ML"
        d.mkdir(parents=True)
        self.assertEqual(conf.folder_index(d), "ML")
        self.j("knowledge/ML/.folder.json", {"index": "概览", "children": {}})
        self.assertEqual(conf.folder_index(d), "概览")
        for bad in ({"index": ""}, {"index": ["a"]}, {}):
            self.assertEqual(conf.folder_index(d, bad), "ML")

    def test_write_folder_一行一个子节点_按_order(self):
        f = self.root / "k/.folder.json"
        f.parent.mkdir()
        conf.write_folder(f, {"index": "k", "children": {"乙": {"type": "folder", "ext": "folder", "order": 2},
                                                         "甲": {"type": "file", "ext": "md", "order": 1}}})
        self.assertEqual(f.read_text(encoding="utf-8"),
                         '{\n  "index": "k",\n  "children": {\n'
                         '    "甲": {"type": "file", "ext": "md", "order": 1},\n'
                         '    "乙": {"type": "folder", "ext": "folder", "order": 2}\n  }\n}\n')
        conf.write_folder(f, {"index": "k", "children": {}})
        self.assertEqual(json.loads(f.read_text(encoding="utf-8")), {"index": "k", "children": {}})

    def test_write_wiki_与_default_wiki(self):
        conf.write_wiki(self.root, conf.default_wiki(3))
        self.assertEqual(self.read(".wiki/wiki.json"),
                         {"version": 3, "parts": {"经历": {"order": 1}, "认知": {"order": 2}, "学习": {"order": 3}, "知识": {"order": 4}, "系统": {"order": 5}}})
        self.assertTrue((self.root / ".wiki/wiki.json").read_text(encoding="utf-8").startswith('{\n  "version": 3,\n'))

    def test_node_key(self):
        self.assertEqual(conf.node_key("a/X.md"), "a/X")
        self.assertEqual(conf.node_key("a/X/X.md"), "a/X")
        self.assertEqual(conf.node_key("a/X"), "a/X")


class TestPathConfs(TempRepo):
    def test_rewrite_path_keys_与_dangling(self):
        self.w(".wiki/anchors.conf", "# 注\n[anatomy/Pi]\npi ~/x abc\n\n[anatomy/Pix]\nq ~/y def\n")
        self.j(".wiki/wiki.json", {"version": 3, "parts": {"anatomy": {"order": 2}}})
        self.w("anatomy/Pi2/Pi2.md")
        self.w("anatomy/Pix/Pix.md")
        n = conf.rewrite_path_keys(self.root, "anatomy/Pi", "anatomy/Pi2", Quiet())
        self.assertEqual(n, 1)
        text = (self.root / ".wiki/anchors.conf").read_text(encoding="utf-8")
        self.assertIn("[anatomy/Pi2]", text)
        self.assertIn("[anatomy/Pix]", text)
        self.assertEqual(conf.dangling_keys(self.root), [])
        conf.rewrite_path_keys(self.root, "anatomy", "学习", Quiet())
        self.assertEqual(self.read(".wiki/wiki.json"), {"version": 3, "parts": {"学习": {"order": 2}}})
        self.assertIn("[学习/Pi2]", (self.root / ".wiki/anchors.conf").read_text(encoding="utf-8"))
        self.assertEqual(sorted(k for _c, k in conf.dangling_keys(self.root)), ["学习", "学习/Pi2", "学习/Pix"])

    def test_renamed_to_按_git_改名追(self):
        self.w("anatomy/Univer/Univer.md", "# U\n")
        self.w("anatomy/Univer/a.md", "# a\n")
        self.commit()
        subprocess.run(["git", "-C", str(self.root), "mv", "anatomy/Univer", "anatomy/Univer2"], check=True)
        self.assertEqual(conf.renamed_to(self.root, "anatomy/Univer"), "anatomy/Univer2")
        self.commit()
        self.assertEqual(conf.renamed_to(self.root, "anatomy/Univer"), "anatomy/Univer2")
        self.assertIsNone(conf.renamed_to(self.root, "anatomy/没有"))

    def test_sync_folder_conf(self):
        kid = lambda o: {"type": "file", "ext": "md", "order": o}
        self.j("k/ML/.folder.json", {"index": "ML", "children": {"Loss": kid(1), "B": kid(2)}})
        ml = self.root / "k/ML"
        conf.sync_folder_conf(self.root, ml, "Loss", ml, "损失", Quiet())
        self.assertEqual(self.read("k/ML/.folder.json"), {"index": "ML", "children": {"损失": kid(1), "B": kid(2)}})
        self.assertEqual(list(self.read("k/ML/.folder.json")["children"]), ["损失", "B"], "同层改名：order 与位置不变")
        conf.sync_folder_conf(self.root, ml, "B", self.root / "k", "B", Quiet())
        self.assertEqual(self.read("k/ML/.folder.json"), {"index": "ML", "children": {"损失": kid(1)}})

    def test_sync_folder_conf_写坏了只警告不改(self):
        f = self.w("k/ML/.folder.json", "{坏")
        out = Quiet()
        conf.sync_folder_conf(self.root, self.root / "k/ML", "A", self.root / "k/ML", "B", out)
        self.assertEqual(f.read_text(encoding="utf-8"), "{坏")
        self.assertTrue(any("解析失败" in l for l in out.lines), out.lines)


class TestMoveEndToEnd(TempRepo):
    def test_move_同步_anchors_与父层_folder_json_且不误伤单词(self):
        self.w(".wiki/anchors.conf", "[学习/Pi]\npi ~/x abc\n")
        self.w("学习/Pi/Pi.md", "---\ntitle: Pi\n---\n# Pi\n")
        self.w("学习/学习.md", "---\ntitle: 学习\n---\n见 [[Pi]]，a framework, `学习/Pi/` 在此。\n")
        self.j("学习/.folder.json", {"index": "学习", "children": {"Pi": {"type": "folder", "ext": "folder", "order": 1}}})
        self.commit()
        self.assertEqual(restructure.move(self.root, "学习/Pi", "学习/Pi2"), 0)
        self.assertIn("[学习/Pi2]", (self.root / ".wiki/anchors.conf").read_text(encoding="utf-8"))
        self.assertEqual(self.read("学习/.folder.json")["children"], {"Pi2": {"type": "folder", "ext": "folder", "order": 1}})
        idx = (self.root / "学习/学习.md").read_text(encoding="utf-8")
        self.assertTrue((self.root / "学习/Pi2/Pi2.md").is_file())
        self.assertIn("[[Pi2]]", idx)
        self.assertIn("`学习/Pi2/`", idx)
        self.assertIn("a framework", idx)



class TestReviewFixes(TempRepo):
    """最终审查的三个问题：单挪文件夹页、--fix 误推前缀、children 结构不对时崩溃。"""

    def test_单独挪文件夹页被拒绝且什么都不改(self):
        self.j("知识/ML/.folder.json", {"index": "概览", "children": {}})
        self.w("知识/ML/概览.md", "---\ntitle: 概览\n---\n")
        self.w("知识/知识.md", "---\ntitle: 知识\n---\n见 [[ML]]\n")
        self.commit()
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            rc = restructure.move(self.root, "知识/ML/概览.md", "知识/ML/总览.md")
        self.assertEqual(rc, 1)
        self.assertTrue((self.root / "知识/ML/概览.md").is_file())
        self.assertIn("[[ML]]", (self.root / "知识/知识.md").read_text(encoding="utf-8"))
        self.assertEqual(self.read("知识/ML/.folder.json"), {"index": "概览", "children": {}})

    def test_renamed_to_不因曾有单个文件移出而误推前缀(self):
        self.w("学习/nanochat/nanochat.md", "# n\n")
        self.w("学习/nanochat/x.md", "# x\n")
        self.w("知识/知识.md", "# k\n")
        self.commit()
        subprocess.run(["git", "-C", str(self.root), "mv", "学习/nanochat/x.md", "知识/x.md"], check=True)
        self.commit()
        subprocess.run(["git", "-C", str(self.root), "mv", "学习/nanochat", "学习/nano"], check=True)
        self.assertEqual(conf.renamed_to(self.root, "学习/nanochat"), "学习/nano")

    def test_写坏了_index_回到默认页而不是崩溃(self):
        self.w("知识/ML/.folder.json", '{"children": [')
        self.assertEqual(repo.index_of(self.root / "知识/ML"), self.root / "知识/ML/ML.md")
        self.j("知识/ML/.folder.json", {"index": ["a", "b"], "children": {}})
        self.assertEqual(repo.index_of(self.root / "知识/ML"), self.root / "知识/ML/ML.md")


class TestMinorFixes(TempRepo):
    """审查暂缓的次要问题。"""

    def quiet(self, fn, *a):
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            return fn(*a)

    def test_路径边界不认尾随点加字母(self):
        r = restructure._replace_path
        self.assertEqual(r("知识/ML/a 与 知识/ML.v2/b 与 见知识/ML.", "知识/ML", "知识/M"), "知识/M/a 与 知识/ML.v2/b 与 见知识/M.")

    def test_shrink_改指页时把指向页名的双链改成文件夹名(self):
        self.j("知识/X/.folder.json", {"index": "概览", "children": {}})
        self.w("知识/X/概览.md", "---\ntitle: 概览\n---\n")
        self.w("知识/Y.md", "---\ntitle: Y\n---\n见 [[概览]] 与 [[X]]\n")
        self.assertEqual(self.quiet(restructure.shrink, self.root, self.root / "知识/X"), 0)
        self.assertIn("见 [[X]] 与 [[X]]", (self.root / "知识/Y.md").read_text(encoding="utf-8"))

    def test_move_改写带标签与锚点的双链(self):
        self.w("知识/A.md", "---\ntitle: A\n---\n")
        self.w("知识/Y.md", "---\ntitle: Y\n---\n[[A|甲]] [[A#一节]] [[A#一节|甲]] [[AB]]\n")
        self.commit()
        self.assertEqual(self.quiet(restructure.move, self.root, "知识/A.md", "知识/B.md"), 0)
        self.assertIn("[[B|甲]] [[B#一节]] [[B#一节|甲]] [[AB]]", (self.root / "知识/Y.md").read_text(encoding="utf-8"))

    def test_raw_下嵌套_wiki_目录不误判(self):
        (self.root / "raw/document/2026-09-01/pkg/.wiki").mkdir(parents=True)
        d = self.root / "raw/document/2026-09-01/pkg/sub"
        d.mkdir()
        self.assertTrue(repo._under_raw(d))
        k = self.root / "知识/K"
        k.mkdir(parents=True)
        self.assertFalse(repo._under_raw(k))


if __name__ == "__main__":
    unittest.main()
