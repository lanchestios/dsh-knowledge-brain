"""wiki page mark —— 改一页的 status。"""

from pathlib import Path

from core import frontmatter as fm
from core import repo


def mark(root: Path, path_arg: str, value: str) -> int:
    """改一页的 status。只碰 status——确认状态在 verified，两者不互相代表。"""
    out = repo.Out()
    problem = repo.status_problem(value)
    if problem:
        out.err(problem)
        return 1
    target = repo.node_page(Path(path_arg).resolve())
    if not target.is_file():
        out.err(f"找不到：{path_arg}")
        return 1
    if fm.set_scalar(target, "status", value):
        out.ok(f"{repo.rel(root, target)} → {value}")
    else:
        out.info(f"{repo.rel(root, target)} 已经是 {value}")
    return 0
