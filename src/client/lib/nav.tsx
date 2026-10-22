import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useEnv } from '../env'
import type { ClientChangeEvent } from '../api'
import { createTabsModel, type TabsState } from '../reader/tabs/model'

/** 失效作用域：tree=目录树/prev-next，stats=首页看板/动态/草稿/标签，graph=图谱，documents=书/文档/raw，page=单页正文 */
export type TickScope = 'all' | 'tree' | 'stats' | 'graph' | 'documents' | { page: string }
export interface Ticks { all: number; tree: number; stats: number; graph: number; documents: number; pages: Map<string, number> }

// 载荷 → tick 自增（纯函数）：structural 全自增并清页表；patch 按 flags 与 ids
export function applyChange(t: Ticks, ev: ClientChangeEvent): void {
  if (ev.kind === 'structural') {
    t.all++; t.tree++; t.stats++; t.graph++; t.documents++
    t.pages = new Map()
    return
  }
  if (ev.flags.tree) t.tree++
  if (ev.flags.stats) t.stats++
  if (ev.flags.graph) t.graph++
  if (ev.flags.documents) t.documents++
  for (const id of ev.ids) t.pages.set(id, (t.pages.get(id) ?? 0) + 1)
}

// 页作用域的 tick 用 all*1e9 + 页计数合成：structural（all 翻）与该页自身的 patch 都能推动 effect
export const tickOf = (t: Ticks, scope: TickScope): number =>
  typeof scope === 'object' ? t.all * 1e9 + (t.pages.get(scope.page) ?? 0)
    : scope === 'all' ? t.all : t[scope]

/** 文档表的状态筛选：待沉淀 = 未沉淀 + 沉淀中 */
export type DocumentFilter = '待沉淀' | '未沉淀' | '沉淀中' | '已引用' | '完成' | '全部'

export type Route =
  | { kind: 'kb' }        // 知识库主页（探索三入口 + 沉淀列表）
  | { kind: 'page'; id: string; anchor?: string }
  | { kind: 'graph'; focus?: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'raw'; path: string }
  // 探索区（书 ｜ 文档）：面包屑、图谱按钮按 isExplore 切版式，导航全在主区
  | { kind: 'books' }                                  // 书架
  | { kind: 'book'; name: string }                     // 一本书（章节总览）
  | { kind: 'chapter'; book: string; id: string; title?: string }      // 读一章（title：打开处已知的章名，pane 没挂时 tab 用它占位）
  | { kind: 'documents'; status?: DocumentFilter }     // 文档表
  // 沉淀两页（沉淀带的全量出口；面包屑用沉淀版）
  | { kind: 'drafts' }                                 // 沉淀草稿全列表
  | { kind: 'activity' }                               // 沉淀动态：全部页按更新时间
  // 知识问答会话记录页（设置卡机器人行的「会话」跳进来；不带右栏，跳转替换当前 tab）
  | { kind: 'lark'; appId: string }

/** 探索区路由（面包屑用探索版、图谱按钮藏起）：书架 / 一本书 / 一章 / 一份 / 文档表 */
export const isExplore = (kind: Route['kind']): boolean =>
  kind === 'books' || kind === 'book' || kind === 'chapter' || kind === 'raw' || kind === 'documents'

interface Nav {
  route: Route
  go(r: Route): void
  /** 只有栈式 store（右栏 WikiPageTab）有；阅读器 tab 不支持前进后退 */
  back?(): void
  forward?(): void
  canBack: boolean
  canForward: boolean
  /** 只有 tab 式 store（阅读器、DSH 左栏目录树）有：显式开新 tab（链接右键「在新标签页打开」） */
  openTab?(r: Route): void
  /** 只有 tab 式 store 有：回到进当前整页视图（图谱）之前的位置；canRetreat=false 不给按钮 */
  retreat?(): void
  canRetreat: boolean
  version: number
  ticks: Ticks
}

const Ctx = createContext<Nav | null>(null)

