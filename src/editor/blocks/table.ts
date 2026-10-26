// src/editor/blocks/table.ts
// edit 态 GFM 表格：解析、结构操作、导航纯函数 + 网格 widget（Task 5 起）。
// 设计 spec：docs/superpowers/specs/2026-10-05-table-editing-design.md
import alignLeftSvg from '../../icon/align-left.svg?raw'
import alignCenterSvg from '../../icon/align-center.svg?raw'
import alignRightSvg from '../../icon/align-right.svg?raw'
import deleteRowSvg from '../../icon/delete-row.svg?raw'
import deleteColumnSvg from '../../icon/delete-column.svg?raw'
import deleteTableSvg from '../../icon/delete-table.svg?raw'

export type Align = 'l' | 'c' | 'r'

// rows[r][c] 已反转义（\| → |）、已 trim；r=0 是 header 行。
// cols/aligns 由 delimiter 行定义（GFM 语义）；数据行列数不齐只影响渲染（截断/补空），源码不动。
export interface Table { cols: number; aligns: Align[]; rows: string[][] }

export function unescCell(text: string): string {
  return text.replace(/\\\|/g, '|')
}
export function escCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

// 一行表格的格区间：以「未转义管」为界切分。行首/行尾的管是围栏不产空格；
// 无行首管时首格从 0 起、无行尾管时末格到行尾（GFM 两端管都可选）。
// \\| 视作「已转义」——字面反斜杠+管不切开（读回变 \|，接受并文档化）。
export function cellSpans(line: string): Array<[number, number]> {
  const pipes: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && (i === 0 || line[i - 1] !== '\\')) pipes.push(i)
  }
  const spans: Array<[number, number]> = []
  if (!pipes.length) return line.trim() ? [[0, line.length]] : []
  if (pipes[0] > 0) spans.push([0, pipes[0]])
  for (let k = 0; k + 1 < pipes.length; k++) spans.push([pipes[k] + 1, pipes[k + 1]])
  if (pipes[pipes.length - 1] < line.length - 1) spans.push([pipes[pipes.length - 1] + 1, line.length])
  return spans
}

export function splitCells(line: string): string[] {
  return cellSpans(line).map(([a, b]) => unescCell(line.slice(a, b).trim()))
}

const DELIM = /^:?-+:?$/

function parseAlign(d: string): Align {
  const l = d.startsWith(':'), r = d.endsWith(':')
  return l && r ? 'c' : r ? 'r' : 'l'
}

// src = 整个表格块（blocksOf 口径不含尾换行；容错也吃尾换行形态）。首行 header、次行 delimiter、其余 body。
// 空体行丢弃（GFM 空行终止表格，表内不可能有；尾部空行只来自测试 fixture 的尾换行）。
// delimiter 整行不合法 → null（lezer 判了 Table，但 src 可能被手改坏——渲染层兜底退 server）。
export function parseTable(src: string): Table | null {
  const lines = src.split('\n')
  if (lines.length < 2) return null
  const head = splitCells(lines[0])
  const delims = splitCells(lines[1])
  if (!head.length || !delims.length || !delims.every((d) => DELIM.test(d))) return null
  return {
    cols: delims.length,
    aligns: delims.map(parseAlign),
    rows: [head, ...lines.slice(2).map(splitCells).filter((cs) => cs.length > 0)],
  }
}

// 规模护栏（spec §六）：行 > 300 或 列 > 20 或 格总数 > 2000 → 整表退 server html
export function overGuard(t: Table): boolean {
  return t.rows.length > 300 || t.cols > 20 || t.rows.length * t.cols > 2000
}

// ---- 结构操作（全部纯函数：src → 新 src；护栏不满足返回 null，由调用方放弃）----
// 源码行索引：r===0 → 0（header）；r>=1 → r+1（1 是 delimiter）
const lineIdx = (r: number) => (r === 0 ? 0 : r + 1)

const spliceLine = (line: string, a: number, b: number, insert: string) =>
  line.slice(0, a) + insert + line.slice(b)

// 缺格补位：补到 cols 格（尾部追加「 |」= 空格+管，每追加一次多一格空位；行无尾管先补尾管）
export function padRow(line: string, cols: number): string {
  if (cellSpans(line).length >= cols) return line
  let out = line.replace(/[ \t]*$/, '')
  const spans = cellSpans(out)
  if (!spans.length) return '| ' + Array(cols).fill('').join(' | ') + ' |'   // 空行/纯围栏：整行重铺
  const endsWithPipe = out.endsWith('|') && !out.endsWith('\\|')
  if (!endsWithPipe) out += ' |'
  while (cellSpans(out).length < cols) out += ' |'
  return out
}

// 单格替换：目标行 pad 到 c+1 格后做 span 手术，只动 [a,b) 段，行内其余字符原样。
// 写入文本：换行拍平空格（粘贴防线）、esc、首尾 trim；空文本写单空格占位（避免 || 相邻）。
export function replaceCell(src: string, r: number, c: number, text: string): string | null {
  const t = parseTable(src)
  if (!t || r < 0 || r >= t.rows.length || c < 0 || c >= t.cols) return null
  const lines = src.split('\n')
  const i = lineIdx(r)
  const flat = text.replace(/\r?\n/g, ' ').trim()
  const line = padRow(lines[i], Math.max(c + 1, 1))
  const spans = cellSpans(line)
  if (c >= spans.length) return null
  const cell = flat ? ` ${escCell(flat)} ` : ' '
  lines[i] = spliceLine(line, spans[c][0], spans[c][1], cell)
  return lines.join('\n')
}

// 插空行（网格行 r 上方）：空行模板 '|  |  |'（cols 格）
export function insertRow(src: string, r: number): string | null {
  const t = parseTable(src)
  if (!t || r < 1 || r > t.rows.length) return null
  const lines = src.split('\n')
  lines.splice(lineIdx(r), 0, '| ' + Array(t.cols).fill('').join(' | ') + ' |')
  return lines.join('\n')
}

export function deleteRow(src: string, r: number): string | null {
  const t = parseTable(src)
  if (!t || r < 1 || r >= t.rows.length) return null
  const lines = src.split('\n')
  lines.splice(lineIdx(r), 1)
  return lines.join('\n')
}

// 在线内列 c 左侧插空格：c 超出现有格数 → 尾部追加「 |」；c=0 且行无行首管 → 行头补「| |」
function insertCellInLine(line: string, c: number): string {
  const spans = cellSpans(line)
  if (c >= spans.length) return line.replace(/[ \t]*$/, '') + ' |'
  if (c === 0 && spans[0][0] === 0) return '| |' + line
  return spliceLine(line, spans[c][0], spans[c][0], ' |')
}

