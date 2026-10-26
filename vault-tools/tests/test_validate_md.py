"""validate_md.mjs：解析插件生成的节点没有 position（如 GFM 把 www.x..y 拆成链接），语法检查跳过它们，不崩。

跑： python3 vault-tools/tests/test_validate_md.py
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check import check  # noqa: E402


@unittest.skipUnless(shutil.which("node"), "需要 Node")
class TestPositionless(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_on(self, text):
        p = self.root / "知识" / "页.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return check.run_validate_md(self.root, ["知识/页.md"])

    def test_畸形网址生成的链接节点不崩(self):
        # 《Domain-Driven Design Distilled》扉页原文：GFM 自动链接生成的 link / text 节点不带 position
        found, why = self.run_on("Pearson\n领域驱动精\nmm-n20:www.ne..com.cm\n\n正文\n")
        self.assertIsNotNone(found, why)
        self.assertEqual(found["syntax"], [])

    def test_同一文件里其余语法错照报(self):
        found, why = self.run_on("mm-n20:www.ne..com.cm\n\n```js\n没闭合\n")
        self.assertIsNotNone(found, why)
        self.assertTrue(any("围栏未闭合" in s for s in found["syntax"]), found)


    def test_文件名带空格的报错不丢(self):
        # 书的章节文件是「<号> <标题>.md」，四区也有 Gradient Descent.md 这类页：输出行里路径带空格
        p = self.root / "知识" / "Gradient Descent.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# 一\n\n```js\n没闭合\n", encoding="utf-8")
        found, why = check.run_validate_md(self.root, ["知识/Gradient Descent.md"])
        self.assertIsNotNone(found, why)
        self.assertTrue(any("围栏未闭合" in s and "知识/Gradient Descent.md:3" in s for s in found["syntax"]), found)

    def test_正文一级标题报错(self):
        # 阅读器标题栏已显示页名，正文再写 # 标题 就是重复；ATX 与 setext 都算，二级不算
        found, why = self.run_on("---\ntitle: 页\n---\n\n# 页\n\n正文\n\n## 小节\n\n另一段\n===\n")
        self.assertIsNotNone(found, why)
        h1 = [s for s in found["syntax"] if "一级标题" in s]
        self.assertEqual(len(h1), 1, found)
        self.assertTrue("知识/页.md:5" in h1[0], h1)
        # setext 一级标题同一行已报「误成标题」（一行只报一条），不重复报
        self.assertTrue(any("误成标题" in s and "知识/页.md:11" in s for s in found["syntax"]), found)

    def test_围栏里的井号不算标题(self):
        found, why = self.run_on("正文\n\n```bash\n# 注释\n```\n")
        self.assertIsNotNone(found, why)
        self.assertEqual([s for s in found["syntax"] if "一级标题" in s], [])


if __name__ == "__main__":
    unittest.main()
