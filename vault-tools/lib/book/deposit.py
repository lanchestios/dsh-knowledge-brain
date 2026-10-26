"""wiki book deposit —— 在进度页「知识沉淀」登记一章。"""

import re
from pathlib import Path

from core import frontmatter as fm
from core import repo


def deposit(root: Path, book_name: str, chapter: str, done: bool = False) -> int:
    """知识沉淀：在进度页「## 知识沉淀」登记一章。

    不带 --done：这一章开始沉淀，登记 `- <号> <标题> · 沉淀中`（须先在章节清单里勾了已读）。
    带 --done：去掉「· 沉淀中」，这一章沉淀完成——只由人标，理由同 cover 的「完成」：
    标了完成的章就不再出现在待办里，误标了待办就静默消失。
    沉淀出的页由写页的人 / 智能体在条目下用 [[页名]] 登记，本命令不碰。
    """
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
    item = re.search(rf"^\s*-\s*\[([ xX])\]\s*({re.escape(chapter)}{repo.ID_END}.*?)(?:\s*→.*)?$", text, re.M)
    if not item:
        out.err(f"进度清单里没有 {chapter}")
        return 1
    if item.group(1) == " ":
        out.err(f"{chapter} 还没读完——先 wiki book read {book_name} {chapter}")
        return 1
    title = item.group(2).strip()

    head = re.search(rf"^## {re.escape(repo.DEPOSIT_SECTION)}\s*$", text, re.M)
    if not head:
        text = text.rstrip("\n") + f"\n\n## {repo.DEPOSIT_SECTION}\n\n"
        head = re.search(rf"^## {re.escape(repo.DEPOSIT_SECTION)}\s*$", text, re.M)
    nxt = re.search(r"^## ", text[head.end():], re.M)
    s0, s1 = head.end(), head.end() + (nxt.start() if nxt else len(text) - head.end())
    sec = text[s0:s1]
    entry = re.search(rf"^- {re.escape(chapter)}{repo.ID_END}.*$", sec, re.M)
    mark = re.compile(rf"\s*·\s*{re.escape(repo.DEPOSITING_MARK)}")

    if done:
        who = repo.actor(root)
        if not who.startswith("human:"):
            out.err(f"「沉淀完成」只由人标（当前身份 {who}）——在自己的终端跑这条命令")
            return 1
        if not entry:
            out.err(f"{chapter} 还没开始沉淀——先 wiki book deposit {book_name} {chapter}")
            return 1
        if not mark.search(entry.group(0)):
            out.info(f"{chapter} 早已沉淀完成")
            return 0
        sec = sec[:entry.start()] + mark.sub("", entry.group(0), count=1) + sec[entry.end():]
        msg = f"{book_name} {chapter} 沉淀完成"
    else:
        if entry:
            out.info(f"{chapter} {'正在沉淀' if mark.search(entry.group(0)) else '早已沉淀完成'}")
            return 0
        line = f"- {title} · {repo.DEPOSITING_MARK}"
        if re.search(r"^- （暂无）\s*$", sec, re.M):
            sec = re.sub(r"^- （暂无）\s*$", line, sec, count=1, flags=re.M)
        else:
            sec = sec.rstrip("\n") + f"\n{line}\n" + ("\n" if nxt else "")
        msg = f"{book_name} {chapter} 开始沉淀"
    idx.write_text(text[:s0] + sec + text[s1:], encoding="utf-8")
    fm.set_scalar(idx, "updated", repo.today())
    out.ok(msg)
    return 0
