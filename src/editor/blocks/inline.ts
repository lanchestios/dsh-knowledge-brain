// src/editor/blocks/inline.ts
import { WidgetType, type EditorView } from '@codemirror/view'
import type { BatchStore } from './server'
import { remeasure } from './measure'
import type { EditorIo } from '../io'
import s from '../editor.module.css'

const IMG = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)[ \t]*$/

export class ImageWidget extends WidgetType {
  constructor(readonly md: string, readonly io: EditorIo) { super() }
  eq(o: ImageWidget) { return o.md === this.md }
  // 事件放行给编辑器（WidgetType 默认 ignoreEvent=true 会把事件全吞）：
  // 原子块选中（单击/右键菜单）在 surface 的 handlers 里认 data-atomic
  ignoreEvent() { return false }
  toDOM() {
    const w = document.createElement('span')
    w.className = s.inlineImg
    w.dataset.atomic = 'image'   // 原子块路由标记（surface 单击选中/右键菜单认这个）
    const m = IMG.exec(this.md.trim())
    if (m) {
      // 宿主 resolveAsset 同步回调，异常兜住（宿主崩溃纪律：widget toDOM 不抛裸异常）
      let r: ReturnType<NonNullable<EditorIo['resolveAsset']>> = null
      try { r = this.io.resolveAsset?.(m[2]) ?? null } catch { r = null }
      const img = document.createElement('img')
      img.src = r?.url ?? m[2]
      img.alt = m[1]
      img.title = r?.title ?? m[3] ?? m[2]      // hover 元信息（spec 阅读1）
      if (r?.title) img.dataset.path = r.title
      img.onload = () => remeasure(img)   // 解码定高是异步的，heightmap 需要再测
      w.append(img)
    } else w.textContent = this.md
    return w
  }
}

// 行内公式：整段 $...$ 交服务端（与阅读页同 KaTeX），取 <p> 内层
export class MathWidget extends WidgetType {
  constructor(readonly md: string, readonly batch: BatchStore) { super() }
  eq(o: MathWidget) { return o.md === this.md }
  toDOM() {
    const el = document.createElement('span')
    el.className = s.math
    el.textContent = this.md                 // 先源码占位；html 回来后替换，失败保持源码
    this.batch.get(this.md).then((html) => {
      const t = document.createElement('template')
      t.innerHTML = html
      const p = t.content.querySelector('p')
      el.replaceChildren(...Array.from((p ?? t.content).childNodes))
      remeasure(el)
    }).catch(() => {})
    return el
  }
}

// 任务框：点击翻转 [ ] ↔ [x]（from 来自装饰位置，+1 是框内字符）
export class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly checked: boolean) { super() }
  eq(o: TaskWidget) { return o.from === this.from && o.checked === this.checked }
  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.checked = this.checked
    el.className = s.task
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return el
  }
  ignoreEvent() { return false }
}

export class HrWidget extends WidgetType {
  eq() { return true }
  toDOM() { const d = document.createElement('span'); d.className = s.hrView; return d }
}
