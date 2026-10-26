import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Button, Input, Popover, PopoverTrigger, PopoverContent } from '../ui'
import { IconCheckMark, IconChevronsUpDown, IconMoreDown, IconMoreRight } from '../../icon'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "wrap": "wk:flex wk:flex-col wk:gap-[6px]",
  "trigger": "wk:w-full wk:min-w-0 wk:justify-between wk:font-normal wk:text-left",
  "crumbs": "wk:flex-1 wk:min-w-0 wk:whitespace-nowrap wk:overflow-hidden wk:text-ellipsis",
  "sep": "wk:my-0 wk:mx-[3px] wk:text-muted-foreground",
  "last": "wk:font-semibold",
  "placeholder": "wk:text-muted-foreground",
  "missing": "wk:text-destructive",
  "missingTag": "wk:flex-none wk:text-[11px] wk:text-destructive",
  "caret": "wk:flex-none wk:text-[10px] wk:text-muted-foreground",
  "panel": "wk:flex wk:flex-col wk:p-0",
  "search": "wk:w-[calc(100%_-_12px)] wk:m-[6px]",
  "list": "wk:max-h-[min(320px,_calc(var(--radix-popover-content-available-height)_-_54px))] wk:overscroll-contain wk:overflow-auto wk:pt-[2px] wk:pr-1 wk:pb-1 wk:pl-1",
  "row": "wk:flex wk:items-center wk:gap-[2px] wk:min-h-8 wk:pr-2 wk:rounded-[var(--wk-radius-sm)] wk:cursor-pointer wk:select-none wk:text-[13px] wk:text-foreground wk:[&:hover]:bg-secondary wk:[&[data-active=true]]:bg-secondary wk:[&[data-active=true]]:[box-shadow:inset_0_0_0_1px_var(--wk-alias-border-l4)] wk:[&[aria-selected=true]_.wk-components-treepicker-name]:font-semibold wk:[&[aria-selected=true]_.wk-components-treepicker-name]:text-primary",
  "ghost": "wk:[&_.wk-components-treepicker-name]:text-muted-foreground",
  "rootRow": "wk:[&_.wk-components-treepicker-name]:font-semibold",
  "twisty": "wk:flex-none wk:flex wk:items-center wk:justify-center wk:w-5 wk:h-6 wk:text-muted-foreground wk:bg-transparent wk:border-0 wk:p-0 wk:cursor-pointer wk:[&:hover]:text-foreground",
  "name": "wk-components-treepicker-name wk:flex-1 wk:min-w-0 wk:whitespace-nowrap wk:overflow-hidden wk:text-ellipsis wk:[&_mark]:bg-[var(--wk-alias-state-warn-primary)] wk:[&_mark]:text-[inherit] wk:[&_mark]:rounded-[2px] wk:[&_mark]:py-0 wk:[&_mark]:px-[1px] wk:[&_mark]:opacity-85",
  "check": "wk:flex-none wk:flex wk:items-center wk:w-[14px] wk:text-primary",
  "empty": "wk:p-[14px] wk:text-center wk:text-xs wk:text-muted-foreground",
  "group": "wk:cursor-default wk:[&_.wk-components-treepicker-name]:text-secondary-foreground",
}

// 文件夹树保留业务层级与键盘逻辑，弹层、焦点恢复和碰撞检测由 shadcn 风格 Popover 管理。
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
  const treeId = useId()
  const { root, byRel, byValue } = tree
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
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
  const close = () => setOpen(false)
  const toggle = (rel: string) => setExpanded((e) => { const n = new Set(e); n.has(rel) ? n.delete(rel) : n.add(rel); return n })
  // 可选节点：选中关面板；分组节点：展开收起，焦点留在搜索框
  const pick = (node: PickNode) => {
    if (node.value !== undefined) { onChange(node.value); close(); return }
    if (node.children.length && !q) { toggle(node.rel); setActive(node.rel) }
    searchRef.current?.focus()
  }

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
  const indent = hideRoot ? 1 : 0   // 根不出行时一层子节点顶格
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => next ? openPanel() : setOpen(false)}>
      <div data-wiki-ui="" className={s.wrap} data-wiki-picker-open={open && !disabled ? '' : undefined}>
        <PopoverTrigger asChild>
        <Button variant="outline" className={s.trigger} disabled={disabled}
          role="combobox" aria-label="选择文件夹" aria-haspopup="tree" aria-controls={open ? treeId : undefined} aria-expanded={open} title={label}>
          {value
            ? <span data-wiki-ui="" className={`${s.crumbs} ${missing ? s.missing : ''}`}>
                {parts.map((p, i) => i === parts.length - 1
                  ? <span data-wiki-ui="" key={i} className={s.last}>{p}</span>
                  : <span key={i}>{p}<span data-wiki-ui="" className={s.sep}>›</span></span>)}
              </span>
            : <span data-wiki-ui="" className={`${s.crumbs} ${s.placeholder}`}>{text.pick}</span>}
          {missing && <span data-wiki-ui="" className={s.missingTag}>{text.missing}</span>}
          <IconChevronsUpDown size={14} className={s.caret} />
        </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="选择文件夹" className={s.panel}
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus() }}
          onMouseDown={(e) => { if (e.target !== searchRef.current) e.preventDefault() /* 点面板里不抢搜索框焦点，行照样收 click */ }}>
            <Input ref={searchRef} type="search" className={s.search} value={query} autoComplete="off" aria-label={text.searchLabel} aria-controls={treeId} aria-activedescendant={cur ? `${treeId}-${encodeURIComponent(cur)}` : undefined}
              placeholder={text.search}
              onChange={(e) => { setQuery(e.target.value); setActive(null) }} onKeyDown={onKey} />
            <div data-wiki-ui="" className={s.list} role="tree" aria-label="文件夹" id={treeId} ref={listRef}>
              {!ready
                ? <div data-wiki-ui="" className={s.empty}>{text.none}</div>
                : rows.length === 0
                  ? <div data-wiki-ui="" className={s.empty}>{text.noHit(q)}</div>
                  : rows.map(({ node, ghost }) => {
                      const isOpen = !!q || expanded.has(node.rel)
                      const isSel = node.value !== undefined && node.value === value
                      return (
                        <div data-wiki-ui="" key={node.rel} role="treeitem" id={`${treeId}-${encodeURIComponent(node.rel)}`} data-rel={node.rel} data-active={node.rel === cur}
                          aria-level={node.depth + 1 - indent} aria-selected={isSel} aria-expanded={node.children.length ? isOpen : undefined}
                          aria-disabled={node.value === undefined ? true : undefined}
                          className={`${s.row} ${ghost ? s.ghost : ''} ${node.root ? s.rootRow : ''} ${node.value === undefined ? s.group : ''}`}
                          style={{ paddingLeft: 4 + (node.depth - indent) * 16 }}
                          onClick={() => pick(node)}>
                          {!q && node.children.length
                            ? <Button size="sm" type="button" tabIndex={-1} className={s.twisty} data-twisty={node.rel} aria-label={isOpen ? '收起' : '展开'}
                                onClick={(e) => { e.stopPropagation(); toggle(node.rel); setActive(node.rel); searchRef.current?.focus() }}>{isOpen ? <IconMoreDown size={12} /> : <IconMoreRight size={12} />}</Button>
                            : <span data-wiki-ui="" className={s.twisty} />}
                          <span data-wiki-ui="" className={s.name}>{node.root || ghost ? node.name : <Hl text={node.name} q={q} />}</span>
                          <span data-wiki-ui="" className={s.check}>{isSel && <IconCheckMark size={14} />}</span>
                        </div>
                      )
                    })}
            </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}
