"""wiki-write 四步流程的布局校验 —— 技能、软链、区门面。

跑： WIKI_ROOT=<vault 根> python3 vault-tools/tests/test_compose_layout.py
本文件校验的是真实 vault 的现场布局（.wiki 软链），要对着库跑；
不设 WIKI_ROOT 时按文件位置推导，落在插件仓里没有 .wiki，打印 skip 以 0 退出。
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import frontmatter as fm  # noqa: E402

ROOT = Path(os.environ["WIKI_ROOT"]).resolve() if os.environ.get("WIKI_ROOT") \
    else Path(__file__).resolve().parent.parent.parent
SKILLS = ["wiki", "wiki-read", "wiki-write", "wiki-write-book-ingest", "wiki-write-explore", "wiki-write-draft", "wiki-write-humanize", "wiki-write-review"]

# 插件仓里没有 .wiki（本文件校验真实 vault 的现场布局）：类级 skip，pytest / unittest 两边都认
in_vault = (ROOT / ".wiki").is_dir()
skip_no_vault = unittest.skipUnless(in_vault, "ROOT 下没有 .wiki——校验真实 vault 的现场布局，去 vault 侧跑")

@skip_no_vault
class TestSkill(unittest.TestCase):
    def test_技能都在且_name_与目录名一致(self):
        for s in SKILLS:
            p = ROOT / ".wiki" / "skills" / s / "SKILL.md"
            self.assertTrue(p.exists(), f"缺 {p}")
            page = fm.parse(p)
            self.assertIsNotNone(page, f"{p} 没有 frontmatter")
            self.assertEqual(page.fields.get("name"), s)
            self.assertTrue(page.fields.get("description"), f"{s} 缺 description")


@skip_no_vault
class TestSymlink(unittest.TestCase):
    def test_每个技能各有一条软链(self):
        for s in SKILLS:
            link = ROOT / ".claude" / "skills" / s
            self.assertTrue(link.is_symlink(), f".claude/skills/{s} 应该是软链")
            self.assertEqual(link.resolve(), (ROOT / ".wiki" / "skills" / s).resolve())


# wiki-write 的场景分派点名的区门面 —— 改名了要在这里失败，不能静默断链
FACADES = ["学习/学习.md", "系统/系统.md", "经历/经历.md", "知识/知识.md"]


@skip_no_vault
class TestCompose分派(unittest.TestCase):
    def setUp(self):
        self.skill = (ROOT / ".wiki" / "skills" / "wiki-write" / "SKILL.md").read_text(
            encoding="utf-8"
        )

    def test_分派点名的门面都真实存在(self):
        for m in FACADES:
            self.assertTrue((ROOT / m).exists(), f"分派指向的门面不存在: {m}")

    def test_分派里确实引用了这些门面(self):
        for m in FACADES:
            self.assertIn(m, self.skill, f"wiki-write 没有点名 {m}")


if __name__ == "__main__":
    if (ROOT / ".wiki").is_dir():
        unittest.main(verbosity=2)
    else:
        print("skip：ROOT 下没有 .wiki——本文件校验真实 vault 的现场布局，去 vault 侧跑")
        raise SystemExit(0)
