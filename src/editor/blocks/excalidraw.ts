// src/editor/blocks/excalidraw.ts
// excalidraw 图位块：asset/ 下 .excalidraw 场景 → 静态 svg 嵌进正文。
// 画底恒纸色（exportWithDarkMode:false——场景颜色是人手挑的，不跟宿主夜间反转，按普通图片对待）。
// 场景文件在编辑态由覆盖层重写（客户端 ExcalidrawOverlay），写完 bumpAssetVersion，
// 本块靠 registry 的 stale 钩子判版本重建（src 没变也要换新图）。
import { registerBlock } from './registry'
import { remeasure } from './measure'
import { excalidrawRef } from '../kernel/blocks'
import s from '../editor.module.css'

// 版本表：rel → 保存/变更次数。build 把当前值记进 dom.dataset.v，stale 对比当前值。
// 客户端（WikiEditor / ExcalidrawOverlay）直连本模块调 bump；编辑器包不依赖客户端。
const versions = new Map<string, number>()
export function assetVersion(rel: string): number { return versions.get(rel) ?? 0 }
export function bumpAssetVersion(rel: string): void { versions.set(rel, (versions.get(rel) ?? 0) + 1) }

// 独立件加载器：按需注入 /api/wiki.exfonts/excalidraw.iife.js（build 第三任务产物），
// 注入前把宿主 react 三面塞进 window 供件内 shim 读。promise 缓存单次加载。
import * as ReactNS from 'react'
import * as ReactDOMNS from 'react-dom'
import * as JSXRT from 'react/jsx-runtime'

