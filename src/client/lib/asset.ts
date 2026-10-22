// src/client/lib/asset.ts
// core/render.ts 的 assetRel/assetUrl 浏览器版：node:path 换成手写 posix 三件套
// （normalize/join/dirname），规则逐条对齐（rooted、文档相对、上跳、?query、协议、#fragment）。
const norm = (p: string) => {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..'); continue }
    out.push(seg)
  }
  return out.join('/')
}
const dirname = (p: string) => { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i) }

export function assetRel(docId: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null
  let p = href.split('#')[0]
  try { p = decodeURI(p) } catch { /* 保持原样 */ }
  const at = p.indexOf('?'); if (at !== -1) p = p.slice(0, at)     // ?h=560 是嵌入件高度参数
  const rooted = p.startsWith('asset/') || p.startsWith('raw/')
  const rel = norm(rooted || !p ? p : (dirname(docId) ? dirname(docId) + '/' + p : p))
  return rel.startsWith('asset/') || rel.startsWith('raw/') ? rel : null
}
export const assetUrl = (rel: string) => 'api/wiki.asset?path=' + encodeURIComponent(rel)
