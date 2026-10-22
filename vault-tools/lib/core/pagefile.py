"""新页落盘：frontmatter 契约（新页一律 draft、generated 记谁写的、verified 留空）与 .folder.json 补齐。

page new、book new、wiki init 共用。"""

from pathlib import Path

from core import frontmatter as fm
from core import repo


def write_page(path: Path, title: str, tags=None, source=None, progress=None, body="",
                by=None, status=None):
    # description 留空等人填——机器编不出一句诚实的摘要
    fields = {"title": title, "description": "", "tags": tags or [], "source": source or []}
    # 刚建出来的页就是个空壳，draft 是它的真实状态，不是保守估计
    fields["status"] = status or repo.NEW_PAGE_STATUS
    if progress:
        fields["progress"] = progress
    # 谁写的记下来，谁确认过留空——两件事分开（OKF §5.2）。
    # at 是时刻不是日期：陈旧检测要能排到秒。
    fields["generated"] = {"by": by or "human:unknown", "at": repo.now_iso()}
    fields["verified"] = []
    fields["created"] = repo.today()
    fields["updated"] = repo.today()
    path.parent.mkdir(parents=True, exist_ok=True)
    # 正文不写一级标题：阅读器标题栏显示页名（title / 文件名），# 标题 是重复（check 语法规则拦）
    body = body.strip("\n")
    path.write_text(fm.render(fields) + "\n" + (f"\n{body}\n" if body else ""), encoding="utf-8")


def sync_folders(root, paths, out):
    """改了沉淀区目录内容之后补齐相关文件夹的 .folder.json（所在文件夹及其祖先）；补不了的只警告，check 会报。"""
    from core import folders
    for p in folders.sync(root, paths, out):
        out.warn(p)
