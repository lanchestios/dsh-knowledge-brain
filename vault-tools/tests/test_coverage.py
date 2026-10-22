"""沉淀完成度（coverage）：词表、台账读者、台账写者、CLI 与查询。

档位落 .wiki/coverage.conf 旁挂台账——raw/ 只进不改，素材本体不带状态
（规则三），人评档位是 raw_citations 那个下界之上补的真值层。

跑： python3 vault-tools/tests/test_coverage.py
"""

import io
import contextlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import repo  # noqa: E402
from document import cover as document_cover  # noqa: E402
from document import list as document_list  # noqa: E402
from _vault import fill_top, fix_folders  # noqa: E402

NFD_NAME = "cafe" + "́"       # macOS 给的分解形
NFC_NAME = "café"             # 手打的组合形


class CoverageBase(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        (self.root / repo.RAW / "document" / "2026-09-06").mkdir(parents=True)
        # 知识/ 是节点文件夹，check 要求 index 页；先放一份合法的，
        # 让「全绿」类测试量的是台账而不是 fixture 的结构缺角。
        idx = self.root / "知识" / "知识.md"
        idx.parent.mkdir(parents=True, exist_ok=True)
        idx.write_text("---\ntitle: 知识\ndescription: \ntags: []\nsource: []\n"
                       "created: 2026-09-06\nupdated: 2026-09-06\n---\n\n",
                       encoding="utf-8")
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def raw(self, name, text="素材"):
        p = self.root / repo.RAW / "document" / "2026-09-06" / name
        p.write_text(text, encoding="utf-8")
        return p

    def page(self, rel_path, sources):
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        src = "".join(f"\n  - {s}" for s in sources) or " []"
        p.write_text(f"---\ntitle: 甲\ndescription: \ntags: []\nsource:{src}\n"
                     f"created: 2026-09-06\nupdated: 2026-09-06\n---\n\n正文\n",
                     encoding="utf-8")
        fix_folders(self.root)            # 直接写的页：补齐 .folder.json，免得挡住只量台账的用例
        return p

    def conf(self, text):
        (self.root / repo.COVERAGE_CONF).write_text(text, encoding="utf-8")

    def run_main(self, fn, *a, **kw):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = fn(*a, **kw)
        return code, buf.getvalue()


class TestVocabulary(CoverageBase):
    """词表：两个档位，仿 STATUSES / PROGRESSES 的先例。"""

    def test_两个档位(self):
        self.assertEqual(repo.COVERAGES, ["processing", "done"])

    def test_每个档位都有显示标签(self):
        for c in repo.COVERAGES:
            self.assertIn(c, repo.COVERAGE_LABELS)

    def test_空值合法_等于未评(self):
        self.assertIsNone(repo.coverage_problem(""))
        self.assertIsNone(repo.coverage_problem(None))

    def test_合法值不报问题(self):
        for c in repo.COVERAGES:
            self.assertIsNone(repo.coverage_problem(c))

    def test_词表外的值报问题(self):
        self.assertIn("processing / done", repo.coverage_problem("已沉淀"))

    def test_带空格的值不合法(self):
        self.assertIsNotNone(repo.coverage_problem("取 尽"))


class TestLoadCoverage(CoverageBase):
    """台账读者：宽容，坏行跳过，专职报错的是 check。"""

    def test_没有台账文件返回空表(self):
        self.assertEqual(repo.load_coverage(self.root), {})

    def test_注释和词条读回来(self):
        (self.root / repo.COVERAGE_CONF).write_text(
            "# 头注释\n"
            "\n"
            "[raw/document/2026-09-06/甲.pdf]\n"
            "material_status = processing\n"
            "detail = 已取边界框架；AI 规模数未动\n",
            encoding="utf-8")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"],
                         {"material_status": "processing", "detail": "已取边界框架；AI 规模数未动"})

    def test_值里的井号与等号不剥不截(self):
        """文件名可以含 #，detail 是自由文本——行内注释剥离是 anchor 的坑，不能抄。"""
        (self.root / repo.COVERAGE_CONF).write_text(
            "[raw/document/2026-09-06/a#b.pdf]\n"
            "material_status = done\n"
            "detail = a=b # 注\n",
            encoding="utf-8")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/a#b.pdf"]["material_status"], "done")
        self.assertEqual(got["raw/document/2026-09-06/a#b.pdf"]["detail"], "a=b # 注")

    def test_NFD_文件名对上_NFC_词条(self):
        self.raw(NFD_NAME + ".pdf")
        (self.root / repo.COVERAGE_CONF).write_text(
            f"[raw/document/2026-09-06/{NFC_NAME}.pdf]\n"
            "material_status = done\n",
            encoding="utf-8")
        got = repo.load_coverage(self.root)
        self.assertIn(f"raw/document/2026-09-06/{NFC_NAME}.pdf", got)

    def test_坏行跳过不炸(self):
        (self.root / repo.COVERAGE_CONF).write_text(
            "这行没有等号\n"
            "键 = 值\n"
            "\n"
            "[raw/document/2026-09-06/甲.pdf]\n"
            "material_status = processing\n",
            encoding="utf-8")
        got = repo.load_coverage(self.root)
        self.assertEqual(got, {"raw/document/2026-09-06/甲.pdf": {"material_status": "processing"}})

    def test_coverage_for_查表归一(self):
        entries = {f"raw/document/2026-09-06/{NFC_NAME}.pdf": {"material_status": "done"}}
        got = repo.coverage_for(entries, f"raw/document/2026-09-06/{NFD_NAME}.pdf")
        self.assertEqual(got, {"material_status": "done"})

    def test_coverage_for_没有词条返回空表(self):
        self.assertEqual(repo.coverage_for({}, "raw/document/2026-09-06/甲.pdf"), {})


