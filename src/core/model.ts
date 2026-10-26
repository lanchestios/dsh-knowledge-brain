import { buildGraphFrom, DEFAULT_AREAS, displayName, crumbOf, prevNext, areaOf, deadInfo } from './vault/graph'
import { statusOf } from './vault/pagemeta'
import { readAnchors, rawNames, loadDocs, loadFolders, loadParts } from './vault/vault'
import { embedsOfDoc, DocStore } from './vault/docstore'
import type { FolderConf } from './vault/vault'
import { buildSearch, type SearchIndex } from './search'
import { renderPage, type Rendered } from './render'
import type { AreaStat, HomeData, HomeStats, PageRef, PageResult, RecentPage, TagEntry, TagPage } from './api'

export interface Model {
  dir: string
  g: any
  byId: Map<string, any>
  anchors: any[]
  dead: Map<string, any>
  search: SearchIndex
  html: Map<string, Promise<Rendered>>
  blockHtml: Map<string, import('./vault/blockcache').BlockHtmlCache>   // 块级渲染缓存（编辑器 renderBlocks RPC 用）
  folders: Map<string, FolderConf>    // .folder.json 表（手术的 refinalize 要读）
  raws: Set<string>                   // raw/ 名字集（死链 unpublished 判据）
  embedOf: Map<string, string[]>      // 页 → 提到的 asset/raw 路径（asset 变更反查要失效的页）
  store: DocStore | null              // 解析仓（引擎注入；oracle 构建为 null）
}

export function buildModel(dir: string, store?: DocStore): Model {
  const areas = loadParts(dir, DEFAULT_AREAS)
  const docs = store ? store.bulk(areas) : loadDocs(dir, areas)
  const folders = loadFolders(dir, areas)
  const g = buildGraphFrom({ posts: docs, areas, folders })
  const raws = rawNames(dir)
  // 站内口径：目标只在 raw/ 或路径指到沉淀区外，记为「不在应用里」
  for (const e of g.dead) if (e.reason === 'missing') e.reason = deadInfo(g, raws, e.target).reason
  const embedOf = new Map<string, string[]>()
  for (const d of docs) {
    embedOf.set(d._id, store ? (store.get(d._id)?.embeds ?? []) : embedsOfDoc(d._id, d._content || ''))
  }
  return {
    dir, g,
    byId: new Map(docs.map((d: any) => [d._id, d])),
    anchors: readAnchors(dir),
    dead: new Map(g.dead.map((e: any) => [e.target, e])),
    search: buildSearch(g),
    html: new Map(),
    blockHtml: new Map(),
    folders, raws, embedOf,
    store: store ?? null,
  }
}

export function refOf(m: Model, doc: any): PageRef {
  const node = m.g.nodeOf.get(doc._id)
  return { id: doc._id, name: displayName(node), crumb: crumbOf(node) }
}

const baseOf = (id: string) => id.split('/').pop()!.replace(/\.md$/i, '')

export async function page(m: Model, id: string): Promise<PageResult> {
  const doc = m.byId.get(id)
  if (!doc) {
    const base = baseOf(id)
    return { ok: false, candidates: [...m.byId.values()].filter((d) => baseOf(d._id) === base).map((d) => refOf(m, d)) }
  }
  let rendered: Rendered = { html: '', toc: [] }
  if (!doc.offline) {
    if (!m.html.has(id)) {
      m.html.set(id, renderPage(doc, m).catch((err) => { m.html.delete(id); throw err }))
    }
    rendered = await m.html.get(id)!
  }
  const node = m.g.nodeOf.get(id)
  const crumbs: PageRef[] = []
  for (let p = node.parent; p && p.parent; p = p.parent) if (p.doc) crumbs.unshift(refOf(m, p.doc))
  const { prev, next } = prevNext(m.g, doc)
  const s = statusOf(m.g, doc, m.anchors)
  return {
    ok: true,
    page: {
      id, title: doc.title, description: doc.description, tags: doc.tags, area: areaOf(doc),
      crumbs,
      children: (node.items ?? []).filter((c: any) => c.doc).map((c: any) => ({ ...refOf(m, c.doc), desc: c.doc.description || '' })),
      status: { human: s.human, draft: s.draft, updated: s.updated, pos: s.pos, baselines: s.baselines, sources: doc.sources, fmError: doc.fmError },
      html: rendered.html, toc: rendered.toc,
      prev: prev ? refOf(m, prev) : null, next: next ? refOf(m, next) : null,
      backlinks: (m.g.backlinks.get(id) || []).map((b: any) => ({ from: refOf(m, b.doc), snippet: b.snippet })),
      offline: doc.offline,
    },
  }
}

// 标签清单：wiki_tags 工具在用（AI 列标签 / 按标签列页）
export function tags(m: Model, keep?: (id: string) => boolean): TagEntry[] {
  const count = new Map<string, number>()
  for (const d of m.byId.values()) {
    if (keep && !keep(d._id)) continue
    for (const t of d.tags) count.set(t, (count.get(t) ?? 0) + 1)
  }
  return [...count].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'))
}

export function tagPages(m: Model, tag: string, keep?: (id: string) => boolean): TagPage[] {
  return m.g.order.filter((d: any) => d.tags.includes(tag) && (!keep || keep(d._id))).map((d: any) => ({ ref: refOf(m, d), desc: d.description }))
}

// 全量两表（沉淀草稿页 / 动态页）：与 home() 同一口径——草稿 = status: draft，
// 动态 = 全部页按 updated 倒序；不截断。首页看板只取前几条，全量在这里给
export function pageLists(m: Model): { drafts: RecentPage[]; recent: RecentPage[] } {
  const recent: RecentPage[] = []
  const drafts: RecentPage[] = []
  for (const d of m.byId.values()) {
    const area = areaOf(d)
    const isDraft = d.status === 'draft'
    const updated = String(d.updated || d.date || '').slice(0, 10)
    if (!updated) continue
    const hit = { id: d._id, name: refOf(m, d).name, area, updated }
    recent.push(hit)
    if (isDraft) drafts.push(hit)
  }
  const byUpdated = (a: RecentPage, b: RecentPage) => b.updated.localeCompare(a.updated)
  recent.sort(byUpdated)
  drafts.sort(byUpdated)
  return { drafts, recent }
}

// 首页（沉淀看板）：完成率、五区进度、最近更新与草稿一次遍历聚合。
// 口径：完成 = 非草稿（status: draft 之外都算）
export function home(m: Model): HomeData {
  const total = m.byId.size
  const byArea = new Map<string, { count: number; done: number }>()
  let draft = 0
  for (const d of m.byId.values()) {
    const area = areaOf(d)
    const isDraft = d.status === 'draft'
    if (isDraft) draft++
    const c = byArea.get(area) ?? { count: 0, done: 0 }
    byArea.set(area, { count: c.count + 1, done: c.done + (isDraft ? 0 : 1) })
  }
  const { drafts, recent } = pageLists(m)
  const areas: AreaStat[] = m.g.root.items.map((node: any) => {
    const c = byArea.get(node.name) ?? { count: 0, done: 0 }
    return { area: node.name, count: c.count, done: c.done, draft: c.count - c.done }
  })
  const stats: HomeStats = {
    total, done: total - draft, draft, areas,
    recent: recent.slice(0, 7),
    drafts: drafts.slice(0, 7),
  }
  return { stats }
}
