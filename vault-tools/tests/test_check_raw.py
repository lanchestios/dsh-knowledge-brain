"""wiki check 不碰 raw/：书进度页、章节、听录、document 卫生、台账都不校验；四区页 source 指 raw 仍查存在。

跑： python3 vault-tools/tests/test_check_raw.py
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
from _vault import fill_top  # noqa: E402

FM = "---\ntitle: {t}\ndescription: x\ntags: []\nsource: {src}\nstatus: draft\ncreated: 2026-10-13\nupdated: 2026-10-13\n---\n\n{t} 的正文。\n"


class TestCheckSkipsRaw(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        fill_top(self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def w(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def check(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check.run(self.root)
        return rc, buf.getvalue()

    def test_半成品书不挡开库(self):
        self.w("raw/book/《甲》/《甲》.index.md", "没有 frontmatter")          # 缺页 + 无 frontmatter
        self.w("raw/book/《乙》/《乙》.md", "---\nmaterial_status: 乱写\n---\n")
        self.w("raw/book/《乙》/章节/ch01-一.md", "```\n没闭合的围栏 ![](images/缺.png)\n")
        rc, text = self.check()
        self.assertEqual(rc, 0, text)

    def test_听录与_document_卫生与台账不查(self):
        self.w("raw/listen/2026-10-06/听录.md", "无 frontmatter\n")
        self.w("raw/document/散文件.md", "# x\n")
        self.w("raw/document/不是日期/a.md", "![](asset/images/没有.png)\n")
        self.w(".wiki/coverage.conf", "乱写一行\n")
        rc, text = self.check()
        self.assertEqual(rc, 0, text)

    def test_raw_下非_UTF8_的_md_不崩(self):
        gbk = "---\ntitle: 中文\n---\n\n中文正文 ![](asset/images/x.png)\n".encode("gbk")
        for rel in ("raw/document/2026-10-13/x.md", "raw/book/《甲》/《甲》.md"):
            p = self.root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(gbk)
        rc, text = self.check()
        self.assertEqual(rc, 0, text)

    def test_四区页_source_指向不存在的_raw_仍报(self):
        self.w("知识/某页.md", FM.format(t="某页", src="[raw/book/《无》/无.pdf]"))
        from _vault import fix_folders
        fix_folders(self.root)
        rc, text = self.check()
        self.assertEqual(rc, 1)
        self.assertIn("引用：source 指向的文件不存在 —— 知识/某页.md → raw/book/《无》/无.pdf", text)


if __name__ == "__main__":
    unittest.main()
