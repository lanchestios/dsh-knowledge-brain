// src/editor/viewer/lightbox.ts
import { select } from 'd3-selection'
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
import s from '../editor.module.css'
import zoomOutSvg from '../../icon/zoom-out.svg?raw'
import zoomInSvg from '../../icon/zoom-in.svg?raw'
import expandSvg from '../../icon/expand.svg?raw'
import oneToOneSvg from '../../icon/one-to-one.svg?raw'
import closeSvg from '../../icon/close.svg?raw'

const MIN_SCALE = 0.1
const MAX_SCALE = 16
/** 工具栏 / 快捷键每按一次的倍率 */
const STEP = 1.25
/** 适应窗口时留的边：内容铺到视口的 90% */
const FIT_FILL = 0.9

function cloneVisual(content: HTMLElement): HTMLElement {
  const copy = content.cloneNode(true) as HTMLElement
  // cloneNode 不复制 canvas 位图。信息图可能以 canvas 输出，需逐张同步像素。
  const originals = [
    ...(content instanceof HTMLCanvasElement ? [content] : []),
    ...content.querySelectorAll<HTMLCanvasElement>('canvas'),
  ]
  const clones = [
    ...(copy instanceof HTMLCanvasElement ? [copy] : []),
    ...copy.querySelectorAll<HTMLCanvasElement>('canvas'),
  ]
  originals.forEach((canvas, i) => {
    const target = clones[i]
    if (!target) return
    target.width = canvas.width
    target.height = canvas.height
    try { target.getContext('2d')?.drawImage(canvas, 0, 0) } catch { /* 跨域/环境不支持时保留 DOM 副本 */ }
  })
  return copy
}

const num = (v: string | null | undefined): number => {
  const n = Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n > 0 && !/%$/.test(String(v)) ? n : 0
}

/** 内容的自然尺寸：svg 认 viewBox（mermaid 输出 width="100%" + 内联 max-width，量出来是正文里的小图）、
 *  再认像素 width/height；img 认 naturalWidth；canvas 认位图尺寸；外层容器（信息图）认里面第一张图 */
function naturalSize(el: Element): { w: number; h: number } {
  if (el instanceof SVGSVGElement) {
    const vb = (el.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] }
    const w = num(el.getAttribute('width')), h = num(el.getAttribute('height'))
    if (w && h) return { w, h }
  } else if (el instanceof HTMLImageElement) {
    if (el.naturalWidth && el.naturalHeight) return { w: el.naturalWidth, h: el.naturalHeight }
  } else if (el instanceof HTMLCanvasElement) {
    if (el.width && el.height) return { w: el.width, h: el.height }
  } else {
    const child = el.querySelector('svg, canvas, img')
    if (child) return naturalSize(child)
  }
  const r = el.getBoundingClientRect()
  return { w: r.width, h: r.height }
}

/** 把副本钉成自然尺寸：去掉把它压成小图的 max-width / 百分比宽，transform 才是唯一的缩放来源 */
function pinNatural(copy: HTMLElement, size: { w: number; h: number }): void {
  const target = copy instanceof SVGSVGElement || copy instanceof HTMLImageElement || copy instanceof HTMLCanvasElement
    ? copy
    : (copy.querySelector<HTMLElement>('svg, canvas, img') ?? copy)
  for (const el of new Set<Element>([copy, target])) {
    const st = (el as HTMLElement).style
    st.maxWidth = ''
    st.maxHeight = ''
    st.margin = '0'
    // 外层容器带着页内的内联高度（excalidraw ?h= 块的定高 + flex 居中）会把钉回自然尺寸的
    // svg 竖向挤出去：清掉高度，让容器包住 svg（svg 的尺寸由钉定值决定）
    st.height = ''
  }
  if (!size.w || !size.h) return
  if (target instanceof SVGSVGElement) {
    target.setAttribute('width', String(size.w))
    target.setAttribute('height', String(size.h))
  } else if (!(target instanceof HTMLCanvasElement)) {
    target.style.width = `${size.w}px`
    target.style.height = `${size.h}px`
  }
}

// 工具栏图标拷自 @univerjs/icons 1.43.2（MIT）：ZoomOut / ZoomIn / Expand / OneToOne / Close，构建期读入 svg 源码
const ICONS = { out: zoomOutSvg, in: zoomInSvg, fit: expandSvg, one: oneToOneSvg, close: closeSvg }

