"""wiki check —— 校验：顶层 / 编码 / 结构 / 骨架 / frontmatter / 引用 / 卫生 / 嵌入件 / 语法 / 围栏与公式。

每条规则的 docstring 写了三件事：查什么、为什么、违规了怎么改。知识库没通过校验时
插件拒绝打开它，修复者（人或 AI）按报错前缀（「顶层：」「引用：」……）找到对应的
_check_* 函数，照「违规怎么改」逐条修，改完再跑 `wiki check`，直到通过。
命令一律在库根跑：`./.wiki/bin/wiki <子命令>`，用法见 `wiki --help`。
`raw/` 素材区不归开库校验管；书的章节质检是 `wiki book qc`。
"""

import re
import shutil
import subprocess
from pathlib import Path

from core import conf
from core import folders
from core import links
from core import frontmatter as fm
from core import repo
from upgrade import upgrade

REQUIRED_FIELDS = ["title", "description", "tags", "source", "created", "updated"]


def _md(root):
    """check 管的 md：仓库作用域内、且不在 raw/ 下——素材区只进不改，开库校验一律不碰（半成品书不能挡开库）。"""
    return (p for p in repo.iter_md(root) if not _in_raw(repo.rel(root, p)))


def _dirs(root):
    return (d for d in repo.iter_dirs(root) if not _in_raw(repo.rel(root, d)))


def _in_raw(r: str) -> bool:
    return r == repo.RAW or r.startswith(repo.RAW + "/")


def _check_version(root, out):
    """版本（.wiki/wiki.json 的 version）。报错前缀「版本：」。

    查什么：version 读得出（整数），且等于工具认的库版本（init.WIKI_VERSION）。
    为什么：库结构每变一次版本加一，变化由 lib/upgrade/steps/v<N>.py 落到库里。没升级的库拿新规则校验会
      大面积报错，真因是版本没升、不是那些页本身；版本对不上时先看这一条。
    违规怎么改：
      - 库版本低 → 库根跑 `./.wiki/bin/wiki upgrade`（逐级升级，改动留在工作区，
        `git diff` 可查）；升级报的问题照改，再跑到成功。wiki check 只校验，不代跑升级。
      - 库版本高 → 库是更新的插件建或升过的，先升级 dsh-knowledge-brain 插件，别把 version 改小。
      - 读不出 → 在 wiki.json 写上 `"version": <库的版本>`（当前工具认的是 init.WIKI_VERSION）。
    """
    have, want = upgrade.read_version(root), upgrade.current()
    if have is None:
        out.err(f"版本：{conf.WIKI_CONF} 读不出 version（缺失或格式不对）")
    elif have < want:
        out.err(f"版本：库是 v{have}，工具是 v{want}——先跑 wiki upgrade")
    elif have > want:
        out.err(f"版本：库是 v{have}，比工具认的 v{want} 新——先升级 dsh-knowledge-brain 插件")


def _check_top(root, out):
    """顶层：库根只放七个固定目录（repo.FIXED_DIRS）与白名单文件（repo.TOP_ALLOW_FILES）。

    为什么：插件、CLI、AI 都按这六个目录找东西；根上散落的别的东西没有归属，
    读者和工具都不知道它算素材、附件还是正文。
    违规怎么改：
      - 缺固定目录 → 建出这个空目录（`mkdir <名>`），空着也合法。
      - 多余条目 → 判断它是什么再挪：别人写的原件进 raw/document/<日期>/<名>/（`wiki document add`），
        图片等附件进 asset/，自己写的正文挪进五区合适的位置（`wiki page new` 建页再搬内容），
        不需要的删掉。`.` 开头的工具目录不归这条管。
    """
    for d in repo.FIXED_DIRS:
        if not (root / d).is_dir():
            out.err(f"顶层：缺固定目录 —— {d}/")
    for name in repo.top_extras(root):
        out.err(f"顶层：多余条目 —— {name}（库根只允许 {' / '.join(repo.FIXED_DIRS)} 与 "
                f"{'、'.join(sorted(repo.TOP_ALLOW_FILES))}）")