class TestSetCoverage(CoverageBase):
    """台账写者：原位行手术，保注释与邻条目，幂等。"""

    def test_首写带头部注释(self):
        self.assertTrue(repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "processing"))
        text = (self.root / repo.COVERAGE_CONF).read_text(encoding="utf-8")
        self.assertIn("# 素材沉淀完成度台账", text)
        self.assertIn("[raw/document/2026-09-06/甲.pdf]", text)
        self.assertIn("material_status = processing", text)

    def test_改档位原位更新_不伤邻条与注释(self):
        (self.root / repo.COVERAGE_CONF).write_text(
            "# 头注释\n"
            "\n"
            "[raw/document/2026-09-06/甲.pdf]\n"
            "material_status = processing\n"
            "detail = 旧清单\n"
            "\n"
            "[raw/document/2026-09-06/乙.pdf]\n"
            "material_status = done\n",
            encoding="utf-8")
        self.assertTrue(repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done"))
        text = (self.root / repo.COVERAGE_CONF).read_text(encoding="utf-8")
        lines = text.splitlines()
        self.assertEqual(lines.index("# 头注释"), 0)
        self.assertIn("material_status = done\n", text[:text.index("乙.pdf")])
        self.assertIn("detail = 旧清单", text[:text.index("乙.pdf")])
        self.assertIn("[raw/document/2026-09-06/乙.pdf]\nmaterial_status = done", text)

    def test_同值同清单返回_False_不重写(self):
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done", detail="全取了")
        before = (self.root / repo.COVERAGE_CONF).read_text(encoding="utf-8")
        self.assertFalse(repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf",
                                           "done", detail="全取了"))
        self.assertEqual((self.root / repo.COVERAGE_CONF).read_text(encoding="utf-8"), before)

    def test_只改档位保留原清单(self):
        """档位与取用清单是两根轴，改一根不抹另一根。"""
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "processing", detail="取了开头")
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"],
                         {"material_status": "done", "detail": "取了开头"})

    def test_改档位同时换清单(self):
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "processing", detail="旧")
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done", detail="新")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"],
                         {"material_status": "done", "detail": "新"})

    def test_给已有_detail_的词条首次补清单(self):
        (self.root / repo.COVERAGE_CONF).write_text(
            "[raw/document/2026-09-06/甲.pdf]\n"
            "material_status = processing\n",
            encoding="utf-8")
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "processing", detail="补上的")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"]["detail"], "补上的")

    def test_新词条写在文件末尾_旧条目不动(self):
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done")
        repo.set_coverage(self.root, "raw/document/2026-09-06/乙.pdf", "processing", detail="清单")
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"]["material_status"], "done")
        self.assertEqual(got["raw/document/2026-09-06/乙.pdf"],
                         {"material_status": "processing", "detail": "清单"})


