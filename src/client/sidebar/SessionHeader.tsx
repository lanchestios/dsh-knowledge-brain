import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, StateDot, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui'
import { IconMoreDown } from '../../icon'
import { cx } from '../lib/cx'
import s from './WikiRightbar.styles'

// 右栏会话的标题行，照 DSH 主会话头（ConversationSessionHeader + ui-subagent 的子智能体目录）：
// 子智能体会话给祖先面包屑（点了右栏换到那场），末尾是当前标题；本场派生过子智能体就挂一个计数
// 胶囊（有在跑的亮绿点），点开列直接下级，点一条右栏换到那场。
// 原生会话头只在 main.conversation 里渲染，嵌进右栏的 conversation.content 不带它，
// 插槽归属又不许借别人声明的 conversation.session.header——数据直接读 sessions.list 自己画。

interface Summary { id: string; displayTitle: string; running?: boolean; origin?: string; parentId?: string }
interface CatalogEntry { id: string; label?: string; mode?: string }
interface ListSnap {
  byId: Record<string, Summary>
  projectionsBySession?: Record<string, { values?: { subagentCatalog?: CatalogEntry[] }; state?: string }>
}

/** 祖先链（含自己），根在前：沿 subagent 的 parentId 往上，碰到非子智能体或缺摘要就停；防环 */
export function ancestry(byId: Record<string, Summary>, id: string): Summary[] {
  const chain: Summary[] = []
  const seen = new Set<string>()
  let cur: string | undefined = id
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur)
    const x: Summary | undefined = byId[cur]
    if (!x) break
    chain.unshift(x)
    if (x.origin !== 'subagent') break
    cur = x.parentId
  }
  return chain
}

export interface SubagentRow { id: string; label: string; mode?: string; running: boolean }

/** 本场的直接下级子智能体（目录投影 subagentCatalog），带运行态（摘要的 running） */
export function subagents(snap: ListSnap, id: string): SubagentRow[] {
  const cat = snap.projectionsBySession?.[id]?.values?.subagentCatalog ?? []
  return cat.map((e) => ({ id: e.id, label: e.label ?? snap.byId[e.id]?.displayTitle ?? e.id, mode: e.mode, running: snap.byId[e.id]?.running === true }))
}

const MODE: Record<string, string> = { 'one-shot': '一次性', continuable: '可继续' }
const EMPTY: ListSnap = { byId: {} }

export function SessionHeader({ c, sessionId, onOpen }: { c: any; sessionId: string | null; onOpen: (id: string) => void }) {
  const list = c?.get?.('sessions')?.list
  const snap: ListSnap = useSyncExternalStore(list?.subscribe ?? (() => () => {}), () => list?.getSnapshot?.() ?? EMPTY)
  // 子智能体目录是按会话懒加载的投影：挂上就要一次（同一连接内宿主自己去重）
  useEffect(() => {
    if (!sessionId) return
    try { c?.get?.('sessions')?.refreshProjections?.(sessionId) } catch { /* 读不到目录不显示胶囊 */ }
  }, [c, sessionId])
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [sessionId])
  if (!sessionId) return <span data-wiki-ui="" className={s.title}>会话</span>
  const chain = ancestry(snap.byId, sessionId)
  const kids = subagents(snap, sessionId)
  const running = kids.filter((k) => k.running).length
  return (
    <span data-wiki-ui="" className={s.lead}>
      <nav data-wiki-ui="" className={s.crumbs} aria-label="会话层级">
        {chain.length === 0 && <span data-wiki-ui="" className={cx(s.crumb, s.crumbCur)}>新会话</span>}
        {chain.map((x, i) => {
          const last = i === chain.length - 1
          return (
            <span data-wiki-ui="" key={x.id} className={s.crumbSeg}>
              {i > 0 && <span data-wiki-ui="" className={s.crumbSep}>/</span>}
              {last
                ? <span data-wiki-ui="" className={cx(s.crumb, s.crumbCur)} title={x.displayTitle}>{x.displayTitle}</span>
                : <Button size="sm" type="button" className={s.crumb} title={x.displayTitle} onClick={() => onOpen(x.id)}>{x.displayTitle}</Button>}
            </span>
          )
        })}
      </nav>
      {kids.length > 0 && (
        <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="wk:h-[22px] wk:gap-1 wk:rounded-full wk:px-1.5 wk:text-xs"
              aria-label={running > 0 ? `${running} 个子智能体，正在运行` : `${kids.length} 个子智能体`}>
              <StateDot state={running > 0 ? 'ongoing' : 'idle'} />
              <span>{running > 0 ? `${running}/${kids.length}` : kids.length}</span>
              <IconMoreDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="子智能体会话" className="wk:w-80">
            {kids.map((r) => <DropdownMenuItem key={r.id} onSelect={() => onOpen(r.id)} title={r.label}>
              <StateDot state={r.running ? 'ongoing' : 'idle'} />
              <span data-wiki-ui="" className="wk:min-w-0 wk:flex-1 wk:truncate">{r.label}</span>
              <span data-wiki-ui="" className="wk:shrink-0 wk:text-[11px] wk:text-muted-foreground">{r.running ? '正在运行' : (r.mode && MODE[r.mode]) || ''}</span>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )
}
