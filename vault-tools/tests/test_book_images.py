"""wiki book images：章节/images/ 的书图搬进 raw/book/<书名>/images/，章节引用改成相对 ../images/；幂等。

跑： python3 vault-tools/tests/test_book_images.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from book import images  # noqa: E402

NAME = "Domain-Driven Design"
INDEX = f"---\ntitle: {NAME}\ncreated: 2026-09-06\n---\n\n# {NAME}\n"
BODY = ("# 一\n\n![图 1](images/1-001.png)\n\n![](<images/a b.png>)\n\n![](1-002.png)\n\n"
        "![](http://x.org/y.png)\n\n![](asset/images/2026-09-06/别处/z.png)\n")
DEST = "raw/book/Domain-Driven Design/images"
REF = "../images"


class TestImages(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.book = self.root / "raw/book" / NAME
        (self.book / "章节/images").mkdir(parents=True)
        (self.book / f"{NAME}.md").write_text(INDEX, encoding="utf-8")
        (self.book / "章节/1 一.md").write_text(BODY, encoding="utf-8")
        for f in ("1-001.png", "1-002.png", "a b.png"):
            (self.book / "章节/images" / f).write_bytes(f.encode())

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_move(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = images.move(self.root, NAME)
        return rc, buf.getvalue()

    def body(self):
        return (self.book / "章节/1 一.md").read_text(encoding="utf-8")

    def test_搬图并改引用(self):
        rc, text = self.run_move()
        self.assertEqual(rc, 0, text)
        for f in ("1-001.png", "1-002.png", "a b.png"):
            self.assertTrue((self.root / DEST / f).is_file(), f)
        self.assertFalse((self.book / "章节/images").exists())
        b = self.body()
        self.assertIn(f"![图 1]({REF}/1-001.png)", b)
        self.assertIn(f"![]({REF}/a%20b.png)", b)
        self.assertIn(f"![]({REF}/1-002.png)", b, "裸文件名按 basename 认")
        self.assertIn("![](http://x.org/y.png)", b)
        self.assertIn("![](asset/images/2026-09-06/别处/z.png)", b)
        self.assertIn("3 张", text)

    def test_再跑一次不变(self):
        self.run_move()
        before = self.body()
        rc, text = self.run_move()
        self.assertEqual(rc, 0, text)
        self.assertEqual(self.body(), before)

    def test_目标有不同的同名图就整体不动(self):
        (self.root / DEST).mkdir(parents=True)
        (self.root / DEST / "1-001.png").write_bytes(b"different")
        rc, text = self.run_move()
        self.assertEqual(rc, 1)
        self.assertIn("1-001.png", text)
        self.assertTrue((self.book / "章节/images/1-001.png").is_file())
        self.assertEqual(self.body(), BODY)


if __name__ == "__main__":
    unittest.main()
