// src/editor/kernel/blockmenu.ts
// 原子块右键菜单：编辑器包自渲染（spec 裁定——io.menu 只认链接引用、宿主拿不到 EditorView、
// 删除必须走可撤销 transaction，挂宿主侧要跨包返工）。菜单挂 document.body、fixed 定位；
// 关闭：点外部 / Esc / 动作执行后，document 监听随之拆干净（挂载期累积监听 = 宿主崩纪律同类）。
// 一切回调 try 不住的地方（clipboard）降级为不动作，不外抛。
import type { EditorView } from '@codemirror/view'
import s from '../editor.module.css'

export interface AtomicMenuBlock { kind: string; from: number; to: number; src: string }

let menu: HTMLElement | null = null
const close = () => {
  if (!menu) return
  menu.remove()
  menu = null
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
}
const onDocDown = (e: MouseEvent) => {
  const t = e.target as Element | null
  if (menu && !(t?.closest?.('[data-blockmenu]'))) close()
}
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }

/** 收起当前菜单（surface destroy 时兜底，防菜单孤儿挂在 body 上） */
export function closeBlockMenu() { close() }

export function openBlockMenu(view: EditorView, block: AtomicMenuBlock, at: { x: number; y: number }, actions: { edit?(): void } = {}) {
  close()
  const root = document.createElement('div')
  root.className = s.blockMenu
  root.dataset.blockmenu = ''
  const item = (label: string, run: () => void, danger = false) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (danger) b.dataset.danger = ''
    b.onclick = (ev) => { ev.stopPropagation(); close(); run() }
    root.append(b)
  }
  // 执行前校验块仍原位（菜单开着时文档可能被改——surface 侧已在 docChanged 收菜单，
  // 这里是兜底）：src 对不上就不动作，绝不拿过期区间 dispatch（RangeError 不外抛，宿主崩纪律）
  const intact = () => {
    const end = Math.min(block.from + block.src.length, view.state.doc.length)
    return view.state.doc.sliceString(block.from, end) === block.src
      ? { from: block.from, to: Math.min(end + (block.kind === 'image' ? 0 : 1), view.state.doc.length) }   // 块级多带尾换行（在则带走）
      : null
  }
  if (block.kind === 'image') {
    item('复制引用', () => {
      // clipboard 在部分 webview/jsdom 里缺失、同步抛或异步拒（权限拒绝）：都降级为不动作，不炸宿主
      try { navigator.clipboard?.writeText(block.src)?.catch?.(() => {}) } catch { /* 降级 */ }
    })
  } else {
    item('编辑', () => {
      if (intact()) actions.edit?.()
    })
  }
  // 删除只删正文引用（spec：asset/ 文件不动，孤儿由 vault-tools check 警告兜底）；
  // block.to 已含尾换行，整行带走；selection 落删除点，Cmd+Z 可撤销
  item('删除引用', () => {
    const r = intact()
    if (r) view.dispatch({ changes: { from: r.from, to: r.to }, selection: { anchor: r.from } })
  }, true)
  root.style.left = at.x + 'px'
  root.style.top = at.y + 'px'
  document.body.append(root)
  menu = root
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey, true)
}
