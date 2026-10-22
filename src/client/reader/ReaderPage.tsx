import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { TopBar } from '../components/TopBar'
import { Main } from '../components/Main'
import { GraphView } from '../components/GraphView'
import { LocalGraphPane } from '../components/LocalGraphPane'
import { isExplore } from '../lib/nav'
import { SearchDialog } from '../components/SearchDialog'
import { useEnv } from '../env'
import { NavProvider, installClickModifier, tabKey, useLoad, useNav, type Route } from '../lib/nav'
import { PanelProvider } from '../lib/panelCtx'
import { rightOf, type PanelState } from './panel'
import { TabsBar } from './TabsBar'
import { ChapterCtx, PageCtx, RawCtx } from '../lib/page'
import { readerCommands } from './commands'
import { persistTabs } from './tabs/persist'
import { aliveKeys, touchRecent } from './tabs/alive'
import { scrollMemo } from './tabs/scrollMemo'
import { EditCtx } from '../lib/edit'
import type { VaultStatus } from '../../core/api'
import s from './ReaderPage.module.css'

// main 插槽的整页阅读器：DSH 左栏「知识库」开这一个，多 tab（tab = 一篇文章，常挂保活，切回即所见）；
// 目录树在 DSH 左栏（sidebar/WikiSidebar.tsx）、检视栏在 DSH 右栏（sidebar/WikiRightbar.tsx），三处共用 panel 状态。
// 库没打开时显示提示，换库后自动进入
export function ReaderPage({ panel }: { panel: PanelState }) {
  const { api } = useEnv()
  const [status, setStatus] = useState<VaultStatus>()
  useEffect(() => {
    // 库变更（页可能改名）：树面变了才清标题表（TabPane 重拉后重新上报真标题）；stats/结构变了才重取 status
    const load = () => { api.status().then(setStatus).catch(() => setStatus({ ok: false, dir: '', pages: 0, error: null, degraded: false, validating: false, checkOutput: null })); panel.nav.clearTitles() }
    load()
    return api.onChanged((ev) => {
      const structural = ev.kind === 'structural'
      if (structural || ev.flags.stats) api.status().then(setStatus).catch(() => setStatus({ ok: false, dir: '', pages: 0, error: null, degraded: false, validating: false, checkOutput: null }))
      if (structural || ev.flags.tree) panel.nav.clearTitles()
    })
  }, [api, panel])
  // tab 持久化：库打开了才接（按库目录分键）；换库先把旧库没落盘的写掉（上一次的退订），再接新库，
  // 并标 switched——手上的 tab 是旧库的，换成新库的存档（换库不串）
  const dir = status?.ok ? status.dir : null
  const lastDir = useRef<string | null>(null)
  useEffect(() => {
    if (!dir) return
    const switched = lastDir.current !== null && lastDir.current !== dir
    lastDir.current = dir
    return persistTabs(panel.nav, dir, { switched })
  }, [panel, dir])
  if (!status) return null
  if (!status.ok) return (
    <div className={s.empty}>
      <p className={s.emptyTitle}>{status.validating ? '正在校验知识库…' : status.dir ? '知识库没有打开' : '还没有知识库'}</p>
      <p className={s.muted}>{status.validating
        ? '大的库要十几秒，校验通过后自动打开。'
        : status.dir
          ? '到 设置 → 插件 → 格物致知 查看原因；没通过校验时那里列了每条报错和修复指引。'
          : '到 设置 → 插件 → 格物致知「新建」一个知识库，或「打开」已有的。'}</p>
    </div>
  )
  return <NavProvider store={panel.nav}><Shell panel={panel} degraded={!!status.degraded} /></NavProvider>
}

