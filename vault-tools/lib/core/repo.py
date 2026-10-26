"""仓库模型：三条规则在这里收成常量和判断函数。

改规则只改这个文件。
"""

import os
import re
import subprocess
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

# ── 一级目录 ────────────────────────────────────────────────
RAW = "raw"
EXPERIENCE = "经历"                     # 经历区：我看到的（观察）与我做过的（实践），按月记
THOUGHT = "认知"
KNOWLEDGE = "知识"
ANATOMY = "学习"                        # 研习区：某个具体系统怎么造的、怎么用的
SYSTEM = "系统"                         # 系统区：业务域与其中的系统、项目（原「工作」）
ASSET = "asset"                              # 附件区：不是内容，是被内容引用的东西
TOP_DIRS = [RAW, EXPERIENCE, THOUGHT, KNOWLEDGE, ANATOMY, SYSTEM, ASSET]
DEPOSIT_DIRS = [EXPERIENCE, THOUGHT, ANATOMY, KNOWLEDGE, SYSTEM]   # 沉淀区；显示顺序以 .wiki/wiki.json 为准

# 库根只允许这些。七个固定目录：沉淀五区 + 附件区 + 素材区；它们缺一个库就不完整，
# 空着也合法（新库的 asset/、raw/ 本来就是空的，git 也带不过去空目录）。
# 白名单文件：README.md 是库首页（wiki tree --write 往里写目录树），skills-lock.json
# 是装第三方技能的锁文件。`.` 开头的条目（.git、.wiki、.claude……）是工具与工作区，不归这条管。
FIXED_DIRS = [*DEPOSIT_DIRS, ASSET, RAW]
TOP_ALLOW_FILES = {"README.md", "skills-lock.json"}


def top_extras(root: Path) -> list:
    """库根下不该在的条目名（已排序）：非 `.` 开头、又不是固定目录或白名单文件。

    名字按 NFC 比——macOS 上 Finder 建的中文目录名可能是 NFD，不归一会把「知识」误判成多余。
    类型也要对：叫 README.md 的目录、叫 raw 的文件，同样多余。
    """
    out = []
    for x in root.iterdir():
        name = unicodedata.normalize("NFC", x.name)
        if name.startswith("."):
            continue
        if x.is_dir() and name in FIXED_DIRS:
            continue
        if x.is_file() and name in TOP_ALLOW_FILES:
            continue
        out.append(name)
    return sorted(out)


def source_exists(root: Path, s: str) -> bool:
    """frontmatter `source` 的一条是否指向真实文件。`~` 开头按家目录解析，其余按库根
    ——与 anchor.load_conf 同一套规矩（研习页的 source 指向 raw/project/ 下的外部克隆）。"""
    sp = Path(s).expanduser()
    return (sp if sp.is_absolute() else root / s).exists()

# 学习/ 与 知识/ 的判据：断言绑定不绑定一个具体版本。
# 研习页说的是「这个系统在这个 commit 上是这么造的」（拆源码），或「在这个
# 版本上是这么用的」（调 API 写 demo 练用法）——都需要 anchors.conf
# 钉一份基线才能回验，上游一改就可能不对。知识页说的是书和方法，
# 不绑版本、基本不老化。分开是为了让「会过期」这件事有地方安放。
# 学习/ 下不设固定子目录：形状由被研习的系统决定，强设只会造空壳。

# ── 规则二：固定骨架 ─────────────────────────────────────────
# 提炼链：经历（观察 / 实践，按月记）→ 认知（见解 / 方法论 / 原则）。
# 经历是来料，往哪沉淀由人指定，登记在经历文档末尾的「沉淀去向」节。
THOUGHT_CATEGORIES = ["见解", "方法论", "原则"]
EXPERIENCE_CATEGORIES = ["观察", "实践"]
# 系统区二层按名字分级钉骨架（命名规范见库内 系统/系统.md「名词四级」）：
# 域级名以「平台」收尾，钉 业务域规划（域摊终局设计的挂点）与 业务域落地（落地抽屉必设）；
# 系统级名以「系统」收尾，钉 系统域规划（本系统的规划，与域摊的业务域规划分开叫）；
# 行业矩阵名以「矩阵」收尾，不带固定骨架——串联多个平台/系统、直接对应行业的信息化建设，
# 不走平台/系统两级谱系（先例：教育行业矩阵）。
# 项目树与用户故事不钉门面层：项目树归 业务域落地/ 下收落地项目，
# 用户故事归对应的系统或域内部（已建系统在 业务域落地/<系统>/，规划中的域在 业务域规划/<域>/）。
# 先例：人力资源平台——业务域落地/项目树、Medusa系统/用户故事、招聘域/用户故事。
DOMAIN_CATEGORIES = ["业务域规划", "业务域落地"]
SYSTEM_CATEGORIES = ["系统域规划"]
# 书的进度页里登记知识沉淀的一节；一章在里面有一条 = 在沉淀，条目带「· 沉淀中」= 还没完成
DEPOSIT_SECTION = "知识沉淀"
DEPOSITING_MARK = "沉淀中"


