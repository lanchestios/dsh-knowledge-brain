"""wiki book read —— 勾选一章，全勾完置「读完」。"""

import re
from pathlib import Path

from core import frontmatter as fm
from core import repo


def read(root: Path, book_name: str, chapter: str) -> int:
    """勾选一章；全勾完自动把 progress 改成「读完」。"""
    out = repo.Out()
    book_name, d = repo.book_dir(root, book_name)
    idx = repo.index_of(d)
    if not idx.exists():
        out.err(f"没有这本书：{repo.rel(root, d)}/")
        return 1
    if not repo.book_readable(idx):
        out.err(f"{book_name} 还不可读（material_status 不是 readable）——先走 wiki-write-book-ingest 把书整理完")
        return 1

    if not re.fullmatch(repo.CHAPTER_ID, chapter):
        out.err(f"章节号写成 1 / 1.1 / 1.1.1（给的是 {chapter}）")
        return 1

    text = idx.read_text(encoding="utf-8")
    pat = re.compile(rf"^(\s*-\s*\[)( )(\]\s*{re.escape(chapter)}{repo.ID_END}.*)$", re.M)
    new, n = pat.subn(lambda m: m.group(1) + "x" + m.group(3), text)
    if n == 0:
        if re.search(rf"^\s*-\s*\[x\]\s*{re.escape(chapter)}{repo.ID_END}", text, re.M | re.I):
            out.info(f"{chapter} 早已勾选")
            return 0
        out.err(f"进度清单里没有 {chapter}")
        return 1
    idx.write_text(new, encoding="utf-8")
    out.ok(f"{book_name} 勾选 {chapter}")

    done = len(re.findall(r"^\s*-\s*\[x\]", new, re.M | re.I))
    total = len(re.findall(r"^\s*-\s*\[[ x]\]", new, re.M | re.I))
    progress = repo.PROGRESS_DONE if done == total and total else repo.PROGRESS_READING
    if fm.set_scalar(idx, "progress", progress):
        out.ok(f"progress → {progress}")
    fm.set_scalar(idx, "updated", repo.today())
    out.info(f"进度 {done}/{total}")
    return 0
