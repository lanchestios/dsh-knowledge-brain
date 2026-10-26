"""repo.iter_md / iter_dirs 的范围排除测试 —— 验证 .superpowers/ 等工具区不被遍历。

跑： python3 vault-tools/tests/test_repo_scope.py
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import repo  # noqa: E402


class TestIterMdExcludesToolDirs(unittest.TestCase):
    """iter_md 应该排除工具目录（.git, .wiki, .claude, .superpowers）。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        # 创建 .wiki/ 以使其被识别为仓库根
        (self.root / ".wiki").mkdir()

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_iter_md_排除_dot_superpowers(self):
        """iter_md 应该不产出 .superpowers 目录下的 md 文件。"""
        # 创建工具区文件和正常文件
        (self.root / ".superpowers").mkdir()
        (self.root / ".superpowers" / "report.md").write_text("# 报告", encoding="utf-8")

        (self.root / "系统").mkdir()
        (self.root / "系统" / "normal.md").write_text("# 正常页", encoding="utf-8")

        # iter_md 应该只产出 normal.md，不产出 report.md
        md_files = list(repo.iter_md(self.root))
        relative_paths = [repo.rel(self.root, p) for p in md_files]

        self.assertIn("系统/normal.md", relative_paths)
        self.assertNotIn(".superpowers/report.md", relative_paths)

    def test_iter_md_排除_dot_wiki(self):
        """iter_md 应该不产出 .wiki 目录下的 md 文件。"""
        (self.root / ".wiki" / "lib").mkdir()
        (self.root / ".wiki" / "lib" / "test.md").write_text("# 代码", encoding="utf-8")

        (self.root / "系统").mkdir()
        (self.root / "系统" / "normal.md").write_text("# 正常页", encoding="utf-8")

        md_files = list(repo.iter_md(self.root))
        relative_paths = [repo.rel(self.root, p) for p in md_files]

        self.assertIn("系统/normal.md", relative_paths)
        self.assertNotIn(".wiki/lib/test.md", relative_paths)

    def test_iter_md_排除_dot_claude(self):
        """iter_md 应该不产出 .claude 目录下的 md 文件。"""
        (self.root / ".claude").mkdir()
        (self.root / ".claude" / "memory.md").write_text("# 记忆", encoding="utf-8")

        (self.root / "系统").mkdir()
        (self.root / "系统" / "normal.md").write_text("# 正常页", encoding="utf-8")

        md_files = list(repo.iter_md(self.root))
        relative_paths = [repo.rel(self.root, p) for p in md_files]

        self.assertIn("系统/normal.md", relative_paths)
        self.assertNotIn(".claude/memory.md", relative_paths)

    def test_iter_dirs_排除_dot_superpowers(self):
        """iter_dirs 应该不产出 .superpowers 目录。"""
        (self.root / ".superpowers").mkdir()
        (self.root / ".superpowers" / "sdd").mkdir()
        (self.root / "系统").mkdir()

        dirs = list(repo.iter_dirs(self.root))
        relative_paths = [repo.rel(self.root, p) for p in dirs]

        self.assertIn("系统", relative_paths)
        self.assertNotIn(".superpowers", relative_paths)
        self.assertNotIn(".superpowers/sdd", relative_paths)

    def test_软链指向库外不炸且被排除(self):
        """`.wiki/` 下的工具软链指向插件包（库外）：rel / iter_md / iter_dirs 不炸，按名字排除。"""
        outside = Path(tempfile.mkdtemp()).resolve()
        try:
            (outside / "SKILL.md").write_text("# 技能", encoding="utf-8")
            (outside / "sub").mkdir()
            (self.root / ".wiki" / "lib").mkdir()
            (self.root / ".wiki" / "skills").symlink_to(outside)
            (self.root / ".wiki" / "README.md").symlink_to(outside / "SKILL.md")
            (self.root / "系统").mkdir()
            (self.root / "系统" / "normal.md").write_text("# 正常页", encoding="utf-8")

            md_files = list(repo.iter_md(self.root))
            relative_paths = [repo.rel(self.root, p) for p in md_files]
            self.assertIn("系统/normal.md", relative_paths)
            self.assertNotIn(".wiki/skills/SKILL.md", relative_paths)
            self.assertNotIn(".wiki/README.md", relative_paths)

            dirs = [repo.rel(self.root, p) for p in repo.iter_dirs(self.root)]
            self.assertNotIn(".wiki/skills", dirs)
        finally:
            shutil.rmtree(outside)


if __name__ == "__main__":
    unittest.main(verbosity=2)