def skeleton_for(r: str) -> list:
    """这个路径下必须有哪些固定子目录。规则二的唯一出口——建骨架和校骨架
    都读它，免得「建的那份漏了一角，校的那份才发现」。"""
    if r == THOUGHT:
        return list(THOUGHT_CATEGORIES)
    if r == EXPERIENCE:
        return list(EXPERIENCE_CATEGORIES)
    parts = r.split("/")
    if len(parts) == 2 and parts[0] == SYSTEM:
        # 行业矩阵：串联多个平台/系统的行业信息化收拢节点，不钉骨架
        if parts[1].endswith("矩阵"):
            return []
        # 域级名以「平台」收尾、系统级以「系统」收尾，骨架按名字分级
        if parts[1].endswith("平台"):
            return list(DOMAIN_CATEGORIES)
        return list(SYSTEM_CATEGORIES)
    return []

# ── 生命周期（OKF §5.4）与阅读进度 ──────────────────────────
# status 是「这页写完没有、还算不算数」，缺省即 stable。
# 它**不表达确认状态**——那只看 verified（OKF 把两者分在 §5.4 与 §5.2 两族）。
# 一旦有人拿 status: stable 表示「已确认」，两个字段就会开始打架。
STATUSES = ["draft", "stable", "deprecated"]
DEFAULT_STATUS = "stable"        # 缺省即 stable（OKF §5.4）
NEW_PAGE_STATUS = "draft"        # 刚建出来的页就是个空壳

# 书的阅读进度。原先也叫 status，撞了 OKF 的词表，改名让位。
PROGRESS_UNREAD, PROGRESS_READING, PROGRESS_DONE, PROGRESS_PAUSED = \
    "未读", "在读", "读完", "搁置"
PROGRESSES = [PROGRESS_UNREAD, PROGRESS_READING, PROGRESS_DONE, PROGRESS_PAUSED]

# 书的入库流程（wiki-write-book-ingest）：init 建书 → text 转文本 → figures 补图 → proofread 梳理 → readable 过 qc。
# unavailable 是纸质书；failed 是转文本失败。只有 readable 的书能读、能沉淀
BOOK_MATERIAL_STATUSES = ["unavailable", "init", "text", "figures", "proofread", "readable", "failed"]
BOOK_READABLE = "readable"

# 素材区的容器，不是沉淀节点，因此不要求有页
CONTAINER_DIRS = {
    f"{RAW}",
    f"{RAW}/document",
    f"{RAW}/book",
    f"{ASSET}",
    f"{ASSET}/images",
}

# ── 管辖范围 ───────────────────────────────────────────────
# 白名单：规则只管七个固定目录（FIXED_DIRS）与库根白名单文件（TOP_ALLOW_FILES）。
# 其余一概不管——.git、.wiki、.claude 和各家 agent 的工作区（.agents、.workbuddy、.trae……）
# 都是工具写的，新冒出来一个也不用登记；库根的多余条目由「顶层：」单独报（top_extras）。
# 白名单内唯一的排除：raw/project/ 是外部克隆与练习 demo 仓——基线素材不是页，整棵不管
# （理由见 anchors.conf）；raw/ 其余部分（document/、book/）是素材，由 needs_frontmatter 单独豁免。
SCOPE_EXCLUDE = ("raw/project",)


def in_scope(r: str) -> bool:
    """这个相对路径归仓库规则管。目录本身和它底下都算。"""
    r = unicodedata.normalize("NFC", r)
    top = r.split("/", 1)[0]
    if top not in FIXED_DIRS and r not in TOP_ALLOW_FILES:
        return False
    return not any(r == d or r.startswith(d + "/") for d in SCOPE_EXCLUDE)


