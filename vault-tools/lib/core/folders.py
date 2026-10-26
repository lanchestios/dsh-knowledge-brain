"""沉淀区文件夹配置（<文件夹>/.folder.json）的补齐与校验——一份实现：wiki page 命令改目录时补（sync）、
wiki init 整库补（fix_tree）、wiki check 只读校验（check_dir）都走这里。

形状（所有字段必填，不认识的字段是错误）：
  {
    "index": "<本文件夹的页名，不带 .md；默认同文件夹名>",
    "children": {
      "<子节点>": {"type": "folder" | "file", "ext": "<扩展名>", "order": <正整数>}
    }
  }
规则：沉淀五区下每个文件夹（含区根）都有 .folder.json，children 恰好列出文件夹里的每个文件与子文件夹，
除了文件夹自己的页（index 所指）、. 开头的文件与目录、.folder.json 本身。
键 = 文件去掉最后一个扩展名 / 文件夹名；file 的 ext 是扩展名（不带点，无扩展名为 ""），folder 的 ext 固定 "folder"；
order 是同层不重复的正整数（不要求连续），本层按它排。
补齐保留已有的 index（指向存在的页时）与 order（合法且不重复时）；新出现的、order 缺或坏或重复的接在最后；
内容一致不写盘；JSON 写坏、去掉扩展名后同名不写盘，报出来要人改。
"""

import unicodedata
from pathlib import Path

from core import conf
from core import repo


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def split_name(filename: str):
    """按最后一个点切出（名字，扩展名）；没有点（或只在开头）扩展名为空串。"""
    i = filename.rfind(".")
    if i <= 0:
        return filename, ""
    return filename[:i], filename[i + 1:]


def page_name(d: Path, data) -> str:
    """本文件夹的页名：index 是非空字符串且那页存在就用它，否则同文件夹名。"""
    index = (data or {}).get("index")
    if isinstance(index, str) and index and (Path(d) / (index + ".md")).is_file():
        return _nfc(index)
    return _nfc(Path(d).name)


def scan(d: Path, page: str = None):
    """磁盘上应列的条目 {名: {type, ext}} 与同名冲突 [(名, [文件名…])]。page 缺省按现有 .folder.json 定。"""
    d = Path(d)
    if page is None:
        try:
            page = page_name(d, conf.folder_conf(d))
        except ValueError:
            page = _nfc(d.name)
    own = page + ".md"
    seen = {}
    for p in sorted(d.iterdir(), key=lambda x: x.name):
        if p.name.startswith(".") or (p.is_file() and _nfc(p.name) == own):
            continue
        if p.is_dir():
            seen.setdefault(_nfc(p.name), []).append((p.name, {"type": "folder", "ext": conf.FOLDER_EXT}))
        elif p.is_file():
            name, ext = split_name(p.name)
            seen.setdefault(_nfc(name), []).append((p.name, {"type": "file", "ext": ext}))
    items, clash = {}, []
    for name, hits in seen.items():
        if len(hits) > 1:
            clash.append((name, sorted(h[0] for h in hits)))
        else:
            items[name] = hits[0][1]
    return items, clash


def _target(d: Path, data, items) -> dict:
    """补齐后的完整内容：index 用 page_name；每个条目 type / ext 取磁盘，order 留合法且不重复的，其余按名字接在最后。"""
    data = data or {}
    old = data.get("children")
    old = {_nfc(str(k)): v for k, v in old.items()} if isinstance(old, dict) else {}
    kids, used = {}, set()
    for name, attrs in old.items():                     # 按文件里的先后认 order：重复时前面的留下
        o = attrs.get("order") if isinstance(attrs, dict) else None
        if name in items and conf.is_order(o) and o not in used:
            kids[name] = {**items[name], "order": o}
            used.add(o)
    rest = [n for n in items if n not in kids]
    nxt = max(used, default=0)
    for name in sorted(rest):
        nxt += 1
        kids[name] = {**items[name], "order": nxt}
    return {"index": page_name(d, data), "children": kids}


def _where(root, d, file=True) -> str:
    r = repo.rel(root, d)
    return f"{r}/{conf.FOLDER_CONF}" if file else f"{r}/"


def _clash_msgs(root, d, clash):
    return [f"文件夹配置：{_where(root, d, False)} 有同名的 —— {'、'.join(files)}（去掉扩展名后都叫 {name}，改掉一个的名字）"
            for name, files in clash]


def reconcile(root: Path, d: Path):
    """补齐 d 的 .folder.json。返回（是否写了盘, problems）。"""
    d = Path(d)
    try:
        data = conf.folder_conf(d)
    except ValueError as e:
        return False, [f"文件夹配置：{_where(root, d)} 解析失败 —— {e}"]
    items, clash = scan(d, page_name(d, data))
    if clash:
        return False, _clash_msgs(root, d, clash)
    target = _target(d, data, items)
    if data == target:
        return False, []
    conf.write_folder(d / conf.FOLDER_CONF, target)
    return True, []