// delimiter 行插段：新列写 ---（新列默认左对齐，spec §四）——不走 insertCellInLine 的空格形态
function insertDelimCell(line: string, c: number): string {
  const spans = cellSpans(line)
  if (c >= spans.length) return line.replace(/[ \t]*$/, '') + ' --- |'
  if (c === 0 && spans[0][0] === 0) return '| --- |' + line
  return spliceLine(line, spans[c][0], spans[c][0], ' --- |')
}

// 插空列：每行（含 delimiter）同步。短行先 pad 到全 cols（保证新格落位在语义上的列 c，
// 不然追加会落到错误的显示列——结构操作是整表一次性重写，O(表规模) 语义在 spec §四）。
// delimiter 新列写 ---（新列默认左对齐）。空行跳过（尾换行 fixture 防幻影行，T1 裁定）。
export function insertCol(src: string, c: number): string | null {
  const t = parseTable(src)
  if (!t || c < 0 || c > t.cols) return null
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i === 1) { lines[i] = insertDelimCell(lines[i], c); continue }    // delimiter 行不 pad（本身定义 cols，格数=cols）
    if (!lines[i].trim()) continue                                       // 空行原样保留（join 保尾换行）
    lines[i] = insertCellInLine(padRow(lines[i], t.cols), c)
  }
  return lines.join('\n')
}

// 删列：删格 span + 其左侧相邻管；行内没有列 c（缺格行/空行）则该行不动。多格行删后自然回落。
export function deleteCol(src: string, c: number): string | null {
  const t = parseTable(src)
  if (!t || t.cols <= 1 || c < 0 || c >= t.cols) return null
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const spans = cellSpans(lines[i])
    if (c >= spans.length) continue
    const [a, b] = spans[c]
    lines[i] = spliceLine(lines[i], a > 0 ? a - 1 : 0, b, '')   // 连同左侧管一起删（a=0 时无左管）
  }
  return lines.join('\n')
}

const ALIGN_SRC: Record<Align, string> = { l: '---', c: ':--:', r: '--:' }
export function setAlign(src: string, c: number, a: Align): string | null {
  const t = parseTable(src)
  if (!t || c < 0 || c >= t.cols) return null
  const lines = src.split('\n')
  const line = padRow(lines[1], t.cols)   // delimiter 缺格（如 | --- |定义 2 列但只写 1 段）先补齐
  const spans = cellSpans(line)
  lines[1] = spliceLine(line, spans[c][0], spans[c][1], ` ${ALIGN_SRC[a]} `)
  return lines.join('\n')
}

// ---- 导航矩阵（spec §三）：键盘语义的纯函数，与 keymap/网格渲染解耦 ----
export type NavDest =
  | { k: 'move'; r: number; c: number; at: 'start' | 'end' }
  | { k: 'grow'; r: number; c: number }     // 表尾追加一行，进 (r, c)
  | { k: 'exit'; side: 'before' | 'after' }
  | { k: 'none' }
export type NavKey = 'tab' | 'stab' | 'enter' | 'up' | 'down' | 'left' | 'right'

export function nextCell(t: Table, r: number, c: number, key: NavKey): NavDest {
  const rows = t.rows.length, cols = t.cols
  if (r < 0 || r >= rows || c < 0 || c >= cols) return { k: 'none' }
  const move = (rr: number, cc: number, at: 'start' | 'end'): NavDest => ({ k: 'move', r: rr, c: cc, at })
  switch (key) {
    case 'tab':
      if (c + 1 < cols) return move(r, c + 1, 'start')
      if (r + 1 < rows) return move(r + 1, 0, 'start')
      return { k: 'grow', r: rows, c: 0 }
    case 'stab':
      if (c > 0) return move(r, c - 1, 'end')
      if (r > 0) return move(r - 1, cols - 1, 'end')
      return { k: 'exit', side: 'before' }
    case 'enter':
      if (r + 1 < rows) return move(r + 1, c, 'start')
      return { k: 'grow', r: rows, c }
    case 'up': return r > 0 ? move(r - 1, c, 'start') : { k: 'exit', side: 'before' }
    case 'down': return r + 1 < rows ? move(r + 1, c, 'start') : { k: 'exit', side: 'after' }
    case 'left': return c > 0 ? move(r, c - 1, 'end') : { k: 'exit', side: 'before' }
    case 'right': return c + 1 < cols ? move(r, c + 1, 'start') : { k: 'exit', side: 'after' }
  }
}

// ---- 网格渲染 ----
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { serverBlock } from './server'
import { remeasure } from './measure'
import { registerBlock, type BlockViewCtx } from './registry'
import s from '../editor.module.css'

// 激活态不挂 widget 实例（CM6 eq 保 DOM 时留的是 DOM 节点，实例引用不保证存活——spec §五）。
// WeakMap 按根节点查：eq 保 DOM → 状态存续；重建 → 新节点 → 干净无激活态。
export interface TableState {
  selected: { r: number; c: number } | null
  active: { r: number; c: number } | null
  mini: EditorView | null
  timer: ReturnType<typeof setTimeout> | null
  menuCleanup: (() => void) | null
  toolbarCleanup: (() => void) | null
  view: EditorView | null   // 主视图引用，选中时经 findFromDOM 捕获（彼时 mini 未建、不会被 mini 的 .cm-content 劫持）
  ctx: BlockViewCtx
}
const states = new WeakMap<HTMLElement, TableState>()

const ALIGN_CSS: Record<Align, string> = { l: 'left', c: 'center', r: 'right' }
const cellTextAt = (t: Table, r: number, c: number) => (r < t.rows.length ? t.rows[r][c] ?? '' : '')

// 服务端 HTML 回来前先同步显示表格里最常用的双链与行内代码，避免 RPC 延迟时闪现
// [[源码]] / `反引号`。完整 Markdown 仍由 renderBlocks 回填。
function fillInlinePreview(box: HTMLElement, text: string): { wiki: boolean; code: boolean } {
  const re = /(`+)([\s\S]*?)\1(?!`)|\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g
  let at = 0, found = false
  let wiki = false, code = false
  for (const m of text.matchAll(re)) {
    found = true
    const from = m.index
    if (from > at) box.append(document.createTextNode(text.slice(at, from)))
    if (m[1]) {
      code = true
      let value = m[2].replace(/\r?\n/g, ' ')
      if (value.startsWith(' ') && value.endsWith(' ') && /\S/.test(value)) value = value.slice(1, -1)
      const el = document.createElement('code')
      el.className = s.code
      el.textContent = value
      box.append(el)
    } else {
      wiki = true
      const name = m[3].trim()
      const anchor = m[4]?.slice(1).trim()
      const label = (m[5] || name).trim() || name
      const link = document.createElement('span')
      link.className = s.wikilink
      link.dataset.target = name
      link.dataset.tableWiki = ''
      if (anchor) link.dataset.anchor = anchor
      link.textContent = label
      box.append(link)
    }
    at = from + m[0].length
  }
  if (!found) box.textContent = text
  else if (at < text.length) box.append(document.createTextNode(text.slice(at)))
  return { wiki, code }
}

