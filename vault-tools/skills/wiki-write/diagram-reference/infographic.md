# infographic

小型数据图用 `infographic` 围栏。语法规范以官方 skill 为准（antvis/Infographic 仓库 `skills/infographic-syntax-creator`），要点收在这里：

**围栏与入口**：围栏语言写 `infographic`，内容第一行是 `infographic <模板名>`，往下是 `data`、`theme` 两个块。

**语法**：

- 两空格缩进；键值对写「键 空格 值」（`:` 和 `=` 也认，统一用空格）；数组条目用 `-` 前缀。
- `data` 常用 `title` / `desc` / `items`；条目常用 `label` / `value` / `desc` / `icon` / `children`。`value` 是数值，没有就省；`children` 只配层级结构，模板类型对不上别硬塞。
- `icon` 直接写图标名，如 `mdi/chart-line`。
- 对比类模板（`compare-*`）必须两个根节点，全部对比项做这两个根节点的 `children`。
- `theme` 可省：明暗跟随 DSH 自动切；要手绘风写 `theme hand-drawn`，要自定义颜色在 `theme` 块下列 `palette`。
- 文案从正文取，不往图里编正文没有的「事实」。

**模板选择**：按结构选族——列表 → `list-*`，顺序 / 流程 / 阶段 → `sequence-*`，对比 → `compare-*`，层级 → `hierarchy-*`，数据统计 → `chart-*`，象限 → `quadrant-*`，关系 → `relation-*`。官方推荐清单：

| 族 | 模板（全名照抄） |
|---|---|
| sequence | `sequence-zigzag-steps-underline-text`、`sequence-horizontal-zigzag-underline-text`、`sequence-circular-simple`、`sequence-filter-mesh-simple`、`sequence-mountain-underline-text`、`sequence-cylinders-3d-simple`、`sequence-ascending-steps`、`sequence-color-snake-steps-horizontal-icon-line`、`sequence-pyramid-simple`、`sequence-roadmap-vertical-simple`、`sequence-zigzag-pucks-3d-simple`、`sequence-ascending-stairs-3d-underline-text` |
| list | `list-grid-badge-card`、`list-grid-candy-card-lite`、`list-grid-ribbon-card`、`list-row-horizontal-icon-arrow`、`list-sector-plain-text` |
| compare | `compare-binary-horizontal-simple-fold`、`compare-binary-horizontal-badge-card-arrow`、`compare-binary-horizontal-underline-text-vs`、`compare-hierarchy-left-right-circle-node-pill-badge`、`compare-swot` |
| hierarchy | `hierarchy-tree-tech-style-capsule-item`、`hierarchy-tree-curved-line-rounded-rect-node`、`hierarchy-tree-tech-style-badge-card` |
| chart | `chart-column-simple`、`chart-bar-plain-text`、`chart-line-plain-text`、`chart-pie-plain-text`、`chart-pie-compact-card`、`chart-pie-donut-plain-text`、`chart-pie-donut-pill-badge` |
| quadrant | `quadrant-quarter-simple-card`、`quadrant-quarter-circular` |
| relation | `relation-circle-icon-badge` |

模板名写得不准时引擎按相近度模糊匹配，会落到最近的模板，但别依赖这个兜底。语法错同 mermaid：原地红字带源码，不炸页。

示例（训练循环四步）：

```infographic
infographic sequence-ascending-steps
data
  title 训练循环
  items
    - label 前向
      desc 算出这批样本的预测
    - label 算 loss
      desc 对照正确答案量出差距
    - label 反向传播
      desc 把差距分摊到每个参数
    - label 更新参数
      desc 沿分摊结果走一小步
```

