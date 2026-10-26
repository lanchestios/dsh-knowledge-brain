---
title: OKF 开放知识格式
description: Google Cloud 的开放知识格式 v0.2：一个装满带 frontmatter 的 md 文件的目录树，唯一硬性要求是每个文件有非空 type
tags: [知识工程, 知识组织, AI 智能体, 规范]
source: []
status: stable
generated: {by: claude, at: 2026-09-28T14:47:05Z}
verified:
  - {by: human:lanchestios, at: 2026-09-06T12:00:00Z}
  - {by: human:lanchestios, at: 2026-09-06T13:28:51Z}
created: 2026-09-06
updated: 2026-09-28
---

Open Knowledge Format（开放知识格式），Google Cloud 2026 年 6 月发布的开放规范，当前 **v0.2**。一句话：**一套「怎么用 Markdown 文件组织知识」的约定**——一个目录树，装满带 YAML frontmatter（前置元数据）的 md 文件，唯一的硬性要求是每个文件都有一个非空的 `type`。

它要解决的是：企业里 AI 真正需要的是内部知识（表 schema、指标口径、事故手册、API 弃用通知），但这些知识散在元数据目录、Wiki、云盘、代码注释和没写下来的人脑里，**每个用 AI 的人都在重复解决同一个「上下文组装」问题**。

## 设计原则

三条，是理解全篇的钥匙——后面每一条具体规定都能回推到这里。

| 原则 | 内容 | 落到规范里 |
|---|---|---|
| **尽可能少作预设** | 只强制 `type`，其余全归生产者 | 目录结构与领域无关；`type` 取值不做中央注册 |
| **生产者与消费者独立** | 人手写的、流水线生成的、LLM 合成的都行 | 格式是契约，两端可独立更换 |
| **是格式，不是平台** | 不绑定任何云、数据库或模型供应商 | 参考实现只是让格式落地，不属于规范 |

采纳判据五条：谁都能生产（不需要 SDK）、谁都能消费（不需要集成）、能跨系统与组织迁移、能和代码一起进版本控制、人和智能体都能直接读。

## 结构总览

### 一个 bundle（知识包）长什么样

```
path/to/bundle/
  index.md                  # 可选。目录清单，做渐进式披露
  log.md                    # 可选。变更史，ISO 日期倒序分组
  <concept>.md              # 一份概念 = 一个 md 文件
  <subdirectory>/           # 子目录只用来分组，与领域无关
    index.md
    <concept>.md
    references/             # 约定（非要求）：把外部材料、运行说明、代码
      attesters/revenue.py  # 镜像成包内的一等概念
```

一个真实的包大致长这样——子目录怎么分完全由生产者定，OKF 不预设：

```
sales/
├── index.md
├── datasets/
│   ├── index.md
│   └── orders_db.md
├── tables/
│   ├── index.md
│   ├── orders.md
│   └── customers.md
└── metrics/
    ├── index.md
    └── weekly_active_users.md
```

三个术语：

| 术语 | 是什么 |
|---|---|
| **Knowledge Bundle** | 自包含的目录树，分发单位。可以是 git 仓库（推荐，自带历史、归属与 diff）、tar/zip 包，或大仓库里的一个子目录 |
| **Concept** | 一份知识 = 一个 md 文件。可以描述实体资产（表、API），也可以是抽象概念（指标、流程） |
| **Concept ID** | 文件在包内的路径去掉 `.md` |

**两个保留文件名**在任何层级都有固定含义，不能拿来当 concept（概念）：

| 文件 | 用途 | 格式 | frontmatter |
|---|---|---|---|
| `index.md` | 目录清单，做渐进式披露 | 分节，每节若干条 `* [标题](相对链接) - 描述`；描述应取自被链概念的 `description` | **无**。唯一例外：包根的可带 `okf_version` |
| `log.md` | 变更史 | `## YYYY-MM-DD` 倒序分组；条目前导粗体词（`**Update**` / `**Creation**` / `**Deprecation**`）是约定不是要求 | 无 |

其余所有 `.md` 都是 concept。两个保留文件都是**可选**的——缺了不影响合规。

### 全部 frontmatter 字段

一份 concept（概念）的 frontmatter 就是它的全部契约。**只有 `type` 必填**——只带 `type` 的文档已经完全合规。