def _check_encoding(root, out):
    """编码。报错前缀「编码：」。

    查什么：五区与库根的 md 能按 UTF-8 解码（raw/ 不查，素材原样收）。
    为什么：后面每条规则都按 UTF-8 读正文，一个 GBK 文件会让整个 wiki check 崩掉、看不出是哪个文件；
      所以这条报了错，run() 就不再往下跑。
    违规怎么改：用编辑器把该文件另存为 UTF-8（或 `iconv -f GBK -t UTF-8 <文件> > <新文件>` 后替换）。
    """
    for p in _md(root):
        try:
            p.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            out.err(f"编码：不是 UTF-8 —— {repo.rel(root, p)}")


def _check_structure(root, out):
    """结构（规则一 · 按需生长）。报错前缀「结构：」。

    查什么：沉淀区每个文件夹都有自己的页（`X/X.md`，或 `.folder.json` 的 index 改指）；
      平铺 `X.md` 与文件夹 `X/` 不能并存。
    为什么：一个节点只能有一个正文入口，读者和双链解析才找得到它。
    违规怎么改：
      - 文件夹缺页 → `wiki page new <文件夹路径> <标题>`，或把已有页挪成 `X/X.md`（`wiki page move`）。
      - X.md 与 X/ 并存 → `wiki page grow X.md`，把平铺页收进文件夹。
    """
    for d in _dirs(root):
        r = repo.rel(root, d)
        if repo.needs_index(root, d) and not repo.index_of(d).exists():
            out.err(f"结构：文件夹缺页 —— {r}/ 应有 {repo.index_of(d).name}")
    # 平铺 X.md 与文件夹 X/ 并存 = 该升级没升级
    for p in _md(root):
        if repo.is_folder_page(p):
            continue
        sib = p.parent / p.stem
        if sib.is_dir():
            out.err(f"结构：{repo.rel(root, p)} 与同名文件夹并存 —— 应执行 wiki page grow")


def _check_skeleton(root, out):
    """骨架（规则二 · 固定骨架）。报错前缀「骨架：」。

    查什么：认知/ 下必须有 见解/ 方法论/ 原则/；经历/ 下必须有 观察/ 实践/；系统/ 二层按名字分级——
      系统/<平台>/ 下必须有 业务域规划/ 与 业务域落地/，系统/<系统>/ 下必须有 系统域规划/。
      哪些目录该有哪些子目录，全从 repo.skeleton_for 读。
    为什么：固定类目让同类内容永远落在同一处，跨域、跨时间才能横向比较。
    违规怎么改：缺哪个类目就先 `wiki page new <所在目录>/<类目>`，再 `wiki page grow <所在目录>/<类目>.md`
      把它长成文件夹页——只跑 page new 建出的是平铺 md，骨架照样报缺。新业务域按 wiki 技能「规则二」的建法：
      `wiki page new 系统/<平台>` 建域页（名以「平台」收尾），业务域规划/业务域落地各 page new + page grow。
    """
    for d in [root, *_dirs(root)]:
        r = "." if d == root else repo.rel(root, d)
        for cat in repo.skeleton_for(r):
            if not (d / cat).is_dir():
                out.err(f"骨架：{r}/ 缺固定类目 {cat}/")


