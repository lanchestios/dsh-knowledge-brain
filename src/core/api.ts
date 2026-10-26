/** 区 = 沉淀区一级目录名（经历 / 认知 / 学习 / 知识 / 系统），顺序见 .wiki/wiki.json */
export type Area = string

/** path 是页 id（库内相对路径）；没有 index 的文件夹为 null */
export interface TreeNode { name: string; path: string | null; /** 节点的库内路径：目录是目录路径，文件是 .md 路径（= 页 id）；目录拖动、绑定下拉用它指认节点 */ rel: string | null; desc: string; dir: boolean; count: number; children: TreeNode[]; /** 行尾小标记（如读过的章 ✓），不是计数 */ mark?: string }
export interface GraphNode { id: string; name: string; crumb: string; area: Area; index: boolean; indeg: number; outdeg: number }
export interface GraphEdge { s: string; t: string; type: 'ref' | 'tree' }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export interface PageRef { id: string; name: string; crumb: string }
export interface PageStatus {
  human: boolean; draft: boolean; updated: string; sources: string[]
  pos: { i: number; n: number; parentName: string } | null
  baselines: { name: string; sha: string }[]; fmError: boolean
}
export interface TocItem { id: string; text: string; depth: 2 | 3 }
/** snippet 是已转义的 HTML，命中处包 <mark> */
export interface Backlink { from: PageRef; snippet: string }
export interface PageData {
  id: string; title: string; description: string; tags: string[]; area: Area
  crumbs: PageRef[]
  /** 文件夹页的直接子页（导览序），叶子页为空 */
  children: (PageRef & { desc: string })[]
  status: PageStatus; html: string; toc: TocItem[]
  prev: PageRef | null; next: PageRef | null; backlinks: Backlink[]; offline: boolean
}
export type PageResult = { ok: true; page: PageData } | { ok: false; candidates: PageRef[] }

export interface AreaStat { area: Area; count: number; done: number; draft: number }
export interface RecentPage { id: string; name: string; area: Area; updated: string }
export interface HomeStats { total: number; done: number; draft: number; areas: AreaStat[]; recent: RecentPage[]; drafts: RecentPage[] }
export interface HomeData { stats: HomeStats }
export interface TagPage { ref: PageRef; desc: string }
export interface TagEntry { tag: string; count: number }
/** snippet 是已转义的 HTML，命中处包 <mark> */
export interface SearchHit { id: string; name: string; crumb: string; snippet: string }
export interface VaultStatus { ok: boolean; dir: string; pages: number; error: string | null; degraded: boolean; validating: boolean; checkOutput: string | null }

/** 知识探索里的一份文档；path 是 raw/document/ 下的库内路径 */
export type RawKind = 'md' | 'pdf' | 'html' | 'other'
export interface RawData {
  path: string; name: string; kind: RawKind; size: number; offline: boolean
  /** 听录 md 的 frontmatter 状态；文档、书籍原文不返回 */
  /** md：渲染好的 HTML 与目录 */
  html: string; toc: TocItem[]
  /** md：源文（frontmatter 已剥）与文件指纹（mtimeMs:size，DocStore 自校验同口径）；只读宿主用 */
  text?: string; hash?: string
  /** pdf / html：wiki-asset:// 地址 */
  url: string
}
export type RawResult = { ok: true; raw: RawData } | { ok: false }


/** 书的一章：完成 / 沉淀中（进度页「## 知识沉淀」有这一章的条目，带「· 沉淀中」即未完成）> 已读（清单勾了）> 未读 */
export type ChapterState = 'done' | 'depositing' | 'read' | 'unread'
/** 书的入库状态（wiki-write-book-ingest）：init 建书 → text 转文本 → figures 补图 → proofread 梳理 → readable 过 qc；unavailable 纸质书，failed 转文本失败 */
export type BookMaterialStatus = 'unavailable' | 'init' | 'text' | 'figures' | 'proofread' | 'readable' | 'failed'
export interface Chapter {
  /** 章节号 1 / 1.1 / 1.1.1（叶子：对应一个章节文件） */
  id: string; title: string
  /** 所属分组：父号的分组行全文（如 `2 第二部分`），没有分组行就是父号本身；顶层章 null */
  group: string | null
  state: ChapterState; read: boolean
  /** 章节/ 下的原文（库内路径）；书不是 readable 或没有原文为 null */
  text: string | null
  /** 「知识沉淀」条目里 → 后面登记的去向（目录），没写为 null */
  dest: string | null
  /** 条目下点名的沉淀页（[[页名]]）；Host 按页名解析出 id，解析不到的 id 为 null */
  pages: { name: string; id: string | null }[]
}
export interface Book {
  name: string; path: string; progress: string; source: string | null
  materialStatus: BookMaterialStatus; materialError: string; chapters: Chapter[]
}
// raw：PDF 抽出的纯文本（已合并断行）；html：章节原文是 md 时走同一套渲染（图、表、代码块），此时 raw 为 null
// text/hash 只在 html 非 null 时有值：源文与文件指纹（mtimeMs:size，DocStore 自校验同口径）；只读宿主用
/** readable：这本书是否已过质检（readable）；false 时 raw / text 都没有，阅读器提示还在整理 */
export interface ChapterData { book: string; chapter: Chapter; raw: string | null; html: string | null; toc: TocItem[]; readable: boolean; text?: string; hash?: string }

/** 文档两层状态合一：有显式状态以台账为准，否则看有没有沉淀页引用。待沉淀 = 未沉淀 + 沉淀中。 */
export type DocumentStatus = 'unprocessed' | 'cited' | 'processing' | 'done'
export interface Document { path: string; name: string; ext: string; date: string; status: DocumentStatus; citedBy: PageRef[]; detail: string }
