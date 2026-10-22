# 命令

用 `./.wiki/bin/wiki` 动库时读：有哪些子命令、什么场景选哪条。具体参数以 `--help` 为准。

## 子命令

入口 `./.wiki/bin/wiki`。全库命令直接跟在 `wiki` 后面；其余先写作用域（`page` / `document` / `book`）再写动作。完整用法 `wiki --help`。

```
wiki upgrade                    库版本低于工具时逐级升级（插件开库会自动跑；改动不自动提交）
wiki check                      只读校验；报错照 lib/check/check.py 各 _check_* 的「违规怎么改」修
wiki tree [--write]             目录树，只列五个沉淀区的内容页（--write 写回 README；raw/ 与 asset/ 不进树——素材入口是 wiki document list / book list；.folder.json 与库根设施文件也不进）
wiki stamp [--all]              刷 updated

wiki page new <路径> [标题]      建沉淀页（父节点是平铺 md 会自动 grow）
wiki page grow <文件>            平铺 X.md → X/X.md
wiki page shrink <文件夹>        反向收回
wiki page move <源> <目标>       移动并修好 [[双链]]、source 与 .folder.json；叶子页的路径必须带 .md（见注意）
wiki page mark <路径> <状态>     改 status：draft / stable / deprecated
wiki page verify <路径> [--by <身份>]  追加一条人工确认
wiki page anchor <路径...>       锚点校验
wiki page tags [标签] | orphans | unverified

wiki document add <文件...>      素材移动进 raw/document/<今天>/（不是复制）
wiki document fetch <url> [--type <源>] [--node]
                                抓网页：正文与图片都落 raw/（图在该篇 raw/document/<日期>/<名>/images/）；飞书默认整库，--node 只抓子树
wiki document list [日期] [--pending]
wiki document cover <素材> [状态] 记录沉淀状态：processing / done；无状态 = 查询；--detail 写取用清单
wiki document fidelity <素材> <页> 核对页有没有丢掉素材里的字段与取值

wiki book new <书名>
wiki book split <书籍> <目录>    把 pdf / epub / azw3 / mobi 转成 md + 图片
wiki book read <书名> <章节>   勾选进度，全勾完自动置「读完」
wiki book deposit <书名> <章节> [--done]
                                登记这章沉淀中（须已读）；--done 标完成，只由人标
wiki book list
```

身份：`--by` > `WIKI_ACTOR` > `human:<git user.name>`。

## 怎么选

| 要做的事 | 用什么 |
|---|---|
| 库是空的，第一次上手 | [onboarding.md](onboarding.md)：走完第一个闭环 |
| 写一篇新笔记 | `wiki page new <路径> <标题>`，不手写 frontmatter；再读 [writing.md](../wiki-write/writing.md)；正文产出与修订走 [wiki-write](../wiki-write/SKILL.md) |
| 选图形式与 excalidraw 图位 | [diagrams.md](../wiki-write/diagrams.md) |
| 各图类型的写法（excalidraw / mermaid / infographic / 公式 / html 嵌入） | [diagram-reference/](../wiki-write/diagram-reference) |
| 收到文档 / PDF | `wiki document add`，沉淀页的 `source` 指过去 |
| 看到网页 / 公众号文章 | `wiki document fetch`，同上 |
| 开始读一本书 / 读完一章 | `wiki book new X` / `wiki book read X <号>` |
| 把一章沉淀进知识 | `wiki book deposit`，流程见 [sources.md](sources.md) |
| 新业务域（平台） | `wiki page new 系统/<平台>`，`业务域规划`、`业务域落地` 各跑 page new + page grow，落地下设 `项目树/`（见规则二） |
| 新单系统 | `wiki page new 系统/<系统>`，`系统域规划` 跑 page new + page grow（见规则二） |
| 串联多平台的行业信息化 | `wiki page new 系统/<X>行业矩阵`（名以「矩阵」收尾，不钉骨架、不带抽屉，见规则二；先例长成见 `系统/系统.md`） |
| 骨架报缺 | 缺的类目 `wiki page new` + `wiki page grow`（见规则二） |
| 一页长出子页 | `wiki page grow` |
| 挪位置 / 改名 | `wiki page move`，绝不用 `mv` |
| 会议记录、听录、分享 | 先落 `经历/观察/YYYY-MM/` 一篇文档（`wiki page new`）；往哪沉淀由人指定，登记在文档末尾「沉淀去向」节 |
| 自己做的一件事 | `经历/实践/YYYY-MM/` 一篇文档，同上 |
| 按标签横切 | `wiki page tags [标签]` |
| 哪些素材还没沉淀 | `wiki document list --pending` |
| 素材还在沉淀 | `wiki document cover <素材> processing --detail <已取/待取>` |
| 内容进来往哪放 / 概念挂哪 | 「定落点」三步 |
| 一层子页要排序 | [ordering.md](ordering.md) |
| 页写完了 / 作废留链接 | `wiki page mark <路径> stable` / `deprecated` |
| 核对过一页 | `wiki page verify` |
| 页里写了外部代码的标识符 | `wiki page anchor`，见 [anchors.md](../wiki-write/anchors.md) |
| 哪些页还没人工确认 | `wiki page unverified` |
| 改完任何东西 | `wiki check` |