// 格内容回填：BatchStore 行内渲染，空/失败回退纯文本（spec §六）。deactivateCell 回填共用。
// 回填不得拆激活格：batch promise 从发起到回来之间该格可能已被 activate 挂上 mini，
// 迟到的回填写 innerHTML 会把 mini 的 DOM 整个清掉（实例还活着、焦点已丢）——
// isConnected 只查挂载不查激活，激活格一律跳过（激活格的显示归 mini 管）。
function fillCell(box: HTMLElement, text: string, ctx: BlockViewCtx, root: HTMLElement) {
  box.replaceChildren()
  if (!text) return
  // RPC 回来前先显示同步预览，避免阅读态整张表先坍成空白、随后突然撑开。
  const preview = fillInlinePreview(box, text)
  const activeCell = (stt: TableState | undefined) =>
    stt?.active && String(stt.active.r) === box.dataset.r && String(stt.active.c) === box.dataset.c
  if (activeCell(states.get(root))) return
  ctx.batch.get(text).then((html) => {
    if (!box.isConnected || activeCell(states.get(root))) return
    try {
      if (!html) return
      // 旧服务端或局部渲染失败可能把 [[双链]] 原样包进 HTML。此时保留上面的
      // 可点击预览，不能用更差的结果把它覆盖回源码。
      if (preview.wiki || preview.code) {
        const probe = document.createElement('div')
        probe.innerHTML = html
        if (preview.wiki && probe.textContent?.includes('[[')) return
        if (preview.code && !probe.querySelector('code')) return
      }
      box.innerHTML = html
    } catch { /* 保留同步预览 */ }
    remeasure(root)   // KaTeX 等行内件换高也告知 heightmap（廉价保险）
  }).catch(() => {})
}

// 网格是内容的纯函数（零显示状态）：固定布局把宽度约束在编辑器内，列宽不持久化。
// 非激活格：BatchStore 行内渲染（KaTeX 同路），空/失败回退纯文本（spec §六）。
function buildGrid(src: string, ctx: BlockViewCtx): HTMLElement {
  const t = parseTable(src)!
  const root = document.createElement('div')
  root.className = `${s.blockView} ${s.tblRoot}`
  if (ctx.mode === 'read') root.classList.add(s.tblRead)
  root.dataset.tbl = ''
  const scroll = document.createElement('div')
  scroll.className = s.tblScroll
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const tbody = document.createElement('tbody')
  const rowDom = (r: number, tag: 'th' | 'td') => {
    const tr = document.createElement('tr')
    for (let c = 0; c < t.cols; c++) {
      const cell = document.createElement(tag)
      cell.style.textAlign = ALIGN_CSS[t.aligns[c]]
      const box = document.createElement('div')
      box.className = s.tblCell
      box.tabIndex = -1
      box.dataset.r = String(r); box.dataset.c = String(c)
      const text = cellTextAt(t, r, c)
      fillCell(box, text, ctx, root)
      cell.append(box)
      tr.append(cell)
    }
    return tr
  }
  thead.append(rowDom(0, 'th'))
  for (let r = 1; r < t.rows.length; r++) tbody.append(rowDom(r, 'td'))
  table.append(thead, tbody)
  scroll.append(table)
  states.set(root, { selected: null, active: null, mini: null, timer: null, menuCleanup: null, toolbarCleanup: null, view: null, ctx })
  if (ctx.mode === 'edit') {
    root.append(scroll, buildToolbar(root), buildContextMenu(root))
  } else root.append(scroll)
  // 单击只选格；双击才进入编辑。编辑中的格子保留浏览器默认选区/光标行为。
  if (ctx.mode === 'edit') root.addEventListener('mousedown', (e) => {
    try {
      const ev = e as MouseEvent
      if (ev.button !== 0) return
      const el = ev.target as HTMLElement
      // 非激活格里的 HTML 已由服务端解析。普通点击可直接打开这些链接；mini 内的
      // data-target 仍保留 Cmd/Ctrl+点击语义，避免编辑文字时误跳走。
      const page = el.closest<HTMLElement>('[data-wiki-id]')
      const previewWiki = el.closest<HTMLElement>('[data-table-wiki][data-target]')
      const external = el.closest<HTMLElement>('[data-external], [data-href]')
      if (!ev.metaKey && !ev.ctrlKey && (page || previewWiki || external || el.closest('[data-dead]'))) {
        ev.preventDefault()
        if (page) ctx.io?.open?.({ kind: 'page', id: page.dataset.wikiId!, anchor: page.dataset.anchor || undefined })
        else if (previewWiki) ctx.io?.open?.({ kind: 'wikilink', name: previewWiki.dataset.target!, anchor: previewWiki.dataset.anchor || undefined })
        else {
          const href = external?.dataset.external || external?.dataset.href
          if (href) ctx.io?.open?.({ kind: 'href', href })
        }
        return
      }
      if (ev.metaKey || ev.ctrlKey) {
        const t = el.closest<HTMLElement>('[data-target]')
        if (t) { ev.preventDefault(); ctx.io?.open?.({ kind: 'wikilink', name: t.dataset.target!, anchor: t.dataset.anchor || undefined }); return }
        if (page) { ev.preventDefault(); ctx.io?.open?.({ kind: 'page', id: page.dataset.wikiId!, anchor: page.dataset.anchor || undefined }); return }
        if (external) { ev.preventDefault(); ctx.io?.open?.({ kind: 'href', href: external.dataset.external || external.dataset.href! }); return }
        if (el.closest('[data-dead]')) { ev.preventDefault(); return }
        return   // ⌘裸点表身：不激活，交默认
      }
      const box = el.closest<HTMLElement>('[data-r]')
      if (box) {
        const active = states.get(root)?.active
        const r = Number(box.dataset.r), c = Number(box.dataset.c)
        if (active?.r === r && active.c === c) return
        ev.preventDefault()
        selectCell(root, r, c)
      }
    } catch { /* 宿主崩溃纪律 */ }
  })
  if (ctx.mode === 'edit') root.addEventListener('dblclick', (e) => {
    try {
      const ev = e as MouseEvent
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey) return
      const box = (ev.target as HTMLElement).closest<HTMLElement>('[data-r]')
      if (!box || !root.contains(box)) return
      ev.preventDefault()
      activate(root, Number(box.dataset.r), Number(box.dataset.c), { x: ev.clientX, y: ev.clientY })
    } catch { /* 宿主崩溃纪律 */ }
  })
  if (ctx.mode === 'edit') root.addEventListener('contextmenu', (e) => {
    try {
      const ev = e as MouseEvent
      const box = (ev.target as HTMLElement).closest<HTMLElement>('[data-r]')
      if (!box || !root.contains(box)) return
      ev.preventDefault()
      selectCell(root, Number(box.dataset.r), Number(box.dataset.c))
      openContextMenu(root, ev.clientX, ev.clientY)
    } catch { /* 宿主崩溃纪律 */ }
  })
  if (ctx.mode === 'edit') root.addEventListener('keydown', (e) => {
    try {
      const ev = e as KeyboardEvent
      if (ev.key !== 'ContextMenu' && !(ev.shiftKey && ev.key === 'F10')) return
      const target = states.get(root)?.active ?? states.get(root)?.selected
      const box = target ? cellBox(root, target.r, target.c) : null
      if (!box) return
      ev.preventDefault()
      const rect = box.getBoundingClientRect()
      openContextMenu(root, rect.left + 12, rect.top + Math.min(rect.height, 28), true)
    } catch { /* 宿主崩溃纪律 */ }
  }, true)
  // 焦点离开表格（点主编辑器正文/另一张表）：拆 mini 并清除选中态。
  // focusout 冒泡自 mini 的 content 元素；只认 relatedTarget 明确落在 root 之外——
  // relatedTarget 为 null（切格中途 destroy/窗口失焦）不拆，防 activate 切格路径的
  // destroy→focusout 重入误杀新挂的 mini（deactivateCell 幂等，重入亦无害但白拆一次）。
  if (ctx.mode === 'edit') root.addEventListener('focusout', (e) => {
    try {
      const to = (e as FocusEvent).relatedTarget
      if (to && !root.contains(to as Node)) { deactivateCell(root); clearSelection(root) }
    } catch { /* 宿主崩溃纪律 */ }
  })
  return root
}

