---
name: wiki-write-explore
description: 在要为一篇 wiki 沉淀页调研取材、把该读的素材抓进 raw/ 并出调研笔记时用；正文还没开始写。
---

# wiki-write-explore

为一篇 wiki 沉淀页做调研，产出调研笔记与 raw/ 素材，不写正文、不下结论。

## 产出

只有两样：

- `raw/` 下抓回来的素材
- `.wiki/tmp/<slug>/00-调研笔记.md`

`<slug>` 是目标页文件名去掉扩展名，例如 `C4 Model.md` → `C4 Model`。

调研笔记的三节标题固定，模板逐字照抄：

```markdown
# <主题> 调研笔记

## 源清单
| 素材 | raw/ 路径 | 一手程度 |

## 每份的关键发现
（一份一节，只记这份素材说了什么，不下跨源结论）

## 矛盾与缺口
（几份素材互相打架的地方；查不到的东西）
```

## 怎么抓

| 素材类型 | 命令 |
|---|---|
| 网页 | `wiki document fetch <url>` |
| 本地文件 | `wiki document add <文件>` |
| 券商研报 | `reportapi.eastmoney.com`（东方财富研报 API）按日期 / 行业检索，拿 `infoCode`；PDF 直链 `pdf.dfcfw.com/pdf/H3_<infoCode>_1.pdf`，下到 `.wiki/tmp/` 再 `wiki document add` |

`wiki document fetch` 认不出的 host 直接报错，没有通用兜底；转载域名可以 `--type wechat` 强制指定源类型。

不手写文件塞进 `raw/`——规则三是只进不改，往里放东西一律走 `wiki document fetch` / `wiki document add`。

抓之前先 `wiki document list [日期]` 看有没有已经抓过，避免重复抓同一份素材。

## 三条硬规矩

| 规矩 | 为什么 |
|---|---|
| 一手优先 | 官方文档 / 原论文 / 源码，胜过二手解读；二手的只当线索，落 `raw/` 时在笔记里标明 |
| 不下跨源结论 | 跨源判断是 wiki-write-draft 的活，这里只记「这份说了什么」 |
| 矛盾要单独记 | 几份素材打架的地方写进 `## 矛盾与缺口`，别自己挑一个当定论 |

## 什么时候停

骨架每一节都有材料可写，就停。写不满的节记进 `## 矛盾与缺口`，不要为了凑满去扩大搜索范围。
