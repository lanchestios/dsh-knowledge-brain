// src/client/components/ExcalidrawOverlay.tsx
// excalidraw 画布覆盖层：编辑态点图位弹出、全屏、懒加载重包（首屏不背 excalidraw 的字节）。
// 保存 = 后写覆盖（服务端白名单见 rpc.ts saveExcalidraw）；成功后 bump 版本让本页块定点换新
// （deco 的 refreshBlocksEffect 路径）。一切失败降级为文案，不外抛（宿主崩溃纪律）。
import { Component, lazy, Suspense, useEffect, useRef, useState, type LazyExoticComponent, type ReactNode } from 'react'
import { Button } from '../ui'
import { IconCheckMark, IconClose } from '../../icon'
import { createPortal } from 'react-dom'
import { bumpAssetVersion, loadExcalidrawLib } from '../../editor/blocks/excalidraw'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "overlay": "wk:fixed wk:inset-0 wk:z-1200 wk:flex wk:flex-col wk:bg-[var(--wk-alias-bg-layer-1)] wk:[--wk-alias-button-primary-fill:var(--wk-alias-link,_#2563eb)] wk:[--wk-alias-button-primary-hover:var(--wk-alias-link,_#2563eb)] wk:[--wk-alias-label-primary-foreground:#fff]",
  "bar": "wk:flex wk:items-center wk:justify-end wk:gap-2 wk:py-2 wk:px-3 wk:[border-bottom:0.5px_solid_var(--wk-alias-border-l4)] wk:flex-none wk:[&_button]:[all:unset] wk:[&_button]:cursor-pointer wk:[&_button]:py-1 wk:[&_button]:px-3 wk:[&_button]:rounded-[var(--wk-radius-sm)] wk:[&_button]:text-[13px] wk:[&_button]:text-[var(--wk-alias-text-primary)] wk:[&_button]:inline-flex wk:[&_button]:items-center wk:[&_button]:gap-[6px] wk:[&_button_svg]:block wk:[&_button:hover]:bg-[var(--wk-alias-bg-interactive-hover)] wk:[&_[data-primary='']]:bg-[var(--wk-alias-button-primary-bg,_#2563eb)] wk:[&_[data-primary='']]:text-[var(--wk-alias-button-primary-text,_#fff)] wk:[&_[role='alert']]:mr-auto wk:[&_[role='alert']]:overflow-hidden wk:[&_[role='alert']]:text-ellipsis wk:[&_[role='alert']]:whitespace-nowrap wk:[&_[role='alert']]:text-[var(--wk-alias-danger,_#d0453b)] wk:[&_[role='alert']]:text-[13px]",
  "err": "wk:py-10 wk:px-6 wk:text-center wk:text-[var(--wk-alias-danger,_#d0453b)] wk:text-sm",
  "canvas": "wk:flex-1 wk:min-h-0",
}

const EMPTY = { type: 'excalidraw', version: 2, source: 'dsh-knowledge-brain', elements: [] as unknown[], appState: { viewBackgroundColor: '#ffffff' } }

// 画布模块加载点（测试塞失败假货）；真身动态 import——esbuild 单产物下 import() 惰性求值，
// excalidraw 的 MB 级代码不在首屏解析执行
// 组件形态：函数组件或 memo/forwardRef 包装对象（Excalidraw 是 React.memo——typeof 是 object）。
// react.lazy 的类型收不进 memo 对象形态，loader 的返回面放 any、由运行期 isComponent 判定兜底
type AnyComponent = any
const isComponent = (d: unknown): d is AnyComponent =>
  typeof d === 'function' || (typeof d === 'object' && d !== null && '$$typeof' in d)
// 真身走独立 IIFE 件（src/excalidraw-standalone.ts，按需注入 script）；测试塞窄假货
let loadCanvas: () => Promise<{ default: AnyComponent }> = () =>
  loadExcalidrawLib().then((g) => ({ default: g.Excalidraw }))
export function setCanvasLoader(fn: () => Promise<{ default: AnyComponent }>) { loadCanvas = fn }

const makeCanvas = (): LazyExoticComponent<AnyComponent> => lazy(() => loadCanvas().then((m) => {
  const d = (m as { default?: unknown }).default
  if (!isComponent(d)) throw new Error('excalidraw 组件缺失')
  return { default: d as AnyComponent }
}))

// 懒加载失败/画布内渲染错（断网/包坏/场景数据异常）：覆盖层内降级文案 + 关闭，不炸宿主。
// 文案带上原始错误（getDerivedStateFromError 不能副作用，错误经 componentDidError 钩子转存再渲染）
class Boundary extends Component<{ onClose(): void; children: ReactNode }, { err: string | null }> {
  state = { err: null }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) } }
  componentDidCatch(e: unknown) { console.error('[wiki] excalidraw 画布加载/渲染失败', e) }
  render() {
    return this.state.err !== null
      ? <div data-wiki-ui="" className={s.err}>画布加载失败——请检查插件包是否完整。<br /><small>{this.state.err}</small><br /><Button size="sm" onClick={this.props.onClose}>关闭</Button></div>
      : this.props.children
  }
}

// mac desktop 顶栏让位：dsh-app:// 的 webview 铺满窗口、窗口红绿灯（应用操作按钮）悬浮在
// 内容左上——bar 左侧留 84px 避开；web 端 origin 是 http(s) 不让位。参数化协议只为测试
export function barLeftPad(protocol: string = typeof location !== 'undefined' ? location.protocol : ''): number {
  return protocol === 'dsh-app:' ? 84 : 0
}

