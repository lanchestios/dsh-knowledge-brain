import { Button } from '../ui'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Menu } from '../ui'
import { tabKey, type Route, type TabsNavStore } from '../lib/nav'
import { cx } from '../lib/cx'
import { clampDx, shiftOf, slideTarget, type Span } from './tabDrag'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "bar": "wk:flex-none wk:flex wk:items-end wk:gap-[3px] wk:h-[38px] wk:pt-[6px] wk:pr-2 wk:pb-0 wk:pl-2 wk:bg-[var(--wk-alias-bg-layer-1)] wk:[border-bottom:1px_solid_var(--wk-alias-border-l2)] wk:overflow-hidden",
  "tab": "wk-reader-tabsbar-tab wk:flex wk:items-center wk:gap-[6px] wk:py-0 wk:px-[10px] wk:h-[30px] wk:[flex:0_1_12em] wk:min-w-10 wk:max-w-[16em] wk:[container-type:inline-size] wk:box-border wk:[border:1px_solid_var(--wk-alias-border-l2)] wk:[border-bottom:0] wk:rounded-[8px_8px_0_0] wk:bg-[var(--wk-alias-fill-secondary)] wk:cursor-pointer wk:whitespace-nowrap wk:text-[13px] wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground wk:select-none wk:touch-pan-y wk:[&:hover]:text-foreground wk:[@container_(max-width:_64px)]:[&:not(:hover)_.wk-reader-tabsbar-x]:hidden",
  "on": "wk-reader-tabsbar-on wk:flex wk:items-center wk:gap-[6px] wk:py-0 wk:px-[10px] wk:h-8 wk:[flex:0_1_12em] wk:min-w-10 wk:max-w-[16em] wk:[container-type:inline-size] wk:box-border wk:[border:1px_solid_var(--wk-alias-border-l2)] wk:[border-bottom:0] wk:rounded-[8px_8px_0_0] wk:bg-background wk:cursor-pointer wk:whitespace-nowrap wk:text-[13px] wk:leading-normal wk:font-sans wk:font-semibold wk:text-foreground wk:relative wk:-mb-[1px] wk:z-1 wk:border-[var(--wk-alias-border-l3)] wk:select-none wk:touch-pan-y wk:[&::after]:content-[''] wk:[&::after]:absolute wk:[&::after]:left-0 wk:[&::after]:right-0 wk:[&::after]:-bottom-[1px] wk:[&::after]:h-[2px] wk:[&::after]:bg-background",
  "name": "wk:[flex:1_1_auto] wk:min-w-0 wk:overflow-hidden wk:text-ellipsis",
  "x": "wk-reader-tabsbar-x wk:border-0 wk:bg-transparent wk:py-0 wk:px-[2px] wk:rounded-[4px] wk:cursor-pointer wk:text-muted-foreground wk:text-[13px] wk:leading-[1] wk:font-sans wk:font-normal wk:[&:hover]:bg-[var(--wk-alias-fill-secondary)] wk:[&:hover]:text-foreground",
  "slide": "wk:[&_>_.wk-reader-tabsbar-tab]:[transition:transform_.18s_ease] wk:[&_>_.wk-reader-tabsbar-on]:[transition:transform_.18s_ease] wk:[&_>_.wk-reader-tabsbar-lift]:[transition:none] wk:[&_>_.wk-reader-tabsbar-lift]:relative wk:[&_>_.wk-reader-tabsbar-lift]:z-3 wk:[&_>_.wk-reader-tabsbar-lift]:cursor-grabbing wk:[&_>_.wk-reader-tabsbar-lift]:bg-background wk:[&_>_.wk-reader-tabsbar-lift]:border-[var(--wk-alias-border-l3)] wk:[&_>_.wk-reader-tabsbar-lift]:text-foreground wk:[&_>_.wk-reader-tabsbar-lift]:[box-shadow:0_8px_24px_rgba(20,_30,_50,_.16),_0_2px_6px_rgba(20,_30,_50,_.08)] wk:motion-reduce:[&_>_.wk-reader-tabsbar-tab]:[transition:none] wk:motion-reduce:[&_>_.wk-reader-tabsbar-on]:[transition:none]",
  "lift": "wk-reader-tabsbar-lift",
}

