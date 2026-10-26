"""wiki book crop —— 从 PDF 页图裁一张插图（第 3 步补图用）。

box 是 x0,y0,x1,y1：四个值都在 [0,1] 按页图宽高比例，否则按像素。需要 Pillow。
任何失败都是一行 ✗ 加退出码 1（agent 反复试框，不能每次吐 traceback）。
"""

import math
from pathlib import Path

from core import repo


def crop(page_img: str, box: str, out_path: str) -> int:
    out = repo.Out()
    try:
        x0, y0, x1, y1 = (float(v) for v in box.split(","))
    except ValueError:
        out.err(f"框写成 x0,y0,x1,y1 —— {box}")
        return 1
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)):
        out.err(f"框的四个值都要是有限数 —— {box}")
        return 1
    if x1 <= x0 or y1 <= y0:
        out.err(f"框的右下要大于左上 —— {box}")
        return 1
    try:
        from PIL import Image
    except ImportError:
        out.err("裁图需要 Pillow：python3 -m pip install Pillow")
        return 1
    src = Path(page_img)
    if not src.is_file():
        out.err(f"没有页图：{page_img}")
        return 1
    try:
        im = Image.open(src)
        im.load()
    except Exception as e:                       # UnidentifiedImageError / OSError / 截断文件
        out.err(f"读不了页图：{page_img}（{e.__class__.__name__}）")
        return 1
    w, h = im.size
    if max(x0, y0, x1, y1) <= 1:
        x0, x1, y0, y1 = x0 * w, x1 * w, y0 * h, y1 * h
    rect = (max(0, round(x0)), max(0, round(y0)), min(w, round(x1)), min(h, round(y1)))
    if rect[2] <= rect[0] or rect[3] <= rect[1]:
        out.err(f"框在页图外（页图 {w}×{h}，夹到图内后是 {rect}）—— {box}")
        return 1
    dst = Path(out_path)
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.crop(rect).save(dst)
    except Exception as e:                       # 输出扩展名不认 / 目录不可写
        out.err(f"存不了裁出的图：{out_path}（{e}）")
        return 1
    out.ok(f"{dst} ← {src.name} {rect}")
    return 0