**基本字段**

| 字段 | 必填 | 作用 | 取值 |
|---|---|---|---|
| `type` | **是** | 消费者据此路由、过滤、展示 | 短字符串，不做中央注册。如 `BigQuery Table` / `Metric` / `Playbook` / `Attested Computation`。消费者遇到不认识的类型**必须**优雅降级当作通用概念 |
| `title` | 推荐 | 人读的显示名 | 省略时消费者可从文件名推 |
| `description` | 推荐 | 一句话摘要 | 供 `index.md` 生成、搜索摘要、预览用 |
| `resource` | 推荐 | 底层资产的规范 URI | 描述抽象概念（而非实体资产）时没有这一项 |
| `tags` | 推荐 | 跨切分类 | 短字符串列表。OKF 不另定按标签聚合的文件格式，消费者可在消费时扫 frontmatter 自行合成 |
| 任意其他键 | 可选 | 生产者自定义扩展 | 消费者**不得**因为不认识而拒绝，往返时应保留 |

**出处族 `sources`** —— 这份知识从哪来。

| 字段 | 必填 | 作用 |
|---|---|---|
| `sources[].resource` | 条目内**必填** | 能跟进去的具体制品（绝对 URL / 包内路径 / `references/` 下的路径），**或**跟不进去的范围描述（如「BigQuery 项目 X 里的所有查询」） |
| `sources[].id` | 可选 | 稳定键，供正文脚注逐条归因。正文引用了该来源时应当有 |
| `sources[].title` | 可选 | 人读的标签 |
| `sources[].author` | 可选 | 谁产出的（actor 约定）。**权威性信号** |
| `sources[].usage_count` | 可选 | 在 `usage_window` 期间被使用了多少次。**活跃度信号** |
| `sources[].last_modified` | 可选 | 来源本身何时变过。**时新性信号**，区别于记录「概念何时被写」的 `generated.at` |
| `usage_window` | 可选 | 与 `sources` **平级**写一次，用 `{from, to}` 框住所有 `usage_count`。单条可自带以覆盖 |

**信任族** —— 谁写的、谁核过。

| 字段 | 必填 | 作用 |
|---|---|---|
| `generated.by` | `generated` 内**必填** | 当前内容是谁产出的（actor） |
| `generated.at` | 可选 | 内容最后一次**实质变更**的 ISO 8601 时刻。消费者据此区分「刚改过」与「陈旧事实」 |
| `verified[].by` `verified[].at` | 可选 | 确认**事件列表**。多条表示独立确认（人工签字 + 每夜进程各一条）。「多近确认的」看最新的 `at` |

> 单个确认者可以省掉列表短横，写成一个裸 mapping；消费者**必须**把它当成单元素列表处理。这是合规里为数不多的硬性 MUST 之一。

**生命周期族**

| 字段 | 缺省 | 取值 |
|---|---|---|
| `status` | `stable` | `draft` 未评审、可能不完整 / `stable` 可消费 / `deprecated` 留给旧链接与历史，不再是现行的 |
| `stale_after` | 无 | 绝对时刻。`now >= stale_after` 即过期 |

**计算族** —— 只有 `type: Attested Computation` 才带，机制见下。

| 字段 | 必填 | 作用 |
|---|---|---|
| `runtime` | **该类型必填** | 怎么跑。它决定执行器与见证器如何解释这份算法、`parameters` 是什么意思。如 `bigquery` / `postgres` / `dbt` / `python` / `Looker` |
| `parameters` | 可选 | 有类型的具名空位，每条 `{name, type, required}`。绑定语义随 `runtime` |
| `computation` | 可选 | 指向存放算法的文件路径。省略则以正文的 `# Computation` 代码块为准 |
| `executor.resource` | 可选 | 运行说明或代码，由跑者（智能体或确定性消费者代码）遵循 |
| `executor.receipt` | 可选 | 声明一次运行必须返回哪些字段——见证器要检查的证据，如 BigQuery 的 `job_id` 与实际执行的 SQL |
| `attester.resource` | 可选 | **确定性、无 LLM** 的代码，读 receipt 给出裁决。在消费者侧运行 |

### 正文

标准 markdown，**没有必需的章节**。规范建议优先用结构化 markdown（标题、列表、表格、围栏代码块）而不是自由散文——结构对人读和智能体检索都有帮助。

