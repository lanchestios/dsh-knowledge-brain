"""wiki init —— 新建知识库：在当前目录按模板建库（插件「新建」按钮与命令行共用这一份）。

不要求已经是库（不走 find_root）。按顺序：
  1. git：没有 .git 就 git init；.gitignore 缺哪行补哪行（.wiki 的本机产物与 raw/project/ 不入库；raw/ 其余素材入库）。
  2. .wiki 状态：wiki.json（version + 五区 parts）、anchors.conf、tmp/ 缺哪个补哪个，已有的不动。
  3. 多余顶层项（repo.top_extras）挪进 .wiki/backup/init-<时间>/，保留相对路径。
  4. 七个固定目录（repo.FIXED_DIRS）缺的建上。
  5. 种子：某个区文件夹在第 4 步之前就存在 → 这个区一个种子都不拷；否则按模板拷整棵子树。
  6. 骨架与文件夹页：区门面、规则二的固定类目（new_skeleton），沉淀区缺页的文件夹补页。
  7. frontmatter：沉淀区每页，合规字段不动；缺的必填字段补上；没有 frontmatter 的补一整块；
     source 指向不存在文件的条目删掉。
  8. 文件夹配置：沉淀区每个文件夹补齐 .folder.json（folders.fix_tree）。
  9. 跑一次 wiki check，结果并进报告。

插件用 --json 拿结构化报告；--plan 只看要挪什么、不改任何东西。
"""

import io
import json
import shutil
import subprocess
import sys
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path

from check import check
from core import conf
from core import pagefile
from core import folders
from core import frontmatter as fm
from core import repo

# 与插件 src/core/vault/init.ts 的 WIKI_VERSION 一致（test_init 在插件仓里对照）
WIKI_VERSION = 5
SEEDS = Path(__file__).resolve().parent.parent / "seeds"
TEMPLATES = ("minimal", "preset")
ACTOR = "process:dsh-knowledge-brain"
GITIGNORE_LINES = [".wiki/tmp/", ".wiki/backup/", ".wiki/bin", ".wiki/skills", ".wiki/agents", "raw/project/"]
ANCHORS_CONF = """# 锚点校验的外部代码基线 —— wiki page anchor 的唯一真源。
# 段头 [路径前缀]；段内一行一个仓：<名字> <路径> <commit>；commit 必须钉死。
# 本仓不引用外部代码时保持空文件即可。
"""


def _refuse(root: Path):
    """家目录与文件系统根上不建库：第 3 步会把那里的东西整体挪走。"""
    if root == Path.home().resolve() or root == Path(root.anchor):
        return f"不在家目录或文件系统根上建知识库：{root}"
    if not root.is_dir():
        return f"目录不存在：{root}"
    return None


def _git(root: Path) -> bool:
    inited = False
    if not (root / ".git").exists():
        subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
        inited = True
    gi = root / ".gitignore"
    have = gi.read_text(encoding="utf-8").splitlines() if gi.exists() else []
    miss = [x for x in GITIGNORE_LINES if x not in have]
    if miss:
        head = "" if not have or have[-1] == "" else "\n"
        with gi.open("a", encoding="utf-8") as f:
            f.write(head + "# wiki 不入库的：临时区、迁移备份、指向插件包的软链、raw/project/ 下的外部代码仓\n" + "\n".join(miss) + "\n")
    return inited


def _wiki_state(root: Path):
    w = root / ".wiki"
    (w / "tmp").mkdir(parents=True, exist_ok=True)
    if not (root / conf.WIKI_CONF).exists():
        conf.write_wiki(root, conf.default_wiki(WIKI_VERSION))
    if not (w / "anchors.conf").exists():
        (w / "anchors.conf").write_text(ANCHORS_CONF, encoding="utf-8")


def _backup_dir(root: Path) -> Path:
    base = root / ".wiki" / "backup" / f"init-{datetime.now():%Y%m%d-%H%M%S}"
    d, n = base, 2
    while d.exists():
        d, n = base.with_name(f"{base.name}-{n}"), n + 1
    return d