def today() -> str:
    return date.today().isoformat()


def now_iso() -> str:
    """UTC 的 ISO 8601 时刻，OKF §5.2 的 at 用的就是这个粒度。

    created / updated 仍然是日期——那是本仓库自己的字段，给人读的。
    generated / verified 是 OKF 的字段，必须能排序到秒，否则同一天里
    「改了内容」和「确认过内容」谁先谁后就分不出来。
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_root(start: Path = None) -> Path:
    """向上找仓库根（认 .wiki 目录）。"""
    cur = (start or Path.cwd()).resolve()
    for d in [cur, *cur.parents]:
        if (d / ".wiki").is_dir():
            return d
    raise SystemExit("找不到仓库根（向上没有找到 .wiki/ 目录）")


def rel(root: Path, p: Path) -> str:
    rp = Path(p)
    try:
        return str(rp.resolve().relative_to(root)).replace("\\", "/")
    except ValueError:
        # 软链指向库外（.wiki/ 下的工具链指向插件包）：按未解析路径落回，交给 in_scope 按名字排除
        return str(rp.relative_to(root)).replace("\\", "/")


# ── 分类判断 ────────────────────────────────────────────────

def in_deposit(r: str) -> bool:
    """是不是沉淀区的路径。"""
    return r.split("/")[0] in DEPOSIT_DIRS



def is_book_dir(r: str) -> bool:
    parts = r.split("/")
    return len(parts) == 3 and parts[0] == RAW and parts[1] == "book"


def book_dir(root: Path, name: str) -> tuple[str, Path]:
    """书名 NFC、去掉首尾空白与首尾的《》（书名不带书名号，手打X照样认），返回 (X, 书目录)。命令行传书名都走这里。"""
    name = unicodedata.normalize("NFC", name).strip().strip("《》").strip()
    return name, root / RAW / "book" / name


# ── 书的章节号：1 / 1.1 / 1.1.1，后跟一个空格，空格后整段是标题 ──
CHAPTER_ID = r"\d+(?:\.\d+)*"
ID_END = r"(?=\s|→|$)"                 # 号的右边界：1 不中 1.1，1.1 不中 1.10
_CHAPTER_FILE = re.compile(rf"^({CHAPTER_ID}) (.+)\.md$")
CHECK_ROW = re.compile(rf"^\s*-\s*\[([ xX])\]\s*({CHAPTER_ID}){ID_END}(.*)$", re.M)


def parse_chapter_file(name: str):
    """`1.1 什么是向量.md` → ("1.1", "什么是向量")；不以「号+空格」开头的（00-前言.md 等）不是章节，返回 None。"""
    m = _CHAPTER_FILE.match(unicodedata.normalize("NFC", name))
    return (m.group(1), m.group(2).strip()) if m and m.group(2).strip() else None


def chapter_key(cid: str) -> tuple:
    """按号逐段比数字：1.2 < 1.10，2 < 10。"""
    return tuple(int(x) for x in cid.split("."))


def chapter_parent(cid: str):
    return cid.rsplit(".", 1)[0] if "." in cid else None


def book_image_dir(root: Path, name: str) -> Path:
    """书图目录 raw/book/<书名>/images/：素材图随素材走，一本书的图都在这里。"""
    return root / RAW / "book" / name / "images"


def book_image_ref(file: str) -> str:
    """章节里引用书图的写法：相对章节文件写 ../images/…，文件名里空格与括号编码。"""
    enc = lambda s: s.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
    return f"../images/{enc(file)}"


def book_readable(index: Path) -> bool:
    """进度页 material_status 是 readable。文件不在、读不了（非 UTF-8）都算否。"""
    from core import frontmatter as fm
    try:
        page = fm.parse(index) if index.is_file() else None
    except UnicodeDecodeError:
        return False
    return bool(page) and str(page.fields.get("material_status", "")).strip('"\'') == BOOK_READABLE


def is_document_date_dir(r: str) -> bool:
    parts = r.split("/")
    return len(parts) == 3 and parts[0] == RAW and parts[1] == "document"


# 沉淀五区正文里引 asset/ 的写法：一律仓库根起（`asset/…`），不带 `../`。
# 页挪到哪一层都不用改图，读着也短；代价是 VS Code / Typora / GitHub 预览按文件解析、
# 显示不出——图在 DSH 插件里看。旧的 `../asset/…` 写法故意不认：漏迁的页引的图
# 会变成「没人引用」被 check 报出来——正是想要的响声。
# 素材图不进 asset/，随素材走：书图 raw/book/<书名>/images/（章节相对引用
# ../images/…，见 book_image_ref），文档一篇 = raw/document/<日期>/<文章名>/ 一个
# 文件夹，md 与 images/ 同住其中，正文相对引用（images/…）。
# 五区要引的图只放 asset/，指 raw/ 由 check 报错——素材与沉淀分离。
ASSET_REF_RE = re.compile(rf"\]\(({ASSET}/[^)\s]+)\)")
# 嵌入件 ![](asset/….html?h=560)：与图片同写法，asset/ 下的 html 在 DSH 里嵌成可交互页，不算双链。
# ?h= 声明实际使用高度，DSH 按它定死 iframe 高度、塞不下走内部滚动；不写由 check 报错。
# excalidraw 图位同写法收进来（?h= 可选、默认等比压栏宽），高度规则在 check 里按后缀分派。
# 参数只有一个 h，别的前缀（如 ?w=）不认——写成第二元（含问号）交给下游判。
EMBED_REF_RE = re.compile(rf"!\[[^\]\n]*\]\(({ASSET}/[^)\s]+?\.(?:html?|excalidraw))(\?[^)\s]*)?\)", re.I)
EMBED_H_RE = re.compile(r"\?h=(\d+)")
EMBED_H_MIN, EMBED_H_MAX = 160, 2000

# 站点自身的资产，不是被正文引用的附件，因此不受「必须有人引用」约束。
# logo 和它的构建输入（字体、build 脚本）按定义不会出现在任何笔记里，把它们
# 塞进 README 只是为了骗过检查——那是让规则去迁就检查，不是让检查服务规则。
ASSET_SITE_DIRS = (f"{ASSET}/logo",)


def is_site_asset(r: str) -> bool:
    return any(r == d or r.startswith(d + "/") for d in ASSET_SITE_DIRS)


_FENCE_LINE = re.compile(r"^\s*(```|~~~)")


def asset_path(ref: str) -> str:
    """](asset/…) 里写的引用 → 仓库根起的文件路径：去掉 ?参数 / #片段、按 URL 解码（同插件 assetRel）。"""
    from urllib.parse import unquote
    return unquote(re.split(r"[?#]", ref, 1)[0])


