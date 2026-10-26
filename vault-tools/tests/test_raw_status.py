"""`wiki list raw` 给每份素材标两件事：到达时刻、有没有被沉淀过。

素材本身永不编辑（规则三），所以这两件事都得从别处推导：
到达时刻从 git 首次加入该文件的 commit 来，沉淀状态从全树 frontmatter
的 source 反查来。

跑： python3 vault-tools/tests/test_raw_status.py
"""

import io
import contextlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from document import list as document_list  # noqa: E402
from core import repo  # noqa: E402


def _git(root, *args):
    subprocess.run(["git", "-C", str(root), *args],
                   capture_output=True, text=True, check=True)


class RawStatusBase(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        _git(self.root, "init", "-q")
        _git(self.root, "config", "user.email", "t@t")
        _git(self.root, "config", "user.name", "t")

    def tearDown(self):
        shutil.rmtree(self.root)

    def raw(self, day, name, text="素材"):
        d = self.root / repo.RAW / "document" / day
        d.mkdir(parents=True, exist_ok=True)
        p = d / name
        p.write_text(text, encoding="utf-8")
        return p

    def commit(self, when="2026-09-06T10:00:00+08:00"):
        _git(self.root, "add", "-A")
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "x",
                        "--date", when],
                       capture_output=True, text=True, check=True,
                       env={"GIT_COMMITTER_DATE": when, "PATH": "/usr/bin:/bin",
                            "HOME": str(self.root)})

    def page(self, rel_path, sources):
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        src = "".join(f"\n  - {s}" for s in sources) or " []"
        p.write_text(f"---\ntitle: 甲\nsource:{src}\n---\n\n正文\n", encoding="utf-8")
        return p

    def run_raw(self, *a, **kw):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = document_list.raw(self.root, *a, **kw)
        return code, buf.getvalue()


class TestArrival(RawStatusBase):
    """到达时刻：git 首次加入该文件的 commit 时刻。"""

    def test_已提交的素材给出_commit_时刻(self):
        self.raw("2026-09-06", "甲.pdf")
        self.commit("2026-09-06T10:00:00+08:00")
        got = repo.raw_arrivals(self.root)
        self.assertEqual(got["raw/document/2026-09-06/甲.pdf"][:10], "2026-09-06")

    def test_没提交的素材没有到达时刻(self):
        self.raw("2026-09-06", "乙.pdf")
        self.assertIsNone(repo.raw_arrivals(self.root).get("raw/document/2026-09-06/乙.pdf"))

    def test_中文路径不被_git_转义吞掉(self):
        self.raw("2026-09-06", "交易中台设计.md")
        self.commit()
        self.assertIn("raw/document/2026-09-06/交易中台设计.md", repo.raw_arrivals(self.root))

    def test_取首次加入而不是后来的改动(self):
        p = self.raw("2026-09-06", "丙.md", "一版")
        self.commit("2026-09-06T10:00:00+08:00")
        p.write_text("二版", encoding="utf-8")
        self.commit("2026-09-20T10:00:00+08:00")
        self.assertEqual(repo.raw_arrivals(self.root)["raw/document/2026-09-06/丙.md"][:10],
                         "2026-09-06")

    def test_不是_git_仓库时不炸_只是都没有时刻(self):
        plain = Path(tempfile.mkdtemp()).resolve()
        try:
            (plain / "raw" / "document" / "2026-09-06").mkdir(parents=True)
            (plain / "raw" / "document" / "2026-09-06" / "甲.md").write_text("x")
            self.assertEqual(repo.raw_arrivals(plain), {})
        finally:
            shutil.rmtree(plain)


