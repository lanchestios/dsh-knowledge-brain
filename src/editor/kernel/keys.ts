// src/editor/kernel/keys.ts
import { EditorSelection } from '@codemirror/state'
import { type Command, type EditorView } from '@codemirror/view'

// ⌘B/⌘I/⌘K：从旧 src/client/editor/keys.ts 的 wrap/linkify 移植——同一套绝对坐标
// 逻辑（两侧同标记则去、否则包；空选区插一对），作用对象从「块内源码」换成「整篇文档」。
function wrap(src: string, s: number, e: number, mk: string) {
  if (src.slice(s - mk.length, s) === mk && src.slice(e, e + mk.length) === mk)
    return { src: src.slice(0, s - mk.length) + src.slice(s, e) + src.slice(e + mk.length), s: s - mk.length, e: e - mk.length }
  return { src: src.slice(0, s) + mk + src.slice(s, e) + mk + src.slice(e), s: s + mk.length, e: e + mk.length }
}
const linkify = (src: string, s: number, e: number) => {
  const t = `[${src.slice(s, e)}]()`
  return { src: src.slice(0, s) + t + src.slice(e), s: s + t.length - 1, e: s + t.length - 1 }
}
function apply(view: EditorView, f: (src: string, s: number, e: number) => { src: string; s: number; e: number }): boolean {
  const { from, to } = view.state.selection.main
  const r = f(view.state.doc.toString(), from, to)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.src }, selection: EditorSelection.range(r.s, r.e) })
  return true
}
export const toggleBold: Command = (view) => apply(view, (src, s, e) => wrap(src, s, e, '**'))
export const toggleItalic: Command = (view) => apply(view, (src, s, e) => wrap(src, s, e, '*'))
export const makeLink: Command = (view) => apply(view, linkify)

// ↓/↑ 落进空白行继续走：空行在 WYSIWYG 里只承担块间距（被 CSS 压成 0/0.45 行高），
// 方向键一步步踩进去会让隐形行展开成可见光标行（标题与正文之间的「中间空行」体验）。
// 一次跨过连续空行到最近的非空行；文档边界/无可走返回 false 交默认行为。
import { EditorState } from '@codemirror/state'

const lineBlank = (state: EditorState, pos: number) => state.doc.lineAt(pos).text.trim() === ''

// 按文档行移动（列保真、夹在行内）：不用 @codemirror/commands 的 cursorLineDown/Up——
// 它们走 coordsAtPos 求目标列，jsdom 无 getClientRects 会炸；自实现也去掉了 goal column
// 粘滞（跨短行不记忆列），对「跨空行到最近非空行」的场景无所谓
const moveDocLine = (view: EditorView, dir: 1 | -1) => {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.head)
  const target = line.number + dir
  if (target < 1 || target > view.state.doc.lines) return false
  const tl = view.state.doc.line(target)
  view.dispatch({ selection: { anchor: Math.min(tl.from + (sel.head - line.from), tl.to) } })
  return true
}

export const skipBlankDown: Command = (view) => {
  const before = view.state.selection.main.head
  if (!moveDocLine(view, 1)) return false
  for (let i = 0; i < 10 && lineBlank(view.state, view.state.selection.main.head); i++) {
    if (!moveDocLine(view, 1)) break
  }
  return view.state.selection.main.head !== before
}
export const skipBlankUp: Command = (view) => {
  const before = view.state.selection.main.head
  if (!moveDocLine(view, -1)) return false
  for (let i = 0; i < 10 && lineBlank(view.state, view.state.selection.main.head); i++) {
    if (!moveDocLine(view, -1)) break
  }
  return view.state.selection.main.head !== before
}