// eq 三重一致骨架（spec §五）：结构相同 + diff 限单格 + 该格=激活格 + 新格文本==mini 现文本。
// mini 比对在 Task 7 接线；本任务立壳——无激活态恒 false（结构操作/undo 一律重建）。
function sameTableDom(prevSrc: string, nextSrc: string, dom: HTMLElement): boolean {
  const stt = states.get(dom)
  if (!stt?.active || !stt.mini) return false
  const a = parseTable(prevSrc), b = parseTable(nextSrc)
  if (!a || !b || a.rows.length !== b.rows.length || a.cols !== b.cols || String(a.aligns) !== String(b.aligns)) return false
  const la = prevSrc.split('\n'), lb = nextSrc.split('\n')
  // 行数不等（Final C1：尾部零格 lone-| 行被 parseTable 丢弃但留在 src 里——
  // 单行 diff 时 lb[diffRow] 是 undefined，splitCells(undefined) 会炸 eq → 宿主崩溃）→ 直接重建
  if (la.length !== lb.length) return false
  let diffRow = -1
  for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) { if (diffRow !== -1) return false; diffRow = i }
  if (diffRow === -1 || diffRow === 1) return false                      // 无 diff / delimiter 变 = 结构变化 → 重建
  const ca = splitCells(la[diffRow]), cb = splitCells(lb[diffRow])
  if (ca.length !== cb.length) return false
  let diffCell = -1
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) { if (diffCell !== -1) return false; diffCell = i }
  if (diffCell === -1) return false
  const r = diffRow >= 2 ? diffRow - 1 : 0                                // 源码行 → 网格行
  // 写入口径是 esc+trim（replaceCell），比较也对齐 trim：mini 首尾空格不打破三重一致
  return r === stt.active.r && diffCell === stt.active.c && cb[diffCell] === stt.mini.state.doc.toString().trim()
}

const tableSpec = {
  build(src: string, info: string, ctx: BlockViewCtx) {
    const t = parseTable(src)
    // 合法常规表在两种模式下都直接建本地网格：阅读态不再经历多行源码 fallback，
    // 从根上消除异步替换时表格上方残留的大段占位。坏表/超限/degrade 仍交给 server。
    if (!t || overGuard(t) || ctx.degrade) return serverBlock.build(src, info, ctx)
    return buildGrid(src, ctx)
  },
  destroy(dom: HTMLElement) {
    const stt = states.get(dom)
    if (stt) {
      try { stt.mini?.destroy() } catch { /* 宿主崩溃纪律 */ }
      if (stt.timer) clearTimeout(stt.timer)
      stt.menuCleanup?.()
      stt.toolbarCleanup?.()
      states.delete(dom)
    }
  },
  eq: sameTableDom,
  interactive: true,
} satisfies import('./registry').BlockViewSpec

// 无 once 守卫：Map.set 幂等，且必须允许 surface 每次 createSurface 都重设——
// registerServerKinds() 会把 'table' 抢注回 serverBlock，带守卫的话二次创建 surface 后表格静默退化。
export function registerTableKind() {
  registerBlock('table', tableSpec)   // Map.set 后注册胜出，覆盖 server 的注册
}

// ---- 激活协议（spec §三：唯一入口）与写回 ----
import { EditorState, Prec, StateField, type Extension, type Range } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { mathExt, wikilinkExt, cjkEmphasisExt } from '../kernel/mdext'
import { blocksOf } from '../kernel/blocks'
import { inlineDecoRanges, nameStates, setNameStates, wikiTarget, type DecoCtx } from '../kernel/deco'
import type { NameState } from '../io'

// 主视图 + 块区间现算（spec §五：永不缓存位置）：posAtDOM 定点位、blocksOf 包含性查块。
// 双份相同表格天然不串——点位落在哪块就是哪块（Review Focus 1）。
function withBlock(root: HTMLElement): { view: EditorView; from: number; to: number; src: string } | null {
  const stt = states.get(root)
  const view = stt?.view
  if (!view || !view.dom.isConnected || !root.isConnected) return null
  try {
    const pos = view.posAtDOM(root)
    for (const b of blocksOf(view.state.doc.toString(), syntaxTree(view.state))) {
      if (b.kind === 'table' && b.from <= pos && pos <= b.to) return { view, from: b.from, to: b.to, src: b.src }
    }
  } catch { /* posAtDOM 未挂载时抛错——宿主纪律 */ }
  return null
}

