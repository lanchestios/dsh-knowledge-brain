"""wiki book list —— 列书与读、沉淀进度。"""

import re
from pathlib import Path

from core import frontmatter as fm
from core import repo


def books(root: Path) -> int:
    out = repo.Out()
    b = root / repo.RAW / "book"
    if not b.is_dir():
        out.info("还没有书")
        return 0
    rows = []
    for d in sorted(x for x in b.iterdir() if x.is_dir()):
        page = fm.parse(repo.index_of(d))
        if not page:
            out.err(f"缺进度页：{repo.rel(root, d)}/")
            continue
        done = len(re.findall(r"^\s*-\s*\[x\]", page.body, re.M | re.I))
        total = len(re.findall(r"^\s*-\s*\[[ x]\]", page.body, re.M | re.I))
        sec = re.search(rf"^## {re.escape(repo.DEPOSIT_SECTION)}\s*$(.*?)(?=^## |\Z)", page.body, re.M | re.S)
        items = re.findall(rf"^- {repo.CHAPTER_ID}{repo.ID_END}.*$", sec.group(1), re.M) if sec else []
        going = sum(1 for x in items if repo.DEPOSITING_MARK in x)
        rows.append((d.name, str(page.fields.get("progress", "?")), f"{done}/{total}", f"沉淀中 {going} · 完成 {len(items) - going}"))
    if not rows:
        out.info("还没有书")
        return 0
    w = max(repo.width(r[0]) for r in rows)
    sw = max(repo.width(r[1]) for r in rows)
    for name, progress, prog, notes in rows:
        print(f"  {repo.pad(name, w)}  {repo.pad(progress, sw)}  {prog:>7}  {notes}")
    return 0
