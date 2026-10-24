# wiki 工具

把 [wiki 技能](skills/wiki/SKILL.md) 里的组织规则固化成命令。纯 Python 3 标准库，零依赖。

## 这个目录是什么：插件包的一部分，随插件分发

本目录（dsh-knowledge-brain 的 `vault-tools/`）是工具链**唯一的源码**，git 在插件仓管，
并经 `package.json` 的 `files` 白名单**随插件包安装**到每个装了 dsh-knowledge-brain 的地方。
插件运行时直接用它：skills/agents 从包内挂载，写库命令以 `python3 <包根>/vault-tools/bin/wiki`
、cwd=库根执行。

vault 侧**没有代码副本**，`.wiki/` 下只剩本地状态（wiki.json / anchors.conf / coverage.conf /
tmp）加三条指向包内的软链：`.wiki/bin`——技能文案与子 agent 里的 `./.wiki/bin/wiki` 靠它续命、
`.wiki/skills` 与 `.wiki/agents`——`.claude/` 下入库的相对软链（`skills/*` 六条、`agents`）
经这一层转到包内源；git 钩子 `.git/hooks/pre-commit` 直链包内同名文件。软链由插件**打开库时
自动建立**：没有就建、断链重建、指向别处的活链重指、真实文件不碰。各 profile 一律 git+https 安装，
包根即 `~/.dsh/profiles/<profile>/node_modules/dsh-knowledge-brain`。

### 新建与打开

新建知识库只走 `wiki init`（插件「新建」按钮调的也是它），按顺序：git → `.wiki/` 状态 →
多余顶层项挪进 `.wiki/backup/init-<时间>/` → 七个固定目录 → 按模板拷种子（`seeds/minimal/`、
`seeds/preset/`，目录结构与库一致；某个区文件夹已存在就整区不拷）→ 补骨架与文件夹页 →
补 frontmatter、删断链 source → 跑 `wiki check`。

打开已有的库：插件开库时补建 git 带不过去的东西（空的固定目录、`.wiki/tmp/`、软链与钩子）；
库版本低于插件时先跑 `wiki upgrade`，升级成功再跑完整 `wiki check`，全过才打开。没有 `.wiki/` 的目录、
版本读不出或比插件新的，直接拒绝。插件不自动补齐 `.folder.json`：不经 `wiki` 命令增删了文件，
下次开库校验不过，由 AI 照 `wiki check` 的报错修（修法在各 `_check_*` 的 docstring）再开。
校验不过时设置页列出报错；每条规则的「查什么 / 为什么 / 违规怎么改」写在 `lib/check/check.py` 各
`_check_*` 的 docstring 里，人或 AI 照着修。

语法与围栏与公式校验的 Node 依赖（mermaid / katex / remark 系 / jsdom）**不需要任何 npm install**——
它们是插件 dependencies，由 Node 从 `validate_md.mjs` 的位置向上解析：web/dev 形态落
插件根 node_modules，desktop 形态被 pnpm 提升到 profile 根 node_modules——校验跑的就是渲染
管线用的那套（真同源）。

### 一条警示

`git clean -fdX` 会把 vault 里被 gitignore 的软链清掉——恢复就是重开一次库（或重启 DSH），
软链会自动重建。

---

```bash
./.wiki/bin/wiki --help
alias wiki='"$(git rev-parse --show-toplevel)"/.wiki/bin/wiki'   # 可选
```

命令的用法与选择以 `--help` 和技能为准，本文只讲代码。

## 库版本与升级

库结构每变一次，`.wiki/wiki.json` 的 `version` 加一：两处 `WIKI_VERSION`（`lib/init.py`、插件
`src/core/vault/init.ts`）同时改，再加一个 `lib/upgrade/steps/v<N>.py`（`DESC` + `run(root, out) -> problems`，必须可重复跑）。
`wiki upgrade` 从库版本逐级升到当前，每升完一级写一次 `version`；某一级有要人改的问题就停在上一级，改完再跑。
升级不自动提交，`git status` / `git diff` 可查；撤回：改写的用 `git checkout -- .`，新补出来的是未跟踪文件，用 `git clean`（先 `-n` 看）。

当前是 v5（配置为 JSON、字段全部必填；重名页双链写路径形式；书进度页是 `<书名>/<书名>.md`，书名不带书名号；章节文件 `<号> <标题>.md`，号是 1 / 1.1 / 1.1.1；书图在 `raw/book/<书名>/images/`，章节从 `../images/…` 相对引用），还没有升级脚本；库版本低于 v5 时 `wiki upgrade` 报缺脚本。

