// tab 沿条拖动的纯计算（TabsBar 用）：spans 是拖动开始时量的各 tab 位置，之后不再量——
// 其他 tab 的让位只是 transform，不改布局

export type Span = { left: number; width: number }

/** 被拖 tab 的位移夹在首尾 tab 之间：拖到头就贴着第一个 / 最后一个 */
export function clampDx(spans: readonly Span[], i: number, dx: number): number {
  const me = spans[i]
  return Math.max(spans[0].left - me.left, Math.min(spans[spans.length - 1].left - me.left, dx))
}

/** 目标下标：被拖 tab 的中心越过了哪些邻居的中心。位移先夹紧 */
export function slideTarget(spans: readonly Span[], i: number, dx: number): number {
  const d = clampDx(spans, i, dx)
  const c = spans[i].left + spans[i].width / 2 + d
  let to = i
  spans.forEach((s, k) => {
    const ck = s.left + s.width / 2
    if (k > i && c >= ck) to = Math.max(to, k)
    if (k < i && c <= ck) to = Math.min(to, k)
  })
  return to
}

/** 第 k 个 tab 的让位位移：被拖的从 i 到 to，夹在中间的让一个身位 w（被拖 tab 宽 + gap） */
export function shiftOf(i: number, to: number, k: number, w: number): number {
  if (k === i) return 0
  if (i < k && k <= to) return -w
  if (to <= k && k < i) return w
  return 0
}
