import fs from 'node:fs'
import path from 'node:path'
import { refOf, type Model } from './model'
import type { Document, DocumentStatus } from './api'

// 文档（raw/document/<日期>/ 下的文件）的两层状态：
// 引用 = 沉淀区页的 source 精确含该路径；显式状态 = .wiki/coverage.conf。
const nfc = (s: string) => s.normalize('NFC')
const list = (abs: string) => { try { return fs.readdirSync(abs, { withFileTypes: true }) } catch { return [] } }

/** 读台账 → {文档路径: {material_status, detail}}。宽容读者：坏行跳过，只认整行注释，不剥行内 #（同 repo.load_coverage） */
export function loadCoverage(dir: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  let text = ''
  try { text = fs.readFileSync(path.join(dir, '.wiki', 'coverage.conf'), 'utf8') } catch { return out }
  let cur: string | null = null
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    if (s.startsWith('[') && s.endsWith(']')) { cur = nfc(s.slice(1, -1).trim()); if (!out.has(cur)) out.set(cur, {}) }
    else if (s.includes('=') && cur !== null) { const i = s.indexOf('='); out.get(cur)![s.slice(0, i).trim()] = s.slice(i + 1).trim() }
  }
  return out
}

export function loadDocuments(m: Model): Document[] {
  const cited = new Map<string, any[]>()
  for (const d of m.byId.values()) for (const s of d.sources ?? []) {
    const k = nfc(String(s)); if (!cited.has(k)) cited.set(k, []); cited.get(k)!.push(d)
  }
  const cov = loadCoverage(m.dir)
  const out: Document[] = []
  // 文档内容线只扫 raw/document。
  const kind = 'document'
  const root = path.join(m.dir, 'raw', kind)
  for (const e of list(root).filter((x) => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name))) {
    for (const f of list(path.join(root, e.name)).filter((x) => x.isFile() && x.name !== '.gitkeep')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      const name = nfc(f.name)
      const rel = `raw/${kind}/${e.name}/${name}`
      const by = cited.get(rel) ?? []
      const c = cov.get(rel) ?? {}
      const grade = c.material_status
      const status: DocumentStatus = grade === 'processing' || grade === 'done' ? grade : by.length ? 'cited' : 'unprocessed'
      const ext = path.extname(name).slice(1).toLowerCase()
      out.push({ path: rel, name: ext === 'md' ? name.slice(0, -3) : name, ext, date: e.name, status, citedBy: by.map((d) => refOf(m, d)), detail: c.detail ?? '' })
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'zh'))
  return out
}