## check 查什么

| 类 | 查什么 |
|---|---|
| 版本 | `wiki.json` 读不出 `version`；库版本低于工具（先跑 `wiki upgrade`）或高于工具（先升级插件）。check 不代跑升级 |
| 顶层 | 库根只放七个固定目录（`经历 认知 学习 知识 系统 asset raw`）与 `README.md`、`skills-lock.json`；固定目录缺一个即错，空着合法 |
| 结构 | 沉淀区文件夹缺页；平铺 `X.md` 与文件夹 `X/` 并存 |
| 骨架 | 缺 `repo.skeleton_for` 要求的固定类目 |
| frontmatter | 沉淀区页面必填字段缺失、日期 / 时刻 / 生命周期词表格式不对 |
| 引用 | `source` 指向不存在的文件；沉淀区正文 `[[双链]]` 解析不到、同名歧义（重名要写路径形式）、或指到沉淀区外（规则只在 `lib/core/links.py` 一处，与插件 `graph.ts` 用同一组用例对齐）；`raw/` 里的双链不管 |
| 文件夹配置 | 沉淀区每个文件夹（含区根）缺 `.folder.json`；缺字段或有不认识的字段（全部必填）；`children` 与磁盘不一致（漏列、多列、`type` / `ext` 不对）；`order` 重复或不是正整数；去掉扩展名后同名；写坏了；`index` 指向不存在的文件。只报不改；补齐实现在 `lib/core/folders.py`（`wiki upgrade` 与 page 命令共用） |
| 配置 | `wiki.json` 写坏了、缺字段或有不认识的字段、`parts` 不恰好是五区、`order` 重复或不是正整数；`wiki.json` 的键、`anchors.conf` 段头指向不存在的节点 |
| 卫生 | 空文件夹（`raw/` 不查）；`asset/` 下没人引用的附件 |
| 语法 | 写成结构却没渲染成结构的 md：表格塌成段落（分隔行列数不对、紧贴上一段）、表格行溢出（单元格里 `|` 没转义）、`#` 后缺空格、段落下 `---` 误成标题、围栏或 `<!--` 注释没闭合、`**` / `~~` / `](` / `[[ ]]` / `[^脚注]` / 反引号残留成字面。走渲染管线的 AST（remark-gfm + cjk-friendly，与阅读器同源），`raw/` 不查 |
| 围栏与公式 | mermaid / infographic 围栏语法、infographic 模板名、`$…$` 公式的 LaTeX |

语法、围栏与公式两项共用一趟 Node 侧脚本（`lib/check/validate_md.mjs`），依赖向上解析到插件根或 profile 根 node_modules、与渲染管线同源同版本；插件装好即启用，缺依赖只警告不拦。

有错误时非零退出。

## 代码结构

```
vault-tools/            （源码唯一在此；.wiki/bin 是指向 bin/ 的软链）
├─ bin/wiki              入口：顶层命令 + page / document / book 三个作用域的分派
├─ lib/                  目录即命令：wiki <作用域> <动作> ↔ lib/<作用域>/<动作>.py，顶层命令在 lib/ 根
│  ├─ core/              公共底座：只被命令模块 import，不对应命令，也不反过来 import 命令模块
│  │  ├─ repo.py         仓库模型：规则的唯一来源
│  │  ├─ frontmatter.py  frontmatter 解析与外科式改写
│  │  ├─ conf.py         wiki.json / .folder.json 的读写、路径类配置
│  │  ├─ folders.py      .folder.json 的补齐与校验（scan / reconcile / check_dir / sync / fix_tree）
│  │  ├─ links.py        双链：解析（路径 / 裸名 / 歧义 / 沉淀区外）、改写、结构变动后自动改写
│  │  └─ pagefile.py     新页落盘（frontmatter 契约 + .folder.json 补齐），page new / book new / observe / init 共用
│  ├─ init.py            wiki init：新建知识库（含规则二骨架 new_skeleton）
│  ├─ upgrade/           wiki upgrade
│  │  ├─ upgrade.py      读写库版本、逐级跑升级脚本
│  │  └─ steps/          每一级的升级脚本 v<N>.py（v<N> = 从 N-1 升到 N）
│  ├─ check/             wiki check（只读；不碰 raw/）
│  │  ├─ check.py        各条规则 _check_*
│  │  └─ validate_md.mjs 语法、围栏与公式（Node 侧，check.py 壳着调）
│  ├─ tree.py            wiki tree
│  ├─ stamp.py           wiki stamp
│  ├─ page/              new · restructure（grow / shrink / move / order）· mark · verify · anchor ·
│  │                     query（tags / orphans / unverified）
│  ├─ document/          add · fetch · list · cover · fidelity
│  └─ book/              new · split · cut · sync · images · crop · status · qc · read · deposit · list
├─ skills/  agents/      wiki 系列技能与子 agent（插件挂载与 .claude/ 软链共用同一份文件）
├─ seeds/                新建知识库的模板种子（minimal / preset，目录结构与库一致）
├─ tests/                一个文件一次地跑
└─ hooks/pre-commit      stamp + check
```

