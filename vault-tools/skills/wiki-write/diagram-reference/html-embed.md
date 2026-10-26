# html 嵌入

超出模板能力或要交互的走 html：交互组件放 `asset/explorables/<日期>/`，复杂静态图放 `asset/diagrams/<日期>/`，正文用图片语法嵌入 `![](asset/explorables/<日期>/<名>.html?h=560)`。路径同图片引用，从仓库根写起，不写 `../`。只认 `asset/` 下的 html，`wiki check` 会校验。

`?h=` 声明**实际使用高度**（像素），必须写、只有这一个参数、合法区间 160–2000，`wiki check` 三样都拦。嵌入件**不滚动**：iframe 定死这个高度，滚轮悬在上面滚的是文章；内容装不下会被直接裁掉——发现裁了就把 `?h=` 调够，别让它自己滚。定数按最宽正文栏量（约 880px；带 svg 等比图的组件宽度越大越高，宁可报足），也别虚报用不满的高度留大块空白。量级参考：单卡片交互 ~400、带图表或双栏 ~500、多面板 ~600、整页向导 1000+。做完在 DSH 里看一眼：不裁、不留大空白再定稿。改完 html 不用做任何事，页面会自动换新。

**画布比例贴正文列。**svg 宽超过正文栏（约 880px）就被等比缩小：一张 3:1 的宽图在 800px 栏里只剩约 260px 高、字号跟着缩半、iframe 下半截全空。所以带 svg 的图 viewBox 宽以 880 为上限、宽高比落在 1:1～2:1，内容铺满画布；装不下就重排布局——多列横向铺开改上下两排网格、跨排边走中间通道带——不是把画布拉宽。`?h=` 按「viewBox 高 × min(1, 栏宽/viewBox 宽)＋边距」的量级报足，高度声明写死、图按比例改，不用自适应。

**明暗跟宿主不跟系统。**DSH 的夜间模式挂在宿主页 `body[data-ds-dark-theme]` 上，无同源沙箱 iframe 里的 `prefers-color-scheme` 只跟系统走。插件统一处理：嵌入件下发时直接把宿主明暗写进 `<html data-dsh-theme="dark|light">`（首帧就对），主题切换时广播改这个属性，并按属性统一注入 `color-scheme`。嵌入件只认这个属性，三条 `wiki check` 都拦：①颜色跟属性切——暗色变量除 `@media (prefers-color-scheme: dark)`（直开页兜底）外**必须同时挂** `html[data-dsh-theme="dark"]`，浅色回挂 `html[data-dsh-theme="light"]`；或直接写 `light-dark(浅, 深)`，一处写完；②**不自己写 `color-scheme`**——与宿主错位时 Chromium 在 iframe 背后垫一层不透明白底（或黑底），背景透明也透不到宿主；③`html`/`body` 背景透明。SVG 的 `fill`/`stroke` 也写 `var(--…)`，半透明用 `color-mix(in srgb, var(--ink) 10%, transparent)`，别写死色值。JS 里自己选色的读 `document.documentElement.dataset.dshTheme` 优先、matchMedia 兜底，并盯这个属性的变化重画（先例 `asset/explorables/2026-09-29/learning-and-overfitting-line-fit.html`）——这一类 check 查不到，自己守。

视觉语言照仓库范本走（`asset/explorables/` 下的 choose-loss-overview、payment-roles-flow），约束住这几条：

- 内容画在**一张 SVG 画布**上：`viewBox="0 0 900 H"`、宽度 100% 等比缩放，节点、链路、标签全在画布里；不用 HTML div 拼节点和箭头——div 拼出的方角小盒配细箭头，与画布不是一个语言。
- 配色走 CSS 变量：`--paper/--panel/--rule/--ink/--ink-2/--ink-3` 打底，语义色蓝红绿各司其职；暗色整套重定义（挂法见上一段「明暗跟宿主」）；`body` 透明，容器限宽约 860。
- 节点＝圆角盒，名称＋副题一至两行，当前场景不经的站灰到约三成透明；链路＝带 marker 的 path，坐标手工算、走弧线不排直线队，虚线留给应答与外围关系；画布上的文字一律加 halo（`stroke="var(--halo)" stroke-width="3" paint-order="stroke"`），压线压盒都读得出。
- 交互＝置顶一行页签，选中态色描边，切换即重画画布；跨页签固定节点槽位、只重画链路，切起来不跳。入场用 `pathLength="1"` 的 draw-in 加逐项 fade，`prefers-reduced-motion` 全关。
- 收口两件：左侧色条的选中项解说、虚线框的读图口径，文案从正文取，不往图里编正文没有的。