// tab 条（只装文档；停在文档 tab 上才显示，只开一篇也显示，停在导航位不显示）：标题 + 关闭 ×。标题先按路由给占位
// （首页/书架/文档表…），文档类（页/原始文档/章）数据到了由所在 TabPane 上报真标题。
// tab 多了一起压窄（不滚动），可按住左右拖动排序（实时让位），右键：关闭 / 关闭其他 / 关闭右侧 / 复制路径
const FALLBACK: Record<Route['kind'], string> = {
  kb: '首页', page: '页', graph: '图谱', tag: '标签', raw: '文档', books: '书架', book: '书',
  chapter: '章', documents: '文档', drafts: '草稿', activity: '动态',
}
export function tabLabel(r: Route): string {
  if (r.kind === 'tag') return `标签 ${r.tag}`
  if (r.kind === 'page') return r.id.split('/').pop()?.replace(/\.md$/i, '') || FALLBACK.page
  if (r.kind === 'raw') return r.path.split('/').pop()?.replace(/\.md$/i, '') || FALLBACK.raw
  if (r.kind === 'book') return r.name
  if (r.kind === 'chapter') return r.title || r.id.split('/').pop() || FALLBACK.chapter
  return FALLBACK[r.kind]
}

/** tab 的库内路径（右键「复制路径」）：页 / 文档看路由；章节看 pane 上报的路径表，没到为 null；
 *  其余路由不会是 tab（导航页在导航位），为 undefined */
export function pathOf(r: Route, paths: ReadonlyMap<string, string>): string | null | undefined {
  if (r.kind === 'page') return r.id
  if (r.kind === 'raw') return r.path
  if (r.kind === 'chapter') return paths.get(tabKey(r)) ?? null
  return undefined
}

type Ctx = { i: number; x: number; y: number }