export interface ExcalidrawLib { Excalidraw: unknown; exportToSvg: (opts: unknown) => Promise<{ outerHTML: string }> }
let libLoading: Promise<ExcalidrawLib> | null = null
export function loadExcalidrawLib(src = '/api/wiki.exfonts/excalidraw.iife.js'): Promise<ExcalidrawLib> {
  if (libLoading) return libLoading
  const w = window as unknown as Record<string, unknown>
  // 字体走本插件路由（src/host/exfonts.ts），不落 excalidraw 默认的 esm.sh CDN 回退（断网即失手绘体）。
  // 在这里设而不是只在覆盖层设：静态渲染（exportToSvg）也要字体，且必须先于任何 FontFace 构造
  if (w.EXCALIDRAW_ASSET_PATH !== '/api/wiki.exfonts/') w.EXCALIDRAW_ASSET_PATH = '/api/wiki.exfonts/'
  // shim 的读取面（src/standalone/）：必须在 script 求值前就位
  w.__WikiExdReact = ReactNS
  w.__WikiExdReactDOM = ReactDOMNS
  w.__WikiExdJSXRT = JSXRT
  libLoading = new Promise((resolve, reject) => {
    // 画布 UI 样式表与件同源同路由：注入 script 前先挂 <link>（幂等：已挂过不重复）。
    // link 失败不 reject——样式加载失败只影响观感，画布功能仍可用
    const cssHref = src.replace(/excalidraw\.iife\.js$/, 'excalidraw.iife.css')
    if (!document.querySelector(`link[rel="stylesheet"][href="${cssHref}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = cssHref
      document.head.append(link)
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => {
      const g = w.WikiExcalidraw as ExcalidrawLib | undefined
      // Excalidraw 是 React.memo——typeof object；判定看存在性与 exportToSvg
      if (g && g.Excalidraw != null && typeof g.exportToSvg === 'function') resolve(g)
      else { libLoading = null; reject(new Error('excalidraw 独立件缺组件')) }
    }
    s.onerror = () => { libLoading = null; reject(new Error('excalidraw 独立件加载失败')) }
    document.head.append(s)
  })
  return libLoading
}

// 场景 → svg 字符串。可注入（测试塞假货）；真实实现走独立件（重包不进主 bundle）。
// 失败抛错由块降级，绝不让它逃出去炸宿主。
type ExcalidrawRenderer = (scene: { elements: unknown[]; appState?: Record<string, unknown> }) => Promise<string>
let renderer: ExcalidrawRenderer = async (scene) => {
  const lib = await loadExcalidrawLib()
  const svg = await lib.exportToSvg({
    elements: scene.elements,
    appState: scene.appState,
    exportWithDarkMode: false,   // 画底恒纸色（见文件头注释）
  })
  return svg.outerHTML
}
export function setExcalidrawRenderer(fn: ExcalidrawRenderer) { renderer = fn }

// svg 落位：默认等比压栏宽（exportToSvg 带固有 width/height 属性，不压会把正文撑破），
// 高度随内容宽高比自适应、超高自动封顶（75vh——竖长图不顶满视口），封顶后内容 contain 居中不压扁；
// 带 ?h= 时块定高、svg contain 居中（像 html 嵌入件的可配高度，手动覆盖优先）
const placeSvg = (d: HTMLDivElement, h: string | null) => {
  const svg = d.querySelector('svg')
  if (!svg) return
  if (h) {
    d.style.height = h + 'px'
    d.style.display = 'flex'
    d.style.alignItems = 'center'
    d.style.justifyContent = 'center'
    svg.style.maxWidth = '100%'
    svg.style.maxHeight = '100%'
  } else {
    svg.style.width = '100%'
    svg.style.height = 'auto'
    svg.style.maxHeight = '75vh'
    svg.style.objectFit = 'contain'
  }
}

const note = (msg: string): HTMLElement => {
  const pre = document.createElement('pre')
  pre.className = s.exdNote
  pre.textContent = msg
  return pre
}

let registered = false
export function registerExcalidraw() {
  if (registered) return
  registered = true
  registerBlock('excalidraw', {
    build(src, _info, ctx) {
      const d = document.createElement('div')
      d.className = s.blockView
      const rel = excalidrawRef(src)
      if (!rel) { d.append(note('excalidraw 引用不合法（应为 asset/ 下的 .excalidraw）')); return d }
      const h = /\?h=(\d+)/.exec(src)?.[1] ?? null   // 可选定高（同 html 嵌入件纪律）
      d.dataset.excalidraw = rel
      d.dataset.atomic = 'excalidraw'   // 原子块路由标记（surface 单击选中/双击开画布认这个）
      d.dataset.mode = ctx.mode
      d.dataset.v = String(assetVersion(rel))
      d.append(note('excalidraw 图加载中…'))
      // 取件-渲染链全程 try 住：网络、JSON、excalidraw 渲染任何一步坏都落占位，不外抛
      void (async () => {
        try {
          const url = ctx.io?.resolveAsset?.(rel)?.url
          if (!url) throw new Error(`excalidraw 引用不在 asset/ 下：${rel}`)
          // 取件带版本戳：路由虽 no-store，桌面 dsh-app:// 自定义协议层可能另有缓存——
          // 保存后重建必须拿到新场景，戳随 assetVersion 走（每次 bump 换 URL，任何缓存层都穿透）
          const stamped = url + (url.includes('?') ? '&' : '?') + '_v=' + assetVersion(rel)
          const res = await fetch(stamped)
          if (!res.ok) throw new Error(`图文件不存在：${rel}`)
          let scene: unknown
          try { scene = await res.json() } catch { throw new Error(`场景文件损坏：${rel}`) }
          const elements = (scene as { elements?: unknown } | null)?.elements
          if (!Array.isArray(elements)) throw new Error(`场景文件损坏：${rel}`)
          if (elements.length === 0) {
            d.replaceChildren(note(ctx.mode === 'edit' ? '未画——点此开画布' : '未画'))
            return
          }
          const html = await renderer(scene as { elements: unknown[]; appState?: Record<string, unknown> })
          d.innerHTML = html
          placeSvg(d, h)
          d.dataset.lightbox = ''   // 阅读态点图进灯箱（surface 通用 data-lightbox 路径）
        } catch (err) {
          delete d.dataset.lightbox
          d.replaceChildren(note(err instanceof Error ? err.message : String(err)))
        } finally {
          if (d.dataset.v !== String(assetVersion(rel))) d.dataset.v = String(assetVersion(rel))
          remeasure(d)   // svg/占位高度与加载占位不同，heightmap 要再测
        }
      })()
      return d
    },
    // src 没变但场景文件被重写（版本 bump）→ 陈旧重建；正常打字/换模式不重建
    stale(dom) { return dom.dataset.v !== String(assetVersion(dom.dataset.excalidraw ?? '')) },
    interactive: true,
  })
}
