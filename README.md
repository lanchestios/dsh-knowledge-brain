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

- **素材与沉淀分离**：一份素材可以沉淀到多个节点，不复制文件。素材本身不记状态，沉淀进度由命令根据引用关系现算。
- **按需生长**：节点没有子页就是一个平铺的 `X.md`，长出子页才收成 `X/X.md`。不建空壳，也不留示例页，库里每一页都是真内容。
- **结构走命令**：建页、挪位置、改名都用 `wiki` 命令，引用会跟着修好。pre-commit 跑 `stamp` 和 `check`，结构坏了提交不上去。
- **写和确认分开**：`generated` 记谁写的，`verified` 记谁核过。模型写的页面要等人工确认后才算可信，`wiki page unverified` 能列出还没确认的页。
- **规则只有一处**：组织规则写在 `vault-tools/skills/wiki/`，代码定义在 `vault-tools/lib/core/repo.py`，随插件分发。vault 里没有代码副本，只有几条指向插件包的软链。

## 插件提供什么

给人用：

- **阅读**：Markdown 渲染，支持数学、mermaid、信息图。另有目录、双链与反链、本地图谱、全文搜索（⌘⇧K）。`asset/` 下的 html 以沙箱 iframe 嵌入。
- **编辑**：所见即所得的块级编辑器，可以拖拽调整块的位置，自动保存。
- **看板**：「知识沉淀」看各区进度，「知识探索」看素材和书架。
- **对话**：用 `@` 把 wiki 页引进对话，引用 chip 点开就是右侧页面。

给模型用：

- **工具**：`wiki_search` / `wiki_read_page` / `wiki_tree` / `wiki_tags` / `wiki_backlinks` / `wiki_raw`
- **子 agent**：`wiki_write_explore`（调研、抓素材）、`wiki_write_draft`（断网，只按手上的材料写）、`wiki_write_review`（删掉非知识内容）、`wiki_write_humanize`（去 AI 味）
- **技能**：`wiki` 定义规则，`wiki-write` 负责编排一页从调研到验收的全过程，`wiki-write-distill` 负责提炼听录

外延：

- **飞书问答**：一个机器人对应一个文件夹（也可以是整个知识库），只依据该文件夹的内容作答。机器人以飞书应用名为人设名（取不到时叫「知识问答Agent」），像同事一样直接给答案，答不上来就说明自己能解答的范围。
- **MCP 服务**：一个文件夹对应一个只读 MCP 端点，Claude Code、Cursor、别的 DSH 用 token 连上来，只能搜索、读取这个文件夹里的页面和页面引用的图片。

## 安装

```sh
dsh plugin --profile <profile> add dsh-knowledge-brain
```

或者在插件页的 Add plugin 里填包名 `dsh-knowledge-brain`。

设置 → 插件 → 格物致知 的「知识库目录」一行有两个按钮：

- **新建**：选一个目录，挑模板（「无模板」只建结构；「预置模板」再种下五区写作规则与 `知识/知识工程/`），建好即打开。目录里已有的区文件夹不覆盖；不属于知识库结构的顶层项挪进 `.wiki/backup/init-<时间>/`，挪之前会列清单让你确认。命令行同一件事：在目录里跑 `python3 <插件包>/vault-tools/bin/wiki init --template preset`。
- **打开**：选一个已经是知识库的目录。完整 `wiki check` 全过才打开；没过就列出每条报错，附一段可复制给 AI 的修复指引。

第一次进来时对模型说一句「抓一下这篇 <url>」「我在读《X》」或者「起一页讲 X」，就能走完第一个闭环。

## 配置

在 profile 的 `cordis.patch.yml` 里写：

```yaml
- id: dsh-knowledge-brain
  name: dsh-knowledge-brain
  config:
    vaultDir: "/path/to/your/wiki"
    listen:
      engine: local            # local（mlx-whisper）| cloud（OpenAI 兼容）
      model: mlx-community/whisper-large-v3-turbo
      language: zh
      cloud: { baseURL: "", apiKeyEnv: "", model: "" }   # 密钥只填环境变量名
      digestModel: ""          # 提炼模型 provider/model，空 = 宿主默认
      sources: { mic: true, system: true }
```