export function TabsBar({ store }: { store: TabsNavStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.get)
  const bar = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<Ctx | null>(null)
  // 指针拖动：按下记起点，挪过 4px 才算拖（之前松手是普通点击）。拖动中被拖 tab 跟手、夹在中间的
  // tab 让位（只动 transform，spans 在开始时量一次）；松手吸附 0.14s 后落到 store。监听挂 document：
  // 重渲染时 tab 节点可能换掉。拖完浏览器会补一个 click，用 swallow 吞掉
  const drag = useRef<{ i: number; x0: number; on: boolean; spans: Span[]; els: HTMLElement[]; w: number; to: number; off: () => void } | null>(null)
  const swallow = useRef(false)
  const [lifted, setLifted] = useState<number | null>(null)
  useEffect(() => () => drag.current?.off(), [])
  const clear = (els: HTMLElement[]) => els.forEach((el) => { el.style.transform = ''; el.style.transition = '' })
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    if (e.button !== 0 || drag.current) return
    swallow.current = false
    const move = (ev: PointerEvent | MouseEvent) => {
      const d = drag.current
      if (!d) return
      const dx = ev.clientX - d.x0
      if (!d.on) {
        if (Math.abs(dx) < 4) return
        d.on = true
        d.els = [...(bar.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
        d.spans = d.els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width } })
        d.w = d.spans.length > 1 ? d.spans[1].left - d.spans[0].left : d.spans[0].width
        setLifted(d.i)
      }
      d.to = slideTarget(d.spans, d.i, dx)
      d.els.forEach((el, k) => { const sh = k === d.i ? clampDx(d.spans, d.i, dx) : shiftOf(d.i, d.to, k, d.w); el.style.transform = sh ? `translateX(${sh}px)` : '' })
    }
    const end = (commit: boolean) => {
      const d = drag.current
      if (!d) return
      d.off()
      drag.current = null
      if (!d.on) return
      swallow.current = true
      const to = commit ? d.to : d.i
      const el = d.els[d.i]
      const land = d.spans[to].left - d.spans[d.i].left
      if (!commit) d.els.forEach((x, k) => { if (k !== d.i) x.style.transform = '' })
      el.style.transition = 'transform .14s ease'
      el.style.transform = land ? `translateX(${land}px)` : ''
      setTimeout(() => {
        clear(d.els)
        setLifted(null)
        if (to !== d.i) store.moveTab(d.i, to)
      }, 140)
    }
    const up = () => end(true)
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(false) }
    const cancel = () => end(false)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', key)
    drag.current = { i, x0: e.clientX, on: false, spans: [], els: [], w: 0, to: i, off: () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', key)
    } }
  }
  if (snap.active < 0 || !snap.tabs.length) return null
  // 键盘切 tab：左右方向键循环，焦点跟着挪到新活动 tab（漫游 tabIndex：只有活动 tab 进 tab 序）
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>, i: number) => {
    const n = snap.tabs.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : -1
    if (to < 0) return
    e.preventDefault()
    store.switchTab(to)
    ;(bar.current?.children[to] as HTMLElement | undefined)?.focus()
  }
  const openMenu = (e: ReactMouseEvent<HTMLDivElement>, i: number) => {
    e.preventDefault()
    setMenu({ i, x: e.clientX, y: e.clientY })
  }
  const copy = (text: string) => {
    try { void navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用：静默 */ }) } catch { /* 同上 */ }
  }
  const m = menu && menu.i < snap.tabs.length ? menu : null
  const mPath = m ? pathOf(snap.tabs[m.i], snap.paths) : undefined
  const items = m ? [
    { id: 'close', label: '关闭' },
    { id: 'others', label: '关闭其他', disabled: snap.tabs.length < 2 },
    { id: 'right', label: '关闭右侧', disabled: m.i >= snap.tabs.length - 1 },
    ...(mPath === undefined ? [] : [{ id: 'copy', label: '复制路径', disabled: mPath === null }]),
  ] : []
  const pick = (id: string) => {
    if (!m) return
    setMenu(null)
    if (id === 'close') store.closeTab(m.i)
    else if (id === 'others') store.closeOthers(m.i)
    else if (id === 'right') store.closeRight(m.i)
    else if (id === 'copy' && mPath) copy(mPath)
  }
  return (
    <div data-wiki-ui="" className={cx(s.bar, lifted !== null && s.slide)} role="tablist" ref={bar}>
      {snap.tabs.map((r, i) => {
        const title = snap.titles.get(tabKey(r)) ?? tabLabel(r)
        return (
          <div data-wiki-ui="" key={tabKey(r)} role="tab" aria-selected={i === snap.active} title={title}
            tabIndex={i === snap.active ? 0 : -1}
            className={cx(i === snap.active ? s.on : s.tab, lifted === i && s.lift)}
            onClick={() => { if (swallow.current) { swallow.current = false; return } store.switchTab(i) }} onKeyDown={(e) => onKey(e, i)} onContextMenu={(e) => openMenu(e, i)}
            onPointerDown={(e) => onPointerDown(e, i)}>
            <span data-wiki-ui="" className={s.name}>{title}</span>
            <Button size="sm" className={s.x} aria-label="关闭 tab" title="关闭"
              onClick={(e) => { e.stopPropagation(); if (swallow.current) { swallow.current = false; return } store.closeTab(i) }}>×</Button>
          </div>
        )
      })}
      {/* 右键菜单：插件自己的 Menu，门户到 body、定位在指针处（零尺寸锚点矩形） */}
      <Menu open={!!m} items={items} onSelect={pick} onClose={() => setMenu(null)}
        getAnchorRect={() => (m ? new DOMRect(m.x, m.y, 0, 0) : null)} />
    </div>
  )
}
