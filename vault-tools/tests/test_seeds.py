"""种子：两个模板各在空目录建一个库，wiki check 零错；预置模板的双链都在种子内可解析。

跑： python3 vault-tools/tests/test_seeds.py
"""

import io
import re
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

import init  # noqa: E402
from core import repo  # noqa: E402

SEEDS = Path(__file__).resolve().parent.parent / "seeds"


def strip_code(t):
    t = re.sub(r"```.*?```", "", t, flags=re.S)
    return re.sub(r"`[^`\n]*`", "", t)


class TestSeeds(unittest.TestCase):
    def build(self, template):
        root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, root)
        with redirect_stdout(io.StringIO()):
            r = init.build(root, template)
        return root, r

    def test_门面第一个二级标题是怎么读(self):
        # wiki-read 只认门面的「## 怎么读」：放错位置或漏一区，读路由就指向不存在的节
        seeds = Path(__file__).resolve().parent.parent / "seeds"
        for tpl in ("minimal", "preset"):
            for z in ("经历", "认知", "学习", "知识", "系统"):
                text = (seeds / tpl / z / f"{z}.md").read_text(encoding="utf-8")
                h2 = [l for l in text.splitlines() if l.startswith("## ")]
                self.assertTrue(h2 and h2[0] == "## 怎么读", f"{tpl}/{z}: 第一个 ## 是 {h2[:1]}")
                self.assertNotIn("本页是这个区的写作规则", text, f"{tpl}/{z} 引言没改成读写规则")
                self.assertNotIn("`wiki` 技能的 `writing.md`", text, f"{tpl}/{z} 写作规则应指 wiki-write")

    def test_系统门面写明行业矩阵组织协同_平台不挂矩阵下(self):
        seeds = Path(__file__).resolve().parent.parent / "seeds"
        for tpl in ("minimal", "preset"):
            text = (seeds / tpl / "系统" / "系统.md").read_text(encoding="utf-8")
            self.assertNotIn("下面直接平铺平台", text, f"{tpl}: 平台平铺在 系统/ 二层，不在矩阵下")
        pre = (seeds / "preset" / "系统" / "系统.md").read_text(encoding="utf-8")
        self.assertIn("**行业矩阵组织跨域协同", pre)
        for page in ("生命周期", "全链路数据流", "端到端链路", "矩阵域关系"):
            self.assertIn(page, pre, f"preset 系统门面缺先例长成页 {page}")
        self.assertNotIn("矩阵成员", pre, "成员表先不写进门面（人定）")

    def test_两个模板都有四区门面(self):
        for t in init.TEMPLATES:
            for a in repo.DEPOSIT_DIRS:
                self.assertTrue((SEEDS / t / a / f"{a}.md").is_file(), f"{t}/{a}")

    def test_两个模板建库_check零错(self):
        for t in init.TEMPLATES:
            _, r = self.build(t)
            self.assertTrue(r["check_ok"], f"{t}\n{r['check_output']}")

    def test_预置带知识工程十页(self):
        root, _ = self.build("preset")
        pages = sorted(repo.rel(root, p) for p in (root / "知识" / "知识工程").rglob("*.md"))
        self.assertEqual(len(pages), 10, pages)

    def test_预置种子的双链都在种子内(self):
        names = {p.stem for p in (SEEDS / "preset").rglob("*.md")}
        for p in (SEEDS / "preset").rglob("*.md"):
            for link in re.findall(r"\[\[([^\]|#]+)", strip_code(p.read_text(encoding="utf-8"))):
                self.assertIn(link, names, f"{p.relative_to(SEEDS)} → [[{link}]]")

    def test_预置_已有知识区_仍能打开(self):
        # 已有 知识/ 不拷知识门面，但别的区门面链向 知识/知识工程/：缺的要补上（只补不覆盖），否则断链打不开
        root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, root)
        (root / "知识" / "笔记").mkdir(parents=True)
        (root / "知识" / "笔记" / "a.md").write_text("随手记\n", encoding="utf-8")
        mine = root / "知识" / "知识工程" / "结构化写作" / "结构化写作.md"
        mine.parent.mkdir(parents=True)
        mine.write_text("---\ntitle: 结构化写作\ndescription: 我的版本\ntags: []\nsource: []\n"
                        "created: 2026-01-01\nupdated: 2026-01-01\n---\n\n我改过\n", encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            r = init.build(root, "preset")
        self.assertTrue(r["check_ok"], r["check_output"])
        self.assertIn("我改过", mine.read_text(encoding="utf-8"), "已有的不覆盖")
        self.assertTrue((root / "知识" / "知识工程" / "Sensemaking" / "Sensemaking.md").is_file(), "缺的补上")

    def test_门面带占位符(self):
        for t in init.TEMPLATES:
            for a in repo.DEPOSIT_DIRS:
                text = (SEEDS / t / a / f"{a}.md").read_text(encoding="utf-8")
                self.assertIn("{{at}}", text, f"{t}/{a}")
                self.assertIn("{{today}}", text, f"{t}/{a}")

    def test_种子不带真名与断链素材(self):
        from core import frontmatter as fm
        for p in SEEDS.rglob("*.md"):
            # 种子里的人只许是仓内署名 lanchestios（真名不随包分发）
            for who in re.findall(r"human:([\w.-]+)", p.read_text(encoding="utf-8")):
                self.assertEqual(who, "lanchestios", p)
            page = fm.parse(p)
            if page is not None:
                bad = [s for s in page.sources if s.startswith("raw/")]
                self.assertEqual(bad, [], f"{p} 的 source 指向不随种子走的素材")

    def test_预置门面指向知识工程(self):
        t = (SEEDS / "preset" / "知识" / "知识.md").read_text(encoding="utf-8")
        self.assertIn("[[结构化写作]]", t)


if __name__ == "__main__":
    unittest.main()