三个有约定含义的标题：`# Schema`（资产的列 / 字段）、`# Examples`、`# Computation`。

### 一份完整的 concept（概念）

把上面两节合起来看——frontmatter 加正文，这是绑定了实体资产的那种：

```markdown
---
type: BigQuery Table
title: Customer Orders
description: One row per completed customer order across all channels.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
tags: [sales, orders, revenue]
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-05-28T14:30:00Z }
---

# Schema

| Column        | Type      | Description                                         |
|---------------|-----------|-----------------------------------------------------|
| `order_id`    | STRING    | Globally unique order identifier.                   |
| `customer_id` | STRING    | Foreign key into [customers](/tables/customers.md). |
| `total_usd`   | NUMERIC   | Order total in US dollars.                          |
| `placed_at`   | TIMESTAMP | When the customer submitted the order.              |

# Joins

Joined with [customers](/tables/customers.md) on `customer_id`.
```

不绑定实体资产的概念（`Playbook`、`Metric` 之类）形状一样，只是没有 `resource`，正文换成 `# Trigger` / `# Steps` 这类自定的标题。

> 素材里那篇公众号文章配的示例图写的是 `timestamp:`——**那是 v0.1 字段**，v0.2 已由 `generated.at` 取代。以上面这份为准。

### 路径取值

五个路径型字段——`resource`、`sources[].resource`、`computation`、`executor.resource`、`attester.resource`——统一接受三种写法：绝对 URL、`/` 开头的包内绝对路径、相对路径。（`sources[].resource` 还可以是范围描述，那就不是路径。）

### actor（行为主体）约定

凡是记身份的字段（`generated.by`、`verified[].by`、`sources[].author`）统一三种写法：

| 写法 | 指什么 |
|---|---|
| `<产品>/<版本>` | 智能体与工具，如 `reference_agent/gemini-2.5-pro` |
| `human:<id>` | 人 |
| `process:<id>` | 自动化进程 |

分层信任的消费者靠 `human:` 前缀判断，所以手写或人工确认的内容**必须**带这个前缀。

## 关键机制

四个机制，每个解决一个具体问题。

### 可信度用信号，不用分数

**问题**：消费者怎么判断该多信一份知识。

**做法**：只记 `author` / `usage_count` / `last_modified` 三个客观的、逐来源的信号，不存分数。可信度由信号**推导**。

**为什么**：分数是主观的、跨消费者不可移植、而且会过期。

**注意**：`usage_count` 是粗信号。它在「活着还是死了」和数量级层面可比，也可以和这个来源自己的历史比，但**不能当精确的跨类排名**——一个定时查询的执行次数和一个人主动看板的次数不等重。

血缘不设专门字段：当 `resource` 指向另一份 OKF 概念时，派生边已经存在于包的图里，消费者可以递归进去让可信度传播。更深的血缘（显式的外部 `derived_from`、数据血缘）在 v0.2 属于范围之外。

### generated 与 verified 刻意分开

**问题**：「谁写的」和「谁核过」是两件事。

**做法**：两个字段，`generated` 记产出，`verified` 记确认事件的**列表**。

**为什么**：写内容的人不必是确认内容的人；内容可以变而没人重新确认，事实也可以在内容没变时被重新确认。

三级信任由 `verified` **推导，不存储**：

| 条件 | 层级 |
|---|---|
| 无 `verified` 键 | unverified 未确认 |
| 只有非 `human:` 确认者 | machine-confirmed 机器确认 |
| 有 `human:<id>` 确认者 | human-reviewed 人工确认 |

信任层级是**建议性信号，不是访问控制**。没有任何信任字段的概念照样可消费，消费者不得拒绝。

### 逐条归因用脚注加稳定 id

**问题**：正文里某一句话到底出自哪个来源。

**做法**：markdown 脚注，标签就是某条 `sources[].id`。消费者按 id 匹配到条目，而不是解析脚注的文字。

```markdown
The `events_` table is sharded daily as `events_YYYYMMDD`.[^ga4-schema]

[^ga4-schema]: GA4 BigQuery Export schema
```

**为什么用 id 而不是位置下标 `sources[0]`**：智能体在不停重写这些文档，**列表一被重排，位置下标就静默错配**；稳定 id 扛得住重排。

