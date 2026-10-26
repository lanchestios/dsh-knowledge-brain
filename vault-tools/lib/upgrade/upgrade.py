"""wiki upgrade —— 库版本低于当前时，按版本逐级跑 lib/upgrade/steps/v<N>.py。

库版本记在 .wiki/wiki.json 的 version；当前版本是 init.WIKI_VERSION（与插件 init.ts 一致）。
v<N> 表示「从 N-1 升到 N」：提供 DESC（这一级的说明）与 run(root, out) -> problems（空 = 成功）。
每升完一级就把 version 写成 N，失败停在上一级、不再往下；改好问题再跑会从停下的那一级接着升。
升级不自动 git commit，改动留在工作区。
"""

import importlib
from pathlib import Path

from core import conf
from core import repo


def current() -> int:
    """工具认的库版本。调用时才读 init（init 顶层 import check，check 又 import 本模块，顶层互引会成环）。"""
    import init
    return init.WIKI_VERSION


def read_version(root: Path):
    """wiki.json 的 version（整数）；没文件、写坏了、不是整数 → None。与插件 readWikiVersion 同口径。"""
    try:
        v = conf.read_json(Path(root) / conf.WIKI_CONF).get("version")
    except (OSError, ValueError):
        return None
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def write_version(root: Path, v: int):
    """改 wiki.json 的 version，其余字段原样。与插件 setWikiVersion 同口径。"""
    f = Path(root) / conf.WIKI_CONF
    data = conf.read_json(f)
    conf._write_any(f, {"version": v, **{k: x for k, x in data.items() if k != "version"}},
                    lambda d: conf.write_wiki(root, d))


def _load_step(n: int):
    """steps/v<n>.py；没有这个脚本 → None（脚本内部 import 失败照常抛，别吞掉真错）。"""
    try:
        return importlib.import_module(f"upgrade.steps.v{n}")
    except ModuleNotFoundError as e:
        if e.name in ("upgrade.steps", f"upgrade.steps.v{n}"):
            return None
        raise


def run(root: Path) -> int:
    out = repo.Out()
    have, want = read_version(root), current()
    if have is None:
        out.err(f"{conf.WIKI_CONF} 读不出 version（缺失或格式不对），认不出库版本")
        return 1
    if have > want:
        out.err(f"库版本 v{have} 比工具认的 v{want} 新，先升级 dsh-knowledge-brain 插件")
        return 1
    if have == want:
        out.ok(f"已是 v{want}，不用升级")
        return 0
    for n in range(have + 1, want + 1):
        step = _load_step(n)
        if step is None:
            out.err(f"缺少 v{n - 1} → v{n} 的升级脚本")
            return 1
        problems = step.run(root, out)
        if problems:
            for p in problems:
                out.err(p)
            out.err(f"升级停在 v{n - 1}：v{n - 1} → v{n} 没完成，按上面的问题改完再跑 wiki upgrade")
            return 1
        write_version(root, n)
        out.ok(f"升级 v{n - 1} → v{n}：{step.DESC}")
    out.ok(f"已升到 v{want}")
    return 0
