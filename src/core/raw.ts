import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter } from './vault/vault'
import { inside } from './guard'
import { renderPage, assetUrl } from './render'
import type { Model } from './model'
import type { RawKind, RawResult, TreeNode } from './api'

// 知识探索：raw/ 下的文档与听录只读浏览。目录树与五区树同形（TreeNode），path 是库内路径。

// project 是外部克隆，不进探索目录树（与 CLI 的 SCOPE_EXCLUDE、监听 ignored 同一围栏）
const ROOTS = ['book', 'document']
const IMAGE = /\.(jpe?g|png|gif|svg|webp)$/i

function kindOf(name: string): RawKind {
  if (/\.md$/i.test(name)) return 'md'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.html?$/i.test(name)) return 'html'
  return 'other'
}

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'zh')

// 文件夹在前、文件在后；document/ 下的日期文件夹新的在前；
// 书目录 raw/book/<书名>/ 的 <书名>.md 归位为书目录自己（只认书目录）；图片与 .gitkeep 不列（图片在章节 md 里显示）
function walk(dir: string, rel: string): TreeNode[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch { return [] }
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || IMAGE.test(e.name)) continue
    const name = e.name.normalize('NFC')
    const child = rel + '/' + name
    if (e.isDirectory()) {
      const kids = walk(dir, child)
      const idx = rel === 'raw/book' ? kids.findIndex((k) => !k.dir && k.path === child + '/' + name + '.md') : -1
      const index = idx === -1 ? null : kids.splice(idx, 1)[0]
      if (!kids.length && !index) continue
      const count = kids.reduce((n, k) => n + (k.dir ? k.count + (k.path ? 1 : 0) : 1), 0)
      dirs.push({ name, path: index?.path ?? null, rel: null, desc: '', dir: true, count, children: kids })
    } else {
      files.push({ name: /\.md$/i.test(name) ? name.replace(/\.md$/i, '') : name, path: child, rel: null, desc: '', dir: false, count: 0, children: [] })
    }
  }
  dirs.sort(/^raw\/document$/.test(rel) ? (a, b) => byName(b, a) : byName)
  files.sort(byName)
  return [...dirs, ...files]
}

export function rawTree(dir: string): { children: TreeNode[] } {
  const top = walk(dir, 'raw').filter((n) => n.dir && n.name !== 'project')
  top.sort((a, b) => ROOTS.indexOf(a.name) - ROOTS.indexOf(b.name))
  return { children: top }
}

export async function readRaw(m: Model, rel: string): Promise<RawResult> {
  const abs = rel.startsWith('raw/') ? inside(m.dir, rel, 'raw') : null
  if (!abs) return { ok: false }
  let st: fs.Stats
  try { st = fs.statSync(abs) } catch { return { ok: false } }
  const name = rel.split('/').pop()!
  const kind = kindOf(name)
  const offline = st.size > 0 && st.blocks === 0
  const base = { path: rel, name: kind === 'md' ? name.replace(/\.md$/i, '') : name, kind, size: st.size, offline, html: '', toc: [], url: '' }
  if (kind === 'pdf' || kind === 'html') return { ok: true, raw: { ...base, url: assetUrl(rel) } }
  if (kind !== 'md' || offline) return { ok: true, raw: base }
  // md 与沉淀页共用渲染缓存（id 前缀不同不会撞）；text/hash 给只读宿主（Task 16），
  // hash 与 DocStore 自校验同口径（mtimeMs:size，对 raw md 的绝对路径 stat）
  const { data, body } = parseFrontmatter(fs.readFileSync(abs, 'utf8'))
  if (!m.html.has(rel)) {
    m.html.set(rel, renderPage({ _id: rel, _content: body }, m).catch((err) => { m.html.delete(rel); throw err }))
  }
  const { html, toc } = await m.html.get(rel)!
  return { ok: true, raw: { ...base, html, toc, text: body, hash: `${st.mtimeMs}:${st.size}` } }   // name 一律是文件名（标签页与标题都用它）
}
