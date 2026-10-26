"""零依赖 frontmatter 解析与写回。

只支持本仓库实际用到的 YAML 子集：
    key: 标量
    key: [a, b]          行内列表
    key: {a: 1, b: 2}    行内 mapping（信任层的 generated / verified 用）
    key:                 块列表，元素可以是标量也可以是行内 mapping
      - a
      - {by: human:x, at: 2026-09-06}
够用即可——引入 pyyaml 会让这套工具多一个安装步骤。

行内 mapping 的值里可以带冒号（`human:lanchestios`），但不能带逗号——逗号是项分隔符。
"""

import re
from pathlib import Path

from core import repo

DELIM = "---"

# frontmatter 的规范字段顺序。render 按它生成，set_scalar 按它插入——
# 只有一处定义。先前 set_scalar 一律追加到末尾，加 description 时就乱了，
# 只能靠一次性脚本重排；那次修复没进代码库，于是下次加字段还会乱。
FIELD_ORDER = ["title", "description", "tags", "source", "status", "material_status", "material_error", "progress",
               "generated", "verified", "created", "updated"]


class Page:
    """一个带 frontmatter 的 md 文件。"""

    def __init__(self, path: Path, fields: dict, fm_lines: list, body: str):
        self.path = path
        self.fields = fields          # dict[str, str | list[str]]
        self.fm_lines = fm_lines      # frontmatter 原始行，用于外科式改写
        self.body = body

    @property
    def title(self) -> str:
        return str(self.fields.get("title", "") or "")

    @property
    def description(self) -> str:
        return str(self.fields.get("description", "") or "")

    @property
    def tags(self) -> list:
        return _as_list(self.fields.get("tags"))

    @property
    def sources(self) -> list:
        return _as_list(self.fields.get("source"))

    @property
    def status(self) -> str:
        """缺省即 stable（OKF §5.4）。"""
        from core import repo
        return str(self.fields.get("status", "") or "") or repo.DEFAULT_STATUS

    @property
    def generated(self) -> dict:
        v = self.fields.get("generated")
        return v if isinstance(v, dict) else {}

    @property
    def verified(self) -> list:
        return [e for e in _as_list(self.fields.get("verified")) if isinstance(e, dict)]

    def _prose(self) -> str:
        """去掉围栏代码块与行内代码的正文：那里的 [[...]] 是在讲语法，不算引用。"""
        text = re.sub(r"```.*?```", "", self.body, flags=re.S)
        return re.sub(r"`[^`\n]*`", "", text)

    def wikilinks(self) -> list:
        """正文里的真双链。嵌入件是 ![](asset/…) 图片写法，天然不含 [[ ]]，不在此列。"""
        return re.findall(r"\[\[([^\]|]+?)\]\]", self._prose())

    def embeds(self) -> list:
        """正文里的嵌入件 ![](asset/….html?h=高度) 的目标：(仓库根起路径, 原样参数含问号)。"""
        return [(m.group(1), m.group(2) or "") for m in repo.EMBED_REF_RE.finditer(self._prose())]



def _as_list(v) -> list:
    if v is None or v == "":
        return []
    return v if isinstance(v, list) else [v]


def _is_mapping(v: str) -> bool:
    return v.startswith("{") and v.endswith("}")


def _parse_mapping(v: str) -> dict:
    """{by: human:x, at: 2026-09-06} → dict。只切第一个冒号，所以值里可以带冒号。"""
    inner = v[1:-1].strip()
    d = {}
    for part in inner.split(","):
        if ":" not in part:
            continue
        k, val = part.split(":", 1)
        d[k.strip()] = _strip(val)
    return d


def _render_mapping(d: dict) -> str:
    return "{" + ", ".join(f"{k}: {v}" for k, v in d.items()) + "}"


def _strip(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v


def parse(path: Path):
    """读一个 md。没有 frontmatter 返回 None。"""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0].strip() != DELIM:
        return None
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == DELIM)
    except StopIteration:
        return None

    fm_lines = lines[1:end]
    body = "\n".join(lines[end + 1:])

    fields, key = {}, None
    for raw in fm_lines:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s*-\s*(.*)$", raw)
        if item and key is not None:
            fields.setdefault(key, [])
            if isinstance(fields[key], list):
                v = item.group(1).strip()
                fields[key].append(_parse_mapping(v) if _is_mapping(v) else _strip(v))
            continue
        kv = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", raw)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        if val == "":
            fields[key] = []                      # 等后续块列表填充
        elif _is_mapping(val):
            fields[key] = _parse_mapping(val)
            key = None
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            fields[key] = [_strip(x) for x in inner.split(",") if x.strip()] if inner else []
        else:
            fields[key] = _strip(val)
            key = None
    return Page(path, fields, fm_lines, body)


