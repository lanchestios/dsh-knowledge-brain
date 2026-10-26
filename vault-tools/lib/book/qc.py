"""wiki book qc —— 书级质检：写 readable 之前必过（wiki book status 当场调），之后改章节要重跑。

只读。开库 wiki check 不碰 raw/，书的章节质量只在这里把关。
"""

import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote

from book.split import WHOLE_NAME
from check import check
from core import frontmatter as fm
from core import repo

LOG_SECTION = "整理记录"
LOG_ROW = re.compile(rf"^\s*-\s*({repo.CHAPTER_ID}){repo.ID_END}(.*)$")
# 路径：尖括号形式可含空格（<images/a b.png>），裸路径不含空白，两组取命中的那个；title 认 "…" / '…' / (…)
IMAGE = re.compile(r"!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))"
                   r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)")
REMOTE = re.compile(r"^(?:[A-Za-z][A-Za-z0-9+.-]*:|//)")   # http: / data: / HTTP: / 协议相对，都不是本地文件
GARBLE = re.compile("[\ufffd\ue000-\uf8ff]")   # 替换符 + 私有区（PDF 字体映射丢失的典型残留）
PAGE_MARK = re.compile(r"<!--\s*PDF 第 \d+ 页\s*-->")


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _key(p: Path) -> str:
    """路径比对用 NFC：md 里多是 NFC，macOS 盘上文件名可能是 NFD，APFS 查找不分但字符串比较分。"""
    return unicodedata.normalize("NFC", str(p))


def _section(text: str, title: str) -> str:
    m = re.search(rf"^## {re.escape(title)}\s*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    n = re.search(r"^## ", rest, re.M)
    return rest[: n.start()] if n else rest


def problems(root: Path, name: str) -> list:
    name, d = repo.book_dir(root, name)
    idx = repo.index_of(d)
    page = fm.parse(idx) if idx.is_file() else None
    if page is None:
        return [f"没有这本书：{repo.rel(root, d)}/"]
    text = idx.read_text(encoding="utf-8")
    cdir = d / "章节"
    mds = sorted(p for p in cdir.glob("*.md")) if cdir.is_dir() else []
    seen = {}
    for p in mds:
        got = repo.parse_chapter_file(p.name)
        if got:
            seen.setdefault(got[0], []).append(_nfc(p.name))
    if not seen:
        return [f"{name}：章节/ 下没有 <号> <标题>.md"]
    leaves = sorted(seen, key=repo.chapter_key)
    out = []
    for cid in leaves:
        if len(seen[cid]) > 1:
            out.append(f"章号重复：{cid} 有 {'、'.join(sorted(seen[cid]))}——改名成不同章号再 wiki book sync {name}")
        kids = [k for k in leaves if k.startswith(cid + ".")]
        if kids:
            out.append(f"章节号冲突：{cid} 既是一章又是 {kids[0]} 的上级——一个号只能是叶子或分组之一")
    # split 对 PDF 只出「1 全文.md」；cut 拒绝产出这个名字，epub / 扫描版也不会有，所以它在就是没切章
    if any(_nfc(p.name) == WHOLE_NAME for p in mds):
        out.append(f"PDF 还没切章（章节/ 里是 {WHOLE_NAME}）——先 wiki book cut {name}")
    old = cdir / "images"
    if old.is_dir() and any(f.is_file() and not f.name.startswith(".") for f in old.iterdir()):
        out.append(f"书图还在 章节/images/——先 wiki book images {name}")

    listed = {m.group(2) for m in repo.CHECK_ROW.finditer(text)}
    for cid in leaves:
        if cid not in listed:
            out.append(f"章节清单缺 {cid}（章节/ 里有文件）——跑 wiki book sync {name}")
    for cid in sorted(listed - set(leaves), key=repo.chapter_key):
        out.append(f"章节清单的 {cid} 在 章节/ 里没有文件——跑 wiki book sync {name}")

    log, rows = {}, {}
    for line in _section(text, LOG_SECTION).splitlines():
        m = LOG_ROW.match(line)
        if m:
            log[m.group(1)] = m.group(2)
            rows[m.group(1)] = rows.get(m.group(1), 0) + 1
    for cid, n in sorted(rows.items(), key=lambda x: repo.chapter_key(x[0])):
        if n > 1:
            out.append(f"整理记录：{cid} 不止一行（{n} 行）——合成一行，补图与梳理写在同一行")
    for cid in leaves:
        row = log.get(cid, "")
        for step in ("补图", "梳理"):
            if f"{step} ✓" not in row:
                out.append(f"整理记录：{cid} 没有「{step} ✓」")

    used = set()
    for p in mds:
        r = repo.rel(root, p)
        body = p.read_text(encoding="utf-8")
        for i, line in enumerate(body.splitlines(), 1):
            if GARBLE.search(line):
                out.append(f"乱码字符残留 —— {r}:{i}")
            if PAGE_MARK.search(line):
                out.append(f"PDF 页标记残留（梳理完应删）—— {r}:{i}")
        for a, b in IMAGE.findall(body):
            src = a or b
            if REMOTE.match(src):
                continue
            if src.startswith("/"):
                out.append(f"图片路径别以 / 开头：书图在 raw/book/{name}/images/，章节从 ../images/… 引用 —— {r} → {src}")
                continue
            # 书图随书走（raw/book/<书名>/images/），章节从 ../images/… 相对引用；
            # 仓库根 asset/、raw/ 前缀也认（历史写法与跨书引用），其余相对章节文件解析
            rooted = src.startswith(f"{repo.ASSET}/") or src.startswith(f"{repo.RAW}/")
            target = ((root if rooted else p.parent) / unquote(src)).resolve()
            if target.is_file():
                used.add(_key(target))
            else:
                out.append(f"图片不存在 —— {r} → {src}")
    created = str(page.fields.get("created", "")).strip('"\'')
    if not repo.is_iso_date(created):
        out.append(f"进度页的 created 不是 YYYY-MM-DD —— {created or '（没写）'}")
    img = repo.book_image_dir(root, name)
    if img.is_dir():
        for f in sorted(img.iterdir()):
            if f.is_file() and not f.name.startswith(".") and _key(f.resolve()) not in used:
                out.append(f"书图没被引用 —— {repo.rel(root, f)}")

    found, why = check.run_validate_md(root, [repo.rel(root, p) for p in mds])
    if found is None:
        out.append(f"md 语法校验没跑成：{why}")
    else:
        out.extend(found["syntax"] + found["fence"])
    return out


def run(root: Path, name: str) -> int:
    o = repo.Out()
    name, _ = repo.book_dir(root, name)
    got = problems(root, name)
    for p in got:
        o.err(p)
    if got:
        print(f"\n{name} 质检 {len(got)} 处问题")
        return 1
    o.ok(f"{name} 质检通过")
    return 0
