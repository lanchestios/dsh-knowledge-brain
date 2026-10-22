// src/editor/blocks/mermaid.ts
import mermaid from 'mermaid'
import { registerBlock } from './registry'
import { remeasure } from './measure'
import { registerInfographic } from './infographic'
import s from '../editor.module.css'

let seq = 0

// 渲染函数可注入（测试塞假货）；真实实现与旧 article.ts drawMermaid 同语义：
// startOnLoad:false + strict + suppressErrorRendering，失败清残留临时容器
export class MermaidQueue {
  private q: Promise<void> = Promise.resolve()
  constructor(private renderFn: (el: HTMLElement, id: string, code: string, theme: 'dark' | 'neutral') => Promise<void>) {}

  draw(el: HTMLElement, code: string, dark: boolean): Promise<void> {
    this.q = this.q.then(() => this.one(el, code, dark)).catch((e) => console.error('[dsh-knowledge-brain] mermaid', e))
    return this.q
  }

  private async one(el: HTMLElement, code: string, dark: boolean) {
    const theme: 'dark' | 'neutral' = dark ? 'dark' : 'neutral'   // 字面量类型：mermaid.initialize 的 theme 是字面量联合，不能放宽成 string
    if (el.dataset.theme === theme && el.dataset.src === code) return
    delete el.dataset.lightbox
    el.dataset.src = code
    const id = 'wk-mmd-' + (++seq)
    try {
      await this.renderFn(el, id, code, theme)
      el.dataset.theme = theme
      el.dataset.lightbox = ''
    } catch (err) {
      delete el.dataset.lightbox
      el.innerHTML = ''
      const pre = document.createElement('pre')
      pre.className = s.mermaidErr
      pre.textContent = 'mermaid 语法错误：' + String(err instanceof Error ? err.message : err) + '\n\n' + code
      el.append(pre)
      el.dataset.theme = theme
    } finally {
      for (const leftover of [document.getElementById(id), document.getElementById('d' + id)]) if (leftover && !el.contains(leftover)) leftover.remove()
      remeasure(el)   // svg/报错 pre 的高度与源码占位不同，heightmap 需要再测
    }
  }
}

// mermaid.render 不给容器时，量尺寸的临时 div 直接挂到 body 末尾、留在文档流里（实测 150px 上下）：
// 渲染那一两帧页面长出滚动条，整个应用窄 5px，编辑/查看切换重建所有图时顶栏左右抖。
// 给它一个脱离文档流、零高、隐藏的容器（getBBox 只要求已挂载、非 display:none），渲染完连容器收走
export const mermaidQueue = new MermaidQueue(async (el, id, code, theme) => {
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', suppressErrorRendering: true })
  const scratch = document.createElement('div')
  scratch.setAttribute('aria-hidden', 'true')
  Object.assign(scratch.style, { position: 'fixed', top: '0', left: '0', width: (el.clientWidth || 800) + 'px', height: '0px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' })
  document.body.append(scratch)
  try {
    const { svg } = await mermaid.render(id, code, scratch)
    el.innerHTML = svg
  } finally {
    scratch.remove()
  }
})

// 围栏剥壳（mermaid/infographic 共用；infographic.ts 反向 import 本文件，函数只在运行期调用，环安全）
export const stripFence = (src: string) => src.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/, '').replace(/\n {0,3}(`{3,}|~{3,})[ \t]*$/, '').replace(/\n$/, '')

let registered = false
export function registerViewerKinds() {
  if (registered) return
  registered = true
  registerBlock('mermaid', {
    build(src, _info, ctx) {
      const d = document.createElement('div')
      d.className = s.blockView   // 挂块视图类：灯箱点击（closest .blockView）与块间距规则都靠它
      d.dataset.diagram = ''      // 历史标记（lightbox/样式侧仍认）
      d.dataset.atomic = _info || 'diagram'   // 原子块路由标记（值 = 围栏 info：mermaid/infographic）
      d.dataset.mode = ctx.mode   // 编辑态不给放大镜光标（全屏只在阅读态）
      const code = stripFence(src)
      const fb = document.createElement('pre')
      fb.className = s.blockFallback
      fb.textContent = code
      d.append(fb)
      void mermaidQueue.draw(d, code, ctx.dark)
      return d
    },
    interactive: true,
  })
  registerInfographic()
}
