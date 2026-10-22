---
name: wiki-write-book-ingest
description: 在一本书（pdf / epub / azw3 / mobi）刚放进 raw/book/、书架上显示「整理中」、或扫描版拿不准要不要 AI 转写时用。
---

# wiki-write-book-ingest

一本书从源文件到「可读」走五步，每步落一个 `material_status`（进度页 `raw/book/X/X.md`）。开库 `wiki check` 不管 `raw/`，半成品不会挡开库；质量只由第 5 步的 `wiki book qc` 把关。命令在库根跑：`./.wiki/bin/wiki …`。

先 `wiki book status X` 看停在哪一步，从那一步接着做。status 是 `text` 但 `章节/` 里只有 `1 全文.md`：第 2 步没做完（PDF 还没切章），先 `wiki book cut`。

| 步 | 做完写 | 命令 / 动作 |
|---|---|---|
| 1 建书 | `init` | `wiki book new X`，源文件放进书目录 |
| 2 转文本 | `text` | `wiki book split` 或插件「转换为文字」；PDF 两种方式都要再 `wiki book cut` |
| 3 补图 | `figures` | 页图 + `wiki book crop` |
| 4 梳理 | `proofread` | 对照页图逐段改 |
| 5 质检 | `readable` | `wiki book status X readable`（当场跑 qc） |

## 1. 建书

`wiki book new X` 建目录与进度页（`init`）。源文件放进 `raw/book/X/`。纸质书没有源文件：`wiki book status X unavailable`，到此为止。

## 2. 转文本

插件书籍页点「转换为文字」，或：

```bash
./.wiki/bin/wiki book split "raw/book/X/<源文件>" .wiki/tmp/book-X/章节
```

输出目录须不存在（重跑先删）。CLI 方式产物在临时目录，确认后挪进 `raw/book/X/章节/`，再 `wiki book sync X` 与 `wiki book images X`（插件按钮两步都自己做）。挪之前确认 `章节/` 不存在或是空的——已有内容时 `mv` 会把整个目录套进去一层；有旧内容先问人。

章节文件一律 `<号> <标题>.md`：号是 `1` / `1.1` / `1.1.1`，空格后整段是标题；不以「号+空格」开头的（`00-前页.md`、`99-附录.md`）不是章节。章节清单只列叶子（对应一个文件的那一级），上一级写分组行 `### 1 向量`。`sync` 按号的数字大小排序（`1.2` 在 `1.10` 前）、保留已有的分组行与已读勾。

- **epub / azw3 / mobi**：按 toc 切好章（`1 <标题>.md`、`2 <标题>.md` …），抽出的图由 `wiki book images` 搬进 `raw/book/X/images/`，章节引用改成相对 `../images/…`。
- **按节拆**（作者原稿就是一节一个文件，如《线性代数不难》）：把章拆成 `1.1 <标题>.md`、`1.2 <标题>.md` …，再 `sync`；分组行 `### 1 <章名>` 手写进清单，`sync` 会保留（没写的它补一个只有号的 `### 1`）。
- **PDF**：只出一个 `1 全文.md`，每页前有 `<!-- PDF 第 N 页 -->`。插件按钮也一样，它写完 `text` 时还没切章，照样要 cut。看目录页（按第 3 步的命令把目录那几页渲成页图）定每章起始页——页号用 PDF 页序，不是书上印的页码，两者差几页要对一下——然后：

  ```bash
  ./.wiki/bin/wiki book cut X 15:引言 33:监督学习 58:浅层神经网络
  ```

  起始页须严格递增。两章落在同一个页标记上（中间隔着空页）会被拒：并成一章，或换一个起始页。

  cut 还会把第一章之前的页（封面、版权、目录等）写成 `章节/00-前页.md`，页标记照留；第 4 步要一起清。

- **扫描版**（split 报「扫描版 PDF」、退出码 3，插件显示「整理中 · 1/5」并带这句说明）：CLI 方式先 `wiki book status X init --error "扫描版，待确认 AI 转写"`（插件按钮已自己写），再**停下问人**要不要 AI 转写，说明页数与代价（逐页看图，慢、耗 token）。人不要就停在 `init`。人确认后：按第 3 步的命令逐页渲图、看图转写正文（只照原样转写，不改写、不补全看不清的字，看不清写 `[?]`），按目录直接写成 `章节/<号> <标题>.md`，`wiki book sync X`。大书按页段分给子 agent，每个子 agent 只写自己那几章。