def dead_asset_refs(root: Path, text: str) -> list:
    """正文散文里 ](asset/…) 指向的文件不存在的那些（路径按 asset_path 归一）。
    嵌入件 ![](asset/….html?h=) 不在此列——check 的嵌入件规则单独报。围栏与行内代码里的不算。"""
    lines, fence = [], False
    for line in text.split("\n"):
        if _FENCE_LINE.match(line):
            fence = not fence
        elif not fence:
            lines.append(re.sub(r"`[^`\n]*`", "", line))
    prose = "\n".join(lines)
    embeds = {m.group(1) for m in EMBED_REF_RE.finditer(prose)}
    dead = []
    for m in ASSET_REF_RE.finditer(prose):
        if re.split(r"[?#]", m.group(1), 1)[0] in embeds:
            continue
        p = asset_path(m.group(1))
        if ".." in p.split("/") or not (root / p).is_file():
            if p not in dead:
                dead.append(p)
    return dead


# 五区正文里的附件引用只许 asset/：素材图随素材走落在 raw/，
# 沉淀页要引就复制进 asset/。指 raw/、或相对 / 其他前缀的附件性引用由 check 报错。
# 外链（带协议）与锚点不在此列；嵌入件（html / excalidraw）若指 asset/ 由嵌入件规则管。
ATTACHMENT_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".pdf")
_LINK_RE = re.compile(r"!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s#]+)")