// 导航 store 的快照收敛成 route 形：栈式（WikiPageTab 右侧栏用）带 canBack/canForward，
// tab 式（阅读器用）不支持前进后退、没有这两项。消费端（NavProvider / WikiRightbar）只读 route。
// 快照对象必须缓存复用——get() 每次返回新对象会让 useSyncExternalStore 无限重渲
export interface NavSnapshot { route: Route; canBack?: boolean; canForward?: boolean; canRetreat?: boolean }
export interface TabsSnapshot { route: Route; hub: Route; tabs: readonly Route[]; active: number; titles: Map<string, string>; paths: Map<string, string>; /** 进当前路由前的位置（图谱回退用）：图谱→图谱换聚焦不算 */ canRetreat: boolean }
export interface NavStore {
  get(): NavSnapshot
  subscribe(l: () => void): () => void
  go(r: Route): void
  back?(): void
  forward?(): void
}
export interface TabsNavStore extends NavStore {
  get(): TabsSnapshot
  openTab(r: Route): void
  closeTab(i: number): void
  closeOthers(i: number): void
  closeRight(i: number): void
  switchTab(i: number): void
  moveTab(from: number, to: number): void
  /** 持久化恢复：导航位 + 文档 tab 整体换掉（按篇去重；active 允许 -1，越界取 0） */
  restore(hub: Route, tabs: readonly Route[], active: number): void
  setTitle(r: Route, title: string): void
  clearTitles(): void
  /** pane 上报这篇的库内路径（书 / 章节要等数据到了才知道；tab 右键「复制路径」用） */
  setPath(r: Route, path: string): void
  /** 自创建起 tab 列表从没变过（标题 / 路径上报不算）：持久化只在此时恢复，不覆盖人已经点开的 */
  pristine(): boolean
  /** 回到进当前路由（图谱等整页视图）之前的位置：文档 tab 还在就切回去、没了重开；导航页直接换回去 */
  retreat(): void
}

export const routeKey = (r: Route): string => JSON.stringify(r)

/** tab 认「是哪一篇」的键：页不看锚点、文档表不看筛选、图谱不看聚焦、章节不看标题——这些只是同一篇里的位置
 *  / 视图参数。跨 tab 去重、标题表、pane 的 React key 都用它（同篇换锚点不重挂 pane，PageView 据 anchor 滚） */
export const tabKey = (r: Route): string => {
  if (r.kind === 'page') return routeKey({ kind: 'page', id: r.id })
  if (r.kind === 'documents') return routeKey({ kind: 'documents' })
  if (r.kind === 'graph') return routeKey({ kind: 'graph' })
  if (r.kind === 'chapter') return routeKey({ kind: 'chapter', book: r.book, id: r.id })
  return routeKey(r)
}

/** 文档（占 tab）：知识页、原始文档、章节；其余路由是导航页（首页 / 各列表页，放导航位、不占 tab） */
export const isDoc = (r: Route): boolean => r.kind === 'page' || r.kind === 'raw' || r.kind === 'chapter'

// 栈式（右侧栏 WikiPageTab 用）：一份前进后退
export function createNavStore(initial: Route): NavStore {
  let stack: Route[] = [initial]
  let i = 0
  let snap: NavSnapshot = { route: initial, canBack: false, canForward: false }
  const ls = new Set<() => void>()
  const set = () => { snap = { route: stack[i], canBack: i > 0, canForward: i < stack.length - 1 }; ls.forEach((l) => l()) }
  return {
    get: () => snap,
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l) } },
    go: (r) => { stack = [...stack.slice(0, i + 1), r]; i += 1; set() },
    back: () => { i = Math.max(0, i - 1); set() },
    forward: () => { i = Math.min(stack.length - 1, i + 1); set() },
  }
}