def _check_frontmatter(root, out):
    """frontmatter。报错前缀「frontmatter：」「生命周期：」「信任：」。

    查什么：沉淀页都有 frontmatter 且含必填字段 REQUIRED_FIELDS；status / progress 取值在词表内；generated / verified 的格式；created / updated 是合法日期。
    为什么：插件的列表、排序、信任层、阅读进度全读这些字段，缺了或写错页面就不显示或显示错。
    违规怎么改：
      - 缺字段 → 照库里任一合规页的头部补上：created / updated 写今天（YYYY-MM-DD），tags / source 写 []，
        title 写页名，description 写一句真摘要（拿不准就留空，交给人补）。
      - 无法解析或缺失 → 打开文件，按库里任一合规页的头部格式写好 `---` 包住的块。
      - 词表外取值 → 改成词表里的值（`wiki page mark <路径> draft|stable|deprecated` 改 status）。
      - 日期不合法 → 改成 YYYY-MM-DD；generated / verified 照 `{by: <身份>, at: <ISO 时刻>}` 写。
    """
    for p in _md(root):
        r = repo.rel(root, p)
        if not repo.needs_frontmatter(r):
            continue
        page = fm.parse(p)
        if page is None:
            out.err(f"frontmatter：无法解析或缺失 —— {r}")
            continue
        for k in REQUIRED_FIELDS:
            if k not in page.fields:
                out.err(f"frontmatter：缺字段 {k} —— {r}")
        for msg in (repo.status_problem(page.fields.get("status")),
                    repo.progress_problem(page.fields.get("progress"))):
            if msg:
                out.err(f"生命周期：{msg} —— {r}")
        for msg in repo.trust_problems(page.generated, page.verified):
            out.err(f"信任：{msg} —— {r}")
        for k in ("created", "updated"):
            v = page.fields.get(k)
            if isinstance(v, str) and v and not repo.is_iso_date(v):
                out.err(f"frontmatter：{k} 不是合法的 YYYY-MM-DD —— {r}（{v}）")


