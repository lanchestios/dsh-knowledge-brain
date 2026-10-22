"""asset/ 区的规则：孤儿图检查。

跑： python3 vault-tools/tests/test_assets.py
"""

import io
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402
from core import repo  # noqa: E402


class TestOrphanAssets(unittest.TestCase):
    """asset/ 下没有任何 md 引用的文件就是孤儿。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, rel, text=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def test_被引用的图片不算孤儿(self):
        self.write("asset/images/2026-09-06/文章/01.png", "x")
        self.write("知识/某页.md",
                   "![](asset/images/2026-09-06/文章/01.png)")
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_带_点点斜杠_的旧写法不算引用(self):
        """漏迁移的页要炸出来，不能默默当它引过（图片一律仓库根起引，见 repo.ASSET_REF_RE）。"""
        self.write("asset/images/2026-09-06/文章/01.png", "x")
        self.write("知识/某页.md",
                   "![](../../../asset/images/2026-09-06/文章/01.png)")
        self.assertEqual(repo.orphan_assets(self.root),
                         ["asset/images/2026-09-06/文章/01.png"])

    def test_URL_编码的引用按解码后的文件名算(self):
        """文件名带空格写 %20，与死链检查（repo.dead_asset_refs）同一套解码。"""
        self.write("asset/files/a b.pdf", "x")
        self.write("知识/页.md", "[附件](asset/files/a%20b.pdf#page=2)")
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_没人引用的图片被揪出来(self):
        self.write("asset/images/2026-09-06/文章/01.png", "x")
        self.write("raw/document/2026-09-06/文章.md", "没有图片")
        self.assertEqual(repo.orphan_assets(self.root),
                         ["asset/images/2026-09-06/文章/01.png"])

    def test_沉淀页里的引用同样算数_不论深度(self):
        self.write("asset/images/2026-09-06/文章/01.png", "x")
        self.write("知识/甲/乙/某页.md",
                   "正文 ![](asset/images/2026-09-06/文章/01.png) 结束")
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_gitkeep_不算孤儿(self):
        self.write("asset/images/.gitkeep")
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_没有_asset_目录时返回空(self):
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_站点资产不算孤儿(self):
        """logo 和它的构建输入按定义不会被任何笔记引用，不该报孤儿。"""
        self.write("asset/logo/新格物志.svg", "x")
        self.write("asset/logo/build.py", "x")
        self.write("asset/logo/.Ma_Shan_Zheng.ttf", "x")
        self.assertEqual(repo.orphan_assets(self.root), [])

    def test_豁免只覆盖_logo_目录本身(self):
        """别把 asset/logo-drafts/ 之类同前缀的目录一起放过。"""
        self.write("asset/logo-drafts/试稿.png", "x")
        self.assertEqual(repo.orphan_assets(self.root),
                         ["asset/logo-drafts/试稿.png"])

    def test_多个孤儿按路径排序(self):
        self.write("asset/images/2026-09-06/b/01.png", "x")
        self.write("asset/images/2026-09-06/a/01.png", "x")
        self.assertEqual(repo.orphan_assets(self.root),
                         ["asset/images/2026-09-06/a/01.png",
                          "asset/images/2026-09-06/b/01.png"])


class TestDeadAssetRefs(unittest.TestCase):
    """正文里 ](asset/…) 指向的文件必须存在——孤儿检查的反方向。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, rel, text=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def refs(self):
        out = repo.Out()
        buf = io.StringIO()
        with redirect_stdout(buf):
            check._check_refs(self.root, out)
        return buf.getvalue()

    def test_图片与链接指向不存在的附件就报(self):
        self.write("asset/images/有.png", "x")
        self.write("asset/files/a b.pdf", "x")
        self.write("知识/页.md", "---\ntitle: 页\n---\n# 页\n"
                   "![](asset/images/有.png) ![图](asset/images/没有.png)\n"
                   "[附件](asset/files/a%20b.pdf) [附件](asset/files/丢了.pdf#page=2)\n"
                   "```\n![](asset/images/围栏里.png)\n```\n行内 `![](asset/images/代码.png)`\n")
        text = self.refs()
        self.assertIn("✗ 引用：附件不存在 —— 知识/页.md → asset/images/没有.png", text)
        self.assertIn("✗ 引用：附件不存在 —— 知识/页.md → asset/files/丢了.pdf", text)
        for ok in ("images/有.png", "a%20b", "a b", "围栏里", "代码"):
            self.assertNotIn(ok, text)

    def test_素材页里的死附件只警告(self):
        """raw/ 素材里引用的附件不存在：只警告（素材只进不改），不当错误、不挡开库。"""
        self.write("raw/document/2026-10-01/文章.md", "![](asset/images/2026-10-01/文章/01.png)\n")
        text = self.refs()
        self.assertIn("! 引用：素材里的附件不存在 —— raw/document/2026-10-01/文章.md", text)
        self.assertNotIn("✗", text)

    def test_缺失的嵌入件只按嵌入件报一次(self):
        self.write("知识/页.md", "---\ntitle: 页\n---\n![](asset/embeds/没有.html?h=300)\n")
        text = self.refs()
        self.assertIn("嵌入件不存在", text)
        self.assertNotIn("附件不存在", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
