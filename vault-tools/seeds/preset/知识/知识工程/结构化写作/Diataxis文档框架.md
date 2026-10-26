---
title: Diátaxis 文档框架
description: Procida 的文档架构框架：按「行动↔认知」「学习↔工作」两轴分出教程、操作指南、参考、解释四类，一页只服务一类
tags: [结构化写作, 技术写作, 信息架构, 文档]
source: []
status: stable
generated: {by: claude, at: 2026-09-28T14:47:05Z}
verified:
  - {by: human:lanchestios, at: 2026-09-06T13:28:52Z}
created: 2026-09-06
updated: 2026-09-28
---

Daniele Procida 提出的文档架构框架，名字来自古希腊语 διάταξις（dia「跨越」+ taxis「安排」）。一句话：**文档有四种、且只有四种用途——Tutorial（教程）、How-to guide（操作指南）、Reference（参考）、Explanation（解释）——把它们混在同一页，谁都帮不到**。

它同时回答内容（写什么）、风格（怎么写）、架构（怎么组织）三个问题。Django、Canonical、Cloudflare、Gatsby 都在用。

## 两轴

四类不是列举出来的，是从两个维度推出来的：

| | **Action**（行动 · 做） | **Cognition**（认知 · 知） |
|---|---|---|
| **Acquisition**（学习 · 获取技能） | Tutorial（教程） | Explanation（解释） |
| **Application**（工作 · 应用技能） | How-to guide（操作指南） | Reference（参考） |

横轴从 acquisition 到 application，纵轴从 action 到 cognition。

## 四类

| 类型 | 导向 | 读者处境 | 类比 |
|---|---|---|---|
| **Tutorial**（教程） | 学习 | 新手，需要被带着走一遍 | 驾驶课——教练对学员的安全与成功负责 |
| **How-to guide**（操作指南） | 任务 | 已经懂了，只想把这件事做完 | 菜谱 |
| **Reference**（参考） | 信息 | 需要权威、确定的事实，随查随走 | 地图、词典。API 文档、命令手册 |
| **Explanation**（解释） | 理解 | 想弄明白为什么 | 读烹饪的科学原理，而不是照着菜谱做 |

关键区分：教程和操作指南关于**读者的行动**，参考和解释关于**读者知道什么**；教程和解释服务读者的**学习**，操作指南和参考服务读者的**工作**。

## 首要失败模式

**把类型混在同一页。** 一篇教程顺带把原理讲了，对谁都没帮助——新手被原理压住，想懂原理的人被步骤拖慢。正确做法是给学习者最少的解释，然后链接到深入文章，等他准备好了再去读。

## 怎么用

框架自己反复强调：**它是地图，不是施工图**。

- 不要在结构上过度投入。先改内容，从哪儿开始都行，甚至随机挑一处。
- **上手不等于把文档切成四个目录**，更不等于建四个空的 tutorial / how-to / reference / explanation 文件夹。
- 它明确反对自上而下的规划，主张小步、响应式的迭代。

## 可信边界

- **分类依据被质疑**。Tom Johnson 提出最常被引用的一条：把内容切成四个筒仓，作为信息模型显得过度武断——这套模型基于什么研究？
- **读者不按模式阅读**。一个人在排查故障时同时需要解释、参考和步骤。四分法可能把他需要一起看的东西拆散。Procida 承认这条批评，但主张文档仍应对自己的用途保持清醒。
- **常被误用成目录结构**。框架文档自己花力气警告这一点，某种程度上也是承认这已是常态。
- **短期内会更难看**。Canonical 的说法很坦白：Diátaxis 做的第一件事是让现有文档**看起来更糟**——问题更难藏，放错位置的东西无处遁形。
- **反规划的立场不好推销**。对需要立项、估时的组织，「不要提前规划」很难接受。

## 相关链接

- [Diátaxis](https://diataxis.fr/) · [Start here](https://diataxis.fr/start-here/) · [Diátaxis as a guide to work](https://diataxis.fr/how-to-use-diataxis/)
- [Tom Johnson 的评述与批评](https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework)
- [Canonical 的采用记](https://ubuntu.com/blog/diataxis-a-new-foundation-for-canonical-documentation)