class TestCoverCli(CoverageBase):
    """wiki cover：写档位与清单、查询、幂等、错误路径、完成只由人标。"""

    def setUp(self):
        super().setUp()
        # 身份钉成人：测试可能在配了 WIKI_ACTOR=claude 的会话里跑
        self.saved = os.environ.get("WIKI_ACTOR")
        os.environ["WIKI_ACTOR"] = "human:测试"

    def tearDown(self):
        os.environ.pop("WIKI_ACTOR", None)
        if self.saved is not None:
            os.environ["WIKI_ACTOR"] = self.saved
        super().tearDown()

    def test_智能体标完成被拒且不落盘(self):
        os.environ["WIKI_ACTOR"] = "claude"
        code, text = self.run_main(document_cover.cover, self.root, self.素材(), "done")
        self.assertEqual(code, 1)
        self.assertIn("只由人标", text)
        self.assertEqual(repo.load_coverage(self.root), {})

    def test_智能体可以标沉淀中(self):
        os.environ["WIKI_ACTOR"] = "claude"
        code, _ = self.run_main(document_cover.cover, self.root, self.素材(), "processing",
                                detail="疑似可完成，待确认")
        self.assertEqual(code, 0)

    def test_人可以标完成(self):
        code, text = self.run_main(document_cover.cover, self.root, self.素材(), "done")
        self.assertEqual(code, 0)
        self.assertIn("→ 完成", text)

    def 素材(self, name="甲.pdf"):
        p = self.raw(name)
        return str(p)

    def test_写档位与清单(self):
        code, text = self.run_main(document_cover.cover, self.root, self.素材(), "processing",
                                   detail="已取框架；细表未动")
        self.assertEqual(code, 0)
        self.assertIn("→ 沉淀中", text)
        got = repo.load_coverage(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"]["detail"], "已取框架；细表未动")

    def test_非法档位报错且不落盘(self):
        code, text = self.run_main(document_cover.cover, self.root, self.素材(), "已沉淀")
        self.assertEqual(code, 1)
        self.assertIn("material_status 只能是", text)
        self.assertEqual(repo.load_coverage(self.root), {})

    def test_找不到(self):
        code, text = self.run_main(document_cover.cover, self.root,
                                   str(self.root / "raw/document/2026-09-06/没有.pdf"))
        self.assertEqual(code, 1)
        self.assertIn("找不到", text)

    def test_目录不是文件(self):
        code, text = self.run_main(document_cover.cover, self.root,
                                   str(self.root / "raw/document/2026-09-06"))
        self.assertEqual(code, 1)
        self.assertIn("不是文件", text)

    def test_不在_raw_document_下(self):
        p = self.root / "知识" / "某页.md"
        p.write_text("x", encoding="utf-8")
        code, text = self.run_main(document_cover.cover, self.root, str(p), "done")
        self.assertEqual(code, 1)
        self.assertIn("不在 raw/document/ 下", text)
        self.assertEqual(repo.load_coverage(self.root), {})

    def test_出仓的绝对路径也拒(self):
        outside = Path(tempfile.mkdtemp()).resolve()
        try:
            p = outside / "外部.pdf"
            p.write_text("x", encoding="utf-8")
            code, text = self.run_main(document_cover.cover, self.root, str(p), "done")
            self.assertEqual(code, 1)
            self.assertIn("不在 raw/document/ 下", text)
        finally:
            shutil.rmtree(outside)

    def test_无参查询_未评(self):
        code, text = self.run_main(document_cover.cover, self.root, self.素材())
        self.assertEqual(code, 0)
        self.assertIn("未评", text)
        self.assertIn("沉淀中 / 完成", text)

    def test_无参查询_已评带清单(self):
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "processing", detail="清单")
        code, text = self.run_main(document_cover.cover, self.root, self.素材())
        self.assertEqual(code, 0)
        self.assertIn("沉淀中", text)
        self.assertIn("清单", text)

    def test_重复设置说已经是(self):
        repo.set_coverage(self.root, "raw/document/2026-09-06/甲.pdf", "done")
        code, text = self.run_main(document_cover.cover, self.root, self.素材(), "done")
        self.assertEqual(code, 0)
        self.assertIn("已经是 完成", text)


