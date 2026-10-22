import { createTabsNavStore, type Route, type TabsNavStore } from '../lib/nav'
import type { ChapterData, PageResult, RawResult } from '../../core/api'
import { createEditStore, type EditStore } from '../lib/edit'

// 「知识库」面板（探索与沉淀合在首页一页）的共享状态。阅读器（中栏）、目录树（DSH 左栏）、
// 检视栏（DSH 右栏）是三棵 React 树，通过它共用导航与当前页数据
export type RightTab = 'session' | 'props'
export type RightOf = { width: number } | null
/** right：当前路由的右栏（rightOf 的结果）；null = 这里没有右栏，DSH 右栏收起、顶栏不给开关 */
export interface PanelView { page?: PageResult; raw?: RawResult; chapter?: ChapterData; right: RightOf }
export interface PanelState {
  nav: TabsNavStore
  view: { get(): PanelView; set(v: PanelView): void; subscribe(l: () => void): () => void }
  // 右栏开关：默认关闭（空库首页也不自动开）；用户在顶栏点的偏好，面板内记住（场景按钮点了自动打开）
  inspector: { get(): boolean; set(v: boolean): void; subscribe(l: () => void): () => void }
  /** 探索区详情页右栏的两个 tab：会话（默认）/ 属性；面板内记住，填指令时切回会话 */
  tab: { get(): RightTab; set(v: RightTab): void; subscribe(l: () => void): () => void }
  /** 右栏顶着的会话：场景按钮新开的（openScene）、「历史」里挑的、「新开会话」建的、currentSession
   *  现建的都进这里。不进映射、不跟路由，全站哪页都顶着，直到下一个场景按钮 / 再挑 / 再开 */
  free: { get(): string | null; set(v: string | null): void; subscribe(l: () => void): () => void }
  /** 会话建不起来 / 填指令失败的原因，右栏显示，并给退路按钮 */
  error: { get(): string; set(v: string): void; subscribe(l: () => void): () => void }
  /** 图谱视图开关（顶栏按钮切换）：开着时当前页的正文位换成该页的局部图谱（正文保活不卸载） */
  graph: { get(): boolean; set(v: boolean): void; subscribe(l: () => void): () => void }
  /** 编辑态（正在编辑哪一页 / 哪份文档、保存状态），顶栏与正文共用 */
  edit: EditStore
}

function box<T>(init: T) {
  let v = init
  const ls = new Set<() => void>()
  return {
    get: () => v,
    set: (n: T) => { if (n === v) return; v = n; ls.forEach((l) => l()) },
    subscribe: (l: () => void) => { ls.add(l); return () => { ls.delete(l) } },
  }
}

// 检视内容折进「属性」tab 后右栏统一是会话栏宽（原检视栏 320 的定宽随之取消）
export const SESSION_WIDTH = 400
/** 自带右栏的页：读一章 / 一份 / 一页、一本书、书架、文档表、首页。打开右栏全挂「当前会话」
 *  （free ?? latestVault ?? 现建）。图谱 / 标签不带 */
export const ownSessionRoute = (r: Route): boolean =>
  r.kind === 'chapter' || r.kind === 'raw' || r.kind === 'kb' || r.kind === 'page' || r.kind === 'books' || r.kind === 'book' || r.kind === 'documents'

/** 这页有没有「属性」可看（跟挂着哪场会话无关）：首页 / 图谱 / 标签没有，顶栏不给属性按钮 */
export const hasProps = (r: Route): boolean =>
  r.kind === 'chapter' || r.kind === 'raw' || r.kind === 'page' || r.kind === 'book' || r.kind === 'books' || r.kind === 'documents'

/** 右栏放什么（按路由）：自带右栏的页都开会话栏（「会话｜属性」两个 tab，属性各页自定）；
 *  图谱 / 标签只有右栏顶着会话（free）时才开栏，否则没有右栏（null） */
export function rightOf(p: PanelState, r: Route): RightOf {
  if (ownSessionRoute(r)) return { width: SESSION_WIDTH }
  if (p.free.get()) return { width: SESSION_WIDTH }
  return null
}

export function createPanelState(): PanelState {
  return { nav: createTabsNavStore({ kind: 'kb' }), view: box<PanelView>({ right: null }), inspector: box(false), tab: box<RightTab>('session'), free: box<string | null>(null), error: box(''), graph: box(false), edit: createEditStore() }
}