export function ExcalidrawOverlay({ rel, url, dark, api, onClose, onSaved }: {
  rel: string
  url: string
  dark: boolean
  api: { saveExcalidraw(path: string, scene: unknown): Promise<{ ok: true }> }
  onClose(): void
  /** 保存成功（版本已 bump）后调——宿主据此 dispatch refreshBlocks 让图位换新 */
  onSaved?(): void
}) {
  // 场景三态：null = 取件未决（不开画布——Excalidraw 的 initialData 只在首挂消费，
  // 画布先挂空场景、后到的既有场景会被忽略，保存即把空场景覆盖上去＝静默毁图）
  const [scene, setScene] = useState<unknown | null>(null)
  // 每实例建 lazy：模块级 lazy 会 memo 第一次的加载结果，测试换 loader（或包热换）不生效。
  // 字体路径（EXCALIDRAW_ASSET_PATH）已在 loadExcalidrawLib 里统一设
  const [Canvas] = useState<AnyComponent>(() => makeCanvas())
  const [err, setErr] = useState('')
  // excalidraw api 柄（挂载后 scrollToContent 用；拿不到柄就保持默认位，不炸）
  const [exd, setExd] = useState<{ scrollToContent: (els: unknown[], o?: { fitToViewport?: boolean }) => void } | null>(null)
  const latest = useRef<{ elements: unknown[]; appState: Record<string, unknown> }>({ elements: EMPTY.elements, appState: EMPTY.appState })

  // 打开即滚到内容并适配缩放（真机实证：场景 appState 无 scroll/zoom，画布默认停在 (0,0)、
  // 内容钉左上角）。不走 initialData.scrollToContent 布尔位——excalidraw 0.18.1 在 devicePixelRatio>=2
  // 下该路径把内容滚出画布（探针实证 dpr2 nonwhite=0、内容 bbox 右下角）；挂载后走 api 方法
  // fitToViewport 在 dpr2 下居中正确（中心 1406,722 vs 期望 1400,777）。空场景不调（无内容可滚）
  useEffect(() => {
    if (!exd || scene === null) return
    const els = (scene as typeof EMPTY).elements
    if (!Array.isArray(els) || els.length === 0) return
    const t = setTimeout(() => { try { exd.scrollToContent(els, { fitToViewport: true }) } catch { /* 帧未就绪等异常不外抛 */ } }, 60)
    return () => clearTimeout(t)
  }, [exd, scene])

  // 取件失败按空场景兜底（文件还没放/网络抖都直接开画），不弹错
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        // 每次开层取件带时间戳：穿透任何缓存层（含桌面自定义协议），保证画布看到的是最新存盘
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now())
        if (res.ok) {
          const v = await res.json()
          if (!dead && v && Array.isArray(v.elements)) { setScene(v); return }
        }
      } catch { /* 空场景兜底 */ }
      if (!dead) setScene(EMPTY)
    })()
    return () => { dead = true }
  }, [url])

  // Esc 关层（不保存）。落点在画布里的 Esc 不算——excalidraw 拿它退出文字编辑/选中态，
  // 连层一起关会把这轮没保存的笔迹全丢掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as Element | null
      if (t?.closest?.('.excalidraw')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // appState 里的 collaborators 是运行时 Map——JSON 存盘变 {}，重开喂回 initialData 时
  // excalidraw 调 .forEach 即崩（真机「画布加载失败」根因）；存盘前剔除
  const cleanAppState = (as: Record<string, unknown>) => {
    const out = { ...as }
    delete out.collaborators
    return out
  }
  const save = () => {
    setErr('')
    // 裸 promise 不外抛（宿主崩溃纪律）：失败落在顶栏文案，覆盖层留着可重试（按钮不禁死）
    void api.saveExcalidraw(rel, { type: 'excalidraw', version: 2, source: 'dsh-knowledge-brain', elements: latest.current.elements, appState: cleanAppState(latest.current.appState) })
      .then(() => { bumpAssetVersion(rel); onSaved?.(); onClose() })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }

  return createPortal(
    <div data-wiki-ui="" className={s.overlay} data-excalidraw-overlay="">
      <div data-wiki-ui="" className={s.bar} style={{ paddingLeft: barLeftPad() || undefined }} aria-label={rel}>
        {err && <span role="alert">{err}</span>}
        <Button variant="default" size="sm" onClick={save}><IconCheckMark size={14} />保存</Button>
        <Button variant="ghost" size="sm" onClick={onClose}><IconClose size={14} />关闭</Button>
      </div>
      <div data-wiki-ui="" className={s.canvas}>
        {scene === null
          ? <div data-wiki-ui="" className={s.err}>载入场景…</div>
          : <Boundary onClose={onClose}>
              <Suspense fallback={<div data-wiki-ui="" className={s.err}>画布加载中…</div>}>
                <Canvas
                  theme={dark ? 'dark' : 'light'}   // 界面 chrome 跟宿主；场景画底恒纸色（设计裁定）
                  initialData={{
                    elements: (scene as typeof EMPTY).elements,
                    // 旧版存盘带上了 collaborators（Map 序列化成 {}）：喂回前剔除，防 .forEach 崩。
                    // 画布风格不在代码里注入（用户裁定）：K 编辑纸面 token 表写在 wiki-write/diagrams.md，
                    // 靠骨架与文档约束，场景元素各自带样式
                    appState: cleanAppState((scene as typeof EMPTY).appState),
                  }}
                  onChange={(elements: unknown[], appState: Record<string, unknown>) => { latest.current = { elements, appState } }}
                  excalidrawAPI={setExd}
                />
              </Suspense>
            </Boundary>}
      </div>
    </div>,
    document.body,
  )
}