// 死链染色只在激活格（spec §六）：源码形态的 [[名]] 整段挂色 + data-target（⌘点击开链）
function wikiRanges(state: EditorState): Range<Decoration>[] {
  const names = state.field(nameStates, false) ?? {}
  const out: Range<Decoration>[] = []
  const doc = state.doc.toString()
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name !== 'WikiLink' || n.to - n.from <= 4) return
      const raw = doc.slice(n.from + 2, n.to - 2)
      const { name, anchor } = wikiTarget(raw)
      if (!name) return
      const ns = names[name]
      out.push(Decoration.mark({
        class: ns && !ns.id ? s.wikilink + ' ' + s.dead : s.wikilink,
        attributes: { 'data-target': name, ...(anchor ? { 'data-anchor': anchor } : {}) },
      }).range(n.from, n.to))
    },
  })
  return out
}

// mini 装饰：行内源码形态 + 双链染色，一个 field 一个 set（单元格文档极小，全量重建）
const miniDeco = (ctx: BlockViewCtx) => StateField.define<DecorationSet>({
  create: (st) => Decoration.set([...inlineDecoRanges(st, ctx as DecoCtx), ...wikiRanges(st)], true),
  update: (_, tr) => Decoration.set([...inlineDecoRanges(tr.state, ctx as DecoCtx), ...wikiRanges(tr.state)], true),
  provide: (f) => EditorView.decorations.from(f),
})

const miniTheme = EditorView.theme({
  '&': { fontSize: 'inherit', height: 'auto', minHeight: '1.2em' },
  // CM6 基础 content 是 min-height:100%；嵌在 table-cell 中也会把百分比解析成外层
  // 编辑器可视高度。行高由 editor 自己的 minHeight 承担，content 必须归零。
  '.cm-content': { height: 'auto', minHeight: '0', padding: '0' },
  // CM6 的基础 scroller 是 height:100%；它嵌进 table-cell 后会按外层编辑器高度
  // 解析百分比，单个激活格便撑到整屏。mini 必须由单行内容自然定高。
  '.cm-scroller': { height: 'auto', overflow: 'hidden', fontFamily: 'inherit', lineHeight: 'inherit' },
})

export function miniState(text: string, ctx: BlockViewCtx, names: Record<string, NameState> | undefined, extra: Extension[]): EditorState {
  let st = EditorState.create({
    doc: text,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt, cjkEmphasisExt] }),
      miniDeco(ctx),
      nameStates,   // 死链染色读 field——不挂 field 则 wikiRanges 永远拿 {}（spec §六「mini 挂 nameStates」）
      // 格内单行纪律：换行拍平空格（spec §六粘贴；拍平后 lines=1 不会再触发）
      EditorView.updateListener.of((u) => {
        if (u.docChanged && u.state.doc.lines > 1)
          u.view.dispatch({ changes: { from: 0, to: u.state.doc.length, insert: u.state.doc.toString().replace(/\n/g, ' ') } })
      }),
      miniTheme,
      EditorView.lineWrapping,
      ...extra,
    ],
  })
  if (names && Object.keys(names).length) st = st.update({ effects: setNameStates.of(names) }).state
  return st
}

function cellBox(root: HTMLElement, r: number, c: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)
}

function captureMainView(root: HTMLElement, stt: TableState) {
  if (stt.view) return
  const view = EditorView.findFromDOM(root)
  if (view) stt.view = view
}

function positionToolbar(root: HTMLElement) {
  const stt = states.get(root)
  const target = stt?.active ?? stt?.selected
  const bar = root.querySelector<HTMLElement>('[data-tblbar]')
  const box = target ? cellBox(root, target.r, target.c) : null
  if (!stt?.view || !bar || bar.hidden || !box) return
  const cell = box.getBoundingClientRect()
  const viewport = stt.view.scrollDOM.getBoundingClientRect()
  const visible = cell.bottom > viewport.top && cell.top < viewport.bottom && cell.right > viewport.left && cell.left < viewport.right
  bar.style.visibility = visible ? 'visible' : 'hidden'
  if (!visible) return
  const gap = 6
  const width = bar.offsetWidth || 204
  const height = bar.offsetHeight || 36
  const left = Math.max(viewport.left + gap, Math.min(cell.right - width, viewport.right - width - gap))
  let top = cell.top - height - gap
  const placement = top < viewport.top + gap ? 'below' : 'above'
  if (placement === 'below') top = cell.bottom + gap
  top = Math.max(viewport.top + gap, Math.min(top, viewport.bottom - height - gap))
  bar.dataset.placement = placement
  bar.style.left = `${left}px`
  bar.style.top = `${top}px`
}

function trackToolbar(root: HTMLElement, stt: TableState) {
  if (stt.toolbarCleanup || !stt.view) return
  const reposition = () => positionToolbar(root)
  stt.view.scrollDOM.addEventListener('scroll', reposition, { passive: true })
  window.addEventListener('resize', reposition, { passive: true })
  stt.toolbarCleanup = () => {
    stt.view?.scrollDOM.removeEventListener('scroll', reposition)
    window.removeEventListener('resize', reposition)
  }
}

function selectCell(root: HTMLElement, r: number, c: number, focus = true) {
  const stt = states.get(root)
  if (!stt) return
  captureMainView(root, stt)
  const box = cellBox(root, r, c)
  if (!box) return
  if (stt.active && (stt.active.r !== r || stt.active.c !== c)) deactivateCell(root)
  if (stt.selected && (stt.selected.r !== r || stt.selected.c !== c))
    cellBox(root, stt.selected.r, stt.selected.c)?.classList.remove(s.tblCellSelected)
  stt.selected = { r, c }
  box.classList.add(s.tblCellSelected)
  updateMenuState(root)
  trackToolbar(root, stt)
  positionToolbar(root)
  if (focus && !stt.active) box.focus({ preventScroll: true })
}

function clearSelection(root: HTMLElement) {
  const stt = states.get(root)
  if (!stt?.selected) return
  cellBox(root, stt.selected.r, stt.selected.c)?.classList.remove(s.tblCellSelected)
  stt.selected = null
  closeContextMenu(root)
  updateMenuState(root)
}

