"""wiki document list —— 列素材，每份带到达时刻与沉淀状态。"""

from pathlib import Path

from core import repo


def _arrival_cell(iso, day: str) -> str:
    """到达时刻显示成什么。

    目录日是 `wiki document add` 那天，提交日是真进 git 那天，两者会差开（跨天
    提交）。相同就只显示时分，省一屏宽度；不同就把整个日期摆出来——
    静默把它显示成目录日的时分会是在撒谎。
    """
    if not iso:
        return "未提交"
    return iso[11:16] if iso[:10] == day else iso[:16].replace("T", " ")


def raw(root: Path, day=None, pending=False) -> int:
    """列素材，每行带到达时刻与沉淀状态。

    两列都是现算的推导值，素材本身不带任何标记（规则三）；判据见
    `repo.raw_arrivals` / `repo.raw_citations`。沉淀完成度是人评档位，
    从 .wiki/coverage.conf 读（`repo.load_coverage`）：有档位显示档位标签，
    没有回退二值。--pending 走覆盖口径：未评与「沉淀中」在列，
    「完成」不算待办。
    """
    out = repo.Out()
    doc = root / repo.RAW / "document"
    days = sorted((x for x in doc.iterdir() if x.is_dir()), reverse=True) if doc.is_dir() else []
    if day:
        days = [x for x in days if x.name == day]
        if not days:
            out.err(f"没有 {day} 的素材")
            return 1
    at = repo.raw_arrivals(root)
    cited = repo.raw_citations(root)
    cov = repo.load_coverage(root)

    rows = []       # (目录日, 文件名, 状态, 时刻, 引它的页数)
    total = done = rated = n_full = 0
    for d in days:
        # 一篇 = 日期目录下一个文件夹（md 与 images/ 同住其中），images/ 里的图不是素材；
        # 直接躺在日期目录下的散文件也列（手放或旧布局遗留）
        files = []
        for x in d.iterdir():
            if x.name == ".gitkeep":
                continue
            if x.is_dir():
                if x.name == "images":
                    continue
                files += [c for c in x.iterdir() if c.is_file() and c.name != ".gitkeep"]
            else:
                files.append(x)
        for f in sorted(files):
            r = repo.rel(root, f)
            by = cited.get(r, [])
            c = repo.coverage_for(cov, r).get("material_status")
            total += 1
            done += bool(by)
            rated += bool(c)
            n_full += c == repo.COVERAGE_FULL
            if pending and c not in (None, repo.COVERAGE_PART):
                continue
            state = repo.COVERAGE_LABELS[c] if c else ("已沉淀" if by else "未沉淀")
            rows.append((d.name, f.name, state, _arrival_cell(at.get(r), d.name), len(by)))

    if not total:
        out.info("raw/document/ 下还没有素材")
        return 0
    if not rows:
        out.ok(f"{total} 份素材都没有待沉淀的")
        return 0

    fw = max(repo.width(r[1]) for r in rows)
    sw = max(repo.width(r[2]) for r in rows)
    tw = max(repo.width(r[3]) for r in rows)
    last = None
    for dname, name, state, when, n in rows:
        if dname != last:
            print(f"\n{dname}")
            last = dname
        # 文件名是末列，只有后面真要跟东西时才补齐，否则留一片行尾空白。
        # 状态列同理：标签宽窄不一，不补齐会
        # 剪切后面的时刻列。
        tail = f"  ({n} 页)" if n > 1 else ""
        cell = repo.pad(name, fw) if tail else name
        print(f"  {repo.pad(state, sw)}  {repo.pad(when, tw)}  {cell}{tail}")
    if rated:
        n_pending = total - n_full
        parts = [f"共 {total} 份"]
        if n_pending:
            parts.append(f"待沉淀 {n_pending} 份")
        if n_full:
            parts.append(f"完成 {n_full} 份")
        print("\n" + "，".join(parts))
    else:
        print(f"\n共 {total} 份，{done} 份已沉淀，{total - done} 份未沉淀")
    return 0
