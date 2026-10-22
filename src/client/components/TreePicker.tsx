import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import s from './TreePicker.module.css'

// 库内树形选择器的公共底座（FolderPicker 选文件夹在用；PagePicker 选页已随图谱选页器撤除、2026-10-20 删）：字段是面包屑按钮，点开浮出搜索框 + 树。
// 面板照宿主 Menu 的做法 portal 到 document.body、position:fixed 贴着字段（useAnchoredPosition），
// 不进表单的文档流、不拉高弹窗，也不被 Modal 的 overflow:hidden 裁。React 合成事件仍沿组件树冒到外层 wrap，
// 所以 Esc / 失焦仍挂在 wrap 上；只是「在不在选择器里」要把 wrap 和面板都算上。
// 节点带 value 才可选（选中回调 value）；不带的只当分组，点它 / Enter 是展开收起。rel 是节点在树里的键（搜路径用它）。
// 搜索不带 / 按名字、带 / 按完整路径；结果用树形：命中项保留祖先、祖先调淡，根和不可选节点从不算命中。
// 键盘：↑↓ 移动、←→ 收起/展开或跳父/首子、Enter 选中、Esc 只关面板（不往外冒，外层弹窗不跟着关）。

export type PickNode = { rel: string; name: string; depth: number; parent: string | null; children: PickNode[]; root?: boolean; value?: string }
export type Row = { node: PickNode; ghost: boolean }
export type PickTree = { root: PickNode; byRel: Map<string, PickNode>; byValue: Map<string, PickNode> }

export const ancestorsOf = (byRel: Map<string, PickNode>, rel: string): string[] => {
  const out: string[] = []
  for (let p = byRel.get(rel)?.parent ?? null; p; p = byRel.get(p)?.parent ?? null) out.push(p)
  return out
}

const matches = (n: PickNode, q: string): boolean => {
  if (n.root || n.value === undefined) return false
  const ql = q.toLowerCase()
  return (q.includes('/') ? n.rel : n.name).toLowerCase().includes(ql)
}

/** hideRoot：根不出行（选页时根「知识库」不是一页，列出来只是多一层缩进） */
export function visibleRows(root: PickNode, query: string, expanded: Set<string>, hideRoot = false): Row[] {
  const q = query.trim()
  const out: Row[] = []
  const push = (n: PickNode, ghost: boolean) => { if (!(hideRoot && n.root)) out.push({ node: n, ghost }) }
  if (!q) {
    const walk = (n: PickNode) => { push(n, false); if (expanded.has(n.rel) || (hideRoot && n.root)) n.children.forEach(walk) }
    walk(root)
    return out
  }
  const hit = new Set<string>(), keep = new Set<string>()
  const scan = (n: PickNode, path: string[]) => {
    if (matches(n, q)) { hit.add(n.rel); keep.add(n.rel); path.forEach((p) => keep.add(p)) }
    n.children.forEach((c) => scan(c, [...path, n.rel]))
  }
  scan(root, [])
  const walk = (n: PickNode) => { if (!keep.has(n.rel)) return; push(n, !hit.has(n.rel)); n.children.forEach(walk) }
  walk(root)
  return out
}

/** 面包屑太长时掐中间：首段 … 末两段 */
export const squeeze = (p: string[]): string[] => (p.length > 4 ? [p[0], '…', ...p.slice(-2)] : p)

function Hl({ text, q }: { text: string; q: string }): ReactNode {
  const needle = q.includes('/') ? (q.split('/').filter(Boolean).pop() ?? '') : q
  const i = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>
}

export type PickerText = {
  /** 未选时的占位 */ pick: string
  /** 搜索框占位 */ search: string
  /** 搜索框读屏名 */ searchLabel: string
  /** 树取不到（库未打开） */ none: string
  /** 搜不到 */ noHit: (q: string) => string
  /** 已存值不在树里 */ missing: string
}

