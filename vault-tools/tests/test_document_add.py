"""`wiki document add`：一篇素材 = 日期目录下的一个文件夹。

不指定名字时每个文件各进自己的文件夹；一篇多件（原件 + 抽出的 md）
用 `--name` 归进同一个文件夹。移动不是复制，原处不留副本。

跑： python3 vault-tools/tests/test_document_add.py
"""

import io
import contextlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from document import add as document_add  # noqa: E402
from core import repo  # noqa: E402


class AddBase(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        (self.root / ".wiki").mkdir()
        (self.root / repo.RAW / "document" / repo.today() / ".gitkeep").parent.mkdir(parents=True)
        (self.root / repo.RAW / "document" / repo.today() / ".gitkeep").write_text("")

    def tearDown(self):
        shutil.rmtree(self.root)

    def feed(self, *names, text="x"):
        out = []
        for n in names:
            p = self.root / n
            p.write_text(text, encoding="utf-8")
            out.append(str(p))
        return out

    def run_add(self, files, name=None):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = document_add.add_raw(self.root, files, name=name)
        return code, buf.getvalue()


class TestAddLayout(AddBase):

    def test_不指定名字时每份文件进自己的文件夹(self):
        self.feed("报告.pdf", "笔记.md")
        code, _ = self.run_add([str(self.root / "报告.pdf"), str(self.root / "笔记.md")])
        self.assertEqual(code, 0)
        self.assertTrue((self.root / repo.RAW / "document" / repo.today() / "报告" / "报告.pdf").is_file())
        self.assertTrue((self.root / repo.RAW / "document" / repo.today() / "笔记" / "笔记.md").is_file())
        self.assertFalse((self.root / "报告.pdf").exists())

    def test_指定名字时多份文件归进同一个文件夹(self):
        """一篇多件（html 原件 + extracted md）用 --name 归拢。"""
        self.feed("cnblogs-x.html", "cnblogs-x-extracted.md")
        code, _ = self.run_add([str(self.root / "cnblogs-x.html"),
                                str(self.root / "cnblogs-x-extracted.md")], name="cnblogs-x")
        self.assertEqual(code, 0)
        folder = self.root / repo.RAW / "document" / repo.today() / "cnblogs-x"
        self.assertTrue((folder / "cnblogs-x.html").is_file())
        self.assertTrue((folder / "cnblogs-x-extracted.md").is_file())

    def test_归档后清掉当天的_gitkeep(self):
        self.feed("报告.pdf")
        _, _ = self.run_add([str(self.root / "报告.pdf")])
        self.assertFalse((self.root / repo.RAW / "document" / repo.today() / ".gitkeep").exists())

    def test_目标已存在时报错不动原件(self):
        folder = self.root / repo.RAW / "document" / repo.today() / "报告"
        folder.mkdir()
        (folder / "报告.pdf").write_text("旧", encoding="utf-8")
        self.feed("报告.pdf", text="新")
        code, _ = self.run_add([str(self.root / "报告.pdf")])
        self.assertEqual(code, 1)
        self.assertEqual((folder / "报告.pdf").read_text(encoding="utf-8"), "旧")
        self.assertTrue((self.root / "报告.pdf").exists())


if __name__ == "__main__":
    unittest.main()
