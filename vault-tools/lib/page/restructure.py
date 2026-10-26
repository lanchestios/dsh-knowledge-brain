"""wiki page grow / shrink / move / order —— 结构演化，含引用修复。"""

import re
import unicodedata
from pathlib import Path

from core import conf
from core import frontmatter as fm
from core import links
from core import repo


def _replace_path(text: str, old: str, new: str) -> str:
    """按路径边界替换库内路径（source、正文里写的路径）；[[双链]] 不碰——双链归 links.rewrite_after。

    前面不能是 ASCII 字母数字与 _ . / -（汉字可以：「放进knowledge/…」照样命中）；后面必须是路径边界：/、.md、
    句末的 .（后面不再跟字母）、行尾，或明确不属于名字的字符（空白、标点、引号括号）。汉字在后面不算边界：
    知识/软件 不能匹配进 知识/软件工程，知识/甲 也不能匹配进刚改好的 知识/甲乙。
    单段旧路径（一级目录名）只在后面紧跟 / 时才算路径，免得改坏 framework、英文单词 work。
    """
    if "/" not in old:
        tail = r"(?=/)"
    else:
        tail = r"(?=/|\.md\b|\.(?!\w)|$|[\s`'\"()\[\]{}<>，。；：、！？,;:!?|*])"
    pat = re.compile(rf"(?<![A-Za-z0-9_./-]){re.escape(old)}{tail}", re.M)
    out, last = [], 0
    for m in re.finditer(r"\[\[[^\[\]]*\]\]", text):
        out.append(pat.sub(lambda _m: new, text[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(pat.sub(lambda _m: new, text[last:]))
    return "".join(out)


def _rewrite_refs(root: Path, old_rel: str, new_rel: str, out):
    """把全仓库指向旧位置的 source 路径与正文里写的库内路径改到新位置。双链由 links.rewrite_after 管。"""
    changed = 0
    if old_rel == new_rel:
        return 0
    for p in repo.iter_md(root):
        text = p.read_text(encoding="utf-8")
        new = _replace_path(text, old_rel, new_rel)
        if new != text:
            p.write_text(new, encoding="utf-8")
            out.info(f"修引用 {repo.rel(root, p)}")
            changed += 1
    return changed


def _relink(root, before, out, moved=lambda k: k) -> int:
    """结构变动后改双链（见 links.rewrite_after），逐个报改了哪些页。"""
    changed = links.rewrite_after(root, before, moved)
    for p in changed:
        out.info(f"改双链 {repo.rel(root, p)}")
    return len(changed)


def _sync(root, paths, out):
    """改了沉淀区目录内容之后补齐相关文件夹的 .folder.json（所在文件夹及其祖先）；补不了的只警告，check 会报。"""
    from core import folders
    for p in folders.sync(root, paths, out):
        out.warn(p)


def grow(root: Path, target: Path, out=None) -> int:
    """平铺 X.md → X/X.md（文件名不变，从此它是文件夹 X 的页）。"""
    own = out or repo.Out()
    p = Path(target).resolve()
    if not p.is_file() or not p.name.endswith(".md") or repo.is_folder_page(p):
        own.err(f"不是平铺节点文件：{target}")
        return 1
    name = p.stem
    folder = p.parent / name
    if folder.exists():
        own.err(f"目标文件夹已存在：{repo.rel(root, folder)}/")
        return 1
    before = links.Index(root)
    old_rel = repo.rel(root, p)
    folder.mkdir()
    dst = folder / p.name
    repo.git_mv(root, p, dst)
    own.ok(f"升级 {old_rel} → {repo.rel(root, dst)}")
    _relink(root, before, own)
    _rewrite_refs(root, old_rel, repo.rel(root, dst), own)
    _sync(root, [folder], own)
    return 0


def shrink(root: Path, target: Path) -> int:
    """文件夹页 → 平铺 X.md（仅当文件夹里只剩它的页与 .folder.json）。"""
    out = repo.Out()
    d = Path(target).resolve()
    if not d.is_dir():
        out.err(f"不是文件夹：{target}")
        return 1
    idx = repo.index_of(d)
    # 看磁盘：除了自己的页、.gitkeep、.folder.json 还有别的（含其他 . 开头的文件 / 目录）就不能收回——
    # 下面会把剩下的逐个删掉，放宽到「. 开头都不算」会把隐藏草稿删了，碰到隐藏目录还会半路报错
    rest = [x for x in d.iterdir() if x != idx and x.name not in (".gitkeep", conf.FOLDER_CONF)]
    if rest:
        out.err(f"文件夹里还有 {len(rest)} 项，不能收回：" +
                "、".join(x.name for x in rest[:5]))
        return 1
    if not idx.exists():
        out.err(f"缺 index：{repo.rel(root, d)}/")
        return 1
    before = links.Index(root)
    old_rel = repo.rel(root, idx)
    dst = d.parent / f"{d.name}.md"
    repo.git_mv(root, idx, dst)
    for x in d.iterdir():
        x.unlink()
    d.rmdir()
    out.ok(f"收回 {old_rel} → {repo.rel(root, dst)}")
    _sync(root, [dst], out)
    # 改指的页（概览.md）收回后叫 X.md：[[概览]] 不再解析，改成 [[X]]（rewrite_after 按节点认）
    _relink(root, before, out)
    _rewrite_refs(root, old_rel, repo.rel(root, dst), out)
    return 0


def _child(root: Path, rel: str):
    """库内路径 → （父文件夹, 父层 .folder.json 的键）。只认沉淀区里、区根以下的节点；文件夹页不算节点（挪文件夹）。"""
    p = Path(rel) if Path(rel).is_absolute() else root / rel
    p = Path(unicodedata.normalize("NFC", str(p))).resolve()
    if not p.exists():
        raise ValueError(f"不存在：{rel}")
    r = repo.rel(root, p)
    if not repo.in_deposit(r) or p.parent == root:
        raise ValueError(f"不是沉淀区里可排序的节点：{rel}")
    if p.is_file() and repo.is_folder_page(p):
        raise ValueError(f"{r} 是文件夹 {p.parent.name} 的页：排序要挪整个文件夹")
    from core import folders
    key = p.name if p.is_dir() else folders.split_name(p.name)[0]
    return p.parent, unicodedata.normalize("NFC", key)


def _place(d: Path, key: str, where: str, ref: str = None) -> bool:
    """把 d/.folder.json 里的 key 挪到 ref 前 / 后，或最前 / 最后，order 重写成 1..n。顺序没变返回 False、不写盘。"""
    f = Path(d) / conf.FOLDER_CONF
    data = conf.read_json(f)
    kids = data.get("children")
    if not isinstance(kids, dict) or key not in kids:
        raise ValueError(f"{f.name} 里没有 {key}")
    seq = [k for k, _ in sorted(kids.items(), key=lambda kv: (kv[1].get("order", 1e9) if isinstance(kv[1], dict) else 1e9, kv[0]))]
    rest = [k for k in seq if k != key]
    if where == "first":
        at = 0
    elif where == "last":
        at = len(rest)
    else:
        if ref == key or ref not in rest:
            raise ValueError(f"兄弟不在同一文件夹：{ref}")
        at = rest.index(ref) + (1 if where == "after" else 0)
    new = rest[:at] + [key] + rest[at:]
    if new == seq:                       # 顺序没变：不写盘（order 不要求连续，不为重编号单独写）
        return False
    data["children"] = {k: {**kids[k], "order": i + 1} for i, k in enumerate(new)}
    conf._write_any(f, data, lambda x: conf.write_folder(f, x))
    return True


def order(root: Path, node: str, where: str, ref: str = None) -> int:
    """同父文件夹内挪先后：--before / --after <兄弟>，或 --first / --last。"""
    out = repo.Out()
    try:
        d, key = _child(root, node)
        rkey = None
        if where in ("before", "after"):
            rd, rkey = _child(root, ref)
            if rd != d:
                raise ValueError(f"{ref} 和 {node} 不在同一文件夹")
        if _place(d, key, where, rkey):
            out.ok(f"排序 {repo.rel(root, d)}/{conf.FOLDER_CONF}：{key} 挪到" +
                   {"first": "最前", "last": "最后"}.get(where, f"{rkey} {'前' if where == 'before' else '后'}"))
        else:
            out.info("顺序没变")
    except ValueError as e:
        out.err(str(e))
        return 1
    return 0


def move(root: Path, src: str, dst: str, where: str = None, ref: str = None) -> int:
    """移动节点（文件或文件夹），并修好所有指向它的引用。where / ref：落到目标文件夹的哪里（同 order）；不给排最后。"""
    out = repo.Out()
    s = (root / src).resolve() if not Path(src).is_absolute() else Path(src).resolve()
    if not s.exists():
        out.err(f"源不存在：{src}")
        return 1
    if s.is_file() and repo.is_folder_page(s):
        out.err(f"{repo.rel(root, s)} 是文件夹 {s.parent.name} 的页，不能单独挪："
                f"要改名就 move 整个文件夹；要换一个文件当它的页，改 {conf.FOLDER_CONF} 的 index")
        return 1
    d = (root / dst).resolve() if not Path(dst).is_absolute() else Path(dst).resolve()
    if d.exists() and d.is_dir():
        d = d / s.name
    if d.exists():
        out.err(f"目标已存在：{repo.rel(root, d)}")
        return 1
    if s.is_dir() and (d == s or s in d.parents):
        out.err(f"不能把文件夹移进它自己：{repo.rel(root, s)} → {repo.rel(root, d)}")
        return 1
    rkey = None
    if where in ("before", "after"):
        try:
            rd, rkey = _child(root, ref)
        except ValueError as e:
            out.err(str(e))
            return 1
        if rd != d.parent:
            out.err(f"{ref} 不在目标文件夹 {repo.rel(root, d.parent)}/ 里")
            return 1

    before = links.Index(root)
    old_node = links.node_path(root, s) if s.is_file() else repo.rel(root, s)
    old_rel, old_name = repo.rel(root, s), repo.node_name(s)
    d.parent.mkdir(parents=True, exist_ok=True)
    repo.git_mv(root, s, d)
    new_rel, new_name = repo.rel(root, d), repo.node_name(d)
    new_node = links.node_path(root, d) if d.is_file() else repo.rel(root, d)

    # 文件夹改名后，与旧文件夹名同名的页跟着改名，index 一并改成新名（下面读页要用）；index 改指的别的页不动
    if d.is_dir() and old_name != new_name:
        try:
            data = conf.folder_conf(d) or {}
        except ValueError:
            data = {}
        index = data.get("index")
        stale = d / (old_name + ".md")
        if (index if isinstance(index, str) and index else old_name) == old_name and stale.exists():
            repo.git_mv(root, stale, d / (new_name + ".md"))
            if index == old_name:
                data["index"] = new_name
                f = d / conf.FOLDER_CONF
                conf._write_any(f, data, lambda x: conf.write_folder(f, x))
            out.info(f"index 跟随改名 → {repo.rel(root, d / (new_name + '.md'))}")

    out.ok(f"移动 {old_rel} → {new_rel}")
    if old_name != new_name:
        page = fm.parse(repo.node_page(d))
        if page and page.title != new_name:
            out.warn(f"frontmatter 的 title 仍是「{page.title}」，与新名字「{new_name}」不一致——要改自己改")
    conf.rewrite_path_keys(root, conf.node_key(old_rel), conf.node_key(new_rel), out)
    # 父层 .folder.json 的键按 folders 的规则（文件去掉最后一个扩展名、文件夹原名），不是 node_name（只去 .md）
    from core import folders
    old_key = s.name if d.is_dir() else folders.split_name(s.name)[0]
    new_key = d.name if d.is_dir() else folders.split_name(d.name)[0]
    conf.sync_folder_conf(root, s.parent, old_key, d.parent, new_key, out)
    def moved(k):
        return new_node + k[len(old_node):] if k == old_node or k.startswith(old_node + "/") else k
    n = _relink(root, before, out, moved)
    n += _rewrite_refs(root, old_rel, new_rel, out)
    if n == 0:
        out.info("没有需要修复的引用")
    _sync(root, [s.parent, d], out)
    if where:
        try:
            _place(d.parent, new_key, where, rkey)
        except ValueError as e:
            out.err(f"已移动，但没能排到指定位置：{e}")    # 非 0：界面别把它当成排好了
            return 1
    return 0