这些项也可以在「设置 → 插件 → 格物致知」里改。本地引擎需要先装 `pip3 install -U mlx-whisper`，首次转写时会下载模型。录扬声器时建议戴耳机，免得扬声器的声音回灌进麦克风。

### 飞书问答

飞书侧的配置，每个机器人各做一遍：

1. 在 [open.feishu.cn](https://open.feishu.cn) 建一个**企业自建应用**，开启「机器人」能力。
2. 事件订阅方式选**长连接**，订阅 `im.message.receive_v1`。
3. 开通权限：「读取用户发给机器人的单聊消息」和「以应用身份发消息」。要在群里回答，再开「接收群聊中 @ 机器人的消息」。如果希望群里新开的话题不用 @ 也自动回答，还要开 `im:message.group_msg`，这项需要管理员审批。
4. 发布版本，拿到 app_id 和 app_secret。

DSH 侧：在设置卡的知识问答区填好 app_id、app_secret，再选一个文件夹（选最上面的「知识库」就是整个库），配置自动保存。行尾的「验证」按钮可以当场检查凭证。

行为说明：

- 单聊直接回答，群聊需要 @。群里新开的话题，第一条不用 @，之后的追问仍要 @。
- 每个话题是独立的会话，上下文互不相通。一条回答一般要 10 到 30 秒，上一条没答完时，同一会话里的新消息会被婉拒。
- 同一个 app_id 只能在一个 DSH 实例里启用，否则多个实例会抢消息。
- DSH 不运行时机器人就离线。问答历史只存在内存里，重启后清空。
- 选「知识库」的机器人依据整个库作答，对提问人只说负责「这边的业务问题」，不报具体范围。

### MCP 服务

在设置卡的 MCP 服务区点「新增」，填端点和名称、选一个文件夹（选最上面的「知识库」就是整个库），token 自动生成，确定后自动保存。卡片上的「MCP参数」复制一份通用配置，贴进客户端（Claude Code 的 `.mcp.json` 或 `claude mcp add-json <端点> '<json里那一项>'`、Cursor 的 `mcp.json`）：

```json
{
  "mcpServers": {
    "<端点>": {
      "type": "http",
      "url": "http://127.0.0.1:19387/mcp/<端点>",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

desktop 的端口是 19387，`dsh web` 默认 3080。

行为说明：

- 工具只读：`wiki_search` / `wiki_read_page` / `wiki_tree` / `wiki_tags` / `wiki_backlinks` / `wiki_image`。结果只含该文件夹（含子文件夹）的页；`wiki_image` 只给这些页正文里引用的 png/jpg/jpeg/gif/webp/bmp，单张 ≤5MB。素材正文不开放。
- 正文原样返回，里面指向文件夹外页面的 `[[双链]]` 链接名可见，但读不到那一页。
- DSH 开着才能用。端点不走浏览器登录，只认 token；带 `Origin` 头的请求一律拒绝，浏览器页面连不上。token 等同密码，重新生成或删除后旧配置立即失效。
- web profile 绑在 0.0.0.0 时，局域网里也能连到这个端点，token 走明文 HTTP；敏感内容请用 desktop 或只绑 localhost 的 web。
- 也可以手写在 `cordis.patch.yml` 的 `config.mcpServers`：`[{ endpoint, name, folder, token }]`，endpoint 只能用字母、数字、- 和 _，最多 32 位；name 是显示名称，最多 32 个字；folder 写 `/` 表示整个知识库；token 至少 32 位。

## 开发

```sh
pnpm install   # 含 prepare 构建
pnpm build     # 构建到 lib/
pnpm watch
pnpm test      # vitest
pnpm typecheck
```

wiki 命令行工具的代码结构和开发约定见 [vault-tools/README.md](vault-tools/README.md)。

## License

[MIT](LICENSE)