def nonasset_attachment_refs(text: str) -> list:
    """五区正文里指到 asset/ 之外的附件引用（原文 token），图片与链接都算。围栏与行内代码里的不算。

    认两类：以 raw/ 起头的链接；扩展名是附件的链接。外链（带协议）、锚点、
    asset/ 前缀都放过——各有各的规则。
    """
    lines, fence = [], False
    for line in text.split("\n"):
        if _FENCE_LINE.match(line):
            fence = not fence
        elif not fence:
            lines.append(re.sub(r"`[^`\n]*`", "", line))
    out = []
    for m in _LINK_RE.finditer("\n".join(lines)):
        t = m.group(1)
        if t.startswith("<"):
            t = t[1:-1]
        if t.startswith(f"{ASSET}/") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", t):
            continue
        low = re.split(r"[?#]", t, 1)[0].lower()
        if t.startswith(f"{RAW}/") or low.endswith(ATTACHMENT_EXTS):
            if t not in out:
                out.append(t)
    return out


def orphan_assets(root: Path) -> list:
    """asset/ 下没有任何 md 引用的文件——图片会越攒越多，得有人管。

    站点资产（ASSET_SITE_DIRS）除外，见那里的说明。
    """
    base = root / ASSET
    if not base.is_dir():
        return []
    referenced = set()
    for p in iter_md(root):
        # raw/ 下的 md（书的章节、听录、文档）编码不归库管，非 UTF-8 也不能让 wiki check 崩
        text = p.read_text(encoding="utf-8", errors="replace")
        for m in ASSET_REF_RE.finditer(text):      # ![](asset/….html?h=…) 嵌入件也是 ](asset/…) 形状，一并计入
            referenced.add(unicodedata.normalize("NFC", os.path.normpath(asset_path(m.group(1)))))
    orphans = []
    for f in base.rglob("*"):
        if not f.is_file() or f.name in (".gitkeep", ".DS_Store"):
            continue
        r = rel(root, f)
        if is_site_asset(r):
            continue
        if unicodedata.normalize("NFC", r) not in referenced:     # macOS 盘上文件名可能是 NFD
            orphans.append(r)
    return sorted(orphans)


def needs_frontmatter(r: str) -> bool:
    """哪些 md 必须带 frontmatter。"""
    if r == "README.md" or not in_scope(r):
        return False
    if r.startswith(f"{RAW}/document/"):
        return False          # 素材区：原样收进来，不套 schema
    if re.match(rf"^{RAW}/book/[^/]+/章节/", r):
        # raw/book/<书>/章节/ 是从源文件拆出的章节副本,
        # 跟源文件同性质是书的派生素材,不是沉淀页
        return False
    return r.endswith(".md")


def needs_index(root: Path, d: Path) -> bool:
    """一个文件夹是不是"节点文件夹"——必须有它的页（index_of）。"""
    r = rel(root, d)
    if r == "." or r.startswith(".") or r in CONTAINER_DIRS:
        return False
    top = r.split("/")[0]
    if top in DEPOSIT_DIRS:
        return True
    if is_book_dir(r):          # raw/book/X/ 是节点（进度页）
        return True
    return False                # 笔记/、document/<日期>/ 等都不是


# ── 信任层（OKF §5.2 / §5.3 / §7） ──────────────────────────

def actor(root: Path, explicit: str = None) -> str:
    """谁在操作：--by 参数 > WIKI_ACTOR 环境变量 > human:<git user.name>。

    CLI 本身分不出是人还是智能体在跑，所以身份必须从外面给。智能体在
    .claude/settings.json 里配一次 WIKI_ACTOR，人手动跑时自动落回 git 身份。
    """
    a = (explicit or os.environ.get("WIKI_ACTOR") or "").strip()
    if a:
        return a
    name = git(root, "config", "user.name", check=False).stdout.strip()
    return f"human:{name}" if name else "human:unknown"


def is_iso_date(s) -> bool:
    """真校验，不是形状匹配：2026-13-45 / 2026-02-30 / 平年 2026-02-29 都得拒掉。

    fromisoformat 在 3.11+ 还认 '20260906' 这种紧凑写法，所以回写一遍比对，
    只放行严格的 YYYY-MM-DD。
    """
    if not isinstance(s, str):
        return False
    try:
        return date.fromisoformat(s).isoformat() == s
    except ValueError:
        return False