def _move_extras(root: Path, extras: list):
    if not extras:
        return None
    d = _backup_dir(root)
    d.mkdir(parents=True)
    for name in extras:
        shutil.move(str(root / name), str(d / name))
    return repo.rel(root, d)

def _seed(root: Path, template: str, existed: dict):
    """按模板拷种子。

    区不存在 → 整棵子树拷过去。区已存在 → 区根的文件（门面、用户自己的页）一个不拷；
    种子子树（如 知识/知识工程/）里缺的文件补上，已有的一律不覆盖——别的区门面链向这些页，
    不补会断链、库打不开。
    """
    at, today = repo.now_iso(), repo.today()
    seeded, skipped = [], []
    for a in repo.DEPOSIT_DIRS:
        src = SEEDS / template / a
        if existed[a]:
            skipped.append(a)
        if not src.is_dir():
            continue
        for s in sorted(src.rglob("*")):
            t = root / a / s.relative_to(src)
            if existed[a] and (s.parent == src or t.exists()):
                continue                  # 已有区：区根不碰、已有的不覆盖
            if s.is_dir():
                t.mkdir(parents=True, exist_ok=True)
            elif s.suffix == ".md":
                t.parent.mkdir(parents=True, exist_ok=True)
                t.write_text(s.read_text(encoding="utf-8").replace("{{at}}", at).replace("{{today}}", today),
                             encoding="utf-8")
            else:
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(s, t)
        if not existed[a]:
            seeded.append(a)
    return seeded, skipped


def _skeleton(root: Path) -> list:
    """区门面 + 规则二固定类目（new_skeleton，幂等），再给沉淀区缺页的文件夹补页（规则一）。"""
    before = {repo.rel(root, p) for p in repo.iter_md(root)}
    new_skeleton(root, by=ACTOR)
    for d in repo.iter_dirs(root):
        r = repo.rel(root, d)
        if repo.in_deposit(r) and repo.needs_index(root, d) and not repo.index_of(d).exists():
            pagefile.write_page(repo.index_of(d), d.name, by=ACTOR)
    return sorted({repo.rel(root, p) for p in repo.iter_md(root)} - before)


def _blank_value(p, key):
    """补缺字段时填什么。摘要和标题不能瞎编，只有日期能推。"""
    if key in ("created", "updated"):
        return repo.today()
    if key in ("tags", "source"):
        return "[]"
    if key == "description":
        return ""
    return repo.node_name(p)


def _frontmatter(root: Path):
    """合规的不动；缺字段补（_blank_value：日期补今天、列表补 []、description 留空）；没有 frontmatter 的补整块；断链 source 删。"""
    fixed, dropped = [], []
    for p in repo.iter_md(root):
        r = repo.rel(root, p)
        if not (repo.in_deposit(r) and repo.needs_frontmatter(r)):
            continue
        text = p.read_text(encoding="utf-8")
        # BOM 与开头空行不算正文：带着它们的 frontmatter 照样是有 frontmatter，不能再叠一块
        if not text.lstrip("\ufeff").lstrip().startswith(fm.DELIM):
            head = {k: _blank_value(p, k) for k in check.REQUIRED_FIELDS}
            fields = {"title": head["title"], "description": "", "tags": [], "source": [],
                      "created": head["created"], "updated": head["updated"]}
            p.write_text(f"{fm.render(fields)}\n\n{text}", encoding="utf-8")
            fixed.append(r)
            continue
        page = fm.parse(p)
        if page is None:
            continue                      # frontmatter 坏了：猜不出原意，留给 check 报
        touched = False
        for k in check.REQUIRED_FIELDS:
            if k not in page.fields:
                fm.set_scalar(p, k, _blank_value(p, k))
                touched = True
        keep = [s for s in page.sources if repo.source_exists(root, s)]
        if keep != page.sources:
            dropped += [f"{r} → {s}" for s in page.sources if s not in keep]
            fm.set_list(p, "source", keep)
            touched = True
        if touched:
            fixed.append(r)
    return fixed, dropped