class TestCitations(RawStatusBase):
    """沉淀状态：树里有没有页的 source 指过来。"""

    def test_被某页_source_引到就算已沉淀(self):
        self.raw("2026-09-06", "甲.pdf")
        self.page("知识/某页.md", ["raw/document/2026-09-06/甲.pdf"])
        cited = repo.raw_citations(self.root)
        self.assertEqual(cited["raw/document/2026-09-06/甲.pdf"], ["知识/某页.md"])

    def test_没人引就是未沉淀(self):
        self.raw("2026-09-06", "乙.pdf")
        self.assertNotIn("raw/document/2026-09-06/乙.pdf", repo.raw_citations(self.root))

    def test_多页引同一份素材时都记下(self):
        self.raw("2026-09-06", "甲.pdf")
        self.page("知识/甲页.md", ["raw/document/2026-09-06/甲.pdf"])
        self.page("认知/见解/乙页.md", ["raw/document/2026-09-06/甲.pdf"])
        self.assertEqual(len(repo.raw_citations(self.root)["raw/document/2026-09-06/甲.pdf"]), 2)

    def test_raw_里的页自己引不算沉淀(self):
        """raw 内部的互引不是沉淀——沉淀必须发生在四个树区里。"""
        self.raw("2026-09-06", "甲.pdf")
        self.page("raw/book/《X》/笔记/ch01.md", ["raw/document/2026-09-06/甲.pdf"])
        self.assertNotIn("raw/document/2026-09-06/甲.pdf", repo.raw_citations(self.root))


class TestListRawOutput(RawStatusBase):
    """输出：每行带状态和时刻，末尾给出统计。"""

    def test_已沉淀的行标已沉淀(self):
        self.raw("2026-09-06", "甲.pdf")
        self.page("知识/某页.md", ["raw/document/2026-09-06/甲.pdf"])
        self.commit()
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "甲.pdf" in l][0]
        self.assertIn("已沉淀", line)

    def test_未沉淀的行标未沉淀(self):
        self.raw("2026-09-06", "乙.pdf")
        self.commit()
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "乙.pdf" in l][0]
        self.assertIn("未沉淀", line)

    def test_行里带到达时刻(self):
        self.raw("2026-09-06", "甲.pdf")
        self.commit("2026-09-06T14:23:00+08:00")
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "甲.pdf" in l][0]
        self.assertIn("14:23", line)

    def test_没提交的素材标未提交(self):
        self.raw("2026-09-06", "丙.pdf")
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "丙.pdf" in l][0]
        self.assertIn("未提交", line)

    def test_提交日与目录日不同时把日期一并显示(self):
        """目录日是 wiki add 那天，提交日是真进 git 那天，差了就不能只显示时分。"""
        self.raw("2026-09-08", "丁.pdf")
        self.commit("2026-09-09T09:00:00+08:00")
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "丁.pdf" in l][0]
        self.assertIn("2026-09-09", line)

    def test_末尾给出沉淀统计(self):
        self.raw("2026-09-06", "甲.pdf")
        self.raw("2026-09-06", "乙.pdf")
        self.page("知识/某页.md", ["raw/document/2026-09-06/甲.pdf"])
        self.commit()
        _, text = self.run_raw()
        self.assertRegex(text, r"2 份.*1 份已沉淀")

    def test_pending_按覆盖口径_未评在列_完成不列(self):
        """--pending 走覆盖口径：被引但未评仍是待办（下界说已沉淀不算数），
        标了「完成」的档位才算了结。"""
        self.raw("2026-09-06", "甲.pdf")
        self.raw("2026-09-06", "乙.pdf")
        self.raw("2026-09-06", "丙.pdf")
        self.page("知识/某页.md", ["raw/document/2026-09-06/甲.pdf"])
        repo.set_coverage(self.root, "raw/document/2026-09-06/丙.pdf", "done")
        self.commit()
        _, text = self.run_raw(pending=True)
        self.assertIn("甲.pdf", text)
        self.assertIn("乙.pdf", text)
        self.assertNotIn("丙.pdf", text)

    def test_按日筛选仍然可用(self):
        self.raw("2026-09-06", "甲.pdf")
        self.raw("2026-09-07", "乙.pdf")
        self.commit()
        _, text = self.run_raw("2026-09-06")
        self.assertIn("甲.pdf", text)
        self.assertNotIn("乙.pdf", text)

    def test_文章文件夹里的素材列出而_images_里的图不列(self):
        """一篇 = 日期目录下的一个文件夹：md 在里面，images/ 里的图不是素材。"""
        folder = self.root / repo.RAW / "document" / "2026-09-06" / "文章甲"
        (folder / "images").mkdir(parents=True)
        (folder / "文章甲.md").write_text("正文 ![](images/01.png)", encoding="utf-8")
        (folder / "images" / "01.png").write_bytes(b"png")
        self.commit()
        _, text = self.run_raw()
        line = [l for l in text.splitlines() if "文章甲.md" in l][0]
        self.assertIn("未沉淀", line)
        self.assertNotIn("01.png", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
