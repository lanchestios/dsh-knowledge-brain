# 元数据

建页、改 frontmatter、mark、verify 时读。

## frontmatter

五区每个 md 都有（`raw/document/` 下的素材除外）。用 `wiki page new` 生成，不手写：

```yaml
---
title: 库存系统架构设计
description: 库存链路的分层与关键取舍
tags: [架构设计, 交易链路]
source:
  - raw/document/2026-09-06/评审纪要.pdf
status: stable
generated: {by: claude, at: 2026-09-06T09:12:00Z}
verified:
  - {by: human:lanchestios, at: 2026-09-06T17:40:00Z}
created: 2026-09-06
updated: 2026-09-06
---
```

| 字段 | 规则 |
|---|---|
| `description` | 一句话摘要，必填但可空。建页时留空（机器编不出诚实摘要），写完正文由写页的人补 |
| `tags` | 唯一的跨树第二轴 |
| `source` | 仓库根起的路径，不用 `[[]]`（不经渲染器，根路径更稳；双链对 pdf / docx 不可靠）。没有就写 `[]` |
| `status` | 见下 |
| `generated` / `verified` | 见信任层。`at` 是完整 ISO 8601 UTC 时刻 |
| `created` / `updated` | 日期。`created` 还决定同层排序，见 [ordering.md](../wiki/ordering.md) |

解析器 `vault-tools/lib/core/frontmatter.py`（`.wiki/bin` 软链指向的插件包里）只认标量、行内列表 `[a, b]`、行内 mapping `{k: v}`、块列表。行内 mapping 的值可以带冒号（`human:x`），不能带逗号。

## status 与 progress

`status`：`draft` / `stable` / `deprecated`，缺省是 `stable`。`wiki page new` 建出 `draft`，写完 `wiki page mark <路径> stable`。

`status` 不表示有没有人核过：

| | 回答什么 | 谁设 |
|---|---|---|
| `status` | 这页写完没有、还算不算数 | 写页的人 |
| `verified` | 有没有人核过内容属实 | 确认的人 |

四种组合都成立。不要用 `stable` 表示「已确认」。

`progress`：书的阅读进度，`未读` / `在读` / `读完` / `搁置`，只在 `raw/book/X/` 的进度页上，由 `wiki book read` 推进，和 `status` 无关。

## 信任层

沿用 OKF v0.2，分开「谁写的」和「谁确认过」：

- `generated: {by, at}`：谁写的，`wiki page new` 自动打。`wiki stamp` 刷 `updated` 时把 `at` 推到此刻，默认不动 `by`（stamp 多由 pre-commit 钩子跑，不知道是谁编辑的）；重写别人页面的人自己带 `--by`。
- `verified: [{by, at}]`：谁确认过。`wiki page verify` 只追加、不去重，隔一年再核一次是新的事实。
- 信任层级由 `verified` 推导，不存储：无条目为未确认，只有非 `human:` 为机器确认，有 `human:` 为人工确认。`wiki page unverified` 列出未到人工确认的页。
- 内容改动不作废已有确认。确认只记「谁在何时看过」。

**身份**：`--by` > `WIKI_ACTOR` > `human:<git user.name>`。智能体写 `claude`（在 `.claude/settings.json` 配 `WIKI_ACTOR`），人写 `human:<id>`，自动化进程写 `process:<id>`，不带模型版本。

`wiki check` 只查这两个字段的格式，不查有没有确认。