def _check_refs(root, out):
    """引用。报错前缀「引用：」。

    查什么：frontmatter `source` 每条都指向存在的文件；沉淀区页正文的 [[双链]] 解析到唯一一个沉淀区的页（规则见 lib/core/links.py）；
      [[页#锚]] 的锚对得上目标页的某个标题（slug 规则同插件 github-slugger，同名标题按 -1、-2 去重）；
      `![](asset/….html?h=N)` 嵌入件在 asset/ 下、声明了高度且在允许范围内；
      正文里 `](asset/…)` 指向的图片 / 文件存在；
      沉淀五区的附件引用只指向 asset/（指 raw/ 素材图或相对路径的附件都报错）。
    为什么：断链在阅读器里点不开，在 AI 检索时变成无从核对的断言；素材与沉淀分离，素材图随素材走、不进 asset/。
    违规怎么改：
      - source 不存在 → 素材被挪过就改成新路径；素材确实没了就删掉这一条。
      - 双链不存在 → 改成正确页名或路径，或先 `wiki page new` 建出那一页；页改过名用 `wiki page move` 修。
      - 同名歧义 → 写成从区根起的路径形式 `[[系统/<域>/<页>]]`（不带 .md，文件夹页写到文件夹），展示仍是页名。
      - 只能指向沉淀区 → 素材 / 书不用双链：路径写进本页 frontmatter 的 source，正文里写纯文字。
      - 锚点找不到 → 改成目标页现有标题的原文（同名第二个起写 `标题-1`），标题改过名就跟着改；不需要定位就去掉 `#…`。
      - 嵌入件 → 把附件放到 asset/ 下并写 `?h=<高度>`。
      - 附件不存在 → 路径写错就改正（仓库根起 `asset/…`，文件名有空格写 %20）；文件确实没了就补回或删掉这处引用。
      - 五区引了非 asset/ 附件 → 素材区的图复制一份进 asset/ 再引；素材本体写进 source，不在正文挂链接。
    """
    ix = links.Index(root)
    heads = {}

    def slugs_of(key):
        if key not in heads:
            heads[key] = links.heading_slugs(links.split_fm(ix.paths[key].read_text(encoding="utf-8"))[1])
        return heads[key]

    # 先滤掉 raw/ 再解析：raw/ 下的进度页、听录编码不归库管，解析了非 UTF-8 会崩
    for p in _md(root):
        r = repo.rel(root, p)
        if not repo.needs_frontmatter(r):
            continue
        page = fm.parse(p)
        if page is None:
            continue
        for s in page.sources:
            if not repo.source_exists(root, s):
                out.err(f"引用：source 指向的文件不存在 —— {r} → {s}")
        if repo.in_deposit(r):
            for target, anchor, _l in links.links_in(page.body):
                state, val = ix.resolve(target)
                if state == "ok":
                    if anchor and links.slug(anchor) not in slugs_of(val):
                        out.err(f"引用：双链锚点在目标页找不到标题 —— {r} → [[{target}#{anchor}]]")
                elif state == "missing":
                    out.err(f"引用：双链指向的页面不存在 —— {r} → [[{target}]]")
                elif state == "ambiguous":
                    out.err(f"引用：双链同名歧义 —— {r} → [[{target}]]（候选：{'、'.join(val)}；写成路径形式）")
                elif state == "outside":
                    out.err(f"引用：双链只能指向沉淀区 —— {r} → [[{target}]]（素材写进 source）")
        for e, q in page.embeds():
            if not (e.startswith(f"{repo.ASSET}/") and ".." not in e.split("/") and (root / e).is_file()):
                out.err(f"引用：嵌入件不存在或不在 asset/ 下 —— {r} → ![]({e}{q})")
                continue
            h = repo.EMBED_H_RE.fullmatch(q)
            if e.endswith(".excalidraw"):
                # excalidraw 图位：?h= 可选（默认等比压栏宽）；写了就只认 ?h=数字 且落区间
                if q and not h:
                    out.err(f"引用：excalidraw 高度参数只认 ?h=数字（不写则等比压栏宽）—— {r} → ![]({e}{q})")
                elif h and not repo.EMBED_H_MIN <= int(h.group(1)) <= repo.EMBED_H_MAX:
                    out.err(f"引用：嵌入件高度 {h.group(1)} 超出 {repo.EMBED_H_MIN}–{repo.EMBED_H_MAX} —— {r} → ![]({e}{q})")
            elif not h:
                out.err(f"引用：嵌入件未声明高度（写 ![]({e}?h=高度)）—— {r}")
            elif not repo.EMBED_H_MIN <= int(h.group(1)) <= repo.EMBED_H_MAX:
                out.err(f"引用：嵌入件高度 {h.group(1)} 超出 {repo.EMBED_H_MIN}–{repo.EMBED_H_MAX} —— {r} → ![]({e}{q})")
    # 附件：图片 / 文件链接从仓库根写 asset/…。嵌入件上面已报，不重复
    for p in _md(root):
        r = repo.rel(root, p)
        for a in repo.dead_asset_refs(root, p.read_text(encoding="utf-8")):
            out.err(f"引用：附件不存在 —— {r} → {a}")
    # 五区附件只能用 asset/：素材与沉淀分离——素材图随素材走在 raw/，沉淀页要引就把图复制进 asset/
    for p in _md(root):
        r = repo.rel(root, p)
        if not repo.in_deposit(r):
            continue
        for t in repo.nonasset_attachment_refs(p.read_text(encoding="utf-8")):
            out.err(f"引用：五区附件只能用 asset/ 下的资源 —— {r} → {t}")
    # raw/ 素材里的 asset/ 引用：坏了只警告（素材只进不改，不能挡开库）；编码不归库管，读坏字节不崩
    for p in repo.iter_md(root):
        r = repo.rel(root, p)
        if not _in_raw(r):
            continue
        for a in repo.dead_asset_refs(root, p.read_text(encoding="utf-8", errors="replace")):
            out.warn(f"引用：素材里的附件不存在 —— {r} → {a}")


def _check_hygiene(root, out):
    """卫生。报错前缀「卫生：」。

    查什么：沉淀区与附件区没有空文件夹（七个固定目录本身除外）。
    为什么：空文件夹在目录树里是假节点。
    违规怎么改：空文件夹删掉，或往里放该有的页。
    """
    for d in _dirs(root):
        if repo.rel(root, d) in repo.FIXED_DIRS:
            continue                      # 固定目录空着合法：新库的 asset/、raw/ 本来就空
        if not any(d.iterdir()):
            out.err(f"卫生：空文件夹 —— {repo.rel(root, d)}/")


