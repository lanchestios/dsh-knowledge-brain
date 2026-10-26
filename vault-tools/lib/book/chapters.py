"""wiki book cut / sync —— 章节文件与进度页章节清单。

cut：PDF 转出的「1 全文.md」按 `<!-- PDF 第 N 页 -->` 切成章（页号由 agent 看目录页定）。
sync：按 章节/<号> <标题>.md 重写「## 章节进度」，保留已勾。行格式与 src/actions.ts 的 syncChapterIndex 一致。
"""

import re
import unicodedata
from pathlib import Path

from book.split import WHOLE_NAME, chapter_filename
from core import repo

PROGRESS_SECTION = "章节进度"
WHOLE = WHOLE_NAME
MARK = re.compile(r"^<!--\s*PDF 第 (\d+) 页\s*-->\s*$", re.M)
GROUP = re.compile(rf"^###\s+({repo.CHAPTER_ID})(?=\s|$).*$", re.M)   # 分组行：### <父号> [标题]


def _index(root, name):
    name, d = repo.book_dir(root, name)
    idx = repo.index_of(d)
    return name, d, idx if idx.is_file() else None


def sync(root: Path, name: str, keep_read: bool = True) -> int:
    """按 章节/<号> <标题>.md 重写「## 章节进度」：叶子按号数字排序；已有的 `### <父号> …` 分组行原样保留，
    缺的补 `### <父号>`。keep_read=False：所有章写成未勾（cut 切出的是新章，原来全文的勾不算数）。"""
    out = repo.Out()
    name, d, idx = _index(root, name)
    if idx is None:
        out.err(f"没有这本书：{repo.rel(root, d)}/")
        return 1
    text = idx.read_text(encoding="utf-8")
    head = re.search(rf"^## {PROGRESS_SECTION}\s*$", text, re.M)
    if not head:
        out.err(f"{name} 进度页缺少「## {PROGRESS_SECTION}」")
        return 1
    nxt = re.search(r"^## ", text[head.end():], re.M)
    end = head.end() + nxt.start() if nxt else len(text)
    sec = text[head.end():end]
    read = {m.group(2): m.group(1).lower() == "x" for m in repo.CHECK_ROW.finditer(sec)} if keep_read else {}
    groups = {m.group(1): m.group(0).rstrip() for m in GROUP.finditer(sec)}
    leaves = []
    for p in (d / "章节").glob("*.md"):
        f = unicodedata.normalize("NFC", p.name)
        got = repo.parse_chapter_file(f)
        if got:
            leaves.append((got[0], got[1], f))
    if not leaves:
        out.err(f"{name}：章节/ 下没有 <号> <标题>.md")
        return 1
    rows, last = [], object()
    for cid, title, f in sorted(leaves, key=lambda x: repo.chapter_key(x[0])):
        parent = repo.chapter_parent(cid)
        if parent is not None and parent != last:
            rows.append(groups.get(parent, f"### {parent}"))
        last = parent
        rows.append(f"- [{'x' if read.get(cid) else ' '}] {cid} {title} → `章节/{f}`")
    new = text[:head.start()] + f"## {PROGRESS_SECTION}\n\n" + "\n".join(rows) + "\n\n" + text[end:].lstrip("\n")
    idx.write_text(new.rstrip("\n") + "\n", encoding="utf-8")
    out.ok(f"{name} 章节清单 {len(leaves)} 章")
    return 0


def cut(root: Path, name: str, specs: list) -> int:
    out = repo.Out()
    name, d, idx = _index(root, name)
    if idx is None:
        out.err(f"没有这本书：{repo.rel(root, d)}/")
        return 1
    whole = d / "章节" / WHOLE
    if not whole.is_file():
        out.err(f"{name}：没有 章节/{WHOLE}（只切 PDF 转出的全文）")
        return 1
    # 写盘前把能预见的失败都挡掉：写到一半、删了全文再失败，书就卡在半改状态
    others = sorted(n for n in (unicodedata.normalize("NFC", p.name) for p in (d / "章节").glob("*.md"))
                    if n != WHOLE and repo.parse_chapter_file(n))
    if others:
        out.err(f"{name}：章节/ 里已有别的章节文件（{'、'.join(others)}），cut 只切单个全文；先确认再删")
        return 1
    if not re.search(rf"^## {PROGRESS_SECTION}\s*$", idx.read_text(encoding="utf-8"), re.M):
        out.err(f"{name} 进度页缺少「## {PROGRESS_SECTION}」，cut 后没法同步清单——先补上这一节")
        return 1
    parts = []
    for s in specs:
        page, _, title = s.partition(":")
        if not page.isdigit() or not title.strip():
            out.err(f"章节写成 <起始页>:<标题> —— {s}")
            return 1
        parts.append((int(page), title.strip()))
    if any(b[0] <= a[0] for a, b in zip(parts, parts[1:])):
        out.err("起始页必须严格递增")
        return 1
    # 切出的章若恰好叫「1 全文.md」，后面 whole.unlink() 会把刚写的章删掉
    if any(chapter_filename(i, t) == WHOLE for i, (_, t) in enumerate(parts, 1)):
        out.err("第一章别叫「全文」")
        return 1
    text = whole.read_text(encoding="utf-8")
    marks = [(int(m.group(1)), m.start()) for m in MARK.finditer(text)]

    def at(page):
        """页号 ≥ page 的第一个页标记的位置（空页没写标记，往后找）。"""
        return next((pos for n, pos in marks if n >= page), None)

    starts = [at(p) for p, _ in parts]
    if None in starts:
        out.err(f"找不到第 {parts[starts.index(None)][0]} 页及以后的页标记")
        return 1
    # 请求页递增不等于落点递增：中间是空页时两章会落到同一个页标记上，前一章就空了
    for (pa, _), (pb, _), a, b in zip(parts, parts[1:], starts, starts[1:]):
        if b <= a:
            out.err(f"第 {pa} 页与第 {pb} 页落在同一页标记上（中间是空页），合并成一章或改起始页")
            return 1
    front = re.sub(r"\A#[^\n]*\n", "", text[:starts[0]]).strip()
    if front:
        (d / "章节" / "00-前页.md").write_text(f"# 前页\n\n{front}\n", encoding="utf-8")
    for i, ((_, title), s) in enumerate(zip(parts, starts), 1):
        e = starts[i] if i < len(starts) else len(text)
        body = text[s:e].strip()
        (d / "章节" / chapter_filename(i, title)).write_text(f"# {title}\n\n{body}\n", encoding="utf-8")
    whole.unlink()
    out.ok(f"{name} 切成 {len(parts)} 章")
    return sync(root, name, keep_read=False)
