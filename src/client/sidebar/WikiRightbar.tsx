import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui'
import { IconClose, IconHistory, IconIncrease } from '../../icon'
import { Inspector } from '../components/Inspector'
import { NavProvider, type Route } from '../lib/nav'
import { ChapterCtx, PageCtx, RawCtx } from '../lib/page'
import { BookPanel, DocumentsSummary, ShelfPanel } from '../explore/propsPanels'
import { currentSession, discuss, newSession, queueDraft, vaultSessions } from '../lib/sessions'
import type { WikiApi } from '../api'
import { useEnv } from '../env'
import { hasProps, rightOf, type PanelState, type RightTab } from '../reader/panel'
import { DocumentPanel } from '../explore/DocumentPanel'
import { SessionPane } from './SessionPane'
import { SessionHeader } from './SessionHeader'
import s from './WikiRightbar.styles'

// 打开 wiki 面板时顶替 DSH 右栏。自带右栏的页放「会话」或「属性」，由顶栏两颗按钮（智能体 / 属性）
// 切换，栏内不再有切换控件；首页 / 图谱 / 标签没有属性可看，只给会话（图谱 / 标签只有 free 槽顶着会话才开栏）。会话全站一个逻辑——「当前会话」：
// free 槽（场景按钮新开的 / 历史挑的 / 新开的）?? 库目录最近一场（latestVault，空白也算）?? 现建的新场
// （建好进 free 槽）。打开右栏才解析，空库首页也一样（不自动开栏）；属性各页自定（一章：文章目录 + 知识沉淀；一份：沉淀卡 + 文章目录；一页：目录 /
// 下拆 / 引用 / 局部图，数据来自阅读器发布的 panel.view；一本书 / 书架 / 文档表：区情账）。
// 切到属性时会话不卸载，草稿与滚动位置都在。会话栏头照 DSH 会话头：标题（子智能体带祖先面包屑）+ 子智能体胶囊。
// 宽度由 DSH 右栏轨道给（index.tsx 用 openRightbar(true)），栏本体铺满那一列，拖拽调宽走宿主把手
export function WikiRightbar({ panel, c, SessionProvider, renderSlot }: { panel: PanelState; c?: any; SessionProvider?: any; renderSlot?: any }) {
  const view = useSyncExternalStore(panel.view.subscribe, panel.view.get)
  const nav = useSyncExternalStore(panel.nav.subscribe, panel.nav.get)
  const free = useSyncExternalStore(panel.free.subscribe, panel.free.get)
  const route = nav.route
  const on = useSyncExternalStore(panel.inspector.subscribe, panel.inspector.get)
  const tab = useSyncExternalStore(panel.tab.subscribe, panel.tab.get)
  const { api } = useEnv()
  // 「历史」面板开合（纯栏内视图态）：开着就会话区换列历史会话，挑一条挂上（free 槽）
  const [hist, setHist] = useState(false)
  // 「当前会话」解析出的那场（free 顶着时不用它）
  const [curSid, setCurSid] = useState<string | null>(null)
  const err = useSyncExternalStore(panel.error.subscribe, panel.error.get)
  const setErr = panel.error.set
  const [busy, setBusy] = useState(false)

  // 只有自带右栏的页才解析 / 渲染（rightOf 为 null 的页不渲染；图谱 / 标签要挑了历史 free 槽才有）
  const right = rightOf(panel, route)
  const hasBar = right !== null

  // 「当前会话」解析（currentSession）：默认挂库目录下最近动过的哪场（latestVault，空白场也算），
  // 一场都没有就建新的（建好进 free 槽）。右栏收着、图谱 / 标签没右栏都不解析（不然白建看不见的场）；
  // free 顶着时不解析——场景按钮新开的 / 挑中的场优先
  useEffect(() => {
    if (!on || !hasBar || !c || free) return
    let live = true
    setErr('')
    currentSession(panel, c, api).then((id) => { if (live) setCurSid(id) }, (e) => { if (live) setErr(String(e?.message ?? e)) })
    return () => { live = false }
  }, [on, hasBar, c, free, api, setErr, panel])

  if (!on || !right) return null
  const close = <Button variant="ghost" size="sm" icon={<IconClose size={16} />} onClick={() => panel.inspector.set(false)} aria-label="收起右栏" />
  const id = free ?? curSid
  // 「新开会话」：建一场新的进 free 槽（不绑键），空白会话、不填不发
  const fresh = !c
    ? undefined
    : () => { setErr(''); setHist(false); newSession(c, api).then((n) => panel.free.set(n), (e: unknown) => setErr(String(e instanceof Error ? e.message : e))) }
  // 属性跟路由走（这页有没有属性可看，跟挂着哪场会话无关）；没属性的页只放会话
  const cur: RightTab = hasProps(route) ? tab : 'session'
  // 面包屑 / 子智能体胶囊点了：右栏换到那场（进 free 槽，跟「历史」里挑的一个待遇）
  const openHere = (sid: string) => { panel.free.set(sid); setHist(false); setErr('') }
  return (
    <aside data-wiki-ui="" className={s.root}>
      <div data-wiki-ui="" className={s.head}>
        {cur === 'props'
          ? <span data-wiki-ui="" className={s.title}>属性</span>
          : <SessionHeader c={c} sessionId={err ? null : id} onOpen={openHere} />}
        <span data-wiki-ui="" className={s.acts}>
          {cur === 'session' && c && (
            <DropdownMenu open={hist} onOpenChange={(next) => { setHist(next); setErr('') }} modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" icon={<IconHistory size={16} />} title="历史会话（挑一场库里的旧会话挂上右栏）" aria-label="历史会话" />
              </DropdownMenuTrigger>
              {hist && <HistoryPop c={c} api={api} current={id} onPick={openHere} />}
            </DropdownMenu>
          )}
          {cur === 'session' && fresh && <Button variant="ghost" size="sm" icon={<IconIncrease size={16} />} onClick={fresh} title="新开会话（替换这里原来的会话）" aria-label="新开会话" />}
          {close}
        </span>
      </div>
      {cur === 'props' && (
        <div data-wiki-ui="" className={s.props} id="dsh-knowledge-brain-right-props-panel">
          <NavProvider store={panel.nav}>
            <PageCtx.Provider value={view.page}>
              <RawCtx.Provider value={view.raw}>
                <ChapterCtx.Provider value={view.chapter}>
                  {route.kind === 'raw' && <DocumentPanel path={route.path} />}
                  {route.kind === 'book' && <BookPanel name={route.name} />}
                  {route.kind === 'books' && <ShelfPanel />}
                  {route.kind === 'documents' && <DocumentsSummary />}
                  <Inspector />
                </ChapterCtx.Provider>
              </RawCtx.Provider>
            </PageCtx.Provider>
          </NavProvider>
        </div>
      )}
      <div data-wiki-ui="" className={s.session} id="dsh-knowledge-brain-right-session-panel" hidden={cur !== 'session'}>
        {err || (c && (!SessionProvider || !renderSlot))
          ? <div data-wiki-ui="" className={s.empty}>{err ? `会话没建起来：${err}` : '右栏放不下会话。'}
              <div><Button variant="outline" size="sm" disabled={busy} onClick={() => {
              setBusy(true)
              // 右栏能嵌就重解析「当前会话」（建不出的场换新的，话题排队等输入框，只填不发）；
              // 嵌不了才走 discuss 切主视图
              const fail = (e: any) => setErr(String(e?.message ?? e))
              if (!(c && SessionProvider && renderSlot)) {
                discuss(c, api, topic(route)).catch(fail).finally(() => setBusy(false))
              } else {
                setErr('')
                currentSession(panel, c, api).then((nid) => {
                  queueDraft(nid, topic(route))
                  if (!panel.free.get()) setCurSid(nid)
                }, fail).finally(() => setBusy(false))
              }
            }}>{c && SessionProvider && renderSlot ? '右栏新开一个' : '在会话中讨论'}</Button></div></div>
          : id ? <SessionPane key={id} c={c} sessionId={id} SessionProvider={SessionProvider} renderSlot={renderSlot} />
          : <div data-wiki-ui="" className={s.empty}>正在打开会话…</div>}
      </div>
    </aside>
  )
}