def _check_folder_conf(root, out):
    """文件夹配置（<文件夹>/.folder.json）。报错前缀「文件夹配置：」。

    查什么：沉淀五区（含区根）每个文件夹都有 .folder.json，是合法 JSON，字段全部必填、不许有别的字段：
        {
          "index": "<本文件夹的页名，不带 .md>",
          "children": {
            "<子节点>": {"type": "file", "ext": "md", "order": 1},
            "<子文件夹>": {"type": "folder", "ext": "folder", "order": 2}
          }
        }
      index 指向存在的 md；children 恰好列出文件夹里的每个文件与子文件夹（文件夹自己的页、. 开头的、
      .folder.json 本身除外），键 = 文件去掉最后一个扩展名 / 文件夹名；type 是 file / folder；
      file 的 ext 是扩展名（不带点，无扩展名写 ""），folder 的 ext 写 "folder"；order 是同层不重复的正整数。
    为什么：.folder.json 是这一层目录的清单与排序依据，和磁盘对不上，目录树与文件夹页就不可信。
    违规怎么改：.folder.json 由 wiki page 命令与 wiki init 维护，绕开命令改了目录就要手工改它：
      - 漏列 → 在 children 里补一条，order 接在本层最大值后面：`"名": {"type": "file", "ext": "md", "order": 7}`。
        叶子文件夹是 `"children": {}`，补的时候把条目写进花括号里，注意条目之间的逗号。
      - 多列 → 删掉那一条（连同多出的逗号）；type / ext 不对 → 改成实际值；缺字段 → 补上；不认识的字段 → 删掉。
      - order 重复或不是正整数 → 改成本层没用过的正整数；想调先后就改 order。
      - 缺整个 .folder.json → 照同级文件夹的写法新建，列这一层的每个文件与子文件夹。不列：文件夹自己的页
        （index 指的那页）、`.` 开头的、.folder.json 本身。
      - 去掉扩展名后同名 → 改掉其中一个的名字（`wiki page move`）。
      - 写坏了 → 照报错的行列号修好 JSON 语法（常见是多了或少了逗号、用了单引号）。
      - index 指向不存在的文件 → 改成真实存在的 md 文件名（不带 .md），默认是文件夹名。
    """
    for d in folders.deposit_dirs(root):
        for e in folders.check_dir(root, d):
            out.err(e)


def _check_parts(root, out):
    """全局配置（.wiki/wiki.json 的 parts）。报错前缀「配置：」。

    查什么：wiki.json 是合法 JSON，只有 version 与 parts 两个字段；parts 恰好是沉淀五区（经历 认知 学习 知识 系统），
      每个区只有一个字段 order，是不重复的正整数。
    为什么：插件按 parts 决定显示哪些区、按什么顺序。
    违规怎么改：照下面的形状改 .wiki/wiki.json（version 保留原值）：
        {
          "version": 3,
          "parts": {
            "经历": {"order": 1},
            "认知": {"order": 2},
            "学习": {"order": 3},
            "知识": {"order": 4},
            "系统": {"order": 5}
          }
        }
    """
    f = root / conf.WIKI_CONF
    if not f.is_file():
        return            # 缺文件「版本：」已报
    try:
        data = conf.read_json(f)
    except ValueError as e:
        out.err(f"配置：{conf.WIKI_CONF} 解析失败 —— {e}")
        return
    for k in sorted(conf.WIKI_KEYS - set(data)):
        out.err(f"配置：{conf.WIKI_CONF} 缺字段 —— {k}")
    for k in sorted(set(data) - conf.WIKI_KEYS):
        out.err(f"配置：{conf.WIKI_CONF} 有不认识的字段 —— {k}")
    parts = data.get("parts")
    if "parts" in data and not isinstance(parts, dict):
        out.err(f"配置：{conf.WIKI_CONF} 的 parts 必须是对象（区名: {{order}}）")
        return
    parts = parts or {}
    for n in [a for a in repo.DEPOSIT_DIRS if a not in parts]:
        out.err(f"配置：{conf.WIKI_CONF} 的 parts 缺 {n}")
    for n in [a for a in parts if a not in repo.DEPOSIT_DIRS]:
        out.err(f"配置：{conf.WIKI_CONF} 的 parts 有不是沉淀区的 {n}")
    seen = {}
    for n, v in parts.items():
        if not isinstance(v, dict):
            out.err(f"配置：{conf.WIKI_CONF} 的 {n} 必须是对象 {{order}}")
            continue
        for k in sorted(conf.PART_KEYS - set(v)):
            out.err(f"配置：{conf.WIKI_CONF} 的 {n} 缺字段 —— {k}")
        for k in sorted(set(v) - conf.PART_KEYS):
            out.err(f"配置：{conf.WIKI_CONF} 的 {n} 有不认识的字段 —— {k}")
        if "order" not in v:
            continue
        if not conf.is_order(v["order"]):
            out.err(f"配置：{conf.WIKI_CONF} 的 {n} 的 order 必须是正整数 —— 写的 {v['order']!r}")
        elif v["order"] in seen:
            out.err(f"配置：{conf.WIKI_CONF} 的 order {v['order']} 重复 —— {seen[v['order']]}、{n}")
        else:
            seen[v["order"]] = n


