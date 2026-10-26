import { deadInfo, displayName, prevNext, resolveName } from './vault/graph'
import { statusOf } from './vault/pagemeta'
import { refOf, type Model } from './model'
import { search } from './search'
import { deadReason, assetRel } from './render'
import type { PageRef } from './api'

// 给模型看的纯文本视图：markdown 原文 + 元数据，正文限长

export const MAX_CHARS = 20000

export function clip(text: string, offset = 0): { text: string; next: number | null } {
  const end = offset + MAX_CHARS
  return end < text.length
    ? { text: text.slice(offset, end) + `\n\n…（已截断，用 offset=${end} 续读）`, next: end }
    : { text: text.slice(offset), next: null }
}

const baseOf = (id: string) => id.split('/').pop()!.replace(/\.md$/i, '')

/** 先按 id，再按页名 / 文件名；都不中就拿搜索结果当候选。keep 给了就只在它放行的页里找 */
export function resolvePage(m: Model, q: string, keep?: (id: string) => boolean): { doc: any } | { candidates: PageRef[] } {
  const ok = (d: any) => !!d && (!keep || keep(d._id))
  const hit = m.byId.get(q) ?? m.byId.get(q.endsWith('.md') ? q : q + '.md')
  if (ok(hit)) return { doc: hit }
  const byName = [...m.byId.values()].filter((d: any) => ok(d) && (baseOf(d._id) === q || displayName(m.g.nodeOf.get(d._id)) === q))
  if (byName.length === 1) return { doc: byName[0] }
  if (byName.length > 1) return { candidates: byName.map((d: any) => refOf(m, d)) }
  return { candidates: search(m.search, q, 8, keep).map((h) => ({ id: h.id, name: h.name, crumb: h.crumb })) }
}

// 图片：![alt](src) / ![alt](<src>)，可带 "title"。只改 src，alt 与 title 原样。
// 裸写的 src 允许一层成对括号（截图(1).png，CommonMark 同款）
const IMG_RE = /!\[([^\]]*)\]\((<[^>]*>|(?:[^\s()]|\([^\s()]*\))+)((?:\s+"[^"]*")?)\)/g
const escSrc = (p: string) => p.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')

/** 给模型看的正文：图片 src 规整成库根路径（raw/… / asset/…）。答案里只剩模型抄下的裸路径，
 *  已不知抄自哪页，同名 images/image001.png 无从消歧——读页时 docId 在手，源头规整 */
export function rootImages(docId: string, body: string): string {
  return body.replace(IMG_RE, (all, alt: string, src: string, title: string) => {
    const raw = src.startsWith('<') ? src.slice(1, -1) : src
    const rel = assetRel(docId, raw)
    return rel ? `![${alt}](${escSrc(rel)}${title})` : all
  })
}

export function pageForLlm(m: Model, doc: any, offset = 0) {
  const s = statusOf(m.g, doc, m.anchors)
  const { prev, next } = prevNext(m.g, doc)
  const c = clip(rootImages(doc._id, String(doc._content ?? '')), offset)
  return {
    ...refOf(m, doc), title: doc.title, description: doc.description, tags: doc.tags,
    status: { human: s.human, draft: s.draft, updated: s.updated }, offline: !!doc.offline,
    prev: prev ? refOf(m, prev) : null, next: next ? refOf(m, next) : null,
    backlinks: (m.g.backlinks.get(doc._id) || []).map((b: any) => refOf(m, b.doc)),
    body: doc.offline ? '（文件在 OneDrive 上未下载到本机，读不到正文）' : c.text,
    next_offset: doc.offline ? null : c.next,
  }
}

// 单名解析（编辑器点击跳转与批量染色共用）：先走全站同名规则（路径精确 / 裸名唯一），
// 裸名再退 byId / 全库唯一页名。不按来源页位置猜
export function resolveRef(m: Model, name: string): string | null {
  const d = resolveName(m.g, name)
  if (d) return d._id
  if (name.includes('/')) return null
  const r = resolvePage(m, name)
  return 'doc' in r ? r.doc._id : null
}

// 批量双链解析态（编辑器阅读面死链着色用）：命中给 id；否则 dead 原因与阅读页同文案
export function resolveNameStates(m: Model, names: string[]): Record<string, { id: string | null; dead?: string }> {
  const out: Record<string, { id: string | null; dead?: string }> = {}
  for (const n of names) {
    const id = resolveRef(m, n)
    out[n] = id ? { id } : { id: null, dead: deadReason(m.dead.get(n) ?? deadInfo(m.g, m.raws, n), m.g) }
  }
  return out
}