### Attested Computation

**问题**：怎么确认一个数值真是跑权威算法算出来的，而不是模型编的。

**做法**：v0.2 新增的概念类型——把一个指标的权威算法本身变成一份概念，带三件套：

| 件 | 职责 |
|---|---|
| `computation` | 算法本身 |
| `executor` | executor（执行器）。跑完返回 receipt（回执，如 `job_id` + 实际执行的 SQL） |
| `attester` | attester（见证器）。**确定性、无 LLM（大语言模型）** 的代码，读 receipt 给出裁决 |

**它和 `verified` 不是一回事**：`verified` 是人或进程说「我核过了」；attestation（证明）是机器对**一次具体运行**给出裁决。

`resource` 背后是 Skill、脚本还是容器，属于打包选择——**OKF 固定接口，不固定打包**。

## 合规与版本

### 合规只有三条

包合规于 v0.2 只需要：

1. 每个非保留 `.md` 有可解析的 YAML frontmatter
2. 每个 frontmatter 有非空 `type`
3. 出现的 `index.md` / `log.md` 符合各自格式

其余一律软约束。消费者**不得**因为以下五种情况拒绝一个包：

- 缺可选的 frontmatter 字段
- 未知的 `type` 取值
- 未知的附加键
- 断链
- 缺 `index.md`

### 版本

`<major>.<minor>`：小版本只做向后兼容的新增（新可选字段、新约定标题），大版本才改必填字段或保留名。

包可以在**根 `index.md`** 的 frontmatter 里写 `okf_version: "0.2"`——这是 `index.md` 唯一允许带 frontmatter 的地方。消费者看不懂声明的版本时应尽力消费，而不是拒绝。

v0.1 → v0.2 的两处破坏性改动：

| v0.1 | v0.2 |
|---|---|
| `timestamp` | 被 `generated.at` 取代 |
| 正文的 `# Citations` 列表 | 被 frontmatter 的 `sources` 取代 |

其余全是新增。已明确**推迟**到未来版本的：完整的运行时协议（receipt 与裁决的传输格式、一次运行前后的见证生命周期）、attester 的 ABI（应用二进制接口）与沙箱、见证缓存、semantic layer（语义层）模板。

## 可信边界

### 三条非目标

规范自己划的线，和目标同样重要：

- **不定义固定的类型分类法** —— `type` 取值由生产者定
- **不规定存储与查询设施** —— 它是格式，不是服务
- **不取代领域 schema** —— Avro / Protobuf / OpenAPI 由 `resource` 引用，不被吞并

### 链接只断言「有关系」

概念之间用标准 markdown 链接互指，目录因此变成一张关系图。推荐用 `/` 开头的包内绝对路径（文档在子目录间移动时不会断），也接受相对路径。

**一条链接不携带关系类型**——具体是什么关系由上下文散文表达。建图的消费者通常把所有链接当成无类型的有向边。

**消费者必须容忍断链**：目标不存在不算格式错误，它可能只是「尚未写出的知识」。

### 它的性格：一连串「不得拒绝」

规范里反复出现的不是「必须提供什么」，而是「不得因为什么而拒绝」。这是交换格式的自觉——**它假设对面写得很糟，因为交换格式没法要求对面**。

### 与相邻方案

已有解法其实早就收敛到同一个形状——Karpathy 的 LLM Wiki、接编码智能体的 Obsidian Vault、`AGENTS.md` / `CLAUDE.md`、塞满 `index.md` 和 `log.md` 的仓库，以及 [[常青笔记]] 这一脉。问题不是没人做，是**每家都是量身定制，互不兼容**。所以 OKF 的定位很克制：**需要的是一种格式，不是又一个知识服务**。

它对本仓库意味着什么，见 [[与本仓库的对比]]。

### 素材的局限

`source` 里那篇公众号文章讲的是 **v0.1**，只覆盖到「目录 + frontmatter + 只有 `type` 必填 + 三条设计原则」。信任层、可信度信号、生命周期、Attested Computation 全是 v0.2 才有的——以文章为准会漏掉一半。**本页以 SPEC 为准。**

## 相关链接

- [OKF v0.2 SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [Google Cloud: Introducing the Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
- [Andrej Karpathy: LLM Wiki Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