export function TreePicker({ tree, value, onChange, ready, parts, label, text, hideRoot, disabled }: {
  tree: PickTree
  value: string
  onChange: (value: string) => void
  /** 树已取到（库已打开）；取不到时不判「已删」、面板只给一句提示 */
  ready: boolean
  /** 字段上的面包屑（调用方按自己的命名算） */
  parts: string[]
  /** 字段 title */
  label?: string
  text: PickerText
  hideRoot?: boolean
  disabled?: boolean
}) {
  const { root, byRel, byValue } = tree
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const pos = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, side: 'bottom', align: 'start', gap: 4, margin: 12 })
  // 面板不在 wrap 的 DOM 里了：两处都算「里面」
  const inside = (n: globalThis.Node | null) => !!n && (!!wrapRef.current?.contains(n) || !!panelRef.current?.contains(n))

  const q = query.trim()
  const rows = useMemo(() => visibleRows(root, q, expanded, hideRoot), [root, q, expanded, hideRoot])
  const selected = value ? byValue.get(value) : undefined
  // 活动行：不搜时只认显式的（打开时是当前值；未选就没有，免得一按 Enter 选成整个知识库）；搜着时退到第一个命中
  const cur = active !== null && rows.some((r) => r.node.rel === active) ? active
    : q ? (rows.find((r) => !r.ghost) ?? rows[0])?.node.rel ?? null : null
  const missing = !!value && ready && !selected

  const openPanel = () => {
    setQuery('')
    setExpanded(new Set([root.rel, ...(selected ? ancestorsOf(byRel, selected.rel) : [])]))
    setActive(selected?.rel ?? null)
    setOpen(true)
  }
  const close = (refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus() }
  const toggle = (rel: string) => setExpanded((e) => { const n = new Set(e); n.has(rel) ? n.delete(rel) : n.add(rel); return n })
  // 可选节点：选中关面板；分组节点：展开收起，焦点留在搜索框
  const pick = (node: PickNode) => {
    if (node.value !== undefined) { onChange(node.value); close(true); return }
    if (node.children.length && !q) { toggle(node.rel); setActive(node.rel) }
    searchRef.current?.focus()
  }

  useEffect(() => { if (open) searchRef.current?.focus() }, [open])
  // 面板与字段同宽：打开时量一次、窗口变化再量；量出 0（jsdom）就不设宽
  useEffect(() => {
    if (!open) return
    const measure = () => setWidth(triggerRef.current?.offsetWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!inside(e.target as globalThis.Node)) setOpen(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])
  useEffect(() => {
    if (!open || !cur) return
    try { listRef.current?.querySelector<HTMLElement>(`[data-rel="${CSS.escape(cur)}"]`)?.scrollIntoView?.({ block: 'nearest' }) } catch { /* jsdom 等环境没有 */ }
  }, [open, cur])

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const i = rows.findIndex((r) => r.node.rel === cur)
    const node = i >= 0 ? rows[i].node : null
    const move = (d: number) => { if (rows.length) setActive(rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i + d)))].node.rel) }   // 没有活动行时 ↑↓ 都到第一行
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'ArrowRight' && !q && node && node.children.length) {
      e.preventDefault()
      if (!expanded.has(node.rel)) toggle(node.rel); else setActive(node.children[0].rel)
    } else if (e.key === 'ArrowLeft' && !q && node) {
      e.preventDefault()
      // 跳父只跳出了行的父（hideRoot 时根不出行）
      if (expanded.has(node.rel) && node.children.length) toggle(node.rel); else if (node.parent && rows.some((r) => r.node.rel === node.parent)) setActive(node.parent)
    } else if (e.key === 'Enter') { e.preventDefault(); if (node) pick(node) }
  }
  // Esc 挂在外层：焦点落在面板里别处（点了列表空白、Tab 到折叠箭头）也只关面板。
  // preventDefault 让宿主 Modal（document 冒泡阶段听 Esc，看 defaultPrevented）不跟着关；stopPropagation 不往外冒
  const onWrapKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (open && e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); close(true) }
  }
  // 焦点离开整个选择器（Tab 走、切到别处）就关面板，不把焦点拽回字段；relatedTarget 为空也算离开
  const onWrapBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (open && !inside(e.relatedTarget as globalThis.Node | null)) close(false)
  }

  // 首次量出位置前先隐身渲染（不在 0,0 闪一下）
  const panelStyle: CSSProperties = { ...(pos ?? { visibility: 'hidden', left: 0, top: 0 }), ...(width > 0 ? { width } : null) }
  const indent = hideRoot ? 1 : 0   // 根不出行时一层子节点顶格
  return (
    <div className={s.wrap} ref={wrapRef} onKeyDown={onWrapKey} onBlur={onWrapBlur}>
      <button type="button" ref={triggerRef} className={s.trigger} disabled={disabled}
        aria-haspopup="tree" aria-expanded={open} title={label}
        onClick={() => (open ? close(true) : openPanel())}>
        {value
          ? <span className={`${s.crumbs} ${missing ? s.missing : ''}`}>
              {parts.map((p, i) => i === parts.length - 1
                ? <span key={i} className={s.last}>{p}</span>
                : <span key={i}>{p}<span className={s.sep}>›</span></span>)}
            </span>
          : <span className={`${s.crumbs} ${s.placeholder}`}>{text.pick}</span>}
        {missing && <span className={s.missingTag}>{text.missing}</span>}
        <span className={s.caret}>{open ? '▴' : '▾'}</span>
      </button>
      {open && createPortal(
        <div className={s.panel} ref={panelRef} style={panelStyle} onMouseDown={(e) => { if (e.target !== searchRef.current) e.preventDefault() /* 点面板里不抢搜索框焦点，行照样收 click */ }}>
          <input ref={searchRef} type="search" className={s.search} value={query} autoComplete="off" aria-label={text.searchLabel}
            placeholder={text.search}
            onChange={(e) => { setQuery(e.target.value); setActive(null) }} onKeyDown={onKey} />
          <div className={s.list} role="tree" ref={listRef}>
            {!ready
              ? <div className={s.empty}>{text.none}</div>
              : rows.length === 0
                ? <div className={s.empty}>{text.noHit(q)}</div>
                : rows.map(({ node, ghost }) => {
                    const isOpen = !!q || expanded.has(node.rel)
                    const isSel = node.value !== undefined && node.value === value
                    return (
                      <div key={node.rel} role="treeitem" data-rel={node.rel} data-active={node.rel === cur}
                        aria-selected={isSel} aria-expanded={node.children.length ? isOpen : undefined}
                        aria-disabled={node.value === undefined ? true : undefined}
                        className={`${s.row} ${ghost ? s.ghost : ''} ${node.root ? s.rootRow : ''} ${node.value === undefined ? s.group : ''}`}
                        style={{ paddingLeft: 4 + (node.depth - indent) * 16 }}
                        onClick={() => pick(node)}>
                        {!q && node.children.length
                          ? <button type="button" tabIndex={-1} className={s.twisty} data-twisty={node.rel} aria-label={isOpen ? '收起' : '展开'}
                              onClick={(e) => { e.stopPropagation(); toggle(node.rel); setActive(node.rel); searchRef.current?.focus() }}>{isOpen ? '▾' : '▸'}</button>
                          : <span className={s.twisty} />}
                        <span className={s.name}>{node.root || ghost ? node.name : <Hl text={node.name} q={q} />}</span>
                        <span className={s.check}>{isSel ? '✓' : ''}</span>
                      </div>
                    )
                  })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
