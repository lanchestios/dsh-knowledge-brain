import MiniSearch from 'minisearch'
import { displayName, crumbOf, esc } from './vault/graph'
import type { SearchHit } from './api'

const CJK = /[㐀-鿿豈-﫿]/
const CJK_RUN = /[㐀-鿿豈-﫿]+/g
const seg = new Intl.Segmenter('zh', { granularity: 'word' })

// 入库：分词器的词 + 每段汉字的单字与二元组。「研习」「滑片」这类词分词器可能切开，
// 二元组兜住；单字让一个字的查询也能命中。
function tokenizeIndex(text: string): string[] {
  const out: string[] = []
  for (const s of seg.segment(text)) if (s.isWordLike) out.push(s.segment.toLowerCase())
  for (const run of text.match(CJK_RUN) ?? []) {
    for (const ch of run) out.push(ch)
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

// 查询：汉字段长度 1 取单字、≥2 取二元组（AND 起来即连续命中的近似）；其余按分词器的词
function tokenizeQuery(q: string): string[] {
  const out: string[] = []
  for (const run of q.match(CJK_RUN) ?? []) {
    if (run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  for (const s of seg.segment(q.replace(CJK_RUN, ' '))) if (s.isWordLike) out.push(s.segment.toLowerCase())
  return out
}

export function plainText(md: string): string {
  return md
    .replace(/^(```|~~~)(?:mermaid|infographic)[\s\S]*?^\1[ \t]*$/gm, '')
    .replace(/^(```|~~~).*$/gm, '')
    .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t, _a, l) => l || t)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SearchIndex { ms: MiniSearch; texts: Map<string, string> }

export function buildSearch(g: any): SearchIndex {
  const ms = new MiniSearch({
    fields: ['title', 'crumb', 'text'],
    storeFields: ['title', 'crumb'],
    tokenize: tokenizeIndex,
    searchOptions: {
      tokenize: tokenizeQuery,
      boost: { title: 4, crumb: 1.5 },
      prefix: (t: string) => !CJK.test(t),
      combineWith: 'AND',
    },
  })
  const texts = new Map<string, string>()
  ms.addAll(g.order.map((doc: any) => {
    const node = g.nodeOf.get(doc._id)
    const text = plainText(doc._content || '')
    texts.set(doc._id, text)
    return { id: doc._id, title: displayName(node), crumb: crumbOf(node), text }
  }))
  return { ms, texts }
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function snippet(text: string, q: string, terms: string[]): string {
  const lower = text.toLowerCase()
  const needles = [q.toLowerCase(), ...terms].filter(Boolean).sort((a, b) => b.length - a.length)
  let at = -1
  for (const n of needles) { at = lower.indexOf(n); if (at !== -1) break }
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, start + 100)
  const win = text.slice(start, end)
  let out = ''
  let last = 0
  if (needles.length) {
    for (const m of win.matchAll(new RegExp(needles.map(escRe).join('|'), 'gi'))) {
      out += esc(win.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'
      last = m.index! + m[0].length
    }
  }
  out += esc(win.slice(last))
  return (start > 0 ? '…' : '') + out + (end < text.length ? '…' : '')
}

export function search(idx: SearchIndex, raw: string, limit = 30, keep?: (id: string) => boolean): SearchHit[] {
  const q = raw.trim()
  if (!q) return []
  // 先 keep 再判空：AND 只在范围外命中时也要退到 OR（无 keep 时与原先一致）
  const pick = (rs: ReturnType<MiniSearch['search']>) => keep ? rs.filter((r) => keep(String(r.id))) : rs
  let rs = pick(idx.ms.search(q))
  if (!rs.length) rs = pick(idx.ms.search(q, { combineWith: 'OR' }))
  return rs.slice(0, limit).map((r) => ({
    id: String(r.id), name: r.title, crumb: r.crumb,
    snippet: snippet(idx.texts.get(String(r.id)) ?? '', q, r.terms),
  }))
}