def _check_path_confs(root, out):
    """路径类配置（anchors.conf 段头、wiki.json 的 parts）。报错前缀「配置：」。

    查什么：这些配置里按路径写的键都指向存在的节点。
    为什么：节点挪了而配置没跟着改，锚点基线与区顺序就悄悄失效。
    违规怎么改：把键改成节点的新路径（报错里给了按 git 改名记录推出的新路径就照它改），
      节点确实没了就删掉那一段。以后挪节点用 `wiki page move`，它会一起改这些键。
    """
    for rel_, key in conf.dangling_keys(root):
        to = conf.renamed_to(root, key)
        hint = f"（按 git 改名记录，它现在是 {to}）" if to else ""
        out.err(f"配置：{rel_} 的 {key} 指向不存在的节点{hint}")


def _check_assets(root, out):
    """附件。警告前缀「卫生：asset/ 下没人引用的附件」——只警告，不挡开库（补图做到一半、图还没插进正文是常态）。

    查什么：asset/ 下每个附件至少被一页引用（正文从仓库根写 `asset/…`）。
    为什么：没人引用的附件是死重量，也常常是引用路径写错了的信号。
    违规怎么改：引用路径写错了就改正文（从仓库根写 `![](asset/…)`，不写 `../`）；
      确实没用了就删掉这个文件。
    """
    for r in repo.orphan_assets(root):
        out.warn(f"卫生：asset/ 下没人引用的附件 —— {r}")


_STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
_CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
_OWN_SCHEME_RE = re.compile(r"(?<![\w-])color-scheme\s*:")
_BG_RE = re.compile(r"(?<![\w-])background(?:-color)?\s*:\s*([^;]+)")