def trust_problems(generated: dict, verified: list) -> list:
    """信任字段是可选的；一旦出现，形状得对。返回人话的问题列表。"""
    out = []
    if generated:
        if not generated.get("by"):
            out.append("generated 缺 by")
        at = generated.get("at", "")
        if not at:
            out.append("generated 缺 at")
        elif not is_iso_datetime(at):
            out.append(f"generated.at 不是合法的 ISO 8601 时刻（{at}），应形如 2026-09-06T17:00:00Z")
    for i, e in enumerate(verified, 1):
        if not e.get("by"):
            out.append(f"verified 第 {i} 条缺 by")
        at = e.get("at", "")
        if not at:
            out.append(f"verified 第 {i} 条缺 at")
        elif not is_iso_datetime(at):
            out.append(f"verified 第 {i} 条的 at 不是合法的 ISO 8601 时刻（{at}）")
    return out


def is_iso_datetime(s) -> bool:
    """严格的 YYYY-MM-DDTHH:MM:SSZ。"""
    if not isinstance(s, str) or not s.endswith("Z"):
        return False
    try:
        dt = datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") == s


def status_problem(value):
    """status 的值合不合法。缺省（空）合法，OKF 规定缺省即 stable。"""
    if not value:
        return None
    if value not in STATUSES:
        return f"status 只能是 {' / '.join(STATUSES)}（当前 {value}）"
    return None


def progress_problem(value):
    """progress 的值合不合法。"""
    if not value:
        return None
    if value not in PROGRESSES:
        return f"progress 只能是 {' / '.join(PROGRESSES)}（当前 {value}）"
    return None


def material_status_problem(rel_path, value):
    """书籍进度页与听录必须使用各自的素材状态词表。普通页面不查该字段。"""
    values = None
    parts = rel_path.split("/")
    if len(parts) == 4 and is_book_dir("/".join(parts[:3])) and parts[3] == parts[2] + ".md":
        values = BOOK_MATERIAL_STATUSES
    if values is None:
        return None
    if not value:
        return "缺 material_status"
    if value not in values:
        return f"material_status 只能是 {' / '.join(values)}（当前 {value}）"
    return None


def trust_tier(verified: list) -> str:
    """由 verified 推导信任层级——不存储，跟 OKF 一样只存事实、不存结论。"""
    if not verified:
        return "未确认"
    if any(str(e.get("by", "")).startswith("human:") for e in verified):
        return "人工确认"
    return "机器确认"


# ── 节点操作 ────────────────────────────────────────────────

def _under_raw(d: Path) -> bool:
    """d 是否在 raw/ 之下（按向上找到的仓库根判断）。"""
    d = Path(d).resolve()
    # 看所有带 .wiki 的祖先：raw/ 下克隆进来的外部仓自己也可能有 .wiki，不能只认最近的那个
    for anc in [d, *d.parents]:
        if (anc / ".wiki").is_dir() and d != anc and d.relative_to(anc).parts[0] == RAW:
            return True
    return False


def node_name(p: Path) -> str:
    """节点名：文件夹 → 名；文件夹页（沉淀区 X/X.md 或改指的页、书页 X/X.md）→ 文件夹名；X.md → X。"""
    p = Path(p)
    if p.is_dir():
        return p.name
    if p.name.endswith(".md") and is_folder_page(p):
        return p.parent.name
    return p.name[:-3] if p.name.endswith(".md") else p.name


def index_of(d: Path) -> Path:
    """文件夹的页：同名 X.md；沉淀区可由 .folder.json 的 index 改指。raw/ 下只有书目录 raw/book/X/ 有页（见 is_folder_page）。"""
    d = Path(d)
    if _under_raw(d):
        return d / (d.name + ".md")
    from core import conf  # 放函数里：conf 反过来 import repo
    return d / (conf.folder_index(d) + ".md")


def is_folder_page(p: Path) -> bool:
    """p 是不是它所在文件夹的页：沉淀区的 X/X.md 或改指的页；raw/ 下只认书目录的 X/X.md。"""
    p = Path(p)
    if not (p.name.endswith(".md") and p.parent.name != "" and p == index_of(p.parent)):
        return False
    if _under_raw(p.parent):
        root = next(a for a in p.parent.resolve().parents if (a / ".wiki").is_dir())
        return is_book_dir(rel(root, p.parent))
    return True


def node_page(p: Path) -> Path:
    """节点的正文文件：传文件夹给 index，传文件原样返回。"""
    return index_of(p) if p.is_dir() else p


def iter_md(root: Path):
    for p in sorted(root.rglob("*.md")):
        r = rel(root, p)
        if not in_scope(r):
            continue
        yield p


