"""wiki document fidelity —— 核对沉淀页有没有丢掉素材里的字段与取值。

spec 的验收判据是「页里查不到原文里有的字段或取值，就是沉淀失败」。这个模块把
那句话变成会失败的命令：从素材抽出必须保留的 token，逐个在页里找。

删掉是允许的（spec 的操作 4），但必须在页里显式声明：
    <!-- 保真豁免: <token> —— <理由> -->
没写理由的声明不算数——那等于偷偷删内容。
"""

import re
from pathlib import Path

from core import repo

_TABLE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.M)
_BOLD_TITLE = re.compile(r"\*\*([^\*\n]{2,60})\*\*")
_CODE_SPAN = re.compile(r"`([^`\n]{2,60})`")
_NUMBER = re.compile(r"\d+(?:\.\d+)?%?")
_IMG_OR_LINK = re.compile(r"!?\[[^\]]*\]\([^)]*\)")
_EXEMPT = re.compile(r"<!--\s*保真豁免[:：]\s*(.+?)\s*(?:——|--|—)\s*(.+?)\s*-->")
_EXEMPT_COMMENT = re.compile(r"<!--\s*保真豁免[:：][^>]*-->")
# 单字与两字虚词当 token 只会制造噪音
_STOP = {"的", "了", "是", "和", "与", "或", "在", "有", "不", "也"}


def _clean(s):
    s = _IMG_OR_LINK.sub(" ", s)
    return re.sub(r"[*>#`]", "", s).strip()


def tokens(md: str) -> set[str]:
    """素材里必须保留的 token：表格单元格、标题、加粗小标题、反引号标识符、数字。"""
    out = set()
    body = _IMG_OR_LINK.sub(" ", md)
    for line in body.split("\n"):
        if _TABLE_SEP.match(line):
            continue
        if line.lstrip().startswith("|"):
            for cell in line.strip().strip("|").split("|"):
                c = _clean(cell)
                if len(c) >= 2 and c not in _STOP:
                    out.add(c)
    for h in _HEADING.findall(body):
        c = _clean(h)
        if len(c) >= 2:
            out.add(c)
    for b in _BOLD_TITLE.findall(body):
        c = _clean(b)
        if len(c) >= 2 and c not in _STOP:
            out.add(c)
    for c in _CODE_SPAN.findall(body):
        out.add(c.strip())
    for n in _NUMBER.findall(body):
        if len(n) >= 2:
            out.add(n)
    return {t for t in out if t and "asset" not in t and not t.startswith("http")}


def exemptions(page_md: str) -> set[str]:
    """页里声明的豁免。必须带理由，否则不算。"""
    return {m.group(1).strip() for m in _EXEMPT.finditer(page_md)
            if m.group(2).strip()}


def missing(src_md: str, page_md: str) -> list[str]:
    """素材里有、页里没有、且没被豁免的 token。

    先剥离所有保真豁免注释，防止无理由的豁免声明通过子串匹配隐藏缺失。
    合法的豁免（带理由）仍通过 exemptions() 解析生效。
    """
    ex = exemptions(page_md)
    # 剥离所有 <!-- 保真豁免: ... --> 注释，再检查 token 是否在页面正文中
    page_without_exemptions = _EXEMPT_COMMENT.sub("", page_md)
    return sorted(t for t in tokens(src_md)
                  if t not in ex and t not in page_without_exemptions)


def run(root, src_path, page_path) -> int:
    out = repo.Out()
    src, page = Path(root) / src_path, Path(root) / page_path
    for p in (src, page):
        if not p.exists():
            out.err(f"文件不存在：{repo.rel(root, p)}")
            return 1
    miss = missing(src.read_text(encoding="utf-8"),
                   page.read_text(encoding="utf-8"))
    total = len(tokens(src.read_text(encoding="utf-8")))
    if not miss:
        out.ok(f"保真通过（{total} 个 token 全部覆盖或已豁免）")
        return 0
    print(f"# 页里找不到的 token（{len(miss)}/{total}）\n")
    for t in miss:
        print(f"  {t}")
    print("\n补回页里，或加一行： <!-- 保真豁免: <token> —— <理由> -->")
    return 1
