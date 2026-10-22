"""wiki tree —— 打印目录树，--write 写回 README。

树只列五个沉淀区的内容页：raw/ 与 asset/ 不进树——素材的入口是 wiki document
list / book list，附件由正文引用；.folder.json 是排序元数据、库根白名单文件
（README、skills-lock）是库设施，也不进——树只画内容，不画设施与素材（改前
实测 2325 行，六成在列素材）。
"""

import re
from pathlib import Path

from core import repo


TREE_START = "<!-- wiki:tree:start -->"


TREE_END = "<!-- wiki:tree:end -->"

# 不进树的顶层区
TREE_EXCLUDE = (repo.RAW, repo.ASSET)

# 不进树的文件：前两个是系统杂物，.folder.json 是排序元数据
TREE_HIDDEN_FILES = {".DS_Store", ".gitkeep", ".folder.json"}


def _render_tree(root: Path) -> str:
    lines = ["Wiki/"]

    def shown(x: Path) -> bool:
        rel = repo.rel(root, x)
        return (x.name not in TREE_HIDDEN_FILES
                and repo.in_scope(rel)
                and rel not in repo.TOP_ALLOW_FILES
                and rel.split("/", 1)[0] not in TREE_EXCLUDE)

    def walk(d: Path, pre=""):
        entries = [x for x in d.iterdir() if shown(x)]
        entries.sort(key=lambda x: (not x.is_dir(), x.name))
        for i, e in enumerate(entries):
            last = i == len(entries) - 1
            branch = pre + ("└─ " if last else "├─ ")
            lines.append(branch + e.name + ("/" if e.is_dir() else ""))
            if e.is_dir():
                walk(e, pre + ("   " if last else "│  "))

    walk(root)
    return "\n".join(lines)


def tree(root: Path, write=False) -> int:
    out = repo.Out()
    body = _render_tree(root)
    if not write:
        print(body)
        return 0
    readme = root / "README.md"
    text = readme.read_text(encoding="utf-8")
    if TREE_START not in text or TREE_END not in text:
        out.err(f"README.md 里找不到标记 {TREE_START} / {TREE_END}")
        return 1
    new = re.sub(rf"{re.escape(TREE_START)}.*?{re.escape(TREE_END)}",
                 f"{TREE_START}\n```\n{body}\n```\n{TREE_END}", text, flags=re.S)
    if new == text:
        out.info("目录树无变化")
        return 0
    readme.write_text(new, encoding="utf-8")
    out.ok("已把目录树写回 README.md")
    return 0
