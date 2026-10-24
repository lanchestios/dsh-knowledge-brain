"""wiki document add —— 本地文件移动进 raw/document/<今天>/，一篇一个文件夹。"""

import shutil
from pathlib import Path

from core import repo


def add_raw(root: Path, files, name=None) -> int:
    """把文件移动（不是复制）进 raw/document/<今天>/。

    不指定 name 时每份文件各进以自己命名的文件夹；一篇多件（html 原件 +
    抽出的 md）用 name 归进同一个文件夹。
    """
    out = repo.Out()
    dest = root / repo.RAW / "document" / repo.today()
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in files:
        src = Path(f).expanduser().resolve()
        if not src.exists():
            out.err(f"不存在：{f}")
            continue
        folder = dest / (name if name is not None else src.stem)
        tgt = folder / src.name
        if tgt.exists():
            out.err(f"目标已存在：{repo.rel(root, tgt)}")
            continue
        folder.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(tgt))
        out.ok(f"归档 {src.name} → {repo.rel(root, tgt)}")
        n += 1
    gk = dest / ".gitkeep"
    if n and gk.exists():
        gk.unlink()
    return 0 if out.errors == 0 else 1
