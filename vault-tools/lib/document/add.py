"""wiki document add —— 本地文件移动进 raw/document/<今天>/。"""

import shutil
from pathlib import Path

from core import repo


def add_raw(root: Path, files) -> int:
    out = repo.Out()
    dest = root / repo.RAW / "document" / repo.today()
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in files:
        src = Path(f).expanduser().resolve()
        if not src.exists():
            out.err(f"不存在：{f}")
            continue
        tgt = dest / src.name
        if tgt.exists():
            out.err(f"目标已存在：{repo.rel(root, tgt)}")
            continue
        shutil.move(str(src), str(tgt))
        out.ok(f"归档 {src.name} → {repo.rel(root, tgt)}")
        n += 1
    gk = dest / ".gitkeep"
    if n and gk.exists():
        gk.unlink()
    return 0 if out.errors == 0 else 1
