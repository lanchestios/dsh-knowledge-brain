import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { CHAPTER_ID, chapterKey, chapterParent, loadBooks, parseChapterFile } from '../core/books'
import { inside } from '../core/guard'
import { vaultTools } from './pkg'

const GROUP_LINE = new RegExp(String.raw`^###\s+(${CHAPTER_ID})(?=\s|$)`)   // 章节进度里的分组行：### <父号> [标题]

// 界面上直接点的写库动作，只有这几个，参数一律白名单校验：
//   标记已读 → wiki book read <书> <号>　　知识沉淀 / 标记完成 → wiki book deposit <书> <号> [--done]
//   继续沉淀 / 标记完成 → wiki document cover <文档> 沉淀中 / 完成
//   标记完成（知识沉淀页）→ wiki page mark <页> stable（stable 写死在 Host，只收 draft 页）
//   目录拖动 → wiki page order <节点> <位置> / wiki page move <节点> <文件夹>/ [位置]（节点白名单在 rpc.ts 按模型校验）
// 规则由 wiki CLI 把关；不传 --by、不动 WIKI_ACTOR（DSH 由本人从终端启动，CLI 落回 human:<git user.name>）；不 git commit
// 另有编辑正文 → source / save / touchUpdated：本插件直接写文件、不经 CLI；路径白名单在 rpc.ts（沉淀页或 raw/document/ 下的 md），这里只收解析好的绝对路径

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex')
// 同目录临时文件 + rename：监听与 OneDrive 读不到半截文件
export function writeAtomic(abs: string, text: string) {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.wk-${process.pid}.tmp`)
  fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, abs)
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export type Runner = (file: string, args: string[], cwd: string) => Promise<string>

// 子进程超时只看命令位（args[0] 是 wiki 脚本路径）：拆书 10 分钟、建库 3 分钟、其余 30 秒。
// 不用 includes——书名、页名里碰巧有 split / init 不能把超时拉长
export function wikiTimeout(args: string[]): number {
  if (args[1] === 'book' && args[2] === 'split') return 10 * 60_000
  if (args[1] === 'init') return 180_000
  return 30_000
}

export const runWiki: Runner = (file, args, cwd) => new Promise((ok, fail) =>
  execFile(file, args, { cwd, timeout: wikiTimeout(args) }, (e, out, err) => (e ? fail(new Error(String(err || out || e.message).trim())) : ok(String(out)))))

function setFrontmatter(abs: string, patch: Record<string, string>) {
  let text = fs.readFileSync(abs, 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) throw new Error(`缺少 frontmatter：${abs}`)
  const lines = m[1].split(/\r?\n/)
  const order = ['title', 'description', 'tags', 'source', 'status', 'material_status', 'material_error', 'progress']
  for (const [key, value] of Object.entries(patch)) {
    const line = `${key}: ${JSON.stringify(value)}`
    const re = new RegExp(`^${key}:.*$`, 'm')
    const at = lines.findIndex((item) => re.test(item))
    if (at >= 0) {
      lines[at] = line
      continue
    }
    const rank = order.indexOf(key)
    let insertAt = lines.length
    if (rank >= 0) {
      const next = lines.findIndex((item) => {
        const field = item.match(/^([A-Za-z_][A-Za-z0-9_-]*):/)?.[1]
        return field ? order.indexOf(field) > rank : false
      })
      if (next >= 0) insertAt = next
    }
    lines.splice(insertAt, 0, line)
  }
  text = `---\n${lines.join('\n')}\n---${text.slice(m[0].length)}`
  writeAtomic(abs, text)
}

// 按章节文件重写「## 章节进度」：叶子按号数字排序；已有的 `### <父号> …` 分组行原样保留，缺的补 `### <父号>`；
// 已读勾按号保留。行格式与 Python `wiki book sync`（vault-tools/lib/book/chapters.py）逐字一致
export function syncChapterIndex(abs: string, files: string[], read: Map<string, boolean>) {
  const leaves = files.map((f) => ({ f, c: parseChapterFile(f) })).filter((x): x is { f: string; c: { id: string; title: string } } => !!x.c)
  if (!leaves.length) throw new Error('转换结果没有「<号> <标题>.md」章节')
  const text = fs.readFileSync(abs, 'utf8')
  const start = text.search(/^## 章节进度\s*$/m)
  if (start < 0) throw new Error('进度页缺少「## 章节进度」')
  const tail = text.slice(start + '## 章节进度'.length)
  const next = tail.search(/^## /m)
  const end = next < 0 ? text.length : start + '## 章节进度'.length + next
  const groups = new Map<string, string>()
  for (const l of text.slice(start, end).split('\n')) { const g = GROUP_LINE.exec(l); if (g) groups.set(g[1], l.trimEnd()) }
  const rows: string[] = []
  let last: string | null | undefined
  for (const { f, c } of leaves.sort((a, b) => chapterKey(a.c.id, b.c.id))) {
    const parent = chapterParent(c.id)
    if (parent !== null && parent !== last) rows.push(groups.get(parent) ?? `### ${parent}`)
    last = parent
    rows.push(`- [${read.get(c.id) ? 'x' : ' '}] ${c.id} ${c.title} → \`章节/${f}\``)
  }
  // 文件尾统一成单个换行（与 Python sync 的 rstrip + \n 一致）
  writeAtomic(abs, (text.slice(0, start) + `## 章节进度\n\n${rows.join('\n')}\n\n` + text.slice(end).replace(/^\n+/, '')).replace(/\n+$/, '\n'))
}

function bookChapter(dir: string, book: string, id: string) {
  const b = loadBooks(dir).find((x) => x.name === book)
  if (!b) throw new Error(`书架上没有 ${book}`)
  const c = b.chapters.find((x) => x.id === id)
  if (!/^\d+(\.\d+)*$/.test(id) || !c) throw new Error(`${book} 没有 ${id}`)
  return { b, c }
}

export type Place = { before?: string; after?: string; first?: boolean }
// 位置 → CLI 参数；都没给时 order 要显式 --last，move 不写（排最后是它的缺省）
function placeArgs(p: Place, none: string[] | string = []): string[] {
  if (p.before) return ['--before', p.before]
  if (p.after) return ['--after', p.after]
  if (p.first) return ['--first']
  return typeof none === 'string' ? [none] : none
}

export function createActions(dir: () => string, run: Runner = runWiki) {
  // CLI 在插件包里，对着库根（cwd）跑；显式 python3 不依赖执行位（git / 解包 / 云盘都可能剥位）
  const wiki = (args: string[]) => run('python3', [vaultTools('bin', 'wiki'), ...args], dir())

  return {
    async readChapter(p: { book: string; id: string }) {
      bookChapter(dir(), p.book, p.id)
      await wiki(['book', 'read', p.book, p.id])
      return { ok: true }
    },

    // 「完成」只由人标，规则在 CLI 里（身份不是 human: 就拒）；这里不绕
    async deposit(p: { book: string; id: string; done?: boolean }) {
      bookChapter(dir(), p.book, p.id)
      await wiki(['book', 'deposit', p.book, p.id, ...(p.done ? ['--done'] : [])])
      return { ok: true }
    },

    // 只做入库第 2 步（转文本），写 text；补图 / 梳理 / 质检走 wiki-write-book-ingest
    async convertBook(p: { book: string }) {
      const root = dir()
      const book = loadBooks(root).find((x) => x.name === p.book)
      if (!book) throw new Error(`书架上没有 ${p.book}`)
      if (!book.source) throw new Error(`${p.book} 没有可转换的源文件`)
      const source = inside(root, book.source, path.join('raw', 'book'))
      if (!source || !fs.statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`读不到源文件：${book.source}`)
      const ext = path.extname(source).toLowerCase()
      if (!['.pdf', '.epub', '.azw3', '.mobi'].includes(ext)) throw new Error(`暂不支持 ${ext || '无扩展名'} 书籍`)
      const bookDir = path.join(root, book.path)
      const index = path.join(bookDir, `${book.name}.md`)
      const target = path.join(bookDir, '章节')
      const existing = (() => { try { return fs.readdirSync(target) } catch { return [] } })()
      if (book.materialStatus !== 'init' && book.materialStatus !== 'failed') throw new Error(`${p.book} 已是「${book.materialStatus}」，不能再转换；后续步骤走 wiki-write-book-ingest`)
      if (existing.length) throw new Error('章节目录已有内容，不会覆盖；请先确认现有转换结果')

      const originalIndex = fs.readFileSync(index, 'utf8')
      const targetExisted = fs.existsSync(target)
      setFrontmatter(index, { material_error: '' })
      const tmpBase = path.join(root, '.wiki', 'tmp')
      fs.mkdirSync(tmpBase, { recursive: true })
      const tmp = fs.mkdtempSync(path.join(tmpBase, 'book-convert-'))
      const output = path.join(tmp, '章节')
      let installed = false
      try {
        await wiki(['book', 'split', source, output])
        const files = fs.readdirSync(output).filter((f) => !!parseChapterFile(f))
        if (!files.length) throw new Error('转换没有生成章节文字')
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
        fs.renameSync(output, target)
        installed = true
        syncChapterIndex(index, files, new Map(book.chapters.map((c) => [c.id, c.read])))
        await wiki(['book', 'images', book.name])          // epub 抽出的图搬进 raw/book/<书名>/images/
        setFrontmatter(index, { material_status: 'text', material_error: '' })
        return { ok: true as const }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (installed) {
          fs.rmSync(target, { recursive: true, force: true })
          if (targetExisted) fs.mkdirSync(target, { recursive: true })
        }
        writeAtomic(index, originalIndex)
        // 扫描版不是失败：停在 init 等人确认要不要 AI 转写（wiki-write-book-ingest）
        const scanned = /扫描版/.test(message)
        setFrontmatter(index, { material_status: scanned ? 'init' : 'failed', material_error: message.slice(0, 500) })
        throw e
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    },

    async cover(p: { path: string; grade: string }) {
      if (p.grade !== 'processing' && p.grade !== 'done') throw new Error(`不认识的状态：${p.grade}`)
      const abs = inside(dir(), String(p.path), path.join('raw', 'document'))
      if (!abs || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`没有这份文档：${p.path}`)
      await wiki(['document', 'cover', p.path, p.grade])
      return { ok: true }
    },

    // 知识沉淀页「标记完成」：草稿 → stable。状态写死，调用方传不了别的；「页存在且是 draft」由 rpc.ts 按模型校验
    async mark(p: { path: string }) {
      const rel = String(p.path)
      if (!rel.endsWith('.md')) throw new Error(`不是 md 页：${rel}`)
      const abs = inside(dir(), rel)
      if (!abs || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`没有这页：${rel}`)
      await wiki(['page', 'mark', rel, 'stable'])
      return { ok: true }
    },

    // 目录拖动：同文件夹调先后 / 移进别的文件夹。节点、文件夹、兄弟都由 rpc.ts 按模型校验过
    async reorder(p: { node: string; place: Place }) {
      await wiki(['page', 'order', p.node, ...placeArgs(p.place, '--last')])
      return { ok: true }
    },
    async move(p: { node: string; folder: string; place: Place }) {
      await wiki(['page', 'move', p.node, p.folder.replace(/\/$/, '') + '/', ...placeArgs(p.place)])
      return { ok: true }
    },

    // 编辑正文：hash 是整文件 sha1；save 时磁盘上已不是 baseHash 就拒写，交给界面判冲突
    source(abs: string) { const text = fs.readFileSync(abs, 'utf8'); return { text, hash: sha1(text) } },
    save(abs: string, text: string, baseHash: string) {
      const cur = sha1(fs.readFileSync(abs, 'utf8'))
      if (cur !== baseHash) return { ok: false as const, conflict: true as const, hash: cur }
      writeAtomic(abs, text)
      return { ok: true as const, hash: sha1(text) }
    },
    // 只动 frontmatter 里的 updated: 一行；没有 frontmatter 或没有这行不加
    touchUpdated(abs: string) {
      const text = fs.readFileSync(abs, 'utf8')
      const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(text)
      if (!m) return { hash: sha1(text) }
      const fm = m[0].replace(/^updated:.*$/m, `updated: ${today()}`)
      const next = fm + text.slice(m[0].length)
      if (next !== text) writeAtomic(abs, next)
      return { hash: sha1(next) }
    },
  }
}
