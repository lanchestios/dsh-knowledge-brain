// wiki_* 只读工具的共享逻辑：DSH 内部工具（src/tools.ts）与 MCP 端点（src/mcp/server.ts）共用一份。
// scope 给了就只看该文件夹（页 id 以 folder/ 开头），范围外一律当作不存在——见 Task 2。
import { treeJson } from '../core/vault/sitedata'
import { displayName } from '../core/vault/graph'
import { search, plainText } from '../core/search'
import { tags, tagPages, refOf, type Model } from '../core/model'
import { pageForLlm, resolvePage } from '../core/llm'
import { isVaultRoot, normFolder } from '../core/folder'

export type SearchOut = { id: string; name: string; crumb: string; snippet: string }
export interface WikiOps {
  search(query: string, limit?: number): SearchOut[]
  readPage(id: string, offset?: number): any
  backlinks(id: string): any
  tree(path?: string, depth?: number): any[]
  tags(tag?: string): any
  model(): Model
}

const unmark = (html: string) => plainText(String(html).replace(/<\/?mark>/g, ''))

function trimTree(nodes: any[], depth: number): any[] {
  return nodes.map((n) => ({
    name: n.name, id: n.path, desc: n.desc, count: n.count,
    ...(n.children?.length ? (depth > 1 ? { children: trimTree(n.children, depth - 1) } : { more: n.children.length }) : {}),
  }))
}

/** 页 id 是否落在文件夹内（folder/ 前缀；knowledge/ML 不放行 knowledge/ML2）。「/」= 知识库，全部放行；空白、畸形（a//b、..）一律关死 */
export function scopeFilter(folder: string): (id: string) => boolean {
  const f = normFolder(folder)
  if (f === '/') return () => true
  if (f === null) return () => false
  const pre = f + '/'
  return (id) => id.startsWith(pre)
}

/** 文件夹下至少一页：工具层与设置卡状态的同一口径（空文件夹、改名、删除都算不存在） */
export function folderHasPages(m: Model, folder: string): boolean {
  const keep = scopeFilter(folder)
  for (const id of m.byId.keys()) if (keep(id)) return true
  return false
}

export function createWikiOps(getModel: () => Model, scope?: string): WikiOps {
  // 「知识库」= 不带 scope：下游一条代码路径都不分叉（不过滤、不改写面包屑、不查文件夹有没有页）
  // 归一一次：空白 / 畸形 → ''，folderHasPages('') 为假 → 每个方法都抛「文件夹不存在或没有页」（关死，绝不当整库）
  const f = scope === undefined ? undefined : normFolder(scope)
  const folder = f === undefined || isVaultRoot(f ?? '') ? undefined : (f ?? '')
  const keep = folder === undefined ? undefined : scopeFilter(folder)
  const model = () => {
    const m = getModel()
    if (folder !== undefined && !folderHasPages(m, folder)) throw new Error(`文件夹不存在或没有页：${folder}`)
    return m
  }
  const inScope = (d: any) => !!d && (!keep || keep(d._id))
  // scope 下 crumb 只到该文件夹的目录节点为止：refOf 的 crumb 一路走到区，会带出范围外区索引页的标题。
  // 按图节点重走祖先（不拆 ' › ' 字符串，名字里可能有它）；不在范围内的 ref 原样（调用方已滤掉）
  const scopedCrumb = (m: Model, id: string): string | null => {
    const node = m.g.nodeOf.get(id)
    if (!node) return null
    const names: string[] = []
    for (let p = node.dir && node.rel === folder ? null : node.parent; p && p.parent; p = p.parent) {
      names.unshift(displayName(p))
      if (p.dir && p.rel === folder) break
    }
    return names.join(' › ')
  }
  const sref = <T extends { id: string; crumb: string }>(m: Model, r: T): T => {
    if (!keep) return r
    const crumb = scopedCrumb(m, r.id)
    return crumb === null ? r : { ...r, crumb }
  }
  const scand = (m: Model, cs: any[]) => cs.map((c) => sref(m, c))
  return {
    model,
    search(query, limit = 10) {
      const m = model()
      return search(m.search, query, limit, keep).map((h) => sref(m, { id: h.id, name: h.name, crumb: h.crumb, snippet: unmark(h.snippet) }))
    },
    readPage(id, offset = 0) {
      const m = model(); const r = resolvePage(m, id, keep)
      if (!('doc' in r)) return { found: false, candidates: scand(m, r.candidates) }
      const p = pageForLlm(m, r.doc, offset)
      if (!keep) return p
      return {
        ...sref(m, p),
        prev: p.prev && keep(p.prev.id) ? sref(m, p.prev) : null,
        next: p.next && keep(p.next.id) ? sref(m, p.next) : null,
        backlinks: scand(m, p.backlinks.filter((b: any) => keep(b.id))),
      }
    },
    backlinks(id) {
      const m = model(); const r = resolvePage(m, id, keep)
      if (!('doc' in r)) return { found: false, candidates: scand(m, r.candidates) }
      return (m.g.backlinks.get(r.doc._id) || []).filter((b: any) => inScope(b.doc)).map((b: any) => sref(m, { ...refOf(m, b.doc), context: unmark(b.snippet) }))
    },
    tree(path, depth = 2) {
      const root = treeJson(model().g, (d: any) => d._id).children as any[]
      const find = (ns: any[], hit: (n: any) => boolean): any => { for (const n of ns) { if (hit(n)) return n; const f = n.children && find(n.children, hit); if (f) return f } }
      // scope：从该文件夹的目录节点起（按 rel 找——无索引页的目录 path 为 null）；path 只在它下面找
      const base = folder === undefined ? root : find(root, (n) => n.dir && n.rel === folder)?.children
      if (!base) throw new Error(`文件夹不存在或没有页：${folder}`)
      const start = path ? find(base, (n) => n.path === path)?.children : base
      if (!start) throw new Error(`没有这个文件夹页：${path}`)
      return trimTree(start, depth)
    },
    tags(tag) {
      const m = model()
      return tag ? tagPages(m, tag, keep).map((t) => sref(m, { ...t.ref, desc: t.desc })) : tags(m, keep)
    },
  }
}