class TestListRaw(CoverageBase):
    """list raw：档位标签、pending 覆盖口径、对齐与统计行。"""

    def rate(self, name, coverage, detail=None):
        repo.set_coverage(self.root, f"raw/document/2026-09-06/{name}", coverage, detail=detail)

    def test_行标签用档位标签(self):
        self.raw("甲.pdf");  self.raw("乙.pdf")
        self.rate("甲.pdf", "processing")
        self.rate("乙.pdf", "done")
        _, text = self.run_main(document_list.raw, self.root)
        line = [l for l in text.splitlines() if "甲.pdf" in l][0]
        self.assertIn("沉淀中", line)
        self.assertIn("完成", [l for l in text.splitlines() if "乙.pdf" in l][0])

    def test_未评回退二值(self):
        self.raw("甲.pdf")
        self.raw("乙.pdf")
        _, text = self.run_main(document_list.raw, self.root)
        self.assertIn("未沉淀", [l for l in text.splitlines() if "甲.pdf" in l][0])

    def test_pending_未评与沉淀中在列_完成不列(self):
        self.raw("甲.pdf");  self.raw("乙.pdf");  self.raw("丙.pdf")
        self.rate("乙.pdf", "processing")
        self.rate("丙.pdf", "done")
        _, text = self.run_main(document_list.raw, self.root, pending=True)
        self.assertIn("甲.pdf", text)
        self.assertIn("乙.pdf", text)
        self.assertNotIn("丙.pdf", text)

    def test_全部了结的收尾话术(self):
        self.raw("甲.pdf");  self.raw("乙.pdf")
        self.rate("甲.pdf", "done")
        self.rate("乙.pdf", "done")
        code, text = self.run_main(document_list.raw, self.root, pending=True)
        self.assertEqual(code, 0)
        self.assertIn("2 份素材都没有待沉淀的", text)

    def test_统计行_有评价时按档位报数_零计数省略(self):
        self.raw("甲.pdf");  self.raw("乙.pdf");  self.raw("丙.pdf")
        self.rate("乙.pdf", "processing")
        _, text = self.run_main(document_list.raw, self.root)
        self.assertIn("共 3 份，待沉淀 3 份", text)

    def test_统计行_有完成时报全两段(self):
        self.raw("甲.pdf");  self.raw("乙.pdf");  self.raw("丙.pdf")
        self.rate("甲.pdf", "processing")
        self.rate("乙.pdf", "done")
        _, text = self.run_main(document_list.raw, self.root)
        self.assertIn("共 3 份，待沉淀 2 份，完成 1 份", text)

    def test_状态列宽窄不一时时刻列仍对齐(self):
        """沉淀中（8 列）与未沉淀（6 列）混排，不补齐会把时刻列剪错位。
        对齐是显示列的对齐，量前缀得用 repo.width，不能用字符下标。"""
        self.raw("甲.pdf");  self.raw("乙.pdf")
        self.rate("甲.pdf", "processing")
        _, text = self.run_main(document_list.raw, self.root)
        lines = [l for l in text.splitlines() if ".pdf" in l]
        self.assertEqual(len(lines), 2)
        cols = {repo.width(l[:l.index("未提交")]) for l in lines}
        self.assertEqual(len(cols), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