def check_dir(root: Path, d: Path) -> list:
    """只读校验 d 的 .folder.json，返回报错文案（不带 ✗）。"""
    d = Path(d)
    where = _where(root, d)
    try:
        data = conf.folder_conf(d)
    except ValueError as e:
        return _clash_msgs(root, d, scan(d, _nfc(d.name))[1]) + [f"文件夹配置：{where} 解析失败 —— {e}"]
    if data is None:
        return _clash_msgs(root, d, scan(d, _nfc(d.name))[1]) + [f"文件夹配置：{_where(root, d, False)} 缺 {conf.FOLDER_CONF}"]
    errs = []
    for k in sorted(conf.FOLDER_KEYS - set(data)):
        errs.append(f"文件夹配置：{where} 缺字段 —— {k}")
    for k in sorted(set(data) - conf.FOLDER_KEYS, key=str):
        errs.append(f"文件夹配置：{where} 有不认识的字段 —— {k}")
    index = data.get("index")
    if "index" in data:
        if not isinstance(index, str) or not index:
            errs.append(f"文件夹配置：{where} 的 index 必须是页名（不带 .md 的字符串）")
        elif _nfc(index) != _nfc(d.name) and not (d / (index + ".md")).is_file():   # 默认页缺了由「结构：」报
            errs.append(f"文件夹配置：{where} 的 index 指向不存在的文件 —— {index}.md")
    items, clash = scan(d, page_name(d, data))
    errs += _clash_msgs(root, d, clash)
    clashed = {name for name, _ in clash}
    kids = data.get("children")
    if "children" in data and not isinstance(kids, dict):
        return errs + [f"文件夹配置：{where} 的 children 必须是对象（子节点名: {{type, ext, order}}）"]
    listed = {_nfc(str(k)): v for k, v in (kids or {}).items()}
    seen = {}
    for name, got in listed.items():
        if not isinstance(got, dict):
            errs.append(f"文件夹配置：{where} 的 {name} 必须是对象 {{type, ext, order}}")
            continue
        for k in sorted(conf.CHILD_KEYS - set(got)):
            errs.append(f"文件夹配置：{where} 的 {name} 缺字段 —— {k}")
        for k in sorted(set(got) - conf.CHILD_KEYS, key=str):
            errs.append(f"文件夹配置：{where} 的 {name} 有不认识的字段 —— {k}")
        if "order" in got:
            o = got["order"]
            if not conf.is_order(o):
                errs.append(f"文件夹配置：{where} 的 {name} 的 order 必须是正整数 —— 写的 {o!r}")
            elif o in seen:
                errs.append(f"文件夹配置：{where} 的 order {o} 重复 —— {seen[o]}、{name}")
            else:
                seen[o] = name
        if name not in items:
            if name not in clashed:
                errs.append(f"文件夹配置：{where} 列了不存在的 —— {name}")
            continue
        real = items[name]
        if "type" in got and got["type"] != real["type"]:
            errs.append(f"文件夹配置：{where} 的 {name} 类型不对 —— 写的 {got['type']}，实际 {real['type']}")
        elif "ext" in got and got["ext"] != real["ext"]:
            errs.append(f"文件夹配置：{where} 的 {name} 扩展名不对 —— 写的 {got['ext']!r}，实际 {real['ext']!r}")
    for name, real in items.items():
        if name not in listed:
            errs.append(f"文件夹配置：{where} 漏了 —— {name}（{real['type']} / {real['ext']}）")
    return errs


def deposit_dirs(root: Path) -> list:
    """沉淀区全部文件夹（含区根），跳过 . 开头的。"""
    out = []
    for top in repo.DEPOSIT_DIRS:
        base = Path(root) / top
        if not base.is_dir():
            continue
        out.append(base)
        for p in sorted(base.rglob("*")):
            if p.is_dir() and not any(part.startswith(".") for part in p.relative_to(base).parts):
                out.append(p)
    return out


def _in_scope(root: Path, d: Path) -> bool:
    try:
        r = repo.rel(root, d)
    except Exception:
        return False
    return d.is_dir() and r != "." and repo.in_deposit(r) and not any(part.startswith(".") for part in r.split("/"))


def sync(root: Path, paths, out=None) -> list:
    """对每个路径所在的文件夹（是文件夹就是它自己）及其祖先直到区根各补一次。返回 problems。"""
    root = Path(root).resolve()
    todo = []
    for p in paths:
        p = Path(p).resolve()
        cur = p if p.is_dir() else p.parent
        while True:
            if _in_scope(root, cur) and cur not in todo:
                todo.append(cur)
            if cur == root or cur.parent == cur:
                break
            cur = cur.parent
    problems = []
    for d in todo:
        changed, probs = reconcile(root, d)
        if changed and out:
            out.info(f"补齐 {repo.rel(root, d)}/{conf.FOLDER_CONF}")
        problems += probs
    return problems


def fix_tree(root: Path, out=None):
    """补齐整个沉淀区。返回（改了几个, problems）。"""
    n, problems = 0, []
    for d in deposit_dirs(root):
        changed, probs = reconcile(root, d)
        if changed:
            n += 1
            if out:
                out.info(f"补齐 {repo.rel(root, d)}/{conf.FOLDER_CONF}")
        problems += probs
    return n, problems
