"""wiki 的两份配置（JSON，所有字段必填）与路径类配置的维护。

- 全局 .wiki/wiki.json：{"version": 整数, "parts": {"<区>": {"order": 整数}, …}}
- 文件夹 <文件夹>/.folder.json：{"index": "<本文件夹的页名>", "children": {"<子节点>": {"type", "ext", "order"}}}
  （形状与校验见 folders）
- 路径类配置（键是库内路径的全局配置）登记在 PATH_CONFS，随 wiki page move 改写键，
  wiki check 查断键（按 git 改名记录提示新路径）。
"""

import json
import re
from pathlib import Path

from core import repo

FOLDER_CONF = ".folder.json"
WIKI_CONF = ".wiki/wiki.json"
ANCHORS_CONF = ".wiki/anchors.conf"
PATH_CONFS = [ANCHORS_CONF, WIKI_CONF]
WIKI_KEYS = {"version", "parts"}
PART_KEYS = {"order"}
FOLDER_KEYS = {"index", "children"}
CHILD_KEYS = {"type", "ext", "order"}
FOLDER_EXT = "folder"                       # 子文件夹的 ext 固定写这个


# ── 读写 ─────────────────────────────────────────────────────

def read_json(f: Path) -> dict:
    """读一份 JSON 配置：顶层必须是对象。写错 → ValueError（文案可直接给人看）。"""
    try:
        data = json.loads(Path(f).read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        raise ValueError("不是 UTF-8 文本")
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 语法错误（第 {e.lineno} 行第 {e.colno} 列）：{e.msg}")
    if not isinstance(data, dict):
        raise ValueError("顶层必须是对象 {…}")
    return data


def _line(v) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def write_folder(f: Path, data: dict):
    """.folder.json 的规范写法：一个子节点一行，按 order 排。"""
    kids = sorted(data["children"].items(), key=lambda kv: (kv[1]["order"], kv[0]))
    lines = ["{", f'  "index": {_line(data["index"])},']
    if not kids:
        lines.append('  "children": {}')
    else:
        lines.append('  "children": {')
        lines += [f"    {_line(k)}: {_line(v)}" + ("," if i < len(kids) - 1 else "") for i, (k, v) in enumerate(kids)]
        lines.append("  }")
    lines.append("}")
    Path(f).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_wiki(root: Path, data: dict):
    """.wiki/wiki.json 的规范写法：先 version 再 parts，一个区一行。"""
    parts = sorted(data["parts"].items(), key=lambda kv: (kv[1]["order"], kv[0]))
    lines = ["{", f'  "version": {_line(data["version"])},', '  "parts": {']
    lines += [f"    {_line(k)}: {_line(v)}" + ("," if i < len(parts) - 1 else "") for i, (k, v) in enumerate(parts)]
    lines += ["  }", "}"]
    f = Path(root) / WIKI_CONF
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")


def default_wiki(version: int) -> dict:
    return {"version": version, "parts": {a: {"order": i} for i, a in enumerate(repo.DEPOSIT_DIRS, 1)}}


def is_order(v) -> bool:
    """order 合法值：正整数（布尔不算）。"""
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


def folder_conf(d: Path):
    """读 <d>/.folder.json 的原始对象。没有文件 → None；JSON 写错 → ValueError。字段校验在 folders.check_dir。"""
    f = Path(d) / FOLDER_CONF
    return read_json(f) if f.is_file() else None


def folder_index(d: Path, data=None) -> str:
    """文件夹页的名字（不带 .md）：.folder.json 的 index 是非空字符串就用它，否则同文件夹名。"""
    if data is None:
        try:
            data = folder_conf(d) or {}
        except ValueError:
            data = {}
    index = data.get("index")
    return index if isinstance(index, str) and index else Path(d).name


# ── 路径类配置：键随 move 改写、断键检查与修复 ─────────────────

def node_key(r: str) -> str:
    """节点路径：文件去 .md；文件夹页（X/X.md）归到文件夹。"""
    parts = r.split("/")
    last = parts[-1]
    if last.endswith(".md"):
        if len(parts) >= 2 and last[:-3] == parts[-2]:
            return "/".join(parts[:-1])
        return "/".join(parts[:-1] + [last[:-3]])
    return r


def _under(key: str, old: str) -> bool:
    return key == old or key.startswith(old + "/")


def _anchor_keys(text: str):
    """(行号, 键)：anchors.conf 的段头 [路径前缀]。"""
    out = []
    for i, l in enumerate(text.splitlines()):
        m = re.match(r"^\[(.+)\]\s*$", l.strip())
        if m:
            out.append((i, m.group(1).strip()))
    return out


def _part_keys(root: Path) -> list:
    """wiki.json 的 parts 键；文件没有或写坏了 → []（写坏由 check 的「配置：」报）。"""
    try:
        parts = read_json(Path(root) / WIKI_CONF).get("parts")
    except (OSError, ValueError):
        return []
    return list(parts) if isinstance(parts, dict) else []


def _write_any(f: Path, data: dict, canonical):
    """形状齐全时按规范写法写，缺字段时退回通用 JSON（随后的补齐 / 校验会处理缺的）。"""
    try:
        canonical(data)
    except (KeyError, TypeError, AttributeError):
        Path(f).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def rewrite_path_keys(root: Path, old: str, new: str, out) -> int:
    """把路径类配置里等于 old 或在 old 之下的键改到 new 之下。"""
    total = 0
    f = Path(root) / ANCHORS_CONF
    if f.is_file():
        lines = f.read_text(encoding="utf-8").splitlines(keepends=True)
        for i, key in _anchor_keys("".join(lines)):
            if _under(key, old):
                nk = new + key[len(old):]
                lines[i] = lines[i].replace(key, nk, 1)
                out.info(f"改配置键 {ANCHORS_CONF}：{key} → {nk}")
                total += 1
        if total:
            f.write_text("".join(lines), encoding="utf-8")
    f = Path(root) / WIKI_CONF
    if any(_under(k, old) for k in _part_keys(root)):
        data = read_json(f)
        parts = {}
        for k, v in data["parts"].items():
            nk = new + k[len(old):] if _under(k, old) else k
            if nk != k:
                out.info(f"改配置键 {WIKI_CONF}：{k} → {nk}")
                total += 1
            parts[nk] = v
        data["parts"] = parts
        _write_any(f, data, lambda d: write_wiki(root, d))
    return total


def _exists_node(root: Path, key: str) -> bool:
    p = Path(root) / key
    return p.is_dir() or p.with_name(p.name + ".md").is_file()




def dangling_keys(root: Path) -> list:
    bad = []
    f = Path(root) / ANCHORS_CONF
    if f.is_file():
        bad += [(ANCHORS_CONF, k) for _i, k in _anchor_keys(f.read_text(encoding="utf-8")) if not _exists_node(root, k)]
    bad += [(WIKI_CONF, k) for k in _part_keys(root) if not _exists_node(root, k)]
    return bad


def renamed_to(root: Path, key: str):
    """按 git 改名记录（从早到晚）把节点键追到现路径；追不到或不存在返回 None。

    工作区里还没提交的 git mv 也算：先看已提交的改名，再看暂存区。"""
    renames = []
    log = repo.git(root, "log", "--reverse", "-M", "--diff-filter=R", "--name-status", "--format=", check=False)
    staged = repo.git(root, "diff", "--cached", "-M", "--diff-filter=R", "--name-status", check=False)
    for text in (log.stdout, staged.stdout):
        for line in text.splitlines():
            f = line.split("\t")
            if len(f) == 3 and f[0].startswith("R"):
                renames.append((f[1], f[2]))
    cur = key
    for old, new in renames:
        # 只认节点自己的页被改名：平铺页 X.md，或文件夹的默认页 X/X.md。
        # 文件夹里某个子文件被单独挪走不算——那不说明文件夹去了哪。
        # 改指了 index 的文件夹推不出来，留给人修。
        if node_key(old) == cur:
            is_page = cur == old.rsplit("/", 1)[0]
            cur = new.rsplit("/", 1)[0] if is_page else node_key(new)
    return cur if cur != key and _exists_node(root, cur) else None




def sync_folder_conf(root: Path, old_parent: Path, old_key: str, new_parent: Path, new_key: str, out):
    """父层 .folder.json：同父层改名 → children 键原位改名（order 等属性不变）；换父层 → 从旧父层删掉。
    新父层的条目由随后的 folders.sync 补到最后。键按 folders 的规则（文件去掉最后一个扩展名、文件夹原名）。"""
    f = Path(old_parent) / FOLDER_CONF
    if not f.is_file():
        return
    where = repo.rel(root, f)
    try:
        data = read_json(f)
    except ValueError as e:
        out.warn(f"{where} 解析失败，move 没有同步它 —— {e}")
        return
    kids = data.get("children")
    if not isinstance(kids, dict) or old_key not in kids:
        return
    if Path(old_parent).resolve() == Path(new_parent).resolve():
        data["children"] = {(new_key if k == old_key else k): v for k, v in kids.items()}
        out.info(f"改 {where}：children {old_key} → {new_key}")
    else:
        del kids[old_key]
        out.info(f"从 {where} 的 children 删掉 {old_key}")
    _write_any(f, data, lambda d: write_folder(f, d))
