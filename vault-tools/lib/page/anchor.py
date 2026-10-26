"""锚点校验：页里写的代码标识符，必须能在钉死的基线 commit 里查到。

它拦的是 SAR 里那类 **absence（缺失）** —— 页里写了、代码里找不到。按
Reflexion Model 的三分法，divergence（分歧，代码有页没写）只是待补，absence
是**编造**，所以只有它需要机制来拦，光靠自觉不行。

判据取「原文片段可回搜」而非坐标：行号页码容易记错、原文一改就无声失效，而
标识符搜不到就是错，错误自己暴露。

基线来自 `.wiki/anchors.conf`（见该文件里的格式说明）。**基线仓缺失或 commit
不存在时一律硬失败**，绝不静默放行 —— 「什么都没查却报告全部通过」是这个工具
最坏的失败模式，比查出问题坏得多。
"""

import re
from pathlib import Path

from core import repo

CONF = ".wiki/anchors.conf"

# 只挑长得像代码标识符的 token。四种形状，其余一概不查：
#   1. 驼峰类名（可带 .java/.py/.ts/.tsx 后缀）  MetricType、AtomicMetricExecutor.java
#   2. 全大写枚举值（≥3 位）                     ATOMIC、PREV_PERIOD
#   3. snake_case（至少一个下划线）               query_metric、permission_resource
#   4. 含 / 的路径                                src/agents/__init__.py
# 刻意漏掉的是「单个小写词」（atomic、dataware）与「带空格的命令」（wiki page grow、
# git log）—— 前者太容易和散文里的普通词撞上，后者不是标识符。这是本工具的
# 边界：它只保证被检出的那些成立，不保证页里所有断言都被查过。
TOKEN = re.compile(
    r"^(?:"
    r"[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*(?:\.(?:java|py|ts|tsx))?"
    r"|[A-Z][A-Z0-9_]{2,}"
    r"|[a-z][a-z0-9]*(?:_[a-z0-9]+)+"
    r"|[\w.-]+/[\w./-]+"
    r")$")

# 豁免声明：token 后面必须跟理由，没写理由的不算数。
EXEMPT = re.compile(r"<!--\s*锚点豁免:\s*(\S+)\s*——\s*(\S[^>]*?)\s*-->")

CODE_FENCE = re.compile(r"^\s*```")


class ConfError(Exception):
    """基线配置本身有问题——路径不存在、commit 查不到、格式不对。"""


def load_conf(root: Path) -> dict:
    """读 anchors.conf，返回 {路径前缀: [(名字, Path, commit), ...]}。"""
    f = root / CONF
    if not f.exists():
        raise ConfError(f"缺少基线配置 {CONF}")
    sections, cur = {}, None
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1].strip()
            sections.setdefault(cur, [])
            continue
        if cur is None:
            raise ConfError(f"{CONF}:{n} 段头之前不能有仓：{line}")
        parts = line.split()
        if len(parts) != 3:
            raise ConfError(f"{CONF}:{n} 一行要三段（名字 路径 commit）：{line}")
        name, path, sha = parts
        p = Path(path).expanduser()
        if not p.is_absolute():
            # 相对路径按**仓库根**解析，不按进程 CWD——wiki 可以从任意子目录调起。
            p = root / p
        sections[cur].append((name, p, sha))
    return sections


def repos_for(sections: dict, rel_path: str) -> list:
    """取该页适用的基线仓。多个段落都覆盖时全都算（最长前缀不独占）。"""
    out = []
    for prefix, items in sections.items():
        if rel_path == prefix or rel_path.startswith(prefix.rstrip("/") + "/"):
            out += items
    return out


def check_baselines(bases: list):
    """基线必须真的在那儿。缺一个就硬失败，不降级。"""
    for name, path, sha in bases:
        if not (path / ".git").exists():
            raise ConfError(f"基线仓 {name} 不在 {path}（或不是 git 仓）")
        r = repo.git(path, "cat-file", "-e", f"{sha}^{{commit}}", check=False)
        if r.returncode != 0:
            raise ConfError(f"基线仓 {name} 里没有 commit {sha}")


def tokens(text: str) -> set:
    """抽出正文里反引号包的标识符。跳过代码块——那里面是示例，不是断言。"""
    body, fenced = [], False
    for line in text.splitlines():
        if CODE_FENCE.match(line):
            fenced = not fenced
            continue
        if not fenced:
            body.append(line)
    joined = "\n".join(body)
    return {t.strip() for t in re.findall(r"`([^`\n]+)`", joined)
            if TOKEN.match(t.strip())}


def exemptions(text: str) -> set:
    """带理由的豁免才算数。"""
    return {m.group(1) for m in EXEMPT.finditer(text)}


def found(token: str, root: Path, bases: list) -> str:
    """token 在哪个源里查到；查不到返回 None。本仓库自己恒算一个源。"""
    if repo.git(root, "grep", "-qlF", token, "HEAD", check=False).returncode == 0:
        return "（本仓库）"
    if (root / token).exists():          # 尚未提交的新文件也算
        return "（本仓库·工作树）"
    for name, path, sha in bases:
        if repo.git(path, "grep", "-qlF", token, sha, check=False).returncode == 0:
            return name
    return None


def run(root: Path, targets) -> int:
    out = repo.Out()
    try:
        sections = load_conf(root)
    except ConfError as e:
        out.err(str(e))
        return 1

    pages = []
    for t in targets:
        p = (root / t).resolve() if not Path(t).is_absolute() else Path(t).resolve()
        if p.is_dir():
            pages += sorted(x for x in p.rglob("*.md"))
        elif p.suffix == ".md":
            pages.append(p)
        else:
            out.err(f"不是 md 也不是目录：{t}")
    if out.errors:
        return 1
    if not pages:
        out.err("没有要查的页")
        return 1

    # 先把所有页用到的基线一次性验完，再开始查——省得查到一半才报基线不对
    need, seen = [], set()
    skipped = []
    for pg in pages:
        r = repo.rel(root, pg)
        bases = repos_for(sections, r)
        if not bases:
            skipped.append(r)
            continue
        for b in bases:
            if b[0] not in seen:
                seen.add(b[0]); need.append(b)
    try:
        check_baselines(need)
    except ConfError as e:
        out.err(str(e))
        return 1

    for r in skipped:
        out.warn(f"{r} 不在 {CONF} 任何段落下，跳过（未校验，不等于通过）")

    n_tok, missing = 0, []
    for pg in pages:
        r = repo.rel(root, pg)
        bases = repos_for(sections, r)
        if not bases:
            continue
        text = pg.read_text(encoding="utf-8")
        toks = tokens(text) - exemptions(text)
        for t in sorted(toks):
            n_tok += 1
            if not found(t, root, bases):
                missing.append((r, t))

    checked = len(pages) - len(skipped)
    if missing:
        out.err(f"{len(missing)} 个标识符在基线里查不到（共查 {n_tok} 个 / {checked} 页）：")
        for r, t in missing:
            print(f"    {r}: `{t}`")
        print(f"\n  要么改对，要么在页里写 <!-- 锚点豁免: <token> —— <理由> -->。"
              f"\n  没写理由的豁免不算数。")
        return 1

    if checked == 0:
        # 一页都没查却报「通过」，正是本模块 docstring 里说的最坏失败模式。
        out.err(f"没有一页被校验——给的 {len(pages)} 页都不在 {CONF} 的任何段落下")
        return 1

    out.ok(f"锚点校验通过（{n_tok} 个标识符 / {checked} 页，基线 {len(seen)} 个仓）")
    return 0
