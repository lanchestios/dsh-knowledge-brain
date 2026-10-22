"""wiki document cover —— 评一份素材的沉淀完成度（.wiki/coverage.conf）。"""

from pathlib import Path

from core import repo


def cover(root: Path, path_arg: str, value=None, detail=None) -> int:
    """评一份素材的沉淀完成度，写 .wiki/coverage.conf（素材本体不动，规则三）。

    不带档位 = 查询当前档位与取用清单（git-config 式）。mark 是给页的，
    cover 是给素材的——所以它像 mark 一样走参数校验，但写的是旁挂台账。
    """
    out = repo.Out()
    target = Path(path_arg)
    if not target.exists():
        out.err(f"找不到：{path_arg}")
        return 1
    if not target.is_file():
        out.err(f"不是文件：{path_arg}")
        return 1
    try:
        r = repo.rel(root, target.resolve())
    except ValueError:
        r = None
    if r is None or not r.startswith(f"{repo.RAW}/document/"):
        out.err(f"不在 raw/document/ 下：{path_arg}（cover 只评 raw/document/ 的素材）")
        return 1

    entry = repo.coverage_for(repo.load_coverage(root), r)
    if value is None:
        c = entry.get("material_status")
        if not c:
            out.info(f"{r} 未评（档位：{' / '.join(repo.COVERAGE_LABELS[v] for v in repo.COVERAGES)}）")
        else:
            out.ok(f"{r} {repo.COVERAGE_LABELS[c]}")
            if entry.get("detail"):
                out.info(f"detail: {entry['detail']}")
        return 0

    problem = repo.coverage_problem(value)
    if problem:
        out.err(problem)
        return 1
    # 完成只由人标：它把素材移出 --pending，误标了待办就静默消失。智能体判得
    # 再准也只留「沉淀中」，在 detail 里写「疑似完成，待确认」，由人拍板。
    who = repo.actor(root)
    if value == repo.COVERAGE_FULL and not who.startswith("human:"):
        out.err(f"「完成」只由人标（当前身份 {who}）——在自己的终端跑这条命令")
        return 1
    if repo.set_coverage(root, r, value, detail=detail):
        out.ok(f"{r} → {repo.COVERAGE_LABELS[value]}")
        if detail is not None:
            out.info(f"detail: {detail}")
    else:
        out.info(f"{r} 已经是 {repo.COVERAGE_LABELS[value]}")
    return 0
