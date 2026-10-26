"""wiki book status —— 查 / 写书的入库状态（material_status）。

写 readable 每次都当场跑 wiki book qc，没过拒写；插件按钮与 wiki-write-book-ingest 都经这里写状态以外的步骤。
"""

import json
from pathlib import Path

from book import qc
from core import frontmatter as fm
from core import repo


def _unquote(v) -> str:
    """fm.parse 只剥外层引号；--error 写的是 JSON 双引号标量，查询时把 \\" \\\\ 等转义还原。"""
    s = str(v or "")
    try:
        return json.loads(f'"{s}"')
    except ValueError:
        return s.strip('"\'')


def status(root: Path, name: str, value: str = None, error: str = None) -> int:
    """value 为 None 只查；error 给了就写进 material_error（任何状态都行，扫描版停在 init 时用），
    没给时写非 failed 状态顺手清掉旧错误。"""
    out = repo.Out()
    name, d = repo.book_dir(root, name)
    idx = repo.index_of(d)
    page = fm.parse(idx) if idx.is_file() else None
    if page is None:
        out.err(f"没有这本书：{repo.rel(root, d)}/")
        return 1
    cur = _unquote(page.fields.get("material_status", ""))
    if value is None:
        print(f"{name} material_status: {cur or '（未写）'}")
        err = _unquote(page.fields.get("material_error", ""))
        if err:
            print(f"  material_error: {err}")
        return 0
    if value not in repo.BOOK_MATERIAL_STATUSES:
        out.err(f"material_status 只能是 {' / '.join(repo.BOOK_MATERIAL_STATUSES)}（给的是 {value}）")
        return 1
    if value == repo.BOOK_READABLE:
        got = qc.problems(root, name)
        if got:
            for p in got:
                out.err(p)
            out.err(f"{name} 质检没过，不写 readable（{len(got)} 处）")
            return 1
    fm.set_scalar(idx, "material_status", value)
    if error is not None:
        # 单行双引号标量：json 的转义是 YAML 双引号的子集，插件与 fm.parse 都认
        fm.set_scalar(idx, "material_error", json.dumps(" ".join(error.split()), ensure_ascii=False))
    elif value != "failed" and "material_error" in page.fields:
        fm.set_scalar(idx, "material_error", '""')
    fm.set_scalar(idx, "updated", repo.today())
    out.ok(f"{name} material_status：{cur or '（未写）'} → {value}")
    return 0