def set_scalar(path: Path, key: str, value: str) -> bool:
    """外科式改写一个标量字段，其余内容一字不动。字段不存在则插在 frontmatter 末尾。"""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0].strip() != DELIM:
        return False
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == DELIM)
    except StopIteration:
        return False

    pat = re.compile(rf"^{re.escape(key)}\s*:")
    for i in range(1, end):
        if pat.match(lines[i]):
            if lines[i] == f"{key}: {value}":
                return False
            lines[i] = f"{key}: {value}"
            path.write_text("\n".join(lines), encoding="utf-8")
            return True

    lines.insert(_insert_at(lines, 1, end, key), f"{key}: {value}")
    path.write_text("\n".join(lines), encoding="utf-8")
    return True


def set_list(path: Path, key: str, items: list) -> bool:
    """外科式改写一个列表字段（行内 `[a, b]` 或块列表都认），其余内容一字不动。

    set_scalar 只换一行，碰到块列表会把 `  - x` 续行留成孤儿；这里把字段行连同它的
    续行一起换掉。空列表写 `key: []`，非空写块列表。字段不存在则按规范顺序插入。
    """
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0].strip() != DELIM:
        return False
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == DELIM)
    except StopIteration:
        return False
    new = [f"{key}: []"] if not items else [f"{key}:", *[f"  - {x}" for x in items]]
    pat = re.compile(rf"^{re.escape(key)}\s*:")
    for i in range(1, end):
        if pat.match(lines[i]):
            j = i + 1
            while j < end and re.match(r"^\s+-\s", lines[j]):
                j += 1
            if lines[i:j] == new:
                return False
            lines[i:j] = new
            path.write_text("\n".join(lines), encoding="utf-8")
            return True
    at = _insert_at(lines, 1, end, key)
    lines[at:at] = new
    path.write_text("\n".join(lines), encoding="utf-8")
    return True

def _insert_at(lines, start, end, key) -> int:
    """新字段该插在哪一行：规范顺序里排在它后面的第一个字段之前。

    不认识的字段追加到末尾——生产者可以加自己的键（OKF §4.1），
    我们不该给它们编一个位置。
    """
    if key not in FIELD_ORDER:
        return end
    rank = FIELD_ORDER.index(key)
    for i in range(start, end):
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:", lines[i])
        if m and m.group(1) in FIELD_ORDER and FIELD_ORDER.index(m.group(1)) > rank:
            return i
    return end


def render(fields: dict) -> str:
    """按固定顺序生成一段 frontmatter，用于新建页面。"""
    out = [DELIM]
    for k in FIELD_ORDER:
        if k not in fields:
            continue
        v = fields[k]
        if isinstance(v, dict):
            out.append(f"{k}: {_render_mapping(v)}")
        elif isinstance(v, list):
            if not v:
                out.append(f"{k}: []")
            elif k == "tags":
                out.append(f"{k}: [{', '.join(v)}]")
            else:
                out.append(f"{k}:")
                out.extend(f"  - {_render_mapping(x) if isinstance(x, dict) else x}" for x in v)
        else:
            out.append(f"{k}: {v}")
    out.append(DELIM)
    return "\n".join(out)


def append_verified(path: Path, by: str, at: str) -> bool:
    """往 verified 追加一次确认事件。

    OKF §5.2：verified 是事件列表，多条记录独立确认。所以是追加不是覆盖——
    「2026 写的，2027 又核了一遍」正是老化知识最需要的信号。

    每次确认都记一条，不去重——「谁在何时看过」是客观事实，同一个人隔一
    年再看一遍是新的事实，不是重复。
    """
    page = parse(path)
    if page is None:
        return False
    events = page.verified + [{"by": by, "at": at}]

    lines = path.read_text(encoding="utf-8").split("\n")
    end = next(i for i in range(1, len(lines)) if lines[i].strip() == DELIM)

    kept, i = [], 1
    while i < end:                                  # 摘掉旧的 verified 块
        if re.match(r"^verified\s*:", lines[i]):
            i += 1
            while i < end and re.match(r"^\s*-\s", lines[i]):
                i += 1
            continue
        kept.append(lines[i])
        i += 1

    block = ["verified:"] + [f"  - {_render_mapping(e)}" for e in events]
    pos = next((j for j, ln in enumerate(kept) if re.match(r"^created\s*:", ln)), len(kept))
    kept[pos:pos] = block

    path.write_text("\n".join([DELIM] + kept + lines[end:]), encoding="utf-8")
    return True