// 壳：顶栏 + tab 条 + 全部 TabPane（常挂，非活动 hidden）。page/raw/chapter 的 Ctx 在这层由
// panel.view（活动 TabPane 上报）反挂——TopBar 的编辑入口与面包屑要用，pane 内部各自再挂自己的
function Shell({ panel, degraded }: { panel: PanelState; degraded: boolean }) {
  const { route } = useNav()
  const snap = useSyncExternalStore(panel.nav.subscribe, panel.nav.get)
  const view = useSyncExternalStore(panel.view.subscribe, panel.view.get)
  const [searchOpen, setSearchOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // 后台保活：只挂最近用过的 ALIVE_MAX 个 pane（活动的、正在编辑的必挂）；最近使用顺序跟着活动 tab 走
  const keys = snap.tabs.map(tabKey)
  const activeKey = snap.active >= 0 ? keys[snap.active] : ''
  const keySig = keys.join('\u0000')
  const [recent, setRecent] = useState<string[]>(() => (activeKey ? [activeKey] : []))
  // 依赖只有活动键与 tab 集合：effect 里 setState 不会自激（deps 不变就不再跑）。停在导航位只清掉已关的
  useEffect(() => { setRecent((r) => (activeKey ? touchRecent(r, activeKey, keys) : r.filter((k) => keys.includes(k)))) }, [activeKey, keySig])
  // 关掉的 tab 不再记滚动位置
  const prevKeys = useRef<string[]>(keys)
  useEffect(() => {
    const now = new Set(keys)
    for (const k of prevKeys.current) if (!now.has(k)) scrollMemo.forget(k)
    prevKeys.current = keys
  }, [keySig])
  const edit = useSyncExternalStore(panel.edit.subscribe, panel.edit.get)
  const alive = useMemo(() => {
    const pinned = new Set<string>()
    if (edit.path) snap.tabs.forEach((r) => { if ((r.kind === 'page' && r.id === edit.path) || (r.kind === 'raw' && r.path === edit.path)) pinned.add(tabKey(r)) })
    return aliveKeys({ keys, recent, active: activeKey, pinned })
  }, [keySig, recent, activeKey, edit.path, snap.tabs])
  // 离开正在编辑的页 / 文档就退出编辑态（编辑器卸载时自己把未存内容写掉）；tab 切换 = 活动路由变了，同样触发
  const here = route.kind === 'page' ? route.id : route.kind === 'raw' ? route.path : null
  useEffect(() => { const p = panel.edit.get().path; if (p !== null && p !== here) panel.edit.stop() }, [panel, here])
  // 快捷键：搜索（弹窗共享）与焦点域（root 盖住所有常挂 pane）；prev/next 由活动 TabPane 填
  useEffect(() => {
    Object.assign(readerCommands, { root: root.current, search: () => setSearchOpen(true) })
    return () => { for (const k of Object.keys(readerCommands)) delete (readerCommands as any)[k] }
  }, [])
  // Cmd/Ctrl+点捕获：document 级（目录树在另一棵 React 树），TabsNavStore.go 读它分流
  useEffect(() => installClickModifier(), [])
  return (
    <PanelProvider value={panel}>
    <EditCtx.Provider value={panel.edit}>
    <PageCtx.Provider value={view.page}>
    <RawCtx.Provider value={view.raw}>
    <ChapterCtx.Provider value={view.chapter}>
      {/* tabIndex=-1：点阅读器里任何地方焦点都落到这里，快捷键据此判断焦点在不在阅读器 */}
      <div ref={root} tabIndex={-1} className={s.root}>
        {degraded && <p className={s.notice}>文件监听已中断，改动不自动刷新；到 设置 → 插件 → 格物致知 重新保存目录可恢复。</p>}
        <TopBar inspector={view.right ? panel.inspector : undefined} tab={panel.tab} graph={panel.graph} />
        <TabsBar store={panel.nav} />
        <div className={s.main}>
          {/* key 按篇（tabKey）：同篇换锚点不重挂 pane，PageView 按新锚点滚动 */}
          {/* 导航位 pane 常挂（不占保活名额）：key 按导航页，换导航页即重挂（滚动记忆负责回到上次的位置） */}
          <TabPane key={`hub:${tabKey(snap.hub)}`} route={snap.hub} active={snap.active < 0} panel={panel} />
          {snap.tabs.map((r, i) => alive.has(keys[i]) && <TabPane key={keys[i]} route={r} active={i === snap.active} panel={panel} />)}
        </div>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </ChapterCtx.Provider>
    </RawCtx.Provider>
    </PageCtx.Provider>
    </EditCtx.Provider>
    </PanelProvider>
  )
}

// 一个 tab 的常驻内容：自己装载自己路由的三路数据（页/文档/章）、挂自己的 Ctx、渲染 <Main route>。
// 保活是核心——非活动 hidden 不卸载，滚动位置与已载正文都在。panel.view（右栏检视）与
// prev/next 快捷键、真标题上报：只有活动 tab 做
function TabPane({ panel, route, active }: { panel: PanelState; route: Route; active: boolean }) {
  const { api } = useEnv()
  const pageId = route.kind === 'page' ? route.id : null
  const { v: page, err: pageErr } = useLoad(() => (pageId ? api.page(pageId) : Promise.resolve(undefined)), [pageId], pageId ? { page: pageId } : 'all')
  // 翻页时旧页数据会先留一会儿，PageView 自己按 id 判「载入中」
  const current = pageId ? page : undefined
  const rawPath = route.kind === 'raw' ? route.path : null
  const { v: raw, err: rawErr } = useLoad(() => (rawPath ? api.raw(rawPath) : Promise.resolve(undefined)), [rawPath], 'documents')
  const chKey = route.kind === 'chapter' ? [route.book, route.id] as const : null
  const { v: chData, err: chErr } = useLoad(() => (chKey ? api.chapter(chKey[0], chKey[1]) : Promise.resolve(undefined)), [chKey?.[0], chKey?.[1]], 'documents')
  const chapter = chKey && chData?.book === chKey[0] && chData.chapter.id === chKey[1] ? chData : undefined
  // 当前路由那一路的载入错误：失败不再是永远的「载入中」
  const loadErr = pageId ? pageErr : rawPath ? rawErr : chKey ? chErr : null
  // 首页与详情页有右栏（rightOf）：其余页（列表、图谱、标签）DSH 右栏收起、顶栏不给开关（index.tsx 按 view 同步布局）。
  // free 影响 right（图谱 / 标签顶着会话才开栏），订一份让重算发生
  useSyncExternalStore(panel.free.subscribe, panel.free.get)
  const right = rightOf(panel, route)
  // 依赖放 right?.width（基元）不放 right 对象：rightOf 每次渲染都返回新对象，box.set 又是恒等比较，
  // 依赖放对象会 set → 通知 → 重渲 → 再 set 死循环（现行 Shell 同款写法）
  useEffect(() => { if (active) panel.view.set({ page: current, raw: rawPath ? raw : undefined, chapter, right }) }, [panel, active, current, raw, rawPath, chapter, right?.width])
  // tab 标题与库内路径：数据到了上报（标题占位由 TabsBar 按路由给；页 / 文档的路径直接看路由，章节上报原文路径；导航页不占 tab、不上报）
  useEffect(() => {
    if (current?.ok) panel.nav.setTitle(route, current.page.title)
    else if (raw?.ok) panel.nav.setTitle(route, raw.raw.name)
    else if (chapter) panel.nav.setTitle(route, chapter.chapter.title)
    if (chapter?.chapter.text) panel.nav.setPath(route, chapter.chapter.text)
  }, [panel, route, current, raw, chapter])
  // 上一页/下一页快捷键：只在活动 tab 上有效
  // 图谱视图：开着时内容位换成图谱（正文保活：hidden 藏、不卸载——关掉回到原滚动位置）。
  // 知识页＝该页局部图谱（数据没到 / 载入失败先不开，等 next 渲染补上）；其余沉淀区路由＝全局图。
  // 探索区不给（顶栏按钮同款判定）
  const graphOn = useSyncExternalStore(panel.graph.subscribe, panel.graph.get) && !isExplore(route.kind)
    && (route.kind !== 'page' || !!current?.ok)
  useEffect(() => {
    if (!active) return
    Object.assign(readerCommands, {
      prev: current?.ok && current.page.prev ? () => panel.nav.go({ kind: 'page', id: current.page.prev!.id }) : undefined,
      next: current?.ok && current.page.next ? () => panel.nav.go({ kind: 'page', id: current.page.next!.id }) : undefined,
    })
    return () => { delete readerCommands.prev; delete readerCommands.next }
  }, [panel, active, current])
  return (
    <PageCtx.Provider value={current}>
    <RawCtx.Provider value={rawPath ? raw : undefined}>
    <ChapterCtx.Provider value={chapter}>
      {/* hidden 属性藏非活动 pane（保活）；.pane 不写 display，别盖过 UA 的 [hidden] */}
      <div data-pane="" hidden={!active} className={s.pane}>
        {loadErr ? (
          <div className={s.empty}><p className={s.emptyTitle}>载入失败</p><p className={s.muted}>{loadErr}</p></div>
        ) : (
          <>
            {/* hidden 藏正文（保活）；不写 display（别盖过 UA 的 [hidden]） */}
            <div className={s.doc} hidden={graphOn}>
              <Main route={route} memoKey={route.kind === 'graph' || route.kind === 'chapter' ? undefined : tabKey(route)} skipRestore={route.kind === 'page' && !!route.anchor} />
            </div>
            {graphOn && (route.kind === 'page'
              ? <LocalGraphPane id={route.id} />
              : <GraphView embedded />)}
          </>
        )}
      </div>
    </ChapterCtx.Provider>
    </RawCtx.Provider>
    </PageCtx.Provider>
  )
}
