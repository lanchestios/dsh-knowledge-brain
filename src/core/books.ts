import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter } from './vault/vault'
import type { Book, BookMaterialStatus, Chapter, ChapterData, ChapterState } from './api'

// raw/book/<书>/ 的读法：进度页 <书>.md（progress、章节勾选清单、「## 知识沉淀」登记）、
// 章节/ 原文（只有 readable 的书给出）、源文件。只读；写动作在 src/actions.ts

const SOURCE_EXT = ['.pdf', '.azw3', '.epub', '.mobi']
const MATERIAL_STATUSES = new Set<BookMaterialStatus>(['unavailable', 'init', 'text', 'figures', 'proofread', 'readable', 'failed'])
const list = (abs: string) => { try { return fs.readdirSync(abs, { withFileTypes: true }) } catch { return [] } }
const nfc = (s: string) => s.normalize('NFC')

// 章节号 1 / 1.1 / 1.1.1，后跟一个空格，空格后整段是标题。号的右边界：空格、→ 或行尾（1 不中 1.1，1.1 不中 1.10）
export const CHAPTER_ID = String.raw`\d+(?:\.\d+)*`
const ID_END = String.raw`(?=\s|→|$)`
// - [x] 1.1 什么是向量 → `章节/1.1 什么是向量.md`（→ 这一截可没有）
const CHECK = new RegExp(String.raw`^\s*-\s*\[( |x|X)\]\s*(${CHAPTER_ID})${ID_END}\s*(.*?)(?:\s*→\s*` + '`([^`]+)`' + String.raw`)?\s*$`)
// ### 2 第二部分 —— 分组行：父号 + 可选标题，只用来分组，不算章
const GROUP = new RegExp(String.raw`^###\s+(${CHAPTER_ID})(?=\s|$)\s*(.*)$`)
const CHAPTER_FILE = new RegExp(String.raw`^(${CHAPTER_ID}) (.+)\.md$`)

/** `1.1 什么是向量.md` → { id: '1.1', title: '什么是向量' }；不以「号+空格」开头的（00-前言.md 等）不是章节 */
export function parseChapterFile(name: string): { id: string; title: string } | null {
  const m = CHAPTER_FILE.exec(nfc(name))
  return m && m[2].trim() ? { id: m[1], title: m[2].trim() } : null
}
/** 按号逐段比数字：1.2 < 1.10，2 < 10（与 Python repo.chapter_key 同规则） */
export function chapterKey(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return 0
}
export const chapterParent = (id: string): string | null => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null)
// 「## 知识沉淀」段里一章一条：
//   - 3 Training · 沉淀中                            ← wiki book deposit 登记，还没完成
//   - 1 Machine Learning → `知识/机器学习/`，…       ← 去掉了「· 沉淀中」= 完成；→ 后面是去向
//     - [[训练范式]] —— …                            ← 条目下缩进子项用 [[页名]] 点名沉淀出的页
const SECTION = /^## 知识沉淀\s*$/m
const ENTRY = new RegExp(String.raw`^- (${CHAPTER_ID})${ID_END}(.*)$`)
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
type Entry = { depositing: boolean; dest: string | null; links: string[] }

