// 后台保活：tab 全挂着切回来最快，但开多了吃内存。只挂最近用过的 ALIVE_MAX 个；活动的、正在编辑的
// 必挂（编辑中的卸载了未保存内容会丢）。被卸的 tab 只是不渲染 pane，tab 条照常显示，点到再挂上
export const ALIVE_MAX = 8

/** 切到 key：挪到最近使用的最前，顺手去掉已经关掉的 */
export function touchRecent(recent: readonly string[], key: string, live: readonly string[]): string[] {
  const alive = new Set(live)
  return [key, ...recent.filter((k) => k !== key && alive.has(k))]
}

export function aliveKeys(o: { keys: readonly string[]; recent: readonly string[]; active: string; pinned: ReadonlySet<string>; max?: number }): Set<string> {
  const max = o.max ?? ALIVE_MAX
  const live = new Set(o.keys)
  const out = new Set<string>()
  if (live.has(o.active)) out.add(o.active)
  for (const k of o.pinned) if (live.has(k)) out.add(k)
  for (const k of o.recent) {
    if (out.size >= max) break
    if (live.has(k)) out.add(k)
  }
  return out
}
