"""wiki init：空目录建库、迁移多余顶层项、已有区不拷种子只补齐、幂等、拒绝家目录。

跑： python3 vault-tools/tests/test_init.py
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
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import frontmatter as fm  # noqa: E402
import init  # noqa: E402
from core import repo  # noqa: E402

# 假种子的门面：占位符 {{at}} {{today}} 原样留给 init 替换（用 replace 拼标题，避开 format 的花括号转义）
FM = ("---\ntitle: TITLE\ndescription: TITLE\ntags: []\nsource: []\nstatus: stable\n"
      "generated: {by: process:dsh-knowledge-brain, at: {{at}}}\nverified: []\n"
      "created: {{today}}\nupdated: {{today}}\n---\n\nTITLE 的正文。\n")
page = lambda t: FM.replace("TITLE", t)


class Base(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.seeds = Path(tempfile.mkdtemp()).resolve()
        for a in repo.DEPOSIT_DIRS:                                   # 假种子：每区一个门面
            (self.seeds / "minimal" / a).mkdir(parents=True)
            (self.seeds / "minimal" / a / f"{a}.md").write_text(page(a), encoding="utf-8")
        (self.seeds / "minimal" / "知识" / "种子页.md").write_text(page("种子页"), encoding="utf-8")
        self.p = mock.patch.object(init, "SEEDS", self.seeds)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.root)
        shutil.rmtree(self.seeds)

    def run_init(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = init.main(self.root, [*args, "--json"])
        return rc, json.loads(buf.getvalue())



class TestEmpty(Base):
    def test_空目录建库_check通过(self):
        rc, r = self.run_init("--template", "minimal")
        self.assertEqual(rc, 0)
        self.assertTrue(r["git_inited"])
        self.assertTrue((self.root / ".git").is_dir())
        gi = (self.root / ".gitignore").read_text(encoding="utf-8")
        for line in (".wiki/tmp/", ".wiki/backup/", ".wiki/bin", ".wiki/skills", ".wiki/agents"):
            self.assertIn(line, gi.splitlines())
        self.assertIn("raw/project/", gi.splitlines())
        self.assertEqual(json.loads((self.root / ".wiki" / "wiki.json").read_text(encoding="utf-8"))["version"], init.WIKI_VERSION)
        self.assertTrue((self.root / "知识" / ".folder.json").is_file())
        self.assertTrue((self.root / ".wiki" / "anchors.conf").is_file())
        for d in repo.FIXED_DIRS:
            self.assertTrue((self.root / d).is_dir(), d)
        self.assertEqual(sorted(r["seeded"]), sorted(repo.DEPOSIT_DIRS))
        t = (self.root / "知识" / "种子页.md").read_text(encoding="utf-8")
        self.assertNotIn("{{", t)
        self.assertRegex(t, r"at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
        self.assertTrue((self.root / "认知" / "见解" / "见解.md").is_file(), "补了认知骨架")
        self.assertEqual(r["moved"], [])
        self.assertIsNone(r["backup"])
        self.assertTrue(r["check_ok"], r["check_output"])

    def test_plan_只看不动(self):
        (self.root / "drafts").mkdir()
        buf = io.StringIO()
        with redirect_stdout(buf):
            init.main(self.root, ["--plan", "--json"])
        self.assertEqual(json.loads(buf.getvalue()), {"git": False, "extras": ["drafts"]})
        self.assertFalse((self.root / ".wiki").exists())
        self.assertTrue((self.root / "drafts").is_dir())


class TestExtras(Base):
    def test_多余项迁到备份_白名单与点开头不动(self):
        (self.root / "drafts" / "sub").mkdir(parents=True)
        (self.root / "drafts" / "sub" / "a.txt").write_text("x", encoding="utf-8")
        (self.root / "todo.txt").write_text("x", encoding="utf-8")
        (self.root / "README.md").write_text("# 首页\n", encoding="utf-8")
        (self.root / "skills-lock.json").write_text("{}", encoding="utf-8")
        (self.root / ".claude").mkdir()
        rc, r = self.run_init("--template", "minimal")
        self.assertEqual(r["moved"], ["drafts", "todo.txt"])
        b = self.root / r["backup"]
        self.assertRegex(r["backup"], r"^\.wiki/backup/init-\d{8}-\d{6}(-\d+)?$")
        self.assertTrue((b / "drafts" / "sub" / "a.txt").is_file(), "保留相对路径")
        self.assertTrue((b / "todo.txt").is_file())
        for keep in ("README.md", "skills-lock.json", ".claude"):
            self.assertTrue((self.root / keep).exists(), keep)
        self.assertTrue(r["check_ok"], r["check_output"])

    def test_再跑一次不迁移不建备份(self):
        (self.root / "todo.txt").write_text("x", encoding="utf-8")
        self.run_init("--template", "minimal")
        backups = list((self.root / ".wiki" / "backup").iterdir())
        _, r = self.run_init("--template", "minimal")
        self.assertEqual(r["moved"], [])
        self.assertIsNone(r["backup"])
        self.assertEqual(list((self.root / ".wiki" / "backup").iterdir()), backups)
        self.assertFalse(r["git_inited"])


class TestExistingArea(Base):
    def test_已有区不拷种子_只补frontmatter与删断链source(self):
        (self.root / "知识").mkdir()
        p = self.root / "知识" / "甲.md"
        p.write_text("---\ntitle: 甲\nsource:\n  - raw/没有.md\n---\n\n甲的正文。\n", encoding="utf-8")
        _, r = self.run_init("--template", "minimal")
        self.assertIn("知识", r["skipped"])
        self.assertNotIn("知识", r["seeded"])
        self.assertFalse((self.root / "知识" / "种子页.md").exists(), "已有区不拷种子")
        page = fm.parse(p)
        for k in ("description", "tags", "created", "updated"):
            self.assertIn(k, page.fields, k)
        self.assertEqual(page.title, "甲", "合规字段不动")
        self.assertEqual(page.sources, [])
        self.assertIn("知识/甲.md", r["fixed"])
        self.assertIn("知识/甲.md → raw/没有.md", r["dropped"])
        self.assertTrue((self.root / "知识" / "知识.md").is_file(), "区门面由补骨架补出")
        self.assertTrue(r["check_ok"], r["check_output"])

    def test_没有frontmatter的页补一整块(self):
        (self.root / "系统").mkdir()
        p = self.root / "系统" / "笔记.md"
        p.write_text("随手记的一段\n", encoding="utf-8")
        _, r = self.run_init("--template", "minimal")
        page = fm.parse(p)
        self.assertIsNotNone(page)
        self.assertEqual(page.title, "笔记")
        self.assertTrue(p.read_text(encoding="utf-8").endswith("随手记的一段\n"), "正文原样保留")
        self.assertTrue(r["check_ok"], r["check_output"])

    def test_BOM或开头空行的frontmatter不叠第二块(self):
        (self.root / "系统").mkdir()
        good = page("丙").replace("{{at}}", "2026-01-01T00:00:00Z").replace("{{today}}", "2026-01-01")
        for name, text in (("bom.md", "\ufeff" + good), ("blank.md", "\n" + good)):
            p = self.root / "系统" / name
            p.write_text(text, encoding="utf-8")
        self.run_init("--template", "minimal")
        for name in ("bom.md", "blank.md"):
            t = (self.root / "系统" / name).read_text(encoding="utf-8")
            self.assertEqual(t.count("title:"), 1, f"{name} 被叠了第二块 frontmatter")

    def test_合规的页一字不动(self):
        (self.root / "知识").mkdir()
        good = page("乙").replace("{{at}}", "2026-01-01T00:00:00Z").replace("{{today}}", "2026-01-01")
        p = self.root / "知识" / "乙.md"
        p.write_text(good, encoding="utf-8")
        self.run_init("--template", "minimal")
        self.assertEqual(p.read_text(encoding="utf-8"), good)


class TestGuard(Base):
    def test_拒绝家目录(self):
        with mock.patch.object(Path, "home", return_value=self.root):
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = init.main(self.root, ["--template", "minimal", "--json"])
        self.assertEqual(rc, 2)
        self.assertEqual(list(self.root.iterdir()), [], "一个文件都不动")

    def test_未知模板(self):
        self.assertEqual(init.main(self.root, ["--template", "fancy", "--json"]), 2)

    def test_版本号与插件一致(self):
        ts = Path(__file__).resolve().parents[2] / "src" / "core" / "vault" / "init.ts"
        if ts.is_file():                                   # 只在插件仓里能对照
            self.assertIn(f"WIKI_VERSION = {init.WIKI_VERSION}", ts.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