// 统一激活协议：切格先 deactivate（冲刷+拆旧）→ 目标格建 mini → 聚焦 → 光标落位。
// 焦点、实例生命周期、激活态三件事由单一入口保持同步（spec §三）。
export function activate(root: HTMLElement, r: number, c: number, at: 'start' | 'end' | { x: number; y: number } = 'end') {
  try {
    const stt = states.get(root)
    if (!stt) return
    // 必须在 mini 建立前捕获：之后 root 内出现 mini 的 .cm-content，findFromDOM 会被劫持到 mini
    captureMainView(root, stt)
    const wb = withBlock(root)
    const t = wb ? parseTable(wb.src) : null
    if (!t || r >= t.rows.length || c >= t.cols) return
    const box = cellBox(root, r, c)
    if (!box) return
    selectCell(root, r, c, false)
    if (stt.active && (stt.active.r !== r || stt.active.c !== c)) deactivateCell(root)
    if (!stt.active) {
      const names = stt.view?.state.field(nameStates, false)
      // fillCell 已放入阅读态文本；挂 mini 前清掉，否则激活格会同时显示文本与输入器两份内容。
      box.replaceChildren()
      stt.mini = new EditorView({
        state: miniState(cellTextAt(t, r, c), stt.ctx, names, [
          EditorView.updateListener.of((u) => { if (u.docChanged) scheduleFlush(root) }),
          Prec.high(keymap.of(navKeymap(root))),              // 高优先：先于默认/历史键位
        ]),
        parent: box,
      })
      // 浏览器的菜单键可能被内层 CodeMirror 截获；在 mini 根捕获，确保键盘与右键等价。
      stt.mini.dom.addEventListener('keydown', (e) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
        e.preventDefault(); e.stopPropagation()
        const rect = box.getBoundingClientRect()
        openContextMenu(root, rect.left + 12, rect.top + Math.min(rect.height, 28), true)
      }, true)
      stt.active = { r, c }
    }
    const mini = stt.mini!
    mini.focus()
    const len = mini.state.doc.length
    if (typeof at === 'object') {
      try { const p = mini.posAtCoords({ x: at.x, y: at.y }); mini.dispatch({ selection: { anchor: Math.max(0, Math.min(p ?? len, len)) } }) } catch { /* jsdom 无坐标 */ }
    } else {
      mini.dispatch({ selection: { anchor: at === 'start' ? 0 : len } })
    }
    remeasure(root)
    updateMenuState(root)
  } catch { /* 宿主崩溃纪律 */ }
}

// 拆 mini：冲刷（编辑不丢）→ destroy → fillCell 回填阅读形态
function deactivateCell(root: HTMLElement) {
  const stt = states.get(root)
  if (!stt) return
  const wasActive = stt.active
  const text = stt.mini?.state.doc.toString().trim() ?? ''
  flushCell(root)
  try { stt.mini?.destroy() } catch { /* 宿主纪律 */ }
  stt.mini = null
  stt.active = null
  if (wasActive) {
    const box = cellBox(root, wasActive.r, wasActive.c)
    if (box) fillCell(box, text, stt.ctx, root)
  }
  remeasure(root)
  updateMenuState(root)
}

// 立即写回：mini 现文本 → 单格替换事务。区间从当期 doc 现算（防抖期间位置可能被移走）。
// dispatch 后 deco 重建出新 widget（src 变了）→ sameTableDom 三重一致 → 保 DOM，mini 不丢焦点。
export function flushCell(root: HTMLElement): boolean {
  try {
    const stt = states.get(root)
    if (!stt?.active || !stt.mini) return false
    if (stt.timer) { clearTimeout(stt.timer); stt.timer = null }
    const wb = withBlock(root)
    if (!wb) return false
    const next = replaceCell(wb.src, stt.active.r, stt.active.c, stt.mini.state.doc.toString())
    if (next === null || next === wb.src) return false
    wb.view.dispatch({ changes: { from: wb.from, to: wb.to, insert: next } })
    return true
  } catch { return false }   // 宿主崩溃纪律：写回失败静默弃（下轮冲刷再试）
}

// ---- 防抖调度与出表（spec §五：300ms 空闲冲刷；失焦/出表/结构操作立即冲刷）----
import { undo } from '@codemirror/commands'
import type { KeyBinding } from '@codemirror/view'

const FLUSH_MS = 300

export function scheduleFlush(root: HTMLElement) {
  const stt = states.get(root)
  if (!stt) return
  if (stt.timer) clearTimeout(stt.timer)
  stt.timer = setTimeout(() => {
    if (!stt) return
    stt.timer = null
    flushCell(root)
  }, FLUSH_MS)
}

// 出表：冲刷 → 拆 mini → 主编辑器聚焦 + selection 落块边界（spec §一焦点模型）
export function exitTable(root: HTMLElement, side: 'before' | 'after' = 'after') {
  try {
    const stt = states.get(root)
    if (!stt) return
    deactivateCell(root)
    clearSelection(root)
    // withBlock 必须在冲刷【之后】现取（Final I1）：冲刷的写回会让格变长/变短，块尾已移位
    const wb = withBlock(root)
    ;(stt.view ?? wb?.view)?.focus()
    if (wb) wb.view.dispatch({ selection: { anchor: side === 'before' ? wb.from : wb.to } })
  } catch { /* 宿主崩溃纪律 */ }
}

// 格内 Mod-z：先冲刷（格内编辑落进主历史），撤销粒度 = 主文档事务。
// 撤销后 mini 文本与 doc 对不上 → eq false → 整表重建回无激活态（焦点掉出，spec §五接受并文档化）。
export function undoForward(root: HTMLElement): KeyBinding {
  return {
    key: 'Mod-z',
    run: () => {
      const stt = states.get(root)
      flushCell(root)
      try { if (stt?.view) undo(stt.view) } catch { /* 宿主纪律 */ }
      return true
    },
  }
}

// ---- 键盘矩阵接线（spec §三）：只拦边界，格内文本移动放行默认 ----
import { keymap } from '@codemirror/view'

function runNav(mini: EditorView, root: HTMLElement, key: NavKey): boolean {
  try {
    const stt = states.get(root)
    if (!stt?.active) return true          // 状态丢失也吞键（不给格内默认行为可乘）
    const wb = withBlock(root)
    const t = wb ? parseTable(wb.src) : null
    if (!wb || !t) return true
    const d = nextCell(t, stt.active.r, stt.active.c, key)
    if (d.k === 'none') return false
    if (d.k === 'move') activate(root, d.r, d.c, d.at)
    else if (d.k === 'grow') appendRowAndActivate(root, d.c)
    else exitTable(root, d.side)
  } catch { /* 宿主崩溃纪律 */ }
  return true
}

// 结构事务后重定位根：dispatch 同步重建 DOM，旧根已 detach，从主视图 domAtPos 找新根
export function activateAfterDispatch(view: EditorView, from: number, r: number, c: number) {
  try {
    const d = view.domAtPos(from + 1)
    const el = d.node.nodeType === 1 ? (d.node as HTMLElement) : d.node.parentElement
    const root = el?.closest<HTMLElement>('[data-tbl]') ?? el?.querySelector<HTMLElement>('[data-tbl]') ?? null
    if (root) activate(root, r, c, 'start')
  } catch { /* 宿主崩溃纪律 */ }
}

