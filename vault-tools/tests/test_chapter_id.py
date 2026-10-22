"""书的章节号 1 / 1.1 / 1.1.1 与书名（不带书名号）的核心规则。

跑： python3 vault-tools/tests/test_chapter_id.py
"""

import sys
import unicodedata
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import repo  # noqa: E402


class TestChapterId(unittest.TestCase):
    def test_解析章节文件名(self):
        self.assertEqual(repo.parse_chapter_file("1.1 什么是向量.md"), ("1.1", "什么是向量"))
        self.assertEqual(repo.parse_chapter_file("3 1984年.md"), ("3", "1984年"), "标题以数字开头也认得")
        self.assertEqual(repo.parse_chapter_file("12.3.4 深.md"), ("12.3.4", "深"))
        for name in ("00-前言.md", "99-附录.md", "ch01-a.md", "1.md", "1 .md", "1.1.txt", "1.-x.md"):
            self.assertIsNone(repo.parse_chapter_file(name), name)
        self.assertEqual(repo.parse_chapter_file(unicodedata.normalize("NFD", "2 é书.md")), ("2", "é书"))

    def test_按数字排序(self):
        ids = ["1.10", "1.2", "10", "9", "1.9", "1"]
        self.assertEqual(sorted(ids, key=repo.chapter_key), ["1", "1.2", "1.9", "1.10", "9", "10"])

    def test_父号(self):
        self.assertEqual(repo.chapter_parent("1.1.2"), "1.1")
        self.assertEqual(repo.chapter_parent("1.1"), "1")
        self.assertIsNone(repo.chapter_parent("3"))

    def test_清单行(self):
        text = "- [ ] 1 一\n- [x] 1.10 十 → `章节/1.10 十.md`\n- [ ] 2\n- [ ] 2.1x 不是\n"
        got = [(m.group(1), m.group(2)) for m in repo.CHECK_ROW.finditer(text)]
        self.assertEqual(got, [(" ", "1"), ("x", "1.10"), (" ", "2")])

    def test_书名去书名号(self):
        for raw in ("甲", "《甲》", " 《甲》 ", "《甲", "甲》"):
            name, d = repo.book_dir(Path("/r"), raw)
            self.assertEqual(name, "甲", raw)
            self.assertEqual(d, Path("/r/raw/book/甲"))

    def test_书图位置与引用(self):
        self.assertEqual(repo.book_image_dir(Path("/r"), "甲"), Path("/r/raw/book/甲/images"))
        self.assertEqual(repo.book_image_dir(Path("/r"), "Domain-Driven Design"), Path("/r/raw/book/Domain-Driven Design/images"))
        self.assertEqual(repo.book_image_ref("a b.png"), "../images/a%20b.png")
        self.assertEqual(repo.book_image_ref("a (1).png"), "../images/a%20%281%29.png")

    def test_章节副本不套_frontmatter(self):
        self.assertFalse(repo.needs_frontmatter("raw/book/甲/章节/1 一.md"))
        self.assertTrue(repo.needs_frontmatter("raw/book/甲/甲.md"))


if __name__ == "__main__":
    unittest.main()
