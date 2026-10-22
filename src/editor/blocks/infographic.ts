// src/editor/blocks/infographic.ts
import { Infographic } from '@antv/infographic'
import { registerBlock } from './registry'
import { remeasure } from './measure'
import { stripFence } from './mermaid'
import s from '../editor.module.css'

const infograms = new WeakMap<HTMLElement, Infographic>()

function draw(el: HTMLElement, code: string, dark: boolean) {
  const theme = dark ? 'dark' : 'light'
  delete el.dataset.lightbox
  // 销毁旧实例/清容器也在 try 内：实例坏掉时走原位报错，toDOM 不裸抛
  try {
    infograms.get(el)?.destroy()
    el.innerHTML = ''
    const ig = new Infographic({ container: el, width: '100%', editable: false, theme })
    ig.render(code)
    infograms.set(el, ig)
    el.dataset.lightbox = ''
  } catch (err) {
    delete el.dataset.lightbox
    const pre = document.createElement('pre')
    pre.className = s.mermaidErr
    pre.textContent = '信息图语法错误：' + String(err instanceof Error ? err.message : err) + '\n\n' + code
    el.append(pre)
  }
  remeasure(el)   // 实例定高可能晚于挂载测量，补测
}

let registered = false
export function registerInfographic() {
  if (registered) return
  registered = true
  registerBlock('infographic', {
    build(src, _info, ctx) {
      const d = document.createElement('div')
      d.className = s.blockView   // 挂块视图类：灯箱点击（closest .blockView + canvas）与块间距规则都靠它
      d.dataset.diagram = ''      // 编辑态点图换回源码（surface mousedown）认这个
      d.dataset.mode = ctx.mode   // 编辑态不给放大镜光标（全屏只在阅读态）
      const code = stripFence(src)
      const fb = document.createElement('pre')
      fb.className = s.blockFallback
      fb.textContent = code
      d.append(fb)
      draw(d, code, ctx.dark)
      return d
    },
    // widget 被移除时销毁实例：@antv 可能挂文档级监听，只靠 GC 会累积
    destroy(dom) {
      try { infograms.get(dom)?.destroy() } catch { /* 实例已坏也不能炸宿主 */ }
      infograms.delete(dom)
    },
    interactive: true,
  })
}