function selectAfterDispatch(view: EditorView, from: number, r: number, c: number) {
  try {
    const d = view.domAtPos(from + 1)
    const el = d.node.nodeType === 1 ? (d.node as HTMLElement) : d.node.parentElement
    const root = el?.closest<HTMLElement>('[data-tbl]') ?? el?.querySelector<HTMLElement>('[data-tbl]') ?? null
    if (root) selectCell(root, r, c)
  } catch { /* 宿主崩溃纪律 */ }
}

// 末格 Tab / 底行 Enter：冲刷 → 表尾追加一行（一次主文档事务）→ 整表重建 → 进新格
function appendRowAndActivate(root: HTMLElement, c: number) {
  const wb0 = withBlock(root)
  if (!wb0) return
  flushCell(root)
  const wb = withBlock(root) ?? wb0        // 冲刷后 src 已新（区间不变，但以现算为准）
  const t = parseTable(wb.src)
  if (!t) return
  const next = insertRow(wb.src, t.rows.length)
  if (next === null) return
  wb.view.dispatch({ changes: { from: wb.from, to: wb.to, insert: next } })
  activateAfterDispatch(wb.view, wb.from, t.rows.length, Math.min(c, t.cols - 1))
}

export function navKeymap(root: HTMLElement): KeyBinding[] {
  const edge = (key: NavKey, at: 'start' | 'end') => (mini: EditorView) => {
    const sel = mini.state.selection.main
    const atEdge = sel.empty && (at === 'start' ? sel.head === 0 : sel.head === mini.state.doc.length)
    return atEdge ? runNav(mini, root, key) : false
  }
  const contextMenu = () => {
    const target = states.get(root)?.active ?? states.get(root)?.selected
    const box = target ? cellBox(root, target.r, target.c) : null
    if (!box) return false
    const rect = box.getBoundingClientRect()
    openContextMenu(root, rect.left + 12, rect.top + Math.min(rect.height, 28), true)
    return true
  }
  return [
    { key: 'Tab', run: (m) => runNav(m, root, 'tab') },
    { key: 'Shift-Tab', run: (m) => runNav(m, root, 'stab') },
    { key: 'Enter', run: (m) => runNav(m, root, 'enter') },   // 格内永不插真换行
    { key: 'ArrowUp', run: (m) => runNav(m, root, 'up') },    // 单逻辑行：恒格移动
    { key: 'ArrowDown', run: (m) => runNav(m, root, 'down') },
    { key: 'ArrowLeft', run: edge('left', 'start') },
    { key: 'ArrowRight', run: edge('right', 'end') },
    { key: 'Shift-F10', run: contextMenu },
    { key: 'ContextMenu', run: contextMenu },
    { key: 'Escape', run: () => { exitTable(root, 'after'); return true } },
    undoForward(root),                                        // Mod-z 转发主视图（Task 7）
  ]
}

type TableIcon = 'align-left' | 'align-center' | 'align-right' | 'delete-row' | 'delete-col' | 'delete-table'

// 表格 widget 是原生 DOM，不在 React 树中。图形采用 @univerjs/icons 1.43.2（MIT）的
// LeftJustifying/Horizontally/RightJustifying 与三种 Delete* 图标。每个图标独立存放，构建期
// 读入源码；这里仅把对应 SVG 解析成原生 DOM，不引入 Univer 包，也不发起运行时资源请求。
const tableIcons: Record<TableIcon, string> = {
  'align-left': alignLeftSvg,
  'align-center': alignCenterSvg,
  'align-right': alignRightSvg,
  'delete-row': deleteRowSvg,
  'delete-col': deleteColumnSvg,
  'delete-table': deleteTableSvg,
}

function tableIcon(name: TableIcon): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(tableIcons[name], 'image/svg+xml')
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement
  svg.setAttribute('aria-hidden', 'true')
  svg.dataset.iconSource = 'univer'
  return svg
}

function buildToolbar(root: HTMLElement): HTMLElement {
  const bar = document.createElement('div')
  bar.className = s.tblBar
  bar.dataset.tblbar = ''
  bar.hidden = true
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', '当前单元格操作')
  const sep = () => {
    const el = document.createElement('span')
    el.className = s.tblBarSep
    el.setAttribute('aria-hidden', 'true')
    bar.append(el)
  }
  const mk = (id: string, icon: TableIcon, label: string, pressed = false) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.op = id
    button.dataset.tooltip = label
    button.setAttribute('aria-label', label)
    if (pressed) button.setAttribute('aria-pressed', 'false')
    if (id === 'rowDel' || id === 'colDel' || id === 'tblDel') button.classList.add(s.tblDanger)
    button.append(tableIcon(icon))
    bar.append(button)
  }
  mk('alL', 'align-left', '左对齐', true)
  mk('alC', 'align-center', '居中对齐', true)
  mk('alR', 'align-right', '右对齐', true)
  sep()
  mk('rowDel', 'delete-row', '删除所在行')
  mk('colDel', 'delete-col', '删除所在列')
  mk('tblDel', 'delete-table', '删除整个表格')
  bar.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
  bar.addEventListener('click', (e) => {
    try {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-op]')
      if (!button || button.disabled) return
      runOp(root, button.dataset.op!)
    } catch { /* 宿主崩溃纪律 */ }
  })
  return bar
}

function buildContextMenu(root: HTMLElement): HTMLElement {
  const menu = document.createElement('div')
  menu.className = s.tblMenu
  menu.dataset.tblmenu = ''
  menu.hidden = true
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', '表格操作')
  const sep = () => {
    const el = document.createElement('div')
    el.className = s.tblMenuSep; el.setAttribute('role', 'separator'); menu.append(el)
  }
  const mk = (id: string, iconText: string, label: string, kind = '', radio = false) => {
    const b = document.createElement('button')
    b.type = 'button'; b.dataset.op = id; b.setAttribute('role', radio ? 'menuitemradio' : 'menuitem')
    if (radio) b.setAttribute('aria-checked', 'false')
    if (kind) b.classList.add(kind)
    const icon = document.createElement('span')
    icon.className = s.tblMenuIcon; icon.setAttribute('aria-hidden', 'true'); icon.textContent = iconText
    const text = document.createElement('span'); text.textContent = label
    b.append(icon, text); menu.append(b)
  }
  mk('rowAbove', '↑', '上方插入行')
  mk('rowBelow', '↓', '下方插入行')
  sep()
  mk('colLeft', '←', '左侧插入列')
  mk('colRight', '→', '右侧插入列')
  menu.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
  menu.addEventListener('click', (e) => {
    try {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-op]')
      if (!b || b.disabled || b.hidden) return
      runOp(root, b.dataset.op!)
    } catch { /* 宿主崩溃纪律 */ }
  })
  menu.addEventListener('keydown', (e) => {
    try {
      const ev = e as KeyboardEvent
      if (ev.key === 'Escape') { ev.preventDefault(); closeContextMenu(root, true); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return
      ev.preventDefault()
      const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])')]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1
        : ev.key === 'ArrowDown' ? (i + 1 + items.length) % items.length
          : (i - 1 + items.length) % items.length
      items[next].focus()
    } catch { /* 宿主崩溃纪律 */ }
  })
  return menu
}