做完 `wiki book status X text`。

## 3. 补图

页图统一渲到 `.wiki/tmp/book-X/pages/`（不入库；第 2 步看目录、转写扫描版也用这条）。`pdftoppm` 不建目录，先 mkdir：

```bash
mkdir -p ".wiki/tmp/book-X/pages"
pdftoppm -r 150 -png -f N -l N "raw/book/X/<源文件>.pdf" ".wiki/tmp/book-X/pages/p"
```

逐章找缺图的地方：图注（「图 3.2」「Figure 3.2」）、文本里突兀断开的位置、页图上有图而 md 里没有。看页图定框，裁：

```bash
./.wiki/bin/wiki book crop .wiki/tmp/book-X/pages/p-042.png 0.08,0.15,0.92,0.55 "raw/book/X/images/3-001.png"
```

书图都放 `raw/book/X/images/`（素材图随素材走，一本书的图都在这一个目录）。`pdftoppm` 的页号按总页数补零（不到 100 页是 `p-42.png`，上千页是 `p-0042.png`），以 `ls` 看到的实际文件名为准。框四值 ≤1 按比例；裁完 Read 一下产物确认框对了。在正文图注处相对章节引用：`![图 3.2 标题](../images/3-001.png)`，文件名里的空格写 `%20`；图编号 `<号>-NNN` 按章内顺序（`1.1-001.png`）。epub 来的书已有图，只核对缺漏。

建议裁一张就插一张：开库 check 对没人引用的图、引用了不存在的图只给警告，不挡开库；但 qc 两种都报错，写 readable 前必须清零。

每章补完在进度页「## 整理记录」（没有就建在「## 知识沉淀」之前）记一行 `- <号> 补图 ✓ N 张`。全部章做完 `wiki book status X figures`。

## 4. 逐段梳理

一章一章来，章节 md 与对应页图并排看（PDF 用页标记找页；epub 无页标记，对照源文件的同一章）。逐段改：

- 乱码与转义：`�`、私有区字符、ligature（ﬁ ﬂ）、全半角错、被转义的 `\*` `\_`
- 断行与跨页：段内折行合并、跨页断词接回、页眉页脚页码删掉
- 结构：标题层级（章 `#`、节 `##`、小节 `###`）、列表、表格还原成 md 表格、代码块加围栏
- 公式：还原成 `$…$` / `$$…$$`（LaTeX）
- 页标记 `<!-- PDF 第 N 页 -->` 校完那一页就删

`00-前页.md`（cut 产出的前页）同样要删页标记、清乱码，但不需要整理记录行。

**只还原原文**：不改写、不总结、不加注释或译注，原文的错别字照留。拿不准的地方留原样，在「## 整理记录」该章行尾记「待人看：…」。

每章校完在该章记录行追加 ` · 梳理 ✓`（行变成 `- <号> 补图 ✓ N 张 · 梳理 ✓`）。大书按章分给子 agent 并行，每个子 agent 只负责一章、只改自己那章的文件，记录行由主 agent 统一写。全部章做完 `wiki book status X proofread`。

qc 按字面认记录行：每个章节号一行，行里同时有 `补图 ✓` 与 `梳理 ✓`，✓ 是 U+2713（不是 ✔），前面一个空格。

## 5. 质检转可读

```bash
./.wiki/bin/wiki book status X readable
```

它当场跑 `wiki book qc`：章节清单与文件对齐、每章有补图 ✓ 与梳理 ✓、无乱码与页标记残留、图片都在且都被引用、md 语法 / 围栏 / 公式过渲染管线校验。没过就照报错回第 3 / 4 步改，再跑。过了书架显示「可读」，章节才能在插件里读、记已读、沉淀。

之后改了章节（哪怕一个字），再跑一次 `wiki book status X readable`。

## 交接

转可读后读书与沉淀照 [sources.md](../wiki/sources.md)「读书」节。