def pages(root: Path):
    """遍历所有需要 frontmatter 的页，产出 (相对路径, 路径, Page)。

    解析失败的跳过——校验缺失 frontmatter 是 check 自己的事，别的调用方
    不该为此写一遍判空。
    """
    from core import frontmatter as fm
    for p in iter_md(root):
        r = rel(root, p)
        if not needs_frontmatter(r):
            continue
        page = fm.parse(p)
        if page is not None:
            yield r, p, page


def iter_dirs(root: Path):
    for p in sorted(root.rglob("*")):
        if not p.is_dir():
            continue
        r = rel(root, p)
        if not in_scope(r):
            continue
        yield p


# ── git ────────────────────────────────────────────────────

def git(root: Path, *args, check=True):
    # core.quotePath=false：否则 git 会把中文路径转义成 "\345\216\237..."，
    # 这个仓库二级以下全是中文，不关掉的话所有按路径匹配的逻辑都会失效。
    return subprocess.run(["git", "-C", str(root), "-c", "core.quotePath=false", *args],
                          capture_output=True, text=True, check=check)


# ── 素材状态：到达时刻与沉淀状态 ──────────────────────────────
#
# 规则三要求 raw/ 永不编辑，所以这两件事都不能记在素材自己身上——
# 素材连 frontmatter 都不给加。于是都反向推导：
#   到达时刻 ← git 首次加入该文件的 commit
#   沉淀状态 ← 沉淀区某页的 source 有没有指过来
# 两者都不落盘，每次现算，于是不会过期。

def raw_arrivals(root: Path) -> dict:
    """{素材路径: 首次进 git 的 ISO 时刻}。没提交过的不出现在结果里。

    一次 `git log` 拿全库，不要按文件逐个查——242 份素材就是 242 次
    进程启动。`--diff-filter=A` 只留「新增」，于是后来的修改不会把
    时刻推后：记的是到达，不是最后一次改动。
    """
    res = git(root, "log", "--diff-filter=A", "--name-only", "--no-renames",
              "--format=@%aI", "--", f"{RAW}/document", check=False)
    if res.returncode != 0:          # 不是 git 仓库，或还没有任何提交
        return {}
    at = {}
    ts = None
    for line in res.stdout.splitlines():
        line = line.rstrip()
        if line.startswith("@"):
            ts = line[1:]
        elif line:
            # git log 按时间倒序，同一文件若多次出现（删掉又加回），
            # 后读到的那条更早，取它。
            at[line] = ts
    return at


def raw_citations(root: Path) -> dict:
    """{素材路径: [引它的沉淀页...]}。没人引的不出现在结果里。

    只认沉淀区的页：`raw/` 内部的互引（比如章节笔记引一份文档）不算
    沉淀——沉淀的定义是素材进了四个树区之一。
    """
    from core import frontmatter as fm
    cited = {}
    for r, p, page in pages(root):
        if not in_deposit(r):
            continue
        for s in page.sources:
            cited.setdefault(s, []).append(r)
    return cited


# ── 沉淀完成度（coverage）：人评档位，台账在 .wiki/coverage.conf ───
#
# raw_citations 给的沉淀状态是完成度的下界：source 指了一句就算「已引用」，
# 内容未必完成。显式状态是人补上的真值层，落旁挂台账——素材本体仍一字不动
# （规则三），raw/document/ 的素材连 frontmatter 都没有。没有词条 = 未评，
# list 回退二值。台账格式是 INI 式段头：段头里放完整素材路径（可含空格），
# 段内「键 = 值」。只认整行注释，不剥行内 #——文件名可以含 #。

COVERAGE_PART, COVERAGE_FULL = "processing", "done"
COVERAGES = [COVERAGE_PART, COVERAGE_FULL]
COVERAGE_LABELS = {COVERAGE_PART: "沉淀中", COVERAGE_FULL: "完成"}
COVERAGE_CONF = ".wiki/coverage.conf"

_COVERAGE_HEADER = (
    "# 素材沉淀完成度台账 —— wiki document cover 的唯一真源（素材本体不带状态，规则三）。\n"
    "#   [raw/document/<日期>/<文件>]\n"
    "#   material_status = processing   processing / done；没有词条 = 未评\n"
    "#   detail = 取用清单，自由文本，可省\n"
)