// 退路会话里预填的话题（只填不发）：所在页的引用（一章 / 一份 / 一页 / 一本书），列表页就笼统一句
const at = (p: string) => (/\s/.test(p) ? `@"${p}"` : `@${p}`)
function topic(r: Route): string {
  if (r.kind === 'chapter') return `讨论 ${r.book} ${r.id}：`
  if (r.kind === 'raw') return `讨论这份文档 ${at(r.path)} ：`
  if (r.kind === 'page') return `讨论这一页 ${r.id}：`
  if (r.kind === 'book') return `讨论 ${r.name}：`
  if (r.kind === 'books') return '讨论图书：'
  if (r.kind === 'documents') return '讨论文档：'
  return ''
}

// 右栏「历史」下拉浮层：点栏头时钟在按钮下弹出，列库里动过的会话（vaultSessions 筛），
// 挑一条由调用处挂上 free 槽；点外面 / Esc 关。正文不动——切历史不该把正在看的对话换掉。
// sessions 服务没就绪时给空表（栏开着说明面板已在用，一般到不了这步，稳一手不炸）
const NO_LIST = { byId: {} as Record<string, never> }
function HistoryPop({ c, api, current, onPick }: { c: any; api: WikiApi; current: string | null; onPick: (id: string) => void }) {
  const sessions = c.get('sessions')
  const [dir, setDir] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.status().then((st) => { if (live) setDir(st.dir) }, () => { if (live) setDir('') })
    return () => { live = false }
  }, [api])
  const list = useSyncExternalStore(sessions?.list?.subscribe ?? (() => () => {}), () => sessions?.list?.getSnapshot() ?? NO_LIST)
  const rows = dir ? vaultSessions(list.byId, dir) : []
  return (
    <DropdownMenuContent align="end" aria-label="历史会话" className="wk:w-80">
      {rows.length === 0
        ? <div data-wiki-ui="" className="wk:px-2 wk:py-3 wk:text-xs wk:text-muted-foreground">{dir === null ? '正在读取…' : dir === '' ? '库还没配置好。' : '还没有会话历史——在右栏聊过的都会出现在这里。'}</div>
        : rows.map((r) => (
          <DropdownMenuItem key={r.id} className={r.id === current ? 'wk:bg-secondary' : undefined} onSelect={() => onPick(r.id)} title={r.title}>
            <span data-wiki-ui="" className="wk:min-w-0 wk:flex-1 wk:truncate">{r.title}</span>
            <span data-wiki-ui="" className="wk:shrink-0 wk:text-[11px] wk:text-muted-foreground">{ago(r.updatedAt)}</span>
          </DropdownMenuItem>
        ))}
    </DropdownMenuContent>
  )
}

// updatedAt（毫秒）→ 刚刚 / N 分钟 / N 小时 / N 天
function ago(t: number): string {
  const m = Math.floor((Date.now() - t) / 6e4)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  return `${Math.floor(m / 1440)} 天前`
}