vault 侧另有（不在本目录、永不随插件走）：`wiki.json` 五区顺序、`anchors.conf` 锚点基线、
`coverage.conf` 素材沉淀台账、`tmp/` 临时工作区。review 摘出的非知识内容（待办清单、删句账、判过留的）
记在 `review/` 里与页同路径的账本，正文不留待办。

## 开发约定

- **规则的唯一来源是 `lib/core/repo.py`**：骨架看 `skeleton_for`，词表看 `STATUSES` / `PROGRESSES` / `COVERAGES`，身份看 `actor`，管辖范围看 `in_scope`（白名单：七个固定目录 + 库根白名单文件，排除 `SCOPE_EXCLUDE`）。frontmatter 字段顺序只在 `frontmatter.py` 的 `FIELD_ORDER`。
- **零第三方依赖，基础功能用标准库**（唯一例外是语法、围栏与公式校验走 Node，依赖随插件装、没装时自动跳过，不拖累其余校验）：MIME 走 `mimetypes`；日期校验经 `repo.is_iso_date`（`date.fromisoformat`，正则会放过 `2026-02-30`）；HTML 走 `html.parser.HTMLParser`，不用正则解析。
- **YAML 子集是手搓的**（标准库没有 YAML）：`frontmatter.py` 和 `conf.py` 各一份，只认已列出的形状，不加特性。
- **测试一个文件跑一次**：`for f in vault-tools/tests/test_*.py; do python3 "$f"; done`（在插件仓里跑；`test_compose_layout.py` 要 `WIKI_ROOT=<vault 根>` 指着库跑）。多个文件传给同一次调用，多出的路径会被 unittest 当成用例名，报 `no attribute ''`。

### fetch 适配器

`wiki document fetch` 按源类型分派，适配器在 `lib/document/fetch.py` 的 `ADAPTERS`，每个认自己的 host、自己抽元数据和正文。现有：公众号、Gist、Palantir 文档、martinfowler.com、飞书、GitHub 仓库 markdown、mariozechner.at；以及一组「正文容器 + 元数据取法」声明式的静态页适配器（`_ContainerAdapter` 子类）：微信支付商户文档、微信官方页、腾讯客服、微信开放文档、人人都是产品经理、北京商报、光明网、第一财经、移动支付网。新加这类站只需声明 `HOSTS` / `BODY` / `TITLE` / `AUTHOR` / `DATE`，正文后挂按钮栏的用 `BODY_END` 截断。

写新适配器注意：

- **源站存 markdown 就直接取**，转一趟 HTML 会丢代码块标注和嵌套。`Article` 有三种正文给法：`body_html`（转）、`body_url`（另取）、`body_md`（已在手上）。
- **相对地址用 `absolutize(md, base)` 补全**，它走 `urljoin`。`images/x.png` 相对页面所在目录，拼字符串会拼错。
- **`class` 按空格分词匹配**，`paperBody deep` 也要认。收 meta 用 HTMLParser，`_meta()` 的正则认不出 `content = 'x'` 这种带空格的写法。
- **认不出的 host 直接报错**，不做通用兜底，质量不明的东西不进 `raw/`。转载域名可 `--type wechat` 强制指定。
- 一篇 = `raw/document/<日期>/<文章名>/` 一个文件夹：md 在里面，图片下到该文件夹 `images/NN.png`，正文相对引用（`images/NN.png`）。单张失败在原位留 `<!-- 图片下载失败: url -->`，不中断整篇。
- 归档文件抬头带 `源类型` 和 `适配器` 两行，站点改版时据此回查。

## pre-commit hook

提交前跑 `stamp` + `check`。`updated` 靠手写一定会烂，所以建议装（插件打开库时会自动装好）。
手动补装就直链包内（包根见上面两种安装形态）：

```bash
ln -sf <包根>/vault-tools/hooks/pre-commit .git/hooks/pre-commit
```
