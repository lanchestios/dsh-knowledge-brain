"""测试用临时库的公共补齐：六个固定目录（顶层规则要求）+ 四区门面与认知骨架。

顶层规则要求库根六个固定目录都在；空的区目录又会被「结构：文件夹缺页」挡下，
所以光 mkdir 不够——用 wiki new skeleton 补区门面与固定类目（幂等，已有的不碰），
asset/ 与 raw/ 是容器目录、不要求页，建出来即可。只给要跑完整 check 的测试用。
"""

import contextlib
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from core import conf  # noqa: E402
import init  # noqa: E402
from core import folders  # noqa: E402
from core import repo  # noqa: E402
from upgrade import upgrade  # noqa: E402


def fill_top(root: Path):
    """补齐到 check 的顶层与结构规则都能过。wiki.json 写当前 version（「版本：」规则）与全四区 parts——
    补出来的区目录若不在 parts 里，「配置：parts 缺 X」会挡住只想量别的规则的测试。"""
    conf.write_wiki(root, conf.default_wiki(upgrade.current()))
    with contextlib.redirect_stdout(io.StringIO()):
        init.new_skeleton(root)
    for d in repo.FIXED_DIRS:
        (root / d).mkdir(exist_ok=True)
    fix_folders(root)                 # 沉淀区每个文件夹都要有 .folder.json


def fix_folders(root: Path):
    """测试里直接写了沉淀区的页（没走 wiki 命令）之后、跑完整 check 之前调：补齐 .folder.json。"""
    with contextlib.redirect_stdout(io.StringIO()):
        folders.fix_tree(root)