def _check_embed_theme(root, out):
    """嵌入件明暗。报错前缀「嵌入件：」。

    查什么：asset/ 下自带 <style> 的 html——
      1. 颜色跟宿主切：暗色变量挂 `html[data-dsh-theme="dark"]`（浅色回挂 `="light"`），或直接写 `light-dark(浅, 深)`；
      2. 不自己声明 `color-scheme`（`@media (prefers-color-scheme: …)` 不算）；
      3. `html` / `body` 的背景透明（不写，或写 transparent / none）。
    为什么：DSH 的夜间模式在宿主页上，沙箱 iframe 里的 prefers-color-scheme 只跟系统走。插件下发 asset 页时
      把宿主明暗写进 `<html data-dsh-theme>`、切换时广播，并按这个属性统一注入 color-scheme——页里只认这个属性
      才跟得上 DSH。页里自己写 color-scheme 会与宿主错位，Chromium 在 iframe 背后垫一层不透明白底（或黑底）；
      背景不透明则嵌入件在正文里成一块色板。
    违规怎么改：
      - 明暗没跟宿主 → 在 `@media (prefers-color-scheme: dark)` 那套暗色变量旁再挂一份 `html[data-dsh-theme="dark"]{…}`，
        浅色值回挂 `html[data-dsh-theme="light"]{…}`；或把颜色改写成 `light-dark()`。JS 里自己选色的读
        `document.documentElement.dataset.dshTheme` 优先、matchMedia 兜底，并盯这个属性的变化重画。
      - 自己声明了 color-scheme → 删掉，插件统一注入。
      - 背景不透明 → `html` / `body` 背景改 transparent，底色交给宿主；要色块就画在内部容器上。
    JS 里写死的颜色（canvas fillStyle 等）这里查不到，靠「读属性 + 盯变化」的写法自己守。
    """
    asset = root / repo.ASSET
    if not asset.is_dir():
        return
    for p in sorted(asset.rglob("*.htm*")):
        if p.suffix.lower() not in (".html", ".htm"):
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        css = _CSS_COMMENT_RE.sub("", "\n".join(_STYLE_RE.findall(text)))
        if not css.strip():
            continue
        r = repo.rel(root, p)
        if "data-dsh-theme" not in text and "light-dark(" not in css:
            out.err(f"嵌入件：明暗没跟宿主（暗色变量挂 html[data-dsh-theme=\"dark\"]，或改用 light-dark()）—— {r}")
        if _OWN_SCHEME_RE.search(css):
            out.err(f"嵌入件：自己声明了 color-scheme（删掉，插件按宿主统一注入）—— {r}")
        for sel, body in _CSS_RULE_RE.findall(css):
            if not any(s.strip() in ("html", "body") for s in sel.split(",")):
                continue
            bad = [v.strip() for v in _BG_RE.findall(body) if v.strip().lower() not in ("transparent", "none")]
            if bad:
                out.err(f"嵌入件：页面背景不透明（html/body 背景改 transparent）—— {r} → {sel.strip()} {{background: {bad[0]}}}")
                break


def run_validate_md(root, files):
    """跑一趟 lib/check/validate_md.mjs，返回 ({"syntax": [...], "fence": [...]}, "")；没跑成返回 (None, 原因)。

    两项都要拿渲染管线的 AST 才验得准，一趟解析分两组出。依赖不在这层探测目录：bare specifier 由 Node
    从 validate_md.mjs 的位置向上解析，dev/web 形态落插件根 node_modules、desktop hoisted 形态落 profile 根
    node_modules，硬探某一层必探错另一种形态；缺依赖时 mjs 自己退 3，这里按退出码分开说话。"""
    node = shutil.which("node")
    if node is None:
        return None, "需要 Node（依赖随 dsh-knowledge-brain 插件安装）"
    script = Path(__file__).parent / "validate_md.mjs"
    try:
        r = subprocess.run([node, str(script), str(root)], input="\n".join(files),
                           text=True, capture_output=True, timeout=600)
    except subprocess.TimeoutExpired:
        return None, "脚本超时"
    if r.returncode == 3:
        return None, "依赖未装（随 dsh-knowledge-brain 插件分发，重装插件后启用）"
    if r.returncode != 0:
        return None, f"脚本未跑成（exit {r.returncode}）—— {(r.stderr or '').splitlines()[0] if r.stderr else ''}"
    groups = {"syntax": [], "fence": []}
    # 「路径:行 组 kind 消息」——路径可能带空格（书的章节「1.1 标题.md」、四区的 Gradient Descent.md），按「:行号 组 」定位
    out_line = re.compile(r"^(.+?:\d+) (syntax|fence) (.*)$")
    for line in r.stdout.splitlines():
        m = out_line.match(line)
        if m:
            groups[m.group(2)].append(f"{m.group(3)} —— {m.group(1)}")
    return groups, ""


def _run_render(root, out):
    """语法与围栏与公式：开库校验对五区 md 跑 run_validate_md，没跑成只 warn、不挡开库。"""
    files = [repo.rel(root, p) for p in _md(root)]
    if not files:
        return None
    found, why = run_validate_md(root, files)
    if found is None:
        out.warn(f"语法、围栏与公式：跳过 —— {why}")
    return found


