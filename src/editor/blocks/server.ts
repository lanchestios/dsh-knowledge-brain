import { registerBlock, type BlockViewCtx } from './registry'
import { remeasure } from './measure'
import { themeEmbeds } from '../kernel/embed-theme'
import s from '../editor.module.css'

// 页级批量供给：30ms 收集窗内所有未命中 src，去重后一次 io.renderBlocks；
// 结果回填缓存。全路径 catch（宿主崩溃纪律：失败兜底空串，widget 退源码显示）。
export class BatchStore {
  private cache = new Map<string, Promise<string>>()
  private pending = new Map<string, (h: string) => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private fetcher: (srcs: string[]) => Promise<string[]>, private delayMs = 30) {}

  get(src: string): Promise<string> {
    const hit = this.cache.get(src)
    if (hit) return hit
    const p = new Promise<string>((resolve) => this.pending.set(src, resolve))
    this.cache.set(src, p)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delayMs)
    return p
  }

  private flush() {
    const srcs = [...this.pending.keys()]
    const rs = srcs.map((x) => this.pending.get(x)!)
    this.pending.clear()
    // fetcher 同步抛也要兜住（宿主崩溃纪律：包内不允许裸异步逃逸 setTimeout 回调）
    try {
      this.fetcher(srcs).then((htmls) => { srcs.forEach((x, i) => rs[i](htmls[i] ?? '')) }).catch((err) => {
        console.warn('[wiki] renderBlocks RPC 失败', err)
        srcs.forEach((x, i) => { this.cache.delete(x); rs[i]('') })
      })
    } catch (err) {
      console.warn('[wiki] renderBlocks 同步抛错', err)
      srcs.forEach((x, i) => { this.cache.delete(x); rs[i]('') })
    }
  }
}

// 服务端块：占位先显示源码，html 回来后整块替换（html 为空 = 渲染失败，保持源码）。
// 编辑态给 editShield：嵌入件 iframe 屏蔽指针（点击/滚动进不了嵌入页，聚焦回源码编辑），
// 阅读态正常交互（spec §3）。
export const serverBlock = {
  // interactive：事件放行给编辑器事件链（WidgetType 默认 ignoreEvent=true 全吞）——
  // 原子块选中（单击选中/双击进源码/右键菜单）在 surface 的 handlers 里认 data-atomic。
  // 阅读态的块内双链点击（data-wiki-id → openAt）同样走这条链
  interactive: true,
  build(src: string, _info: string, ctx: BlockViewCtx) {
    const wrap = document.createElement('div')
    wrap.className = s.blockView
    if (ctx.mode === 'edit') wrap.classList.add(s.editShield)
    const fb = document.createElement('pre')
    fb.className = s.blockFallback
    fb.textContent = src
    wrap.append(fb)
    ctx.batch.get(src).then((html) => {
      if (!html) { console.warn('[wiki] 块渲染为空，保持源码', src.slice(0, 120)); return }
      const v = document.createElement('div')
      v.className = s.blockHtml
      v.innerHTML = html
      themeEmbeds(v)      // 嵌入件进 DOM 前带上当前明暗，首帧就对（embed-theme.ts）
      wrap.replaceChildren(v)
      remeasure(wrap)   // 换高必须告知 heightmap，否则点击/光标映射按旧高漂移
    }).catch(() => {})
    return wrap
  },
} satisfies import('./registry').BlockViewSpec

let registered = false
export function registerServerKinds() {
  if (registered) return
  registered = true
  // 包一层挂 data-atomic=<kind>（surface 原子块路由认这个根标记；表格 edit 态被 registerTableKind 覆盖，read 态多余标记无害——路由只认编辑态）
  for (const k of ['code', 'table', 'mathblock', 'embed', 'html']) registerBlock(k, {
    ...serverBlock,
    build: (src, info, ctx) => { const d = serverBlock.build(src, info, ctx); d.dataset.atomic = k; return d },
  })
}
