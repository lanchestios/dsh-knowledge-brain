"""wiki page verify —— 人工确认一页，往 verified 追加一条事件。"""

from pathlib import Path

from core import frontmatter as fm
from core import repo


def verify(root: Path, path_arg: str, by=None) -> int:
    """确认一页：往 verified 追加一条事件，不覆盖历史。"""
    out = repo.Out()
    target = repo.node_page(Path(path_arg).resolve())
    if not target.is_file():
        out.err(f"找不到：{path_arg}")
        return 1
    page = fm.parse(target)
    who = repo.actor(root, by)
    at = repo.now_iso()
    if not fm.append_verified(target, who, at):
        out.err(f"读不出 frontmatter：{path_arg}")
        return 1
    out.ok(f"{repo.rel(root, target)} 已确认（{who} · {at}）")
    return 0
