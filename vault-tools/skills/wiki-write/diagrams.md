# 绘图

页里要配图或写公式时读：先在这里选形式，再按所选形式进 [diagram-reference/](diagram-reference/) 下对应的子文件落笔。什么内容根本不该成图、图片引用与防孤儿在 [writing.md](writing.md) 的「附件」一节，这里不重复。

## 选哪种形式

| 手上的东西 | 形式 | 写法 |
|---|---|---|
| 目录树、代码、frontmatter、表格、命令输出 | 不画，写成代码块或表格 | — |
| 架构图 | excalidraw 图位 | [excalidraw.md](diagram-reference/excalidraw.md) |
| 流程图、谱系、时间轴 | mermaid 围栏 | [mermaid.md](diagram-reference/mermaid.md) |
| 领域模型的 ER 图 | excalidraw 图位，不问节点多少 | [excalidraw.md](diagram-reference/excalidraw.md) |
| 关系图（实体关系、域连通），不问节点多少 | excalidraw 图位 | [excalidraw.md](diagram-reference/excalidraw.md) |
| 列表、步骤、对比、层级、占比这类几条带文案的数据 | infographic 围栏 | [infographic.md](diagram-reference/infographic.md) |
| 数学式子 | `$...$` / `$$...$$` | [formula.md](diagram-reference/formula.md) |
| mermaid 自动布局会乱的复杂图 | excalidraw 图位 | [excalidraw.md](diagram-reference/excalidraw.md) |
| 要交互 | html 嵌入 | [html-embed.md](diagram-reference/html-embed.md) |

从上往下试：能写成文字或表格就不画——图不可搜索、不可 diff、智能体读不了，正文改了图也不会跟着变。

## 改这套规范时

这套文件（本文件与 [diagram-reference/](diagram-reference/) 下五个）只许小步增量：一次动一节或一条判据，改完即验，不整体重写某个文件、不一口气铺一组新文件；判据要换就一条一条换，每条都能单独说清为什么换。