// 全屏查看（图片 / mermaid svg / 信息图）：打开即按窗口适应；底部工具栏缩小 / 百分比 / 放大 /
// 适应窗口 / 原始大小 / 关闭；滚轮（含触控板滚动）缩放、拖拽平移；快捷键 + = - 0，Esc 关闭。
// 不做双指捏合与双击复位（桌面端误触多、和滚轮缩放重复）；捏合手势仍拦下，免得整页被系统缩放。
// 内容在内部复制，原图不离开文档。
export function openLightbox(content: HTMLElement): void {
  const root = document.createElement('div')
  root.className = s.lightbox
  root.tabIndex = -1
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', '放大查看')
  const stage = document.createElement('div')
  stage.className = s.lbStage
  const inner = document.createElement('div')
  inner.className = s.lbInner
  const copy = cloneVisual(content)
  const size = naturalSize(content)
  pinNatural(copy, size)
  inner.append(copy)
  // 图（mermaid svg / 信息图）是透明底、按主题底色配的线条与字（亮色深灰线 + 无底标签）——直接放在
  // 深色遮罩上会糊成一片。垫一层主题底色（CSS 用 --wk-alias-bg-base，跟 body[data-ds-dark-theme]
  // 走，与 mermaid 选的主题同源）；照片自带底色，不加框
  if (!(content instanceof HTMLImageElement) && (content instanceof SVGSVGElement || content instanceof HTMLCanvasElement || content.querySelector('svg, canvas'))) {
    inner.dataset.paper = ''
  }
  stage.append(inner)

  const bar = document.createElement('div')
  bar.className = s.lbBar
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', '缩放')
  const button = (label: string, svg: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = s.lbBtn
    b.setAttribute('aria-label', label)
    b.title = label
    b.innerHTML = svg
    b.querySelector('svg')?.setAttribute('aria-hidden', 'true')
    b.addEventListener('click', onClick)
    return b
  }
  const zoomLabel = document.createElement('span')
  zoomLabel.className = s.lbZoom
  zoomLabel.dataset.zoom = ''
  zoomLabel.setAttribute('aria-live', 'polite')

  root.append(stage, bar)
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.append(root)
  root.focus({ preventScroll: true })

  const z: ZoomBehavior<HTMLDivElement, unknown> = zoom<HTMLDivElement, unknown>()
    .scaleExtent([MIN_SCALE, MAX_SCALE])
    .touchable(() => false)
    .on('zoom', (ev) => {
      // 不用 String(ev.transform)：那是 SVG 属性写法 translate(x,y)，CSS 里非零长度不带 px 无效、整条被丢
      const t = ev.transform
      inner.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
      zoomLabel.textContent = `${Math.round(ev.transform.k * 100)}%`
    })
  const stageSelection = select(stage)
  // 拖拽平移交给 d3；wheel 显式处理（Electron/macOS 触控板派发随版本而异），双击复位关掉
  stageSelection.call(z).on('wheel.zoom', null).on('dblclick.zoom', null)

  const clamp = (k: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, k))
  const center = (): [number, number] => [stage.clientWidth / 2, stage.clientHeight / 2]
  const scaleAt = (requestedScale: number, point: [number, number]) => {
    const current = zoomTransform(stage)
    const nextScale = clamp(requestedScale)
    const ratio = nextScale / current.k
    const next = zoomIdentity
      .translate(point[0] - (point[0] - current.x) * ratio, point[1] - (point[1] - current.y) * ratio)
      .scale(nextScale)
    stageSelection.call(z.transform, next)
  }
  /** 以倍率 k 把内容摆到舞台正中 */
  const placeCentered = (k: number) => {
    const kk = clamp(k)
    const x = (stage.clientWidth - size.w * kk) / 2
    const y = (stage.clientHeight - size.h * kk) / 2
    stageSelection.call(z.transform, zoomIdentity.translate(x, y).scale(kk))
  }
  const fitScale = () => {
    const sw = stage.clientWidth, sh = stage.clientHeight
    if (!size.w || !size.h || !sw || !sh) return 1
    return Math.min((sw * FIT_FILL) / size.w, (sh * FIT_FILL) / size.h)
  }
  const fit = () => placeCentered(fitScale())
  const actual = () => placeCentered(1)
  const zoomBy = (factor: number) => scaleAt(zoomTransform(stage).k * factor, center())

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onKey)
    root.remove()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(STEP) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / STEP) }
    else if (e.key === '0') { e.preventDefault(); fit() }
  }
  window.addEventListener('keydown', onKey)

  bar.append(
    button('缩小', ICONS.out, () => zoomBy(1 / STEP)),
    zoomLabel,
    button('放大', ICONS.in, () => zoomBy(STEP)),
    button('适应窗口', ICONS.fit, fit),
    button('原始大小', ICONS.one, actual),
    button('关闭', ICONS.close, close),
  )
  // 工具栏上的按下不算「点背景」
  bar.addEventListener('mousedown', (e) => e.stopPropagation())

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0) return
    e.preventDefault()
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(stage.clientHeight, 1)
        : 1
    const sensitivity = e.ctrlKey ? 0.01 : 0.002
    const factor = Math.exp(-e.deltaY * unit * sensitivity)
    const rect = stage.getBoundingClientRect()
    const point: [number, number] = Number.isFinite(e.clientX) && Number.isFinite(e.clientY)
      ? [e.clientX - rect.left, e.clientY - rect.top]
      : center()
    scaleAt(zoomTransform(stage).k * factor, point)
  }
  const swallow = (e: Event) => { e.preventDefault() }
  stage.addEventListener('wheel', onWheel, { passive: false })
  // 捏合不缩放，但要拦下：不拦 Electron 会把整页缩放
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) stage.addEventListener(t, swallow, { passive: false })
  stage.addEventListener('dblclick', swallow)
  // 只点背景（root/stage 自身）关；点内容是拖动，不关
  root.addEventListener('mousedown', (e) => { if (e.target === root || e.target === stage) close() })

  fit()
}