def _check(root: Path):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = check.run(root)
    return rc == 0, buf.getvalue()


def plan(root: Path) -> dict:
    return {"git": (root / ".git").exists(), "extras": repo.top_extras(root)}


def build(root: Path, template: str) -> dict:
    git_inited = _git(root)
    _wiki_state(root)
    moved = repo.top_extras(root)
    backup = _move_extras(root, moved)
    existed = {a: (root / a).is_dir() for a in repo.DEPOSIT_DIRS}
    for d in repo.FIXED_DIRS:
        (root / d).mkdir(exist_ok=True)
    seeded, skipped = _seed(root, template, existed)
    with redirect_stdout(io.StringIO()):          # new_skeleton 自己会打印，报告里另有 created
        created = _skeleton(root)
    fixed, dropped = _frontmatter(root)
    with redirect_stdout(io.StringIO()):
        folders.fix_tree(root)
    ok, output = _check(root)
    return {"git_inited": git_inited, "template": template, "seeded": seeded, "skipped": skipped,
            "moved": moved, "backup": backup, "created": created, "fixed": fixed, "dropped": dropped,
            "check_ok": ok, "check_output": output}


def main(cwd: Path, args: list) -> int:
    root = Path(cwd).resolve()
    as_json = "--json" in args
    why = _refuse(root)
    if why:
        print(why, file=sys.stderr)
        return 2
    if "--plan" in args:
        r = plan(root)
        print(json.dumps(r, ensure_ascii=False) if as_json else
              f"git：{'已有' if r['git'] else '将初始化'}；将迁移：{'、'.join(r['extras']) or '无'}")
        return 0
    template = args[args.index("--template") + 1] if "--template" in args and args.index("--template") + 1 < len(args) else ""
    if template not in TEMPLATES:
        print(f"--template 只能是 {' / '.join(TEMPLATES)}", file=sys.stderr)
        return 2
    r = build(root, template)
    if as_json:
        print(json.dumps(r, ensure_ascii=False))
        return 0
    if r["git_inited"]:
        print("✓ 已初始化 git")
    print("✓ 已初始化知识库模板")
    if r["backup"]:
        print(f"✓ 已迁移无关文件到 {r['backup']}")
    print(r["check_output"].rstrip())
    return 0 if r["check_ok"] else 1


def new_skeleton(root: Path, by=None) -> int:
    """把规则二要求的固定骨架补齐：五区门面、经历/ 与 认知/ 的固定类目（文件夹页）。幂等——已有的一概不碰。

    只给 wiki init 建库用，没有命令入口：建好以后缺了骨架由 wiki check 报，照 _check_skeleton 的修法补。
    """
    out = repo.Out()
    by = repo.actor(root, by)
    n = 0
    if not (root / conf.WIKI_CONF).exists():
        conf.write_wiki(root, conf.default_wiki(WIKI_VERSION))
        out.ok(f"新建 {conf.WIKI_CONF}")
        n += 1
    for top in repo.DEPOSIT_DIRS:                     # 七个固定目录里的沉淀五区
        d = root / top
        if not repo.index_of(d).exists():
            pagefile.write_page(repo.index_of(d), top, by=by)
            out.ok(f"新建 {repo.rel(root, repo.index_of(d))}")
            n += 1
        for cat in repo.skeleton_for(top):
            if not repo.index_of(d / cat).exists():
                (d / cat).mkdir(parents=True, exist_ok=True)
                pagefile.write_page(repo.index_of(d / cat), cat, by=by)
                out.ok(f"新建 {repo.rel(root, repo.index_of(d / cat))}")
                n += 1
    if n == 0:
        out.info("骨架已经是齐的")
    pagefile.sync_folders(root, [root / top / cat for top in repo.DEPOSIT_DIRS for cat in repo.skeleton_for(top)] + [root / top for top in repo.DEPOSIT_DIRS], out)
    return 0
