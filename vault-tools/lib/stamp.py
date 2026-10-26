"""wiki stamp —— 刷新改过的 md 的 updated 与 generated.at。"""

from pathlib import Path

from core import frontmatter as fm
from core import repo


# 这几个字段的变动不算「内容变了」：updated 是 stamp 自己刷的，
# generated / verified 是元数据。verify 写 verified 要改文件，那不算内容变更。
_VOLATILE = ("updated", "generated", "verified")


def _signature(text: str):
    """一个页的内容指纹：正文 + 除易变字段外的 frontmatter。"""
    lines = text.split("\n")
    if not lines or lines[0].strip() != fm.DELIM:
        return text
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == fm.DELIM)
    except StopIteration:
        return text
    kept, i = [], 1
    while i < end:
        key = lines[i].split(":", 1)[0].strip()
        if key in _VOLATILE:
            i += 1
            while i < end and lines[i].lstrip().startswith("-"):
                i += 1
            continue
        kept.append(lines[i])
        i += 1
    return "\n".join(kept + lines[end:])


def _content_changed(root: Path, rel_path: str, text: str) -> bool:
    """和 HEAD 里的版本比，正文或实质字段变了没。取不到版本就当变了。"""
    res = repo.git(root, "show", f"HEAD:{rel_path}", check=False)
    if res.returncode != 0:
        return True
    return _signature(res.stdout) != _signature(text)


def stamp(root: Path, all_files=False, by=None) -> int:
    """刷新改动过的 md：updated 刷成今天，generated.at 推到此刻。

    generated.at 记的是「内容最后写于何时」，仅此而已——它不参与任何判定，
    也不影响已有的确认记录。**默认不动 generated.by**——stamp 多半是 pre-commit 钩子在跑，钩子
    不知道刚才是谁在编辑，改归属只会张冠李戴。别人重写了一页，让他自己
    带 --by。
    """
    out = repo.Out()
    if all_files:
        targets = [p for p in repo.iter_md(root)]
    else:
        res = repo.git(root, "diff", "--cached", "--name-only", "--diff-filter=ACM", check=False)
        targets = [root / line for line in res.stdout.splitlines() if line.endswith(".md")]
    n = 0
    for p in targets:
        r = repo.rel(root, p)
        if not p.exists() or not repo.needs_frontmatter(r):
            continue
        content_changed = _content_changed(root, r, p.read_text(encoding="utf-8"))
        touched = fm.set_scalar(p, "updated", repo.today()) if content_changed else False
        page = fm.parse(p)
        if content_changed and page is not None and page.generated:
            g = dict(page.generated)
            g["at"] = repo.now_iso()
            if by:
                g["by"] = by
            touched = fm.set_scalar(p, "generated", fm._render_mapping(g)) or touched
        if touched:
            out.ok(f"刷新 {r}")
            repo.git(root, "add", r, check=False)
            n += 1
    if n == 0:
        out.info("没有需要刷新的文件")
    return 0
