"""wiki page tags / orphans / unverified —— 沉淀页的只读列表。"""

from collections import defaultdict
from pathlib import Path

from core import frontmatter as fm
from core import links
from core import repo


def _pages(root):
    for _r, _p, page in repo.pages(root):
        yield page


def tags(root: Path, name=None) -> int:
    out = repo.Out()
    index = defaultdict(list)
    for page in _pages(root):
        for t in page.tags:
            index[t].append((repo.rel(root, page.path), page.description))
    if not index:
        out.info("还没有任何标签")
        return 0
    if name:
        hits = index.get(name)
        if not hits:
            out.err(f"没有标签 {name}")
            return 1
        print(f"# {name}（{len(hits)} 页）\n")
        w = max(repo.width(r) for r, _ in hits)
        for r, d in sorted(hits):
            print(f"  {repo.pad(r, w)}  {d}" if d else f"  {r}")
        return 0
    print(f"# 全部标签（{len(index)} 个）\n")
    for t, ps in sorted(index.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        print(f"  {len(ps):>3}  {t}")
    return 0


def orphans(root: Path) -> int:
    """没人链、也没有 source 的页面。index 页不算孤儿（它们靠目录树定位）。"""
    out = repo.Out()
    ix = links.Index(root)
    linked = set()
    for p in links.deposit_pages(root):
        for target, _a, _l in links.links_in(links.split_fm(p.read_text(encoding="utf-8"))[1]):
            state, key = ix.resolve(target)
            if state == "ok":
                linked.add(key)
    found = []
    for page in _pages(root):
        if repo.is_folder_page(page.path) or not repo.in_deposit(repo.rel(root, page.path)):
            continue
        if links.node_path(root, page.path) not in linked and not page.sources:
            found.append(repo.rel(root, page.path))
    if not found:
        out.ok("没有孤儿页")
        return 0
    print(f"# 孤儿页：没人链接、也没有 source（{len(found)} 个）\n")
    for r in found:
        print(f"  {r}")
    return 0


def unverified(root: Path) -> int:
    """列出还没被人工确认过的沉淀页——信任层级由 verified 推导，不存储。"""
    rows = []
    for p in repo.iter_md(root):
        r = repo.rel(root, p)
        if not repo.in_deposit(r):
            continue
        page = fm.parse(p)
        if page is None:
            continue
        tier = repo.trust_tier(page.verified)
        if tier == "人工确认":
            continue
        rows.append((r, tier, page.generated.get("by", "（未记）"),
                     page.generated.get("at", "")))
    if not rows:
        print("沉淀区全部经过人工确认。")
        return 0
    w = max(repo.width(r) for r, *_ in rows)
    wt = max(repo.width(t) for _, t, *_ in rows)
    print(f"待确认（{len(rows)}）\n")
    for r, tier, by, at in rows:
        print(f"  {repo.pad(r, w)}  {repo.pad(tier, wt)}  {by}  {at}")
    print("\n确认一页： wiki page verify <路径>")
    return 0