// Cmd/Ctrl+点开新 tab：document 捕获阶段记下修饰键（带时间戳），TabsNavStore.go 读取并即刻清除。
// 捕获先于 React 处理器、同一 click 内同步读得到；程序化 go（自动跳转、命令式调用）不吃残留——
// 读后即清 + 时间戳过期双保险。挂 document 而非 reader 根：目录树（DSH 左栏）与阅读器是两棵树
let modAt = 0
export function installClickModifier(): () => void {
  // 只认 [data-tab-source]（目录树、正文、章节原文）里的 Cmd/Ctrl：首页 / 列表里的链接按住修饰键也只是普通点击。
  // mousedown 也听——编辑器的 ⌘+点击在 mousedown 上就打开链接
  const cap = (e: Event) => {
    const m = e as MouseEvent
    if (!(m.metaKey || m.ctrlKey)) return
    const t = e.target
    if (t instanceof Element && t.closest('[data-tab-source]')) modAt = Date.now()
  }
  document.addEventListener('mousedown', cap, true)
  document.addEventListener('click', cap, true)
  return () => { document.removeEventListener('mousedown', cap, true); document.removeEventListener('click', cap, true) }
}
const popModifier = (): boolean => { const hit = modAt !== 0 && Date.now() - modAt < 100; modAt = 0; return hit }
/** 同步取走「这一下按着修饰键」：要先异步解析再跳转的调用方（双链名字要 resolve）在 await 之前调它，
 *  解析完按结果走 openTab / go——等解析回来再让 go 自己读，100ms 窗口早过了，会把正在读的文档原地换掉 */
export const takeModifier = popModifier

// tab 式（阅读器用）：导航位（首页 / 列表页，不占 tab）+ 文档 tab（单路由，无栈，不支持前进后退）。
// 列表操作全在 reader/tabs/model.ts，这里只管导航语义：导航页一律进导航位；停在导航位点开文档每次开新
// tab（同篇已开就切过去）；停在文档 tab 里普通点击原地换（同篇在别的 tab 就切过去，当前 tab 不动）；
// 修饰键在时开新 tab。关最后一个文档 tab 回导航位
const tabsModel = createTabsModel<Route>({ key: tabKey, same: (a, b) => routeKey(a) === routeKey(b) })

export function createTabsNavStore(initial: Route): TabsNavStore {
  let s: TabsState<Route> = tabsModel.init(initial)
  const ls = new Set<() => void>()
  const titlesOf = (st: TabsState<Route>) => {
    const m = new Map<string, string>()
    for (const [k, v] of st.meta) if (v.title !== undefined) m.set(k, v.title)
    return m
  }
  const pathsOf = (st: TabsState<Route>) => {
    const m = new Map<string, string>()
    for (const [k, v] of st.meta) if (v.path !== undefined) m.set(k, v.path)
    return m
  }
  // 进当前路由前的位置：整页视图（图谱）回退用。图谱内换聚焦（graph→graph）不算移动，不覆盖
  let backTarget: Route | null = null
  const snapOf = (st: TabsState<Route>): TabsSnapshot => ({
    route: st.active < 0 ? st.hub : st.tabs[st.active], hub: st.hub, tabs: st.tabs, active: st.active,
    titles: titlesOf(st), paths: pathsOf(st),
    canRetreat: !!backTarget && routeKey(backTarget) !== routeKey(st.active < 0 ? st.hub : st.tabs[st.active]),
  })
  let snap = snapOf(s)
  // 模型没变化时返回同一引用：同引用即不通知（useSyncExternalStore 不空转）。
  // touched：tab 列表 / 活动下标动过（附加信息变化不算）——pristine 据此判断
  let touched = false
  const commit = (n: TabsState<Route>) => {
    if (n === s) return
    const old = s.active < 0 ? s.hub : s.tabs[s.active]
    const now = n.active < 0 ? n.hub : n.tabs[n.active]
    if (routeKey(old) !== routeKey(now) && !(old.kind === 'graph' && now.kind === 'graph')) backTarget = old
    if (n.tabs !== s.tabs || n.active !== s.active || n.hub !== s.hub) touched = true
    s = n
    snap = snapOf(s)
    ls.forEach((l) => l())
  }
  const openTab = (r: Route) => commit(isDoc(r) ? tabsModel.open(s, r) : tabsModel.showHub(s, r))
  return {
    get: () => snap,
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l) } },
    go: (r) => {
      if (popModifier()) return openTab(r)
      if (!isDoc(r)) return commit(tabsModel.showHub(s, r))
      const i = s.tabs.findIndex((t) => tabKey(t) === tabKey(r))
      if (i >= 0) return commit(tabsModel.focus(s, i, r))
      // 停在导航位：开新 tab；停在文档 tab：原地换
      commit(s.active < 0 ? tabsModel.open(s, r) : tabsModel.replace(s, r))
    },
    openTab,
    closeTab: (i) => commit(tabsModel.close(s, i)),
    switchTab: (i) => commit(tabsModel.focus(s, i)),
    setTitle: (r, title) => commit(tabsModel.setMeta(s, r, { title })),
    clearTitles: () => commit(tabsModel.clearMeta(s, 'title')),
    closeOthers: (i) => commit(tabsModel.closeOthers(s, i)),
    closeRight: (i) => commit(tabsModel.closeRight(s, i)),
    moveTab: (from, to) => commit(tabsModel.move(s, from, to)),
    restore: (hub, tabs, active) => commit(tabsModel.restore(s, hub, tabs, active)),
    setPath: (r, path) => commit(tabsModel.setMeta(s, r, { path })),
    pristine: () => !touched,
    retreat: () => {
      const t = backTarget
      if (!t) return
      if (isDoc(t)) {
        const i = s.tabs.findIndex((x) => tabKey(x) === tabKey(t))
        if (i >= 0) return commit(tabsModel.focus(s, i))
        return openTab(t)
      }
      commit(tabsModel.showHub(s, t))
    },
  }
}