def _check_syntax(out, found):
    """语法（写成结构的 md 没渲染成结构）。报错前缀「语法：」，后跟哪一类。

    查什么：沉淀区每页过一遍渲染管线（remark-gfm + cjk-friendly，与阅读器同源），找「落空」——
      作者写的是结构，渲染出来不是：
      - 表格塌成段落：分隔行与表头列数不一致，或表格紧贴上一段（列表项里没缩进的表也算）。
      - 表格行溢出：一行的格子比表头多，多出的不显示。常见是单元格里（含行内代码里）的 | 没转义。
      - 标题缺空格：`#标题` 不是标题，是普通段落。
      - 误成标题：段落下一行是 --- 或 ===，整段变成 setext 标题。
      - 一级标题：正文里写了 # 标题。阅读器标题栏已显示页名，正文再写就重复。
      - 围栏未闭合：``` 或 ~~~ 没有结尾，后文全成代码。
      - 注释未闭合：<!-- 没有 -->，后文全被吞。
      - 标记残留：** / ~~ / ](  / [[ ]] / [^脚注] / ` 在渲染结果里还是字面——没配对、贴错了空格、
        链接目标带空格、双链目标为空、脚注没定义。
    为什么：这些都不报错，页面上只是悄悄少了一张表、多了一串星号、后半页变成代码，作者自己看不出来。
    违规怎么改：照报错的行号改：
      - 表格 → 分隔行写成与表头同列数（`| --- | --- |` 几列就几段）；表格前空一行，列表里的表缩进到列表项内容列；
        单元格里要出现竖线写 `\\|`，行内代码里也一样。
      - 标题 → `#` 后加空格；误成标题的，在 --- 前空一行（要分隔线），或删掉 ---；一级标题整行删掉，正文从 `##` 起。
      - 围栏 / 注释 → 补上结尾的 ``` / -->。
      - 标记残留 → 补全配对；不要格式就用反斜杠转义（\\*\\*）；`**` 内侧别贴空格；链接目标的空格写 %20 或包进 <…>；
        脚注补 `[^名]: …` 定义，或去掉引用。
    """
    for e in found["syntax"]:
        out.err(f"语法：{e}")


def _check_fences(out, found):
    """围栏与公式。报错前缀「围栏与公式：」。

    查什么：mermaid / infographic 围栏能被渲染管线解析、infographic 模板名存在、`$…$` 公式是合法 LaTeX。
    为什么：语法错的图与公式在阅读器里渲染失败，读者只看到一段报错。
    违规怎么改：照报错里的行号改围栏或公式；mermaid 用最基本的 flowchart / sequenceDiagram 语法，
      公式去掉中文与不配对的花括号。
    """
    for e in found["fence"]:
        out.err(f"围栏与公式：{e}")


def run(root: Path) -> int:
    out = repo.Out()
    _check_version(root, out)
    _check_top(root, out)
    before = out.errors
    _check_encoding(root, out)
    if out.errors > before:           # 后面的规则都按 UTF-8 读 md，有编码错时再跑只会崩；只为它提前收，别的错照常一次报全
        print(f"\n共 {out.errors} 处问题")
        return 1
    _check_structure(root, out)
    _check_skeleton(root, out)
    _check_frontmatter(root, out)
    _check_refs(root, out)
    _check_hygiene(root, out)
    _check_folder_conf(root, out)
    _check_parts(root, out)
    _check_path_confs(root, out)
    _check_assets(root, out)
    _check_embed_theme(root, out)
    found = _run_render(root, out)
    if found is not None:
        _check_syntax(out, found)
        _check_fences(out, found)
    if out.errors == 0:
        n = len(list(_md(root)))
        ran = "顶层 / 编码 / 结构 / 骨架 / frontmatter / 引用 / 卫生 / 嵌入件" + (" / 语法 / 围栏与公式" if found is not None else "")
        out.ok(f"校验通过（{n} 个 md，{ran} 全部合规）")
        return 0
    print(f"\n共 {out.errors} 处问题")
    return 1
