import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Tooltip } from '../ui'
import { IconChevronsUpDown } from '../../icon'
import { IconClose, IconMoreRight, IconSearch } from '../../icon'
import { useData, type Route } from '../lib/nav'
import { useRouteMenu } from './RouteMenu'
import { cx } from '../lib/cx'
import { applyDrop, canDrag, dragRows, dropAt, spanEnd, type Drop } from '../lib/treeDrag'
import type { TreePlace } from '../api'
import type { TreeNode } from '../../core/api'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:h-full wk:min-h-0 wk:flex wk:flex-col wk:box-border wk:pr-[var(--dsh-sidebar-inline-padding,_0px)]",
  "header": "wk:flex-none wk:flex wk:items-center wk:gap-1 wk:h-9 wk:mt-[2px] wk:-mr-1 wk:mb-1 wk:ml-0 wk:pl-1 wk:text-muted-foreground",
  "label": "wk:flex-1 wk:min-w-0 wk:overflow-hidden wk:whitespace-nowrap wk:text-ellipsis wk:leading-normal wk:text-[13px] wk:font-sans wk:font-normal",
  "iconButton": "wk:flex-none wk:inline-flex wk:items-center wk:justify-center wk:w-7 wk:h-7 wk:border-0 wk:rounded-[var(--wk-radius-sm)] wk:p-0 wk:bg-transparent wk:cursor-pointer wk:text-secondary-foreground wk:[&:hover]:bg-accent wk:[&:focus-visible]:[outline:var(--wk-focus-ring-width,_2px)_solid_var(--wk-focus-ring-color,_var(--wk-alias-state-business-primary))] wk:[&:focus-visible]:[outline-offset:-2px]",
  "clear": "wk:[&:focus-visible]:[outline:var(--wk-focus-ring-width,_2px)_solid_var(--wk-focus-ring-color,_var(--wk-alias-state-business-primary))] wk:[&:focus-visible]:[outline-offset:-2px] wk:flex-none wk:inline-flex wk:items-center wk:justify-center wk:w-5 wk:h-5 wk:border-0 wk:rounded-full wk:p-0 wk:bg-transparent wk:text-muted-foreground wk:cursor-pointer wk:[&:hover]:text-secondary-foreground",
  "search": "wk:flex-1 wk:min-w-0 wk:flex wk:items-center wk:h-[30px] wk:-mx-[2px] wk:pt-0 wk:pr-1 wk:pb-0 wk:pl-0 wk:[border:0.5px_solid_var(--wk-alias-border-l4)] wk:rounded-[var(--wk-radius-md)] wk:text-[var(--wk-alias-label-caption)]",
  "searchIcon": "wk:flex-none wk:w-7 wk:inline-flex wk:justify-center",
  "input": "wk:flex-1 wk:w-0 wk:min-w-0 wk:-ml-[2px] wk:border-0 wk:outline-none wk:bg-transparent wk:text-[13px] wk:leading-[18px] wk:text-foreground wk:[&::placeholder]:text-muted-foreground",
  "scroll": "wk:flex-1 wk:min-h-0 wk:overflow-auto",
  "list": "wk:relative wk:pb-2 wk:outline-none wk:[&:focus-visible_.wk-components-treepane-focus]:[box-shadow:inset_0_0_0_1px_var(--wk-alias-border-l3)]",
  "row": "wk-components-treepane-row wk:relative wk:flex wk:items-center wk:gap-[2px] wk:h-8 wk:rounded-[var(--wk-radius-md)] wk:pr-2 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-foreground wk:cursor-pointer wk:select-none wk:touch-pan-y wk:[&:hover]:bg-accent",
  "cur": "wk:bg-accent wk:font-medium",
  "twist": "wk:w-5 wk:h-5 wk:shrink-0 wk:grid wk:place-items-center wk:border-0 wk:bg-transparent wk:p-0 wk:text-muted-foreground wk:cursor-pointer wk:rounded-[var(--wk-radius-xs)] wk:[&:hover]:text-secondary-foreground wk:[&_svg]:[transition:transform_.15s]",
  "open": "wk:[&_svg]:[transform:rotate(90deg)]",
  "pad": "wk:w-5 wk:shrink-0",
  "name": "wk:flex-1 wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap wk:ml-[2px]",
  "empty": "wk:p-2 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "mark": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "press": "wk:bg-[var(--wk-alias-fill-secondary)] wk:[transition:background_.38s] wk:[&::after]:content-[''] wk:[&::after]:absolute wk:[&::after]:left-2 wk:[&::after]:right-2 wk:[&::after]:bottom-[2px] wk:[&::after]:h-[2px] wk:[&::after]:rounded-[2px] wk:[&::after]:bg-[var(--wk-alias-brand-primary,_#3370ff)] wk:[&::after]:[transform-origin:left] wk:[&::after]:[transform:scaleX(0)] wk:[&::after]:[animation:wk-components-treepane-hold_.38s_linear_forwards] wk:motion-reduce:[transition:none] wk:motion-reduce:[&::after]:[animation-duration:0s]",
  "ghost": "wk:opacity-30",
  "dragging": "wk:[&_.wk-components-treepane-row:hover]:bg-transparent wk:cursor-grabbing wk:[&_.wk-components-treepane-into:hover]:bg-[rgba(51,_112,_255,_.12)] wk:[&_.wk-components-treepane-into:hover]:[box-shadow:inset_0_0_0_1px_rgba(51,_112,_255,_.5)]",
  "into": "wk-components-treepane-into wk:bg-[rgba(51,_112,_255,_.12)] wk:[box-shadow:inset_0_0_0_1px_rgba(51,_112,_255,_.5)]",
  "floating": "wk:absolute wk:left-0 wk:right-0 wk:z-5 wk:pointer-events-none wk:font-medium wk:bg-background wk:[box-shadow:0_8px_24px_rgba(20,_30,_50,_.16),_0_2px_6px_rgba(20,_30,_50,_.08)]",
  "moveTag": "wk:flex-none wk:text-xs wk:leading-[1] wk:font-sans wk:font-normal wk:py-1 wk:px-[7px] wk:rounded-[5px] wk:text-[#b86200] wk:bg-[rgba(230,_140,_20,_.15)]",
  "line": "wk:absolute wk:right-[6px] wk:h-[2px] wk:rounded-[2px] wk:pointer-events-none wk:z-4 wk:bg-[var(--wk-alias-brand-primary,_#3370ff)] wk:[&::before]:content-[''] wk:[&::before]:absolute wk:[&::before]:-left-1 wk:[&::before]:-top-[3px] wk:[&::before]:w-2 wk:[&::before]:h-2 wk:[&::before]:rounded-[50%] wk:[&::before]:box-border wk:[&::before]:[border:2px_solid_var(--wk-alias-brand-primary,_#3370ff)] wk:[&::before]:bg-background",
  "err": "wk:flex-none wk:flex wk:items-center wk:gap-[6px] wk:mt-0 wk:mr-0 wk:mb-1 wk:ml-0 wk:pt-[6px] wk:pr-1 wk:pb-[6px] wk:pl-2 wk:rounded-[var(--wk-radius-md)] wk:bg-[rgba(204,_61,_61,_.1)] wk:text-[var(--wk-alias-state-danger-primary,_#cc3d3d)] wk:text-xs wk:leading-normal wk:font-sans wk:font-normal",
  "errText": "wk:flex-1 wk:min-w-0",
  "askText": "wk:m-0 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-foreground",
  "focus": "wk-components-treepane-focus",
}

interface Row { key: string; node: TreeNode; depth: number; open: boolean }
const keyOf = (parent: string, n: TreeNode) => parent + '/' + n.name

/** 目录拖动的落盘与守卫（LeftPane 用 makeTreeEdit 接到 API / tab / 编辑态）；不传就不开拖动 */
export interface TreeEdit {
  reorder(node: string, place: TreePlace): Promise<unknown>
  move(node: string, folder: string, place: TreePlace): Promise<unknown>
  impact(node: string): Promise<{ pages: number }>
  /** 不能动时返回原因（如有没保存的改动）；能动返回 null */
  blocked(node: string): string | null
}

const RH = 32          // 行高（与 CSS 一致；落点按它算）
const HOLD = 380       // 长按多久浮起
const SLOP = 6         // 长按期间挪多远算放弃
const AUTO_OPEN = 600  // 悬停在关着的文件夹上多久自动展开

// 拖动中的状态：from 是被拖行的 key（重渲染后行号会变，按 key 找回）；y 是指针相对列表顶的位置
type Lift = { key: string; name: string; depth: number; y: number; offY: number; drop: Drop | null }
// 跨文件夹的确认框：pages 为 null 时还在数
type Ask = { node: string; name: string; from: string; to: string; folder: string; place: TreePlace; pages: number | null }
const errOf = (e: unknown) => { const t = e instanceof Error ? e.message : String(e); return t.split('\n').find((l) => l.startsWith('✗'))?.slice(1).trim() || t.split('\n')[0] }

// wiki 四区树：load 给数据，onOpen 决定点到有 path 的节点时去哪；title 是标题行左边的区名。
// 下面 useData 硬编码 'tree' 作用域只对 wiki 树成立——未来若有文档树复用本组件，必须把作用域参数化。
// edit 给了才开长按拖动（同文件夹排序 / 跨文件夹移动）；筛选中不开（筛选后的行父子不全，落点会算错）
export function TreePane({ title, load, currentId, onOpen, menuRoute, edit }: { title: string; load: () => Promise<{ children: TreeNode[] }>; currentId: string | null; onOpen: (path: string) => void; menuRoute?: (path: string) => Route; edit?: TreeEdit }) {
  const tree = useData(load, [], 'tree')
  // 乐观显示：落点先按新顺序摆，等库变更后新树到了（tree 换了对象）就丢掉；失败还原
  const [pending, setPending] = useState<{ base: unknown; tree: { children: TreeNode[] } } | null>(null)
  const view = pending && pending.base === tree ? pending.tree : tree
  // 右键「打开 / 在新标签页打开」：只给有 path 的节点（目录无 path 不接管右键）
  const menu = useRouteMenu()
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [focus, setFocus] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const [press, setPress] = useState<string | null>(null)
  const [lift, setLift] = useState<Lift | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [err, setErr] = useState('')
  const swallow = useRef(false)
  const gesture = useRef<{ off: () => void } | null>(null)
  useEffect(() => () => gesture.current?.off(), [])
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 4000); return () => clearTimeout(t) }, [err])

  // 当前页所在路径上的文件夹 key（当前页若是文件夹 index，也展开它自己）
  const currentPath = useMemo(() => {
    const keys: string[] = []
    if (!view || !currentId) return keys
    const find = (ns: TreeNode[], parent: string): boolean => {
      for (const n of ns) {
        const k = keyOf(parent, n)
        if (n.path === currentId) { if (n.dir) keys.push(k); return true }
        if (find(n.children, k)) { keys.push(k); return true }
      }
      return false
    }
    find(view.children, '')
    return keys
  }, [view, currentId])

  useEffect(() => { if (currentPath.length) setOpen((o) => new Set([...o, ...currentPath])) }, [currentPath])
  // 树变了（库改动、筛选）行号就不再对得上，键盘焦点归零
  useEffect(() => setFocus(-1), [tree, filter])

  const rows = useMemo(() => {
    const out: Row[] = []
    if (!view) return out
    const q = filter.trim().toLowerCase()
    const hit = (n: TreeNode): boolean => n.name.toLowerCase().includes(q) || n.children.some(hit)
    const walk = (ns: TreeNode[], parent: string, depth: number) => {
      for (const n of ns) {
        if (q && !hit(n)) continue
        const k = keyOf(parent, n)
        const isOpen = q ? true : open.has(k)
        out.push({ key: k, node: n, depth, open: isOpen })
        if (n.dir && isOpen) walk(n.children, k, depth + 1)
      }
    }
    walk(view.children, '', 0)
    return out
  }, [view, filter, open])
  const drows = useMemo(() => dragRows(rows), [rows])
  const live = useRef(drows)
  live.current = drows

  // 换了当前页（或树刚载入）才把当前行滚进视野；全部展开 / 收起、筛选时不跳
  useEffect(() => {
    requestAnimationFrame(() => box.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' }))
  }, [currentId, tree])

  // 全部展开 / 全部收起：有任何展开的就收起，否则全部展开
  const allDirs = useMemo(() => {
    const keys: string[] = []
    const walk = (ns: TreeNode[], parent: string) => { for (const n of ns) { const k = keyOf(parent, n); if (n.dir) { keys.push(k); walk(n.children, k) } } }
    if (view) walk(view.children, '')
    return keys
  }, [view])
  const anyOpen = open.size > 0
  const toggleAll = () => setOpen(anyOpen ? new Set() : new Set(allDirs))
  const openSearch = () => { setSearching(true); requestAnimationFrame(() => input.current?.focus()) }
  const closeSearch = () => { setFilter(''); setSearching(false) }

  const toggle = (k: string, want?: boolean) =>
    setOpen((o) => { const n = new Set(o); if (want ?? !n.has(k)) n.add(k); else n.delete(k); return n })
  // 文件夹：点行只展开并打开 index 页，已展开的再点一遍也只是重新打开——收起只认行首箭头；叶子：打开
  const activate = (r: Row) => {
    if (r.node.dir) toggle(r.key, true)
    if (r.node.path) onOpen(r.node.path)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const r = rows[focus]
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(rows.length - 1, f + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)) }
    else if (e.key === 'ArrowRight' && r?.node.dir) { e.preventDefault(); toggle(r.key, true) }
    else if (e.key === 'ArrowLeft' && r?.node.dir) { e.preventDefault(); toggle(r.key, false) }
    else if (e.key === 'Enter' && r && !e.nativeEvent.isComposing) { e.preventDefault(); activate(r) }
  }

  // —— 长按拖动 ——
  // 按下起 380ms 计时（挪过 6px / 松手就放弃，按普通点击 / 滚动处理）；满了浮起，之后指针相对列表顶的 y
  // 交给 dropAt 算落点。悬停在关着的文件夹「放进去」区 0.6 秒自动展开；贴近滚动区上下边缘时跟着滚
  const yOf = (clientY: number) => clientY - (box.current?.getBoundingClientRect().top ?? 0)
  const onPointerDown = (e: React.PointerEvent, i: number) => {
    swallow.current = false
    if (!edit || e.button !== 0 || filter.trim() || gesture.current || !canDrag(drows, i)) return
    const r = drows[i]
    const x0 = e.clientX, y0 = e.clientY
    let lifted = false
    let last: Drop | null = null   // 最近一次落点：松手直接用它，不在 setState 的更新函数里做副作用
    let hover: { key: string; t: ReturnType<typeof setTimeout> } | null = null
    setPress(r.key)
    const hold = setTimeout(() => {
      lifted = true
      setPress(null)
      setLift({ key: r.key, name: r.name, depth: r.depth, y: yOf(y0), offY: yOf(y0) - i * RH, drop: null })
    }, HOLD)
    const fromIdx = () => live.current.findIndex((x) => x.key === r.key)
    const move = (ev: PointerEvent | MouseEvent) => {
      if (!lifted) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) cancel(); return }
      ev.preventDefault()
      const y = yOf(ev.clientY)
      const drop = last = dropAt(live.current, fromIdx(), y, RH)
      const into = drop?.into != null ? live.current[drop.into] : null
      if (!into || into.open) { if (hover) { clearTimeout(hover.t); hover = null } }
      else if (hover?.key !== into.key) {
        if (hover) clearTimeout(hover.t)
        const k = into.key
        hover = { key: k, t: setTimeout(() => { hover = null; toggle(k, true) }, AUTO_OPEN) }
      }
      setLift((l) => (l ? { ...l, y, drop } : l))
      const sc = box.current?.parentElement
      if (sc) { const b = sc.getBoundingClientRect(); if (ev.clientY < b.top + 24) sc.scrollTop -= 8; else if (ev.clientY > b.bottom - 24) sc.scrollTop += 8 }
    }
    const up = () => {
      const was = lifted
      off()
      if (!was) return
      swallow.current = true
      setLift(null)
      if (last) commit(r.key, last)
    }
    // 浮起后取消（Esc / 指针被系统收走）：松手照样会补发 click，也要吞掉，不能当成点了这一行
    const cancel = () => { const was = lifted; off(); setLift(null); if (was) swallow.current = true }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cancel() }
    function off() {
      clearTimeout(hold)
      if (hover) clearTimeout(hover.t)
      setPress(null)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', key)
      gesture.current = null
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', key)
    gesture.current = { off }
  }

  // 松手：同父 → reorder（乐观先摆）；换父 → 先看编辑态，再弹确认框（影响页数异步填）
  const commit = (key: string, drop: Drop) => {
    const rs = live.current
    const from = rs.findIndex((x) => x.key === key)
    const src = rs[from], dst = rs[drop.folder]
    if (!edit || !src?.rel || !dst?.rel || !view) return
    const node = src.rel, folder = dst.rel
    if (drop.folder === src.parent) {
      setPending({ base: tree, tree: applyDrop(view, node, folder, drop.place) })
      edit.reorder(node, drop.place).catch((e) => { setPending(null); setErr(errOf(e)) })
      return
    }
    const why = edit.blocked(node)
    if (why) { setErr(why); return }
    const a: Ask = { node, name: src.name, from: rs[src.parent]?.name ?? '', to: dst.name, folder, place: drop.place, pages: null }
    setAsk(a)
    edit.impact(node).then((r) => setAsk((x) => (x?.node === node ? { ...x, pages: r.pages } : x)), () => setAsk((x) => (x?.node === node ? { ...x, pages: -1 } : x)))
  }
  const doMove = () => {
    const a = ask
    setAsk(null)
    if (!a || !edit || !view) return
    setPending({ base: tree, tree: applyDrop(view, a.node, a.folder, a.place) })
    edit.move(a.node, a.folder, a.place).catch((e) => { setPending(null); setErr(errOf(e)) })
  }

  const liftAt = lift ? drows.findIndex((x) => x.key === lift.key) : -1
  const ghostEnd = liftAt >= 0 ? spanEnd(drows, liftAt) : -1
  const movingTo = lift?.drop && liftAt >= 0 && lift.drop.folder !== drows[liftAt].parent ? drows[lift.drop.folder]?.name : null
  const impactText = (n: number | null) => n === null ? '正在统计会改哪些页…' : n < 0 ? '没能统计受影响的页，移动时照常修链接' : n > 0 ? `会改 ${n} 页里的链接` : '库里别处没有链到它的页'

  return (
    <div data-wiki-ui="" className={s.root} data-tab-source="">
      <div data-wiki-ui="" className={s.header}>
        {searching ? (
          <div data-wiki-ui="" className={s.search}>
            <span data-wiki-ui="" className={s.searchIcon}><IconSearch size={11} /></span>
            <Input ref={input} className={cx(s.input, 'wk:h-auto wk:rounded-none wk:p-0 wk:shadow-none wk:focus-visible:ring-0')} value={filter} placeholder="筛选目录" onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeSearch() } else onKey(e) }} />
            <Button size="sm" type="button" className={s.clear} aria-label="清除筛选" onClick={closeSearch}><IconClose size={14} /></Button>
          </div>
        ) : (<>
          <span data-wiki-ui="" className={s.label}>{title}</span>
          <Tooltip label="筛选目录" side="bottom" delayMs={500}>
            <Button size="sm" type="button" className={s.iconButton} aria-label="筛选目录" onClick={openSearch}><IconSearch size={14} /></Button>
          </Tooltip>
          <Tooltip label={anyOpen ? '全部收起' : '全部展开'} side="bottom" delayMs={500}>
            <Button size="sm" type="button" className={s.iconButton} aria-label={anyOpen ? '全部收起' : '全部展开'} onClick={toggleAll}><IconChevronsUpDown size={16} /></Button>
          </Tooltip>
        </>)}
      </div>
      {err && (
        <div data-wiki-ui="" className={s.err} role="alert">
          <span data-wiki-ui="" className={s.errText}>{err}</span>
          <Button size="sm" type="button" className={s.clear} aria-label="关掉提示" onClick={() => setErr('')}><IconClose size={14} /></Button>
        </div>
      )}
      <div data-wiki-ui="" className={s.scroll}>
        <div data-wiki-ui="" ref={box} tabIndex={0} onKeyDown={onKey} className={cx(s.list, lift && s.dragging)} data-list="">
          {filter.trim() && rows.length === 0 && <div data-wiki-ui="" className={s.empty}>没有匹配的目录</div>}
          {rows.map((r, i) => {
            const cur = currentId !== null && r.node.path === currentId
            return (
              <div key={r.key} data-row="" data-current={cur || undefined} title={r.node.desc || r.node.name}
                onContextMenu={(e) => { if (press || lift) { e.preventDefault(); return } const p = r.node.path; if (p && menuRoute && menu) menu.show(e, () => menuRoute(p)) }}
                onPointerDown={(e) => onPointerDown(e, i)}
                onClick={() => { if (swallow.current) { swallow.current = false; return } setFocus(i); activate(r) }} style={{ paddingLeft: r.depth * 14 + 4 }}
                className={cx(s.row, cur && s.cur, i === focus && s.focus, press === r.key && s.press, liftAt >= 0 && i >= liftAt && i < ghostEnd && s.ghost, lift?.drop?.into === i && s.into)}>
                {r.node.dir ? (
                  <Button size="sm" className={cx(s.twist, r.open && s.open)} onClick={(e) => { e.stopPropagation(); if (swallow.current) { swallow.current = false; return } toggle(r.key) }} aria-label={r.open ? '收起' : '展开'}>
                    <IconMoreRight size={14} />
                  </Button>
                ) : <span data-wiki-ui="" className={s.pad} />}
                <span data-wiki-ui="" className={s.name}>{r.node.name}</span>
                {r.node.mark && <span data-wiki-ui="" className={s.mark}>{r.node.mark}</span>}
              </div>
            )
          })}
          {lift && (
            <div data-wiki-ui="" className={cx(s.row, s.floating)} data-floating="" style={{ top: lift.y - lift.offY, paddingLeft: lift.depth * 14 + 4 }} aria-hidden="true">
              <span data-wiki-ui="" className={s.pad} />
              <span data-wiki-ui="" className={s.name}>{lift.name}</span>
              {movingTo && <span data-wiki-ui="" className={s.moveTag}>移到「{movingTo}」</span>}
            </div>
          )}
          {lift?.drop?.line && <div data-wiki-ui="" className={s.line} data-line="" style={{ top: lift.drop.line.y - 1, left: lift.drop.line.depth * 14 + 24 }} />}
        </div>
      </div>
      {ask && (
        <Modal open onClose={() => setAsk(null)} title="移动到别的文件夹" closeLabel="取消"
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setAsk(null)}>取消</Button>
            <Button variant="default" size="sm" onClick={doMove}>移动</Button>
          </>}>
          <p data-wiki-ui="" className={s.askText}>把「{ask.name}」从「{ask.from}」移到「{ask.to}」，{impactText(ask.pages)}。</p>
        </Modal>
      )}
      {menu?.node}
    </div>
  )
}