// store 缺省时自带一份（右侧 wiki 页 tab 每个 tab 一栈）
export function NavProvider({ initial, store, children }: { initial?: Route; store?: NavStore; children: ReactNode }) {
  const { api } = useEnv()
  const [own] = useState(() => store ?? createNavStore(initial ?? { kind: 'kb' }))
  const st = store ?? own
  const snap = useSyncExternalStore(st.subscribe, st.get)
  const [ticks, setTicks] = useState<Ticks>(() => ({ all: 0, tree: 0, stats: 0, graph: 0, documents: 0, pages: new Map() }))
  useEffect(() => api.onChanged((ev) => setTicks((t) => {
    const n: Ticks = { ...t, pages: new Map(t.pages) }
    applyChange(n, ev)
    return n
  })), [api])
  const version = ticks.all
  // back/forward 只有栈式 store 有（右栏 WikiPageTab）；openTab 只有 tab 式有（阅读器、左栏目录树）
  const tabs = st as Partial<TabsNavStore>
  const value = useMemo<Nav>(() => ({
    route: snap.route, go: st.go, back: st.back, forward: st.forward,
    canBack: !!snap.canBack, canForward: !!snap.canForward,
    openTab: typeof tabs.openTab === 'function' ? tabs.openTab : undefined,
    retreat: typeof tabs.retreat === 'function' ? tabs.retreat : undefined,
    canRetreat: !!snap.canRetreat,
    version, ticks,
  }), [snap, st, tabs, ticks, version])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNav(): Nav {
  const n = useContext(Ctx)
  if (!n) throw new Error('useNav 必须在 NavProvider 内')
  return n
}

// 载入结果带错误态：v 与 useData 一致（载入中 / 失败都是 undefined），err 非空 = 这次载入失败
// （页被删、RPC 断连、OneDrive 占位文件取不回……）。换了输入或库有变更会重跑，重跑时错误清空。
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], scope: TickScope = 'all'): { v: T | undefined; err: string | null } {
  const { ticks } = useNav()
  const v = tickOf(ticks, scope)
  // 值带着取它时的输入：输入变了（换了书 / 章 / 页）就不再返回上一份，免得旧数据挂到新路由上
  const key = JSON.stringify(deps)
  const [d, setD] = useState<{ key: string; v: T }>()
  const [e, setE] = useState<{ key: string; err: string }>()
  useEffect(() => {
    let live = true
    setE(undefined)
    load().then((x) => { if (live) setD({ key, v: x }) }).catch((err) => { if (live) setE({ key, err: err instanceof Error ? err.message : String(err) }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps])
  return { v: d && d.key === key ? d.v : undefined, err: e && e.key === key ? e.err : null }
}

export function useData<T>(load: () => Promise<T>, deps: unknown[], scope?: TickScope): T | undefined {
  return useLoad(load, deps, scope).v
}