function closeContextMenu(root: HTMLElement, refocus = false) {
  const stt = states.get(root)
  const menu = root.querySelector<HTMLElement>('[data-tblmenu]')
  if (menu) menu.hidden = true
  stt?.menuCleanup?.()
  if (stt) stt.menuCleanup = null
  if (refocus) {
    if (stt?.mini) stt.mini.focus()
    else if (stt?.selected) cellBox(root, stt.selected.r, stt.selected.c)?.focus({ preventScroll: true })
  }
}

function openContextMenu(root: HTMLElement, x: number, y: number, focusFirst = false) {
  const stt = states.get(root)
  const menu = root.querySelector<HTMLElement>('[data-tblmenu]')
  if (!(stt?.active ?? stt?.selected) || !menu) return
  updateMenuState(root)
  closeContextMenu(root)
  menu.hidden = false
  menu.style.left = '0px'; menu.style.top = '0px'
  const gap = 6
  const width = menu.offsetWidth || 208, height = menu.offsetHeight || 360
  menu.style.left = `${Math.max(gap, Math.min(x, window.innerWidth - width - gap))}px`
  menu.style.top = `${Math.max(gap, Math.min(y, window.innerHeight - height - gap))}px`
  const onPointer = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) closeContextMenu(root) }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(root, true) } }
  document.addEventListener('mousedown', onPointer, true)
  document.addEventListener('keydown', onKey, true)
  stt.menuCleanup = () => {
    document.removeEventListener('mousedown', onPointer, true)
    document.removeEventListener('keydown', onKey, true)
  }
  if (focusFirst) menu.querySelector<HTMLButtonElement>('button:not(:disabled):not([hidden])')?.focus()
}

function updateMenuState(root: HTMLElement) {
  const stt = states.get(root)
  if (!stt) return
  const wb = withBlock(root)
  const t = wb ? parseTable(wb.src) : null
  const controls = [...root.querySelectorAll<HTMLButtonElement>('[data-op]')]
  const target = stt.active ?? stt.selected
  for (const b of controls) b.disabled = !target || !t
  const bar = root.querySelector<HTMLElement>('[data-tblbar]')
  if (bar) bar.hidden = !target || !t
  if (!target || !t) {
    closeContextMenu(root)
    return
  }
  const { r, c } = target
  const buttons = (id: string) => root.querySelectorAll<HTMLButtonElement>(`[data-op="${id}"]`)
  for (const b of buttons('rowDel')) b.disabled = r === 0                 // GFM 必有 header
  for (const b of buttons('rowAbove')) b.disabled = r === 0               // header 之上无行可插
  for (const b of buttons('colDel')) b.disabled = t.cols <= 1             // 单列禁删
  const rowEdge = r > 0 && (r === 1 || r === t.rows.length - 1)
  const colEdge = c === 0 || c === t.cols - 1
  for (const b of buttons('rowAbove')) b.hidden = !rowEdge
  for (const b of buttons('colLeft')) b.hidden = !colEdge
  for (const [id, align] of [['alL', 'l'], ['alC', 'c'], ['alR', 'r']] as const) {
    const selected = t.aligns[c] === align
    for (const b of buttons(id)) {
      if (b.getAttribute('role') === 'menuitemradio') b.setAttribute('aria-checked', String(selected))
      else b.setAttribute('aria-pressed', String(selected))
    }
  }
  positionToolbar(root)
}

// 统一执行流（spec §四）：冲刷 → 重写源码（一次事务）→ 整表重建 → 按移动后坐标激活。
// 事务后旧根已 detach → activateAfterDispatch 从主视图重定位新根。
export function runOp(root: HTMLElement, opId: string) {
  try {
    const stt = states.get(root)
    const target = stt?.active ?? stt?.selected
    if (!stt || !target) return
    const wasEditing = !!stt.active
    if (wasEditing) flushCell(root)                       // 结构重算基于冲刷后的文档
    const wb = withBlock(root)
    const t = wb ? parseTable(wb.src) : null
    if (!wb || !t) return
    const { r, c } = target
    const commit = (next: string | null, nr: number | null, nc: number) => {
      if (next === null) return
      if (next !== wb.src) wb.view.dispatch({ changes: { from: wb.from, to: wb.to, insert: next } })
      if (nr !== null) {
        if (wasEditing) activateAfterDispatch(wb.view, wb.from, nr, nc)
        else selectAfterDispatch(wb.view, wb.from, nr, nc)
      }
    }
    switch (opId) {
      case 'rowAbove': commit(insertRow(wb.src, r), r + 1, c); break          // 原行下移 → 跟随 (r+1,c)
      case 'rowBelow': commit(insertRow(wb.src, r + 1), r + 1, c); break      // 进新行同列
      case 'rowDel': {                                                        // 删到 0 body 行 → 不保留选中或编辑态
        const rows2 = t.rows.length - 1
        commit(deleteRow(wb.src, r), rows2 > 1 ? Math.min(r, rows2 - 1) : null, c)
        break
      }
      case 'colLeft': commit(insertCol(wb.src, c), r, c); break               // 新空列在 c → 进新格
      case 'colRight': commit(insertCol(wb.src, c + 1), r, c + 1); break
      case 'colDel': commit(deleteCol(wb.src, c), r, Math.max(0, Math.min(c, t.cols - 2))); break
      case 'alL': commit(setAlign(wb.src, c, 'l'), r, c); break
      case 'alC': commit(setAlign(wb.src, c, 'c'), r, c); break
      case 'alR': commit(setAlign(wb.src, c, 'r'), r, c); break
      case 'tblDel': {                                                        // 删表：整块 + 尾换行，回主编辑器
        const end = wb.to < wb.view.state.doc.length ? wb.to + 1 : wb.to
        wb.view.dispatch({ changes: { from: wb.from, to: end } })
        wb.view.focus()
        break
      }
    }
  } catch { /* 宿主崩溃纪律 */ }
}
