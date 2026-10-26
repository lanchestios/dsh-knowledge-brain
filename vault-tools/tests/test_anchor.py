"""锚点校验：token 抽取、豁免、基线硬失败。

跑： python3 vault-tools/tests/test_anchor.py
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from page import anchor  # noqa: E402


def git_init(d: Path, files: dict):
    """建一个带一次提交的 git 仓，返回那次提交的 sha。"""
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=d, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=d, check=True)
    for name, body in files.items():
        f = d / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "commit", "-qm", "x"], cwd=d, check=True)
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=d,
                          capture_output=True, text=True, check=True).stdout.strip()


class TestTokens(unittest.TestCase):
    """只挑像标识符的，其余一概不查——漏检是有意的，误检才是坏的。"""

    def test_认四种形状(self):
        got = anchor.tokens("`MetricType` `PREV_PERIOD` `query_metric` `src/agents/x.py`")
        self.assertEqual(got, {"MetricType", "PREV_PERIOD", "query_metric",
                               "src/agents/x.py"})

    def test_认带后缀的类名(self):
        self.assertIn("AtomicMetricExecutor.java",
                      anchor.tokens("`AtomicMetricExecutor.java`"))

    def test_不认单个小写词(self):
        """atomic、dataware 这种太容易和散文里的普通词撞上。"""
        self.assertEqual(anchor.tokens("`atomic` `dataware` `current`"), set())

    def test_不认带空格的命令(self):
        self.assertEqual(anchor.tokens("`wiki grow` `git log` `mvn clean package`"), set())

    def test_跳过代码块(self):
        """代码块里是示例，不是断言。"""
        text = "正文 `RealThing`\n\n```\n`FakeThing`\n```\n"
        self.assertEqual(anchor.tokens(text), {"RealThing"})

    def test_代码块未闭合时不吞掉后面的正文(self):
        text = "```\n`InFence`\n"
        self.assertEqual(anchor.tokens(text), set())


class TestExemptions(unittest.TestCase):
    def test_带理由的豁免算数(self):
        got = anchor.exemptions("<!-- 锚点豁免: GoneClass —— 该类已在下个版本删除 -->")
        self.assertEqual(got, {"GoneClass"})

    def test_没写理由的豁免不算数(self):
        self.assertEqual(anchor.exemptions("<!-- 锚点豁免: GoneClass -->"), set())
        self.assertEqual(anchor.exemptions("<!-- 锚点豁免: GoneClass —— -->"), set())


class TestRepoScoping(unittest.TestCase):
    def test_按路径前缀取基线(self):
        sec = {"工作/A": [("a", Path("/a"), "1")], "工作/B": [("b", Path("/b"), "2")]}
        self.assertEqual([x[0] for x in anchor.repos_for(sec, "工作/A/x.md")], ["a"])
        self.assertEqual(anchor.repos_for(sec, "工作/C/x.md"), [])

    def test_前缀不做半个目录名的匹配(self):
        """工作/A 不该覆盖 工作/AB —— 否则两个域会互相当命中源。"""
        sec = {"工作/A": [("a", Path("/a"), "1")]}
        self.assertEqual(anchor.repos_for(sec, "工作/AB/x.md"), [])


class TestRun(unittest.TestCase):
    """端到端：真建仓、真跑 git grep。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.code = self.tmp / "code"
        self.sha = git_init(self.code, {"Main.java": "class MetricType {}\n"})
        self.root = self.tmp / "wiki"
        git_init(self.root, {"README.md": "x\n"})
        (self.root / ".wiki").mkdir(exist_ok=True)
        self.page = self.root / "工作" / "D" / "p.md"
        self.page.parent.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def conf(self, path=None, sha=None):
        (self.root / anchor.CONF).write_text(
            f"[工作/D]\ncode {path or self.code} {sha or self.sha}\n", encoding="utf-8")

    def test_查得到就通过(self):
        self.conf()
        self.page.write_text("用了 `MetricType`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 0)

    def test_查不到就失败(self):
        self.conf()
        self.page.write_text("用了 `MadeUpClass`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)

    def test_带理由的豁免能放行(self):
        self.conf()
        self.page.write_text("`MadeUpClass`\n<!-- 锚点豁免: MadeUpClass —— 尚未合并 -->\n",
                             encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 0)

    def test_没理由的豁免放行不了(self):
        self.conf()
        self.page.write_text("`MadeUpClass`\n<!-- 锚点豁免: MadeUpClass -->\n",
                             encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)

    def test_本仓库自己的路径算命中(self):
        self.conf()
        self.page.write_text("见 `工作/D/p.md`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 0)

    def test_基线仓不存在时硬失败(self):
        """最坏的失败模式是「什么都没查却说全部通过」，所以这里必须非零退出。"""
        self.conf(path=self.tmp / "nope")
        self.page.write_text("`MetricType`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)

    def test_基线_commit_不存在时硬失败(self):
        self.conf(sha="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
        self.page.write_text("`MetricType`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)

    def test_缺配置文件时报错而不是放行(self):
        self.page.write_text("`MadeUpClass`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)

    def test_一页都没查时不许报通过(self):
        """给的页全不在配置段落下 → 非零退出。

        「什么都没查却说全部通过」比查出问题坏得多——它会让人以为核过了。
        """
        self.conf()
        other = self.root / "工作" / "E" / "q.md"
        other.parent.mkdir(parents=True)
        other.write_text("`MadeUpClass`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/E"]), 1)

    def test_部分页跳过不影响其余页的校验(self):
        self.conf()
        self.page.write_text("`MetricType`\n", encoding="utf-8")
        other = self.root / "工作" / "E" / "q.md"
        other.parent.mkdir(parents=True)
        other.write_text("`MadeUpClass`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D", "工作/E"]), 0)

    def test_配置格式不对时报错(self):
        (self.root / anchor.CONF).write_text("code /x\n", encoding="utf-8")
        self.page.write_text("`MetricType`\n", encoding="utf-8")
        self.assertEqual(anchor.run(self.root, ["工作/D"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
