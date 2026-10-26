"""开库 check 对附件：asset/ 孤儿附件、raw/ 素材里的死附件引用都只警告，不挡开库；四区死引用仍是错误。

跑： python3 vault-tools/tests/test_check_assets_warn.py
"""

import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE))

from check import check  # noqa: E402
from _vault import fill_top, fix_folders  # noqa: E402

FM = "---\ntitle: 页\ndescription: x\ntags: []\nsource: []\nstatus: draft\ncreated: 2026-10-13\nupdated: 2026-10-13\n---\n\n# 页\n{body}"


class TestAssetWarnings(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, data):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data) if isinstance(data, bytes) else p.write_text(data, encoding="utf-8")

    def check(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check.run(self.root)
        return rc, buf.getvalue()

    def test_孤儿附件只警告(self):
        self.w("asset/images/x.png", b"png")
        rc, text = self.check()
        self.assertEqual(rc, 0, text)
        self.assertIn("! 卫生：asset/ 下没人引用的附件 —— asset/images/x.png", text)

    def test_raw_素材里的死附件只警告(self):
        for rel in ("raw/document/2026-10-01/文章.md", "raw/book/甲/章节/1 一.md", "raw/listen/2026-10-06/听录.md"):
            self.w(rel, "正文 ![](asset/images/没有.png)\n")
        rc, text = self.check()
        self.assertEqual(rc, 0, text)
        for rel in ("raw/document/2026-10-01/文章.md", "raw/book/甲/章节/1 一.md", "raw/listen/2026-10-06/听录.md"):
            self.assertIn(f"! 引用：素材里的附件不存在 —— {rel} → asset/images/没有.png", text)

    def test_raw_非_UTF8_的死引用也只警告不崩(self):
        self.w("raw/document/2026-10-13/x.md", "中文 ![](asset/images/没有.png)\n".encode("gbk"))
        rc, text = self.check()
        self.assertEqual(rc, 0, text)
        self.assertIn("! 引用：素材里的附件不存在 —— raw/document/2026-10-13/x.md", text)

    def test_四区死引用仍是错误(self):
        self.w("知识/页.md", FM.format(body="![](asset/images/没有.png)\n"))
        fix_folders(self.root)
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertIn("✗ 引用：附件不存在 —— 知识/页.md → asset/images/没有.png", text)

    def test_五区附件只能用_asset(self):
        fm = FM.replace("# 页\n", "")                  # 一级标题会另报语法错，这里只看附件规则
        self.w("知识/页.md", fm.format(
            body="![](raw/document/2026-10-01/文章/images/01.png)\n\n![](images/本地图.png)\n\n[资料](raw/document/2026-10-01/文章.md)\n"))
        fix_folders(self.root)
        rc, text = self.check()
        self.assertEqual(rc, 1, text)
        self.assertIn("✗ 引用：五区附件只能用 asset/ 下的资源 —— 知识/页.md → raw/document/2026-10-01/文章/images/01.png", text)
        self.assertIn("✗ 引用：五区附件只能用 asset/ 下的资源 —— 知识/页.md → images/本地图.png", text)
        self.assertIn("✗ 引用：五区附件只能用 asset/ 下的资源 —— 知识/页.md → raw/document/2026-10-01/文章.md", text)

    def test_五区外链锚点不拦_素材区不拦(self):
        fm = FM.replace("# 页\n", "")
        self.w("知识/页.md", fm.format(body="[外链](https://x.org/a.png)\n\n[锚](#节)\n"))
        self.w("raw/document/2026-10-01/文章.md",
               "![](raw/document/2026-10-01/文章/images/01.png)\n\n[本地](images/01.png)\n")
        fix_folders(self.root)
        rc, text = self.check()
        self.assertEqual(rc, 0, text)


if __name__ == "__main__":
    unittest.main()
