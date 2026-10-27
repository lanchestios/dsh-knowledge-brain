# 格物致知

[DeepSeek Harness](https://dsh.deepseek.com)（DSH）的个人知识库插件。一个 git 管的 Markdown 目录，人在里面读、写，模型在里面查、沉淀，两边用的是同一份文件、同一套规则。

## 理念

**格物**：别人写的东西进 `raw/`，原件保留，只进不改。文章、书、听录都算素材。

**致知**：经历与自己消化过的内容写进五个区，每页用 frontmatter 的 `source` 指回素材。

| 区 | 放什么 | 判据 |
|---|---|---|
| `经历/` | 观察与实践，按月记，是认知的来料 | 我经历过什么 |
| `认知/` | 见解、方法论、原则 | 我怎么想 |
| `学习/` | 拆过、练过的具体系统，钉版本基线 | 我拆过、练过什么 |
| `知识/` | 外部习得的领域知识，不绑版本 | 我知道什么 |
| `系统/` | 业务域与其中的系统、项目 | 我在做什么 |

几条贯穿始终的约束：

- **素材与沉淀分离**：正文用 `source` 指回素材，同一份素材可以被多页引用。文档的引用关系由命令计算，处理进度另记在 `.wiki/coverage.conf`，不改素材原件。
- **按需生长**：节点没有子页就是一个平铺的 `X.md`，长出子页才收成 `X/X.md`，按实际内容扩展目录。
- **结构走命令**：建页、挪位置、改名都用 `wiki` 命令，引用会跟着修好。pre-commit 跑 `stamp` 和 `check`，结构坏了提交不上去。
- **写和确认分开**：`generated` 记谁写的，`verified` 记谁核过。模型写的页面要等人工确认后才算可信，`wiki page unverified` 能列出还没确认的页。
- **规则随插件分发**：通用组织规则在 `vault-tools/skills/wiki/`，写作规则在 `vault-tools/skills/wiki-write/`；区内规则在知识库的五区门面页。代码中的分区、骨架与词表统一定义在 `vault-tools/lib/core/repo.py`。

文档按 `raw/document/<日期>/<文章名>/` 归档，正文和 `images/` 同住；书籍按 `raw/book/<书名>/` 保存原文件、进度页、章节与图片。素材图片随素材保存，沉淀页使用的图片和图表等附件放在 `asset/`。

## 插件提供什么

给人用：

- **阅读**：Markdown 渲染，支持公式、Mermaid、信息图、Excalidraw 图位与代码高亮。另有目录、双链与反链、图谱和全文搜索（阅读器内 macOS 用 ⌘⇧K，Windows 用 Ctrl+Shift+K）。`asset/` 下的 HTML 以沙箱 iframe 嵌入。
- **编辑**：块级编辑器支持拖拽调整位置、自动保存，也支持源码编辑与 Excalidraw 画布编辑。
- **看板**：「知识探索」查看文档、书籍与待沉淀素材；「知识沉淀」查看草稿、最近变更和各区页面。书籍支持转换文字、按章节阅读、登记阅读与沉淀进度。
- **对话**：用 `@` 把 wiki 页引进对话，引用 chip 点开就是右侧页面。右侧会话栏默认打开当前知识库目录下最近的顶层会话，也可切换历史或新建；文档和章节的「知识沉淀」操作会新开会话并发送指令。

给模型用：

- **工具**：`wiki_search` / `wiki_read_page` / `wiki_tree` / `wiki_tags` / `wiki_backlinks` / `wiki_raw`
- **技能**：`wiki` 管分区规则与库务，`wiki-read` 管只读检索，`wiki-method` 按任务发现并应用当前库的方法论，`wiki-write` 编排一页的写作与验收，`wiki-write-book-ingest` 将书籍源文件整理到可读。
- **写作流程**：调研、起草、去 AI 味与审校分别由 `wiki-write-explore`、`wiki-write-draft`、`wiki-write-humanize`、`wiki-write-review` 承担。`wiki-write` 按场景顺序派发宿主通用子智能体，读取对应技能、通过文件交接，最终由主会话验收。需要宿主启用通用子智能体能力；联网与写入范围等约束写在技能中，工具权限由宿主决定。

需要分析问题、设计方案、拆解系统、制定计划，或明确要求使用库内方法时，模型可选择 `wiki-method`。它从当前库的认知区门面、方法导航与目录发现适用方法，按需读取步骤、判据和可信边界，再用于任务。方法内容保留在知识库；修改或新增方法后，后续读取直接使用当前内容，无需重新发布插件。新任务、目标或约束变化、用户指出方法更新、长任务进入下一阶段时重新读取或选择；本机制不监听单个执行阶段中途的内容变化，也不将每篇方法注册成独立技能。

外延：

- **飞书问答**：一个机器人对应一个文件夹（也可以是整个知识库），只依据该文件夹的内容作答。机器人以飞书应用名为人设名（取不到时叫「知识问答Agent」），像同事一样直接给答案，答不上来就说明自己能解答的范围。
- **MCP 服务**：一个文件夹对应一个只读 MCP 端点，Claude Code、Cursor、别的 DSH 用 token 连上来，只能搜索、读取这个文件夹里的页面和页面引用的图片。

## 安装

当前从 GitHub 仓库安装：

```sh
dsh plugin --profile <profile> add github:lanchestios/dsh-knowledge-brain
```

桌面版在 DSH 插件管理页的 Add plugin 中填 `github:lanchestios/dsh-knowledge-brain`，安装后启用。CLI 的 `<profile>` 替换成目标 profile（如 `web`）。

当前插件版本见 [package.json](package.json)。使用 DSH `0.2.1-rc.3` 构建与验证；三个 DSH 直接依赖的范围均为 `>=0.2.1-rc.2 <0.2.2-0`。运行 DSH 的机器需要提供 `git` 和 `python3`，用于建库、库务命令与开库校验。

### 打开知识库

DSH「设置 → 插件 → 格物致知」的「知识库目录」一行有两个按钮：

- **新建**：选一个目录，挑模板（「无模板」建结构与五区空门面；「预置模板」加入区内规则、系统分析与设计、知识库系统层方法论及 `知识/知识工程/` 的 10 篇知识工程页）。模板不覆盖已有文件，缺失的种子子树文件会补入；不属于知识库结构的顶层项挪进 `.wiki/backup/init-<时间>/`，挪之前会列清单让你确认。命令行同一件事：在目录里跑 `python3 <插件包>/vault-tools/bin/wiki init --template preset`。
- **打开**：选一个已经是知识库的目录。完整 `wiki check` 全过才打开；没过就列出每条报错，附一段可复制给 AI 的修复指引。

预置方法从 `认知/方法论/方法论.md` 进入，分为两组：`系统分析与设计/` 包含问题界定与需求发现、系统架构拆解、流程与用例设计、领域建模、质量属性设计、风险验证和演进迁移；`知识库系统层方法论/` 包含系统知识分层、节点分类、内容组织、成员拆解与建设推进。模板不带原知识库的案例原件和本地素材；相关边界在方法页内说明。

新库首页提供「学一篇文章」「读一本书」「记一场会议」入口，也可以直接在会话里说「抓一下这篇 <url>」「我在读《X》」或「起一页讲 X」。

开库后，库根的 `./.wiki/bin/wiki` 指向插件内的命令入口，`./.wiki/bin/wiki --help` 可查看用法。当前库结构版本为 v5；旧库缺少对应升级脚本时会停止打开，并显示错误。

## 配置

设置入口是 **DSH → 设置 → 插件 → 格物致知**。知识库目录、知识问答机器人和 MCP 服务都在这里配置，合法改动自动保存；机器人与 MCP 条目在弹窗中点「确定」后保存。

也可以修改 profile 的 `cordis.patch.yml`，当前配置字段为：

```yaml
- id: dsh-knowledge-brain
  name: dsh-knowledge-brain
  config:
    vaultDir: "/path/to/your/wiki"
    larkApps: []               # 飞书机器人列表，见下文
    mcpServers: []             # 只读 MCP 端点列表，见下文
```

### 飞书问答

飞书侧的配置，每个机器人各做一遍：

1. 在 [open.feishu.cn](https://open.feishu.cn) 建一个**企业自建应用**，开启「机器人」能力。
2. 在「事件与回调」中选**使用长连接接收事件**，订阅 `im.message.receive_v1`；要在机器人进群时开启新会话，再订阅 `im.chat.member.bot.added_v1`。
3. 「卡片回传交互」也选**长连接接收**，用于 AI 追问选择卡片的按钮回传。
4. 开通以下权限后创建版本并发布，取得 app_id 和 app_secret。

| 权限 | 用途 |
|---|---|
| `im:message:send_as_bot` | 必需：发送回答和追问卡片 |
| `im:message.p2p_msg:readonly` | 必需：接收单聊消息 |
| `im:resource` | 必需：上传答案中引用的图片 |
| `im:message.group_at_msg:readonly` | 群聊：接收 @ 机器人的消息 |
| `im:message.group_msg` | 可选：群里新开话题不 @ 也答，需管理员审批 |
| `im:chat:readonly` | 可选：读取群名和群类型 |
| `contact:contact.base:readonly` | 可选：读取提问人名字，用户需在应用通讯录可见范围内 |

DSH 侧：在「知识问答」点「新增」，填写 app_id、app_secret，选择文件夹和模型；选最上面的「知识库」表示整个库，模型留空使用宿主默认。点「确定」后自动保存，行尾的「检测」可检查凭证、机器人能力和权限。

问答使用宿主会话和内置「仅可查看」（`read-only`）权限预设。

手写配置时，`config.larkApps` 的每一项为：

```yaml
- appId: cli_xxx
  appSecret: "<app_secret>"
  folder: "/"                  # 或库内文件夹路径，如 系统/某平台
  model: ""                    # 可选，指定时写 provider/model
```

行为说明：

- 单聊直接回答，群聊需要 @。群里新开的话题，第一条不用 @，之后的追问仍要 @。
- 话题内按话题隔离上下文，话题外按单聊或群聊隔离。回答卡片会显示处理进度；上一条没答完时，同一会话里的新消息会被婉拒，不排队。
- 发送完整消息「新会话」可重新开始，群聊中仍要 @ 机器人。
- 同一个 app_id 只能在一个 DSH 实例里启用，否则多个实例会抢消息。
- DSH 不运行时机器人就离线。聊天与会话的关联只保留在本次运行的内存中，重启后开始新会话；已有对话仍保留在 DSH 历史中。插件设置页只管理机器人配置和连接状态。
- 选「知识库」的机器人依据整个库作答，对提问人只说负责「这边的业务问题」，不报具体范围。

### MCP 服务

在「MCP 服务」点「新增」，填端点和名称、选一个文件夹（选最上面的「知识库」就是整个库），token 自动生成，确定后自动保存。卡片上的「MCP参数」复制一份通用配置，贴进客户端的 MCP 配置文件：

```json
{
  "mcpServers": {
    "<端点>": {
      "type": "http",
      "url": "http://127.0.0.1:<DSH实际端口>/mcp/<端点>",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

地址由宿主实际监听端口生成，以卡片显示和复制出的配置为准。

行为说明：

- 工具只读：`wiki_search` / `wiki_read_page` / `wiki_tree` / `wiki_tags` / `wiki_backlinks` / `wiki_image`。结果只含该文件夹（含子文件夹）的页；`wiki_image` 只给这些页正文里引用的 png/jpg/jpeg/gif/webp/bmp，单张 ≤5MB。素材正文不开放。
- 正文原样返回，里面指向文件夹外页面的 `[[双链]]` 链接名可见，但读不到那一页。
- DSH 开着才能用。端点不走浏览器登录，只认 token；带 `Origin` 头的请求一律拒绝，浏览器页面连不上。token 等同密码，重新生成或删除后旧配置立即失效。
- web profile 绑在 0.0.0.0 时，局域网里也能连到这个端点，token 走明文 HTTP；敏感内容请用 desktop 或只绑 localhost 的 web。
- 也可以手写在 `cordis.patch.yml` 的 `config.mcpServers`：`[{ endpoint, name, folder, token }]`，endpoint 只能用字母、数字、- 和 _，最多 32 位；name 是显示名称，最多 32 个字；folder 写 `/` 表示整个知识库；token 至少 32 位。

## 开发

使用 Node.js 22+、pnpm、Python 3 和 Git。在插件仓库中运行：

```sh
pnpm install
pnpm build     # 构建 lib/ 与 assets/excalidraw/
pnpm watch     # 监听源码变化
pnpm test      # Vitest
pnpm typecheck
pnpm peers check
```

发布构建用 `node build.mjs --install`（不生成 sourcemap）；`prepublishOnly` 也运行这条命令。仓库跟踪构建产物，更新运行时代码后需同步构建；`pnpm install` 本身不触发构建。

前端使用 React、Tailwind CSS 4 与本地维护的 shadcn 风格组件，交互基于 Radix UI / cmdk。组件和样式约定见 [插件 UI](src/client/ui/README.md)。

### 宿主依赖

| 直接依赖 | 用途 |
|---|---|
| `@deepseek-ai/cordis` | 插件上下文、生命周期与服务接口 |
| `@deepseek-ai/schemastery` | 插件配置定义 |
| `@deepseek-ai/dsh-llm` | 飞书问答消息与 `@页面` 正文注入 |
| `@deepseek-ai/dsh-tools` | 注册库内查询工具 |
| `@deepseek-ai/dsh-skill-filesystem` | 挂载包内技能 |

侧栏会话、设置入口、路由等通过宿主服务接入；写作流程使用宿主通用子智能体，插件自身不注册专用 agent 或会话预设。

wiki 命令行工具的代码结构和开发约定见 [vault-tools/README.md](vault-tools/README.md)。

## License

[MIT](LICENSE)