function depositMap(body: string): Map<string, Entry> {
  const out = new Map<string, Entry>()
  const i = body.search(SECTION)
  if (i < 0) return out
  let cur: Entry | null = null
  for (const l of body.slice(i).split('\n').slice(1)) {
    if (/^## /.test(l)) break
    const m = ENTRY.exec(l)
    if (m) {
      const arrow = m[2].indexOf('→')
      // 去向只取 → 后第一个逗号前那截（「，按概念切成三页」这类说明不要）
      const dest = arrow < 0 ? null : m[2].slice(arrow + 1).replace(/`/g, '').split(/[，,：:]/)[0].trim() || null
      cur = { depositing: /·\s*沉淀中/.test(m[2]), dest, links: [] }
      out.set(m[1], cur)
    } else if (/^\S/.test(l)) cur = null              // 另起一个顶层项 / 段落，不再归这一章
    if (cur) for (const w of l.matchAll(WIKILINK)) { const n = w[1].trim(); if (!cur.links.includes(n)) cur.links.push(n) }
  }
  return out
}

export function loadBooks(dir: string): Book[] {
  const root = path.join(dir, 'raw', 'book')
  const books: Book[] = []
  for (const e of list(root)) {
    if (!e.isDirectory()) continue                     // 书目录按位置认：raw/book/ 下一级文件夹
    const name = nfc(e.name)
    const bdir = path.join(root, e.name)
    let raw = ''
    try { raw = fs.readFileSync(path.join(bdir, `${e.name}.md`), 'utf8') } catch { continue }
    const { data, body } = parseFrontmatter(raw)
    const deposits = depositMap(body)
    const texts = list(path.join(bdir, '章节')).filter((f) => f.isFile() && f.name.endsWith('.md')).map((f) => nfc(f.name))
    const source = list(bdir).find((f) => f.isFile() && SOURCE_EXT.includes(path.extname(f.name).toLowerCase()))
    const rel = `raw/book/${name}`
    const sourceRel = source ? `${rel}/${nfc(source.name)}` : null
    const saved = String(data.material_status ?? '') as BookMaterialStatus
    // 词表外（含旧 pending / done）与没写一样按源文件推；有源文件却写着 unavailable 也归 init
    const materialStatus: BookMaterialStatus = MATERIAL_STATUSES.has(saved) && !(saved === 'unavailable' && sourceRel)
      ? saved
      : sourceRel ? 'init' : 'unavailable'
    const readable = materialStatus === 'readable'
    const chapters: Chapter[] = []
    // 分组行「### 2 第二部分」（只认「## 章节进度」节里的）按父号记标题；章的 group 从号推（与行的先后无关），没有分组行就是父号本身
    const groups = new Map<string, string>()
    const ps = body.search(/^## 章节进度\s*$/m)
    const progress = ps < 0 ? '' : body.slice(ps).replace(/^## 章节进度[^\n]*\n/, '').split(/^## /m)[0]
    for (const l of progress.split('\n')) { const g = GROUP.exec(l); if (g) groups.set(g[1], g[2].trim() ? `${g[1]} ${g[2].trim()}` : g[1]) }
    for (const l of body.split('\n')) {
      const m = CHECK.exec(l)
      if (!m) continue
      const id = m[2]
      const read = m[1].toLowerCase() === 'x'
      const listed = m[4] ? nfc(m[4]) : null
      const textName = listed && texts.includes(path.basename(listed)) ? path.basename(listed) : texts.find((t) => parseChapterFile(t)?.id === id) ?? null
      const dep = deposits.get(id)
      const state: ChapterState = dep ? (dep.depositing ? 'depositing' : 'done') : read ? 'read' : 'unread'
      const parent = chapterParent(id)
      chapters.push({ id, title: m[3].trim(), group: parent ? (groups.get(parent) ?? parent) : null, state, read, text: readable && textName ? `${rel}/章节/${textName}` : null, dest: dep?.dest ?? null, pages: (dep?.links ?? []).map((n) => ({ name: n, id: null })) })
    }
    books.push({
      name, path: rel, progress: String(data.progress ?? ''), source: sourceRel,
      materialStatus, materialError: String(data.material_error ?? ''), chapters,
    })
  }
  // 在读的排前面，其余按书名
  return books.sort((a, b) => Number(b.progress === '在读') - Number(a.progress === '在读') || a.name.localeCompare(b.name, 'zh'))
}

// 章节原文是梳理过的 md（wiki-write-book-ingest 第 4 步），原样按 md 渲染；非 md 返回 null
export function chapterMarkdown(dir: string, rel: string): string | null {
  if (!/\.md$/i.test(rel)) return null
  try { return parseFrontmatter(fs.readFileSync(path.join(dir, rel), 'utf8')).body } catch { return null }
}

export function readChapter(dir: string, book: Book, id: string): ChapterData {
  const chapter = book.chapters.find((c) => c.id === id)
  if (!chapter) throw new Error(`${book.name} 没有 ${id}`)
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8')
  const raw = chapter.text ? read(chapter.text) : null
  return { book: book.name, chapter, raw, html: null, toc: [], readable: book.materialStatus === 'readable' }
}
