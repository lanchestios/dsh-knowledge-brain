"""wiki book images —— 把 章节/images/ 的书图搬进 raw/book/<书名>/images/，章节引用改成相对 ../images/。

插件「转换为文字」装好章节后自动调；CLI 跑完 split 挪进 章节/ 后手动调。幂等：没有要搬的图就什么都不做。
目标目录已有同名但内容不同的文件时整体不动、报出冲突。
"""

import re
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote

from core import frontmatter as fm
from core import repo

# 图片引用里的路径段：尖括号形式可含空格，裸路径不含空白
IMAGE = re.compile(r"(!\[[^\]]*\]\(\s*)(<[^>\n]+>|[^)\s]+)")
SKIP = re.compile(r"^(?:[A-Za-z][A-Za-z0-9+.-]*:|//|/|asset/)")   # 远程、内联、根路径、已在 asset/ 的不动


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def move(root: Path, name: str) -> int:
    out = repo.Out()
    name, d = repo.book_dir(root, name)
    idx = repo.index_of(d)
    page = fm.parse(idx) if idx.is_file() else None
    if page is None:
        out.err(f"没有这本书：{repo.rel(root, d)}/")
        return 1
    src = d / "章节" / "images"
    files = {_nfc(f.name): f for f in sorted(src.iterdir()) if f.is_file() and not f.name.startswith(".")} if src.is_dir() else {}
    if not files:
        out.info(f"{name}：章节/images/ 里没有要搬的图")
        return 0
    dest = repo.book_image_dir(root, name)
    clash = [n for n, f in files.items() if (dest / n).is_file() and (dest / n).read_bytes() != f.read_bytes()]
    if clash:
        out.err(f"{repo.rel(root, dest)}/ 里已有同名但内容不同的图，什么都没动：{'、'.join(clash)}")
        return 1

    refs = 0
    for md in sorted((d / "章节").glob("*.md")):
        text = md.read_text(encoding="utf-8")

        def fix(m):
            nonlocal refs
            raw = m.group(2)[1:-1] if m.group(2).startswith("<") else m.group(2)
            if SKIP.match(raw):
                return m.group(0)
            base = _nfc(Path(unquote(raw)).name)
            if base not in files:
                return m.group(0)
            refs += 1
            return m.group(1) + repo.book_image_ref(base)

        new = IMAGE.sub(fix, text)
        if new != text:
            md.write_text(new, encoding="utf-8")

    dest.mkdir(parents=True, exist_ok=True)
    for n, f in files.items():
        if (dest / n).is_file():
            f.unlink()                     # 同名同内容：上次搬到一半，删源即可
        else:
            shutil.move(str(f), str(dest / n))
    if not any(src.iterdir()):
        src.rmdir()
    out.ok(f"{name}：搬了 {len(files)} 张图到 {repo.rel(root, dest)}/，改了 {refs} 处引用")
    return 0
