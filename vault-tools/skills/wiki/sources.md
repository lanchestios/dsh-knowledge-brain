# 素材

归档素材、记沉淀账、读书时读。

## 三类素材的状态

三类素材都用 `material_status` 表示各自流程状态。文档可以是二进制，因此把字段记在 `.wiki/coverage.conf`；书籍进度页与听录是 Markdown，字段记在 frontmatter。`source` 引用仍用于推导文档是否已经被知识页引用。

| 标什么 | 从哪推 | 实现 |
|---|---|---|
| 到达时刻 | git 首次加入该文件的 commit（不是最后一次改动，重抓也会产生新 commit） | `repo.raw_arrivals` |
| 沉淀状态 | 五区某页的 `source` 有没有指过来（`raw/` 内部互引不算） | `repo.raw_citations` |
| 沉淀完成度 | 人评档位，台账 `.wiki/coverage.conf` 的 `material_status` | `repo.load_coverage` |

`raw/document/` 的目录日是 `wiki document add` 那天，可能和提交日不同；不同时显示完整日期，相同时只显示时分。

沉淀状态只认 `source` 的精确路径，是覆盖率的下界：一页消化了 B 却只在 `source` 写了 A，B 算未沉淀；只顺手引了一句的也算已沉淀。当待办线索用，不当账。

## cover：文档沉淀状态

- `wiki document cover <素材> processing --detail <已取/待取>` 记账；`wiki document cover <素材>` 查询。显式状态只有 `processing / done`，界面显示为「沉淀中 / 完成」。
- 每个台账段使用 `material_status = processing|done`；旧 `coverage` 字段和中文状态值不再识别。
- `wiki document list --pending` 列出未评和「沉淀中」，「完成」不算待办。
- **「完成」只由人标**，代码拦着：身份不是 `human:` 就拒写。口径是逐篇逐章读完、要点已落进沉淀页。智能体最多在 `--detail` 写「疑似完成，待确认」。
## 读书

书先走入库，再走章节阅读与沉淀。入库五步由 [wiki-write-book-ingest](../wiki-write-book-ingest/SKILL.md) 驱动，进度页 `raw/book/X/X.md` 的 `material_status` 记 `unavailable / init / text / figures / proofread / readable / failed`，界面对应「无源文件 / 整理中 1–4/5 / 可读 / 转换失败」。插件「转换为文字」只做第 2 步。书名不带书名号（目录、进度页、命令里都是 `X`）。章节文件 `章节/<号> <标题>.md`，号是 `1` / `1.1` / `1.1.1`，清单只列叶子、上一级写分组行 `### 1 章名`；书图放 `raw/book/X/images/`，章节从 `../images/…` 相对引用（`wiki book images` 自动搬改）。开库 `wiki check` 不管 `raw/` 的其余内容，只对素材里引用了不存在的附件、`asset/` 下没人引用的附件给警告（不挡开库）；章节质量由 `wiki book qc` 把关（图片两种问题它都报错），写 `readable` 时当场跑。只有 `readable` 的书能 `wiki book read` / `wiki book deposit`。章节另有四个状态：

| 状态 | 记在哪 | 谁推进 |
|---|---|---|
| 未读 | 章节清单 `- [ ] <号> <标题>` | — |
| 已读 | 章节清单 `- [x] <号> <标题>` | `wiki book read X <号>` |
| 沉淀中 | 「## 知识沉淀」里 `- <号> <标题> · 沉淀中` | `wiki book deposit X <号>`（须已读） |
| 完成 | 同一条去掉「· 沉淀中」 | `wiki book deposit X <号> --done`，只由人标 |

沉淀一章：

1. 读 `章节/<号> <标题>.md` 原文，按概念写进 `知识/`，一章可落多页或并进已有页。写出新页与改已有页都走 [wiki-write](../wiki-write/SKILL.md) 编排：新建全四步，修订至少 `wiki-write-humanize` → `wiki-write-review` 两步，一步不省。
2. 页的 `source` 指向书的源文件；纸质书留空。
3. 在进度页该章条目 `→` 后写去向，条目下缩进逐页列 `[[页名]]`。章与页的对应只在这里维护，知识页正文不写章节号。
4. 停在「沉淀中」，由人确认后标 `--done`（代码同样拦非 `human:`）。

`wiki book list` 看各书的阅读与沉淀进度。

## 耳闻

