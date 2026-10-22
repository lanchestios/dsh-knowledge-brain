"""嵌入件的高度声明：![](asset/….html?h=高度) 必须写，且落在 160–2000。

跑： python3 vault-tools/tests/test_embed_height.py
"""

import io
import contextlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from core import frontmatter as fm  # noqa: E402
from core import repo  # noqa: E402
from _vault import fill_top, fix_folders  # noqa: E402

FM = ("---\ntitle: 甲\ndescription: 摘要\ntags: [t]\nsource: []\n"
      "created: 2026-09-06\nupdated: 2026-09-06\n---\n\n")


class TestEmbedHeight(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        (self.root / "知识").mkdir()
        (self.root / "知识" / "知识.md").write_text(
            FM.replace("title: 甲", "title: 知识"), encoding="utf-8")
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def page(self, body):
        p = self.root / "知识" / "甲.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(FM + body + "\n", encoding="utf-8")
        fix_folders(self.root)            # 直接写的页：补齐 .folder.json
        return p

    def embed(self, target="asset/explorables/2026-10-03/试.html", body=None):
        (self.root / target).parent.mkdir(parents=True, exist_ok=True)
        (self.root / target).write_text("<p>x</p>", encoding="utf-8")
        self.page(body or f"![]({target}?h=560)")
        return fm.parse(self.root / "知识" / "甲.md")

    def run_check(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = check.run(self.root)
        return rc, buf.getvalue()

    def test_embeds_把路径与参数分开给(self):
        page = self.embed()
        self.assertEqual(page.embeds(), [("asset/explorables/2026-10-03/试.html", "?h=560")])

    def test_没写参数时_query_为空串(self):
        self.embed(body="![](asset/explorables/2026-10-03/试.html)")
        page = fm.parse(self.root / "知识" / "甲.md")
        self.assertEqual(page.embeds(), [("asset/explorables/2026-10-03/试.html", "")])

    def test_声明了高度就过_check(self):
        self.embed()
        rc, out = self.run_check()
        self.assertEqual(rc, 0, out)

    def test_不写高度报错(self):
        self.embed(body="![](asset/explorables/2026-10-03/试.html)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("未声明高度", out)

    def test_高度低于_160_报错(self):
        self.embed(body="![](asset/explorables/2026-10-03/试.html?h=100)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("160", out)

    def test_高度高于_2000_报错(self):
        self.embed(body="![](asset/explorables/2026-10-03/试.html?h=3000)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("2000", out)

    def test_参数只认_h_别的报错(self):
        self.embed(body="![](asset/explorables/2026-10-03/试.html?w=560)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("h", out)

    def test_高度不挡存在性检查(self):
        """参数归参数，文件还是要存在——不能因为带了 ?h= 就跳过另一条规则。"""
        self.page("![](asset/explorables/2026-10-03/没有.html?h=560)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("不存在", out)

    def test_带高度的嵌入仍是引用_不算孤儿(self):
        self.embed()
        self.assertEqual(repo.orphan_assets(self.root), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TestExcalidrawH(TestEmbedHeight):
    """excalidraw 图位的 ?h=：可选（默认等比压栏宽）；写了就要合法区间、别的参数不认"""

    def embed(self, target="asset/diagrams/2026-10-20/图.excalidraw", body=None):
        (self.root / target).parent.mkdir(parents=True, exist_ok=True)
        (self.root / target).write_text('{"type":"excalidraw","version":2,"elements":[]}', encoding="utf-8")
        self.page(body or f"![]({target}?h=560)")
        return fm.parse(self.root / "知识" / "甲.md")

    def test_embeds_把路径与参数分开给(self):
        page = self.embed()
        self.assertEqual(page.embeds(), [("asset/diagrams/2026-10-20/图.excalidraw", "?h=560")])

    def test_不写高度报错(self):
        # excalidraw 的 ?h= 可选：不写不报（等比压栏宽）
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw)")
        rc, out = self.run_check()
        self.assertEqual(rc, 0, out)

    def test_高度低于_160_报错(self):
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw?h=100)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("160", out)

    def test_高度高于_2000_报错(self):
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw?h=9999)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("2000", out)

    def test_不写_h_也过_check(self):
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw)")
        rc, out = self.run_check()
        self.assertEqual(rc, 0, out)

    def test_写了合法_h_过(self):
        self.embed()
        rc, out = self.run_check()
        self.assertEqual(rc, 0, out)

    def test_写了_h_超区间报错(self):
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw?h=9999)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("超出", out)

    def test_写了别的参数报错(self):
        self.embed(body="![](asset/diagrams/2026-10-20/图.excalidraw?w=99)")
        rc, out = self.run_check()
        self.assertEqual(rc, 1)
        self.assertIn("excalidraw 高度参数", out)
