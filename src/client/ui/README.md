# 插件 UI

基础组件按 shadcn/ui new-york 的源码模式维护在本目录，交互使用 Radix UI，样式使用 Tailwind CSS 4。没有 dsh UI 组件的运行时导入。shadcn 的 MIT 许可见 `licenses/shadcn-ui.txt`；图标继续使用仓库现有的 `src/icon` SVG 体系。

- `button`、`input`、`badge`：本地样式与变体；按钮默认 ghost，紧凑工具栏用 `size="sm"`。
- `modal`：Radix Dialog，包含可访问标题、焦点约束和关闭后焦点恢复。目录选择器通过 `usePortalContainer` 将面板挂在所属弹窗内，避免被焦点约束挡住。
- `menu`、`tooltip`：Radix 管理键盘导航、碰撞检测、禁用态和 Escape。
- `popover`：shadcn 风格 Radix Popover，负责选择器定位、视口避让与弹窗内的焦点恢复。
- `command`：基于 cmdk 的可搜索列表；模型选择使用 Popover + Command 组成 Combobox，按服务商分组。全库搜索也复用这组组件。文件夹复用 Popover、Button、Input，保留目录树的搜索、展开和键盘逻辑。
- `dropdown-menu`：历史会话、子智能体列表使用真正的触发器和菜单项，统一键盘导航、视口避让、外部点击关闭和焦点恢复。
- `radio-group`、`collapsible`：新建库的模板选择与飞书/MCP 配置引导。模板选项是卡片样式的 Radio Group，Radix 管理方向键和选中状态。
- `checkbox`、`select`、`toggle-group`、`table`：文档、草稿、动态和章节列表；全选支持半选态，文档类型支持多选，日期筛选使用 Select。当前表格只需基础 Table，不引入额外的表格状态库。
- `breadcrumb`、`card`、`alert`：面包屑、探索/书架/配置卡片、自动保存失败提示。连接状态复用 Badge。

Tailwind 入口是 `src/client/styles/ui.css`，仅导入 theme 和 utilities，关闭全局 Preflight；类名统一使用 `wk:` 前缀。`build/assets.mjs` 还将 Tailwind 内部的 `--tw-*` 变量和 `@property` 注册改成 `--wk-tw-*`，并限制默认变量的初始化范围，避免污染宿主。构建和 watch 都走同一插件。

构建会展开 Tailwind 的 cascade layers，让带前缀的工具类按正常优先级参与层叠，避免宿主未分层的 `button` 等元素 reset 直接压过控件样式。业务布局也使用同一套工具类，通过 `cn` / `cx` 合并与覆盖组件默认样式。

插件的明暗主题、字体、间距和颜色定义在 `styles/tokens.css`，使用自己的 `--wk-*` 变量；主题切换只读取宿主的 `body[data-ds-dark-theme]`。其余三个宿主布局/代码字号变量均有 fallback。

设置页沿用 DSH「设置 → 插件 → 格物致知」，可在没有打开库时进入。`settings/model.ts` 维护草稿、校验、失败保留与并发版本检查；`settings/transport.ts` 将宿主的配置读写服务接入模型，并通过 `plugins.item` 注册摘要和详情页。设置沿用宿主入口，表单与基础控件由插件维护。

普通 React 界面不再导入 CSS Modules。业务样式使用完整、可静态扫描的 `wk:` 类；只被一个界面使用的布局与状态样式就近放在 TSX，跨文件复用的书籍、文档、设置卡和右栏样式放在对应的 `*.styles.ts`。这些映射只是 Tailwind 类的组合，不生成额外样式表。`wk-components-*` 等标记仅供复杂的子元素/拖拽状态选择器定位，不承担独立 CSS 规则。

Tailwind 显式扫描整个 `src/client`，容器查询保留原有的宿主栏宽适配；`dark` 变体读取宿主的明暗主题属性。`data-wiki-ui` 只标在插件自己的元素上，提供局部变量初始化与基础规范。树的缩进、指针坐标、图谱坐标等运行时数值继续使用内联样式。

保留的专用 CSS：`styles/tokens.css` 维护主题；`styles/ui.css` 编译 Tailwind 并声明共用动画；灯箱的原生 DOM/手势、编辑器和文章排版继续使用各自 CSS；KaTeX、Excalidraw 与高亮等第三方或生成内容样式保持专用入口。目录树、文档标签栏与章节分段进度条保留业务实现，外围控件和布局已迁移。
