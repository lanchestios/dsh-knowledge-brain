"""插件技能可移植：不点名具体库的方法页；写作入口指向区门面。

跑： python3 vault-tools/tests/test_portability.py
"""

import re
import unittest
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
# 指路式方法页引用：骨架目录本身（`认知/方法论/`）后面紧跟反引号，不命中
METHOD_REF = re.compile(r"(认知/方法论|知识/知识工程)/[^\s`/，。、）)|]+")


def texts():
    for sub in ("skills", "agents"):
        for p in sorted((PKG / sub).rglob("*.md")):
            yield p, p.read_text(encoding="utf-8")


class TestPortability(unittest.TestCase):
    def test_不点名具体方法页(self):
        hits = [f"{p.relative_to(PKG)}: {m.group(0)}" for p, t in texts() for m in METHOD_REF.finditer(t)]
        self.assertEqual(hits, [], "\n".join(hits))

    def test_写作入口指向区门面(self):
        for rel in ("skills/wiki-write/writing.md", "skills/wiki-write-draft/SKILL.md", "skills/wiki-write/SKILL.md", "skills/wiki/SKILL.md", "agents/wiki-write-draft.md"):
            self.assertIn("<区>/<区>.md", (PKG / rel).read_text(encoding="utf-8"), f"{rel} 没写区门面入口")

    def test_写作不再定义区骨架(self):
        t = (PKG / "skills/wiki-write/writing.md").read_text(encoding="utf-8")
        for k in ("**格式 / 规范类**", "**方法 / 理论类**", "**系统 / 架构类**", "**功能 / 对接类**"):
            self.assertNotIn(k, t, f"writing.md 仍定义 {k}")

    def test_wiki_write_agent_不再自称唯一定义(self):
        self.assertNotIn("那是唯一定义", (PKG / "agents/wiki-write-draft.md").read_text(encoding="utf-8"))

    def test_每区门面种子都给得出骨架(self):
        # 认知、系统 没有全套骨架，要指到 知识/知识.md；否则 wiki-write-draft 第二步只能停下问人
        for a in ("认知", "系统"):
            self.assertIn("`知识/知识.md`", (PKG / "seeds" / "preset" / a / f"{a}.md").read_text(encoding="utf-8"), f"{a} 种子没指骨架")

    def test_学习种子骨架各节写法指向知识门面(self):
        t = (PKG / "seeds/preset/学习/学习.md").read_text(encoding="utf-8")
        self.assertNotIn("「构件清单为什么排在拆解之后」，见 `wiki` 技能", t)


if __name__ == "__main__":
    unittest.main()
