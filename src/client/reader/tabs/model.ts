// 阅读器 tab 的纯模型：一个「导航位」（hub：首页 / 各列表页，同一时刻只有一个，不占 tab）+ 一串文档 tab。
// 不认识路由、不依赖 React：哪些路由进导航位由 lib/nav.tsx 的 createTabsNavStore 判定，持久化 / 保活 /
// 滚动记忆是 reader/tabs/ 下的扩展。key = 「是哪一篇」（去重、附加信息、pane 的 React key 都按它）；
// same = 两个 tab 是否完全一样（同篇不同锚点 key 相同、same 为 false）。active = -1 表示停在导航位。
// 每个操作返回新状态；什么都没变就返回入参同一个引用——store 据此决定通知不通知

export interface TabMeta { title?: string; path?: string }
export interface TabsState<T> {
  /** 导航位上的那一页（首页 / 书架 / 文档表…） */
  readonly hub: T
  /** 文档 tab */
  readonly tabs: readonly T[]
  /** -1 = 停在导航位；>= 0 = 第几个文档 tab */
  readonly active: number
  /** 按 key 挂的附加信息（标题、库内路径），只给文档 tab；关 tab / 原地替换时清掉没人再用的 key */
  readonly meta: ReadonlyMap<string, TabMeta>
}

export interface TabsModel<T> {
  init(hub: T): TabsState<T>
  /** 导航位换成 h 并停在导航位（文档 tab 原样留着） */
  showHub(s: TabsState<T>, h: T): TabsState<T>
  /** 同 key 已开：聚焦并换成 t；否则追加并聚焦 */
  open(s: TabsState<T>, t: T): TabsState<T>
  /** 聚焦第 i 个文档 tab；给了 t 就把它换成 t（同篇换了锚点） */
  focus(s: TabsState<T>, i: number, t?: T): TabsState<T>
  /** 原地把活动文档 tab 换成 t（调用方已确认 t 不在别的 tab）；停在导航位时不动 */
  replace(s: TabsState<T>, t: T): TabsState<T>
  /** 关第 i 个：关左侧活动左移、关自己接右侧（末尾回左侧）、关最后一个回导航位；停在导航位时仍停在导航位 */
  close(s: TabsState<T>, i: number): TabsState<T>
  /** 只留第 i 个，它成为活动 */
  closeOthers(s: TabsState<T>, i: number): TabsState<T>
  /** 关掉 i 右边的全部；活动被关时落到 i */
  closeRight(s: TabsState<T>, i: number): TabsState<T>
  /** 把第 from 个挪到 to；活动跟着那一篇走 */
  move(s: TabsState<T>, from: number, to: number): TabsState<T>
  /** 整体换成存档（持久化恢复）：按 key 去重保留先出现的；active 允许 -1，越界取 0；没有 tab 时为 -1 */
  restore(s: TabsState<T>, hub: T, tabs: readonly T[], active: number): TabsState<T>
  /** 合并附加信息（只认文档 tab 里有的 key） */
  setMeta(s: TabsState<T>, t: T, patch: TabMeta): TabsState<T>
  /** 清掉全部 tab 的某一项附加信息（库变更后标题作废） */
  clearMeta(s: TabsState<T>, field: keyof TabMeta): TabsState<T>
}

