"""wiki book new —— 建书目录与进度页。"""

from pathlib import Path

from core import frontmatter as fm
from core import repo
from core import pagefile


def new_book(root: Path, name: str, by=None) -> int:
    out = repo.Out()
    by = repo.actor(root, by)
    name, d = repo.book_dir(root, name)
    if d.exists():
        out.err(f"已存在：{repo.rel(root, d)}/")
        return 1
    d.mkdir(parents=True)
    body = ("\n\n> 源文件放在本文件夹内；纸质书没有源文件，只留这个进度页。\n"
            "\n## 章节进度\n\n- [ ] 1\n"
            f"\n## {repo.DEPOSIT_SECTION}\n\n读完一章后沉淀进 知识/：`wiki book deposit` 标沉淀中，写完的页在条目下用 `[[页名]]` 登记，"
            "人确认后 `wiki book deposit --done` 标完成：\n\n- （暂无）\n")
    index = repo.index_of(d)
    pagefile.write_page(index, name, progress=repo.PROGRESS_UNREAD, body=body, by=by)
    fm.set_scalar(index, "material_status", "init")
    out.ok(f"新建 {repo.rel(root, d)}/（含进度页）")
    return 0
