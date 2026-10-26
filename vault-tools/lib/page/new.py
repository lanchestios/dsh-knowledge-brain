"""wiki page new —— 建沉淀页，父节点还是平铺 md 时先 grow。"""

from pathlib import Path

from core import links
from core import repo
from core import pagefile


def _ensure_parent_is_folder(root, parent: Path, out) -> Path:
    """父节点若还是平铺 md，先自动升级成文件夹。"""
    if parent.is_dir():
        return parent
    flat = parent.with_suffix(".md")
    if flat.is_file():
        from page import restructure
        restructure.grow(root, flat, out)
        return parent
    if not parent.parent.exists():
        _ensure_parent_is_folder(root, parent.parent, out)
    parent.mkdir(parents=True, exist_ok=True)
    out.info(f"新建文件夹 {repo.rel(root, parent)}/")
    return parent


def new_node(root: Path, path_arg: str, title: str, tags=None, by=None) -> int:
    out = repo.Out()
    before = links.Index(root)
    by = repo.actor(root, by)
    target = (root / path_arg).resolve()
    if str(target).endswith(".md"):
        target = Path(str(target)[:-3])
    name = target.name

    if target.is_dir():                       # 已是文件夹节点 → 写 index
        page = repo.index_of(target)
    else:
        _ensure_parent_is_folder(root, target.parent, out)
        page = target.with_suffix(".md")      # 还没长大 → 平铺

    if page.exists():
        out.err(f"已存在：{repo.rel(root, page)}")
        return 1
    pagefile.write_page(page, title or name, tags=tags, by=by)
    out.ok(f"新建 {repo.rel(root, page)}（generated.by = {by}）")
    pagefile.sync_folders(root, [page], out)
    for p in links.rewrite_after(root, before):
        out.info(f"改双链 {repo.rel(root, p)}（与新页重名，改成路径形式）")
    return 0