def coverage_problem(value):
    """material_status 的值合不合法。缺省（无词条）合法，等于未评。"""
    if not value:
        return None
    if value not in COVERAGES:
        return f"material_status 只能是 {' / '.join(COVERAGES)}（当前 {value}）"
    return None


def coverage_key(rel_path: str) -> str:
    """台账段头的键：NFC 归一。macOS 给的 NFD 文件名要能对上手打的 NFC。"""
    return unicodedata.normalize("NFC", rel_path)


def load_coverage(root: Path) -> dict:
    """读台账 → {素材路径: {键: 值}}。宽容读者：坏行跳过，专职报错的是
    check（与 pages() 跳过坏 frontmatter 同分工）。不剥行内 #。"""
    conf = root / COVERAGE_CONF
    if not conf.is_file():
        return {}
    entries = {}
    cur = None
    for line in conf.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("[") and s.endswith("]"):
            cur = coverage_key(s[1:-1].strip())
            entries.setdefault(cur, {})
        elif "=" in s and cur is not None:
            k, _, v = s.partition("=")
            entries[cur][k.strip()] = v.strip()
        # 段头之前的键值行、没有 = 的行：check 报错，这里跳过
    return entries


def coverage_for(entries: dict, rel_path: str) -> dict:
    """查台账的唯一出口：NFC 归一后取词条，没有就是 {}。"""
    return entries.get(coverage_key(rel_path), {})


def set_coverage(root: Path, rel_path: str, value, detail=None) -> bool:
    """往台账写一条：原位行手术，保注释与邻条目。内容有没有变，返回 bool。

    detail=None 表示只动档位、保留原清单——档位与取用清单是两根轴，
    改一根不该抹掉另一根。字节无变化返回 False（幂等，同 fm.set_scalar）。
    """
    conf = root / COVERAGE_CONF
    text = conf.read_text(encoding="utf-8") if conf.is_file() else ""
    lines = _COVERAGE_HEADER.splitlines() if not text else text.splitlines()
    key = coverage_key(rel_path)

    start = None
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("[") and s.endswith("]") and coverage_key(s[1:-1].strip()) == key:
            start = i
            break

    if start is None:                      # 新词条，追加到末尾
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(f"[{rel_path}]")
        lines.append(f"material_status = {value}")
        if detail is not None:
            lines.append(f"detail = {detail}")
    else:
        end = len(lines)
        for j in range(start + 1, len(lines)):
            s = lines[j].strip()
            if s.startswith("[") and s.endswith("]"):
                end = j
                break
        cov_at = det_at = None
        for j in range(start + 1, end):
            k = lines[j].partition("=")[0].strip()
            if k == "material_status":
                cov_at = j
            elif k == "detail":
                det_at = j
        if cov_at is None:
            lines.insert(start + 1, f"material_status = {value}")
            if detail is not None:
                lines.insert(start + 2, f"detail = {detail}")
        else:
            lines[cov_at] = f"material_status = {value}"
            if detail is not None:
                if det_at is None:
                    lines.insert(cov_at + 1, f"detail = {detail}")
                else:
                    lines[det_at] = f"detail = {detail}"

    new = "\n".join(lines) + "\n"
    if new == text:
        return False
    conf.write_text(new, encoding="utf-8")
    return True


def git_mv(root: Path, src: Path, dst: Path):
    """优先 git mv 以保留历史；文件未被跟踪时退回普通移动。"""
    res = git(root, "mv", rel(root, src), rel(root, dst), check=False)
    if res.returncode != 0:
        src.rename(dst)


# ── 显示 ────────────────────────────────────────────────────

def width(s: str) -> int:
    """终端显示宽度：中日韩字符占两列。"""
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in str(s))


def pad(s: str, n: int) -> str:
    return str(s) + " " * max(0, n - width(s))


# ── 输出 ────────────────────────────────────────────────────

class Out:
    OK, WARN, ERR, INFO = "✓", "!", "✗", "·"

    def __init__(self):
        self.errors = 0

    def ok(self, msg):   print(f"{self.OK} {msg}")
    def info(self, msg): print(f"{self.INFO} {msg}")
    def warn(self, msg): print(f"{self.WARN} {msg}")

    def err(self, msg):
        self.errors += 1
        print(f"{self.ERR} {msg}")
