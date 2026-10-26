"""残留守卫：仓库里（代码、技能、文档、种子）一处旧命令名都不许有——一次切换、不留兼容，
漏改一处就是一个照着敲会得到「未知动作」的坑。测试目录自己不扫（这里的正则就写着旧名）。

跑： python3 vault-tools/tests/test_no_old_names.py
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCAN = ["vault-tools/lib", "vault-tools/bin", "vault-tools/skills", "vault-tools/hooks",
        "vault-tools/seeds", "vault-tools/README.md", "README.md", "src", "locale"]
SUFFIXES = {"", ".py", ".md", ".ts", ".tsx", ".js", ".mjs", ".json", ".yml", ".yaml"}
OLD = re.compile(
    r"wiki (new( (node|book|domain|skeleton))?|list (tags|books|raw|orphans|unverified)"
    r"|add|fetch|fidelity|grow|shrink|move|read|deposit|split-book|anchor|verify|mark|cover|observe|distill"
    r"|fix-folders)(?![A-Za-z0-9_-])"
    r"|fix-folders|split-book|--fix\b"
    # 反引号里裸写的旧子命令（没带 wiki 前缀，上面抓不到）：`mark stable`、`new node 认知/见解`……
    r"|`(add|fetch|grow|shrink|move|mark|verify|anchor|cover|fidelity|observe|distill|read|deposit"
    r"|new (node|book|domain|skeleton)|list [a-z]+)( [^`]*)?`")
# 文档里不许再说 .folder.json 是「自动维护」的：插件已不补，只有 page 命令维护
# 书进度页旧名：一处都不许有（升级脚本已清理）
INDEX_OLD = re.compile(r"\.index\.md|INDEX_SUFFIX")
INDEX_ALLOW = set()
STALE = re.compile(r"工具自动维护|插件.{0,12}(会|也会)补齐|开库前.{0,6}补齐")


def files():
    for s in SCAN:
        p = REPO / s
        if p.is_file():
            yield p
        elif p.is_dir():                                   # 发布包里没有 src/ 等：不在就跳过
            for f in sorted(p.rglob("*")):
                if f.is_file() and "__pycache__" not in f.parts and f.suffix in SUFFIXES:
                    yield f


class TestNoOldNames(unittest.TestCase):
    def test_没有旧命令名(self):
        hits = []
        for f in files():
            try:
                text = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                for m in OLD.finditer(line):
                    hits.append(f"{f.relative_to(REPO)}:{i}: {m.group(0)}")
                if str(f.relative_to(REPO)) not in INDEX_ALLOW:
                    for m in INDEX_OLD.finditer(line):
                        hits.append(f"{f.relative_to(REPO)}:{i}: {m.group(0)}")
                if f.suffix == ".md":
                    for m in STALE.finditer(line):
                        hits.append(f"{f.relative_to(REPO)}:{i}: {m.group(0)}")
        self.assertEqual(hits, [], "\n" + "\n".join(hits))


if __name__ == "__main__":
    unittest.main()