export function createTabsModel<T>(o: { key(t: T): string; same(a: T, b: T): boolean }): TabsModel<T> {
  const { key, same } = o
  const inRange = (s: TabsState<T>, i: number) => Number.isInteger(i) && i >= 0 && i < s.tabs.length
  // 附加信息只留文档 tab 里还在的 key；一项没少就沿用原 Map
  const prune = (meta: ReadonlyMap<string, TabMeta>, tabs: readonly T[]): ReadonlyMap<string, TabMeta> => {
    if (!meta.size) return meta
    const live = new Set(tabs.map(key))
    let gone = false
    for (const k of meta.keys()) if (!live.has(k)) { gone = true; break }
    if (!gone) return meta
    return new Map([...meta].filter(([k]) => live.has(k)))
  }
  const make = (s: TabsState<T>, tabs: readonly T[], active: number): TabsState<T> =>
    ({ hub: s.hub, tabs, active: tabs.length ? active : -1, meta: prune(s.meta, tabs) })

  const focus: TabsModel<T>['focus'] = (s, i, t) => {
    if (!inRange(s, i)) return s
    const swap = t !== undefined && !same(s.tabs[i], t)
    if (s.active === i && !swap) return s
    return make(s, swap ? s.tabs.map((x, j) => (j === i ? t! : x)) : s.tabs, i)
  }

  return {
    init: (hub) => ({ hub, tabs: [], active: -1, meta: new Map() }),
    showHub: (s, h) => {
      if (s.active === -1 && same(s.hub, h)) return s
      return { ...s, hub: h, active: -1 }
    },
    open: (s, t) => {
      const i = s.tabs.findIndex((x) => key(x) === key(t))
      if (i >= 0) return focus(s, i, t)
      return make(s, [...s.tabs, t], s.tabs.length)
    },
    focus,
    replace: (s, t) => {
      if (s.active < 0 || same(s.tabs[s.active], t)) return s
      return make(s, s.tabs.map((x, j) => (j === s.active ? t : x)), s.active)
    },
    close: (s, i) => {
      if (!inRange(s, i)) return s
      const tabs = s.tabs.filter((_, j) => j !== i)
      // 停在导航位：仍停着；关左侧：活动左移一格；关自己：同下标即右邻（末尾则回左侧）；关右侧：不动
      const active = s.active === -1 ? -1
        : i < s.active ? s.active - 1
        : i === s.active ? Math.min(i, tabs.length - 1)
        : s.active
      return make(s, tabs, active)
    },
    closeOthers: (s, i) => {
      if (!inRange(s, i) || (s.tabs.length === 1 && s.active === 0)) return s
      return make(s, [s.tabs[i]], 0)
    },
    closeRight: (s, i) => {
      if (!inRange(s, i) || i === s.tabs.length - 1) return s
      return make(s, s.tabs.slice(0, i + 1), s.active > i ? i : s.active)
    },
    move: (s, from, to) => {
      if (!inRange(s, from) || !inRange(s, to) || from === to) return s
      const tabs = [...s.tabs]
      const [t] = tabs.splice(from, 1)
      tabs.splice(to, 0, t)
      if (s.active === -1) return { ...s, tabs }
      const activeKey = key(s.tabs[s.active])
      return { ...s, tabs, active: tabs.findIndex((x) => key(x) === activeKey) }
    },
    restore: (_s, hub, list, active) => {
      const seen = new Set<string>()
      const tabs: T[] = []
      for (const t of list) { const k = key(t); if (!seen.has(k)) { seen.add(k); tabs.push(t) } }
      if (!tabs.length || active === -1) return { hub, tabs, active: -1, meta: new Map() }
      const want = Number.isInteger(active) && active >= 0 && active < list.length ? key(list[active]) : key(tabs[0])
      return { hub, tabs, active: Math.max(0, tabs.findIndex((x) => key(x) === want)), meta: new Map() }
    },
    setMeta: (s, t, patch) => {
      const k = key(t)
      if (!s.tabs.some((x) => key(x) === k)) return s
      const cur = s.meta.get(k) ?? {}
      const next = { ...cur, ...patch }
      if ((Object.keys(next) as (keyof TabMeta)[]).every((f) => next[f] === cur[f])) return s
      const meta = new Map(s.meta)
      meta.set(k, next)
      return { ...s, meta }
    },
    clearMeta: (s, field) => {
      let hit = false
      const meta = new Map<string, TabMeta>()
      for (const [k, v] of s.meta) {
        if (v[field] === undefined) { meta.set(k, v); continue }
        hit = true
        const { [field]: _drop, ...rest } = v
        if (Object.keys(rest).length) meta.set(k, rest)
      }
      return hit ? { ...s, meta } : s
    },
  }
}
