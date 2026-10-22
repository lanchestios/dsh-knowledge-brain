import type { TreeNode } from '../../core/api'
import type { TreePlace } from '../api'

// 目录拖动的纯计算（TreePane 用）：行是当前可见的扁平行（未筛选），行高固定 32px。
// 落点规则见 spec「落点」：文件行 50% 分前后；文件夹行 28% / 72% 分前 / 放进 / 后（开着的「后」= 放进排第一）

export type DragRow = { key: string; rel: string | null; name: string; depth: number; dir: boolean; open: boolean; parent: number }
export type Drop = { folder: number; place: TreePlace; line: { y: number; depth: number } | null; into: number | null }

export function dragRows(rows: readonly { key: string; node: TreeNode; depth: number; open: boolean }[]): DragRow[] {
  const stack: number[] = []
  return rows.map((r, i) => {
    stack.length = r.depth
    const parent = r.depth === 0 ? -1 : stack[r.depth - 1]
    stack[r.depth] = i
    return { key: r.key, rel: r.node.rel, name: r.node.name, depth: r.depth, dir: r.node.dir, open: r.open, parent }
  })
}

/** 第 i 行连同展开的子孙占到哪一行之前 */
export function spanEnd(rows: readonly DragRow[], i: number): number {
  let j = i + 1
  while (j < rows.length && rows[j].depth > rows[i].depth) j++
  return j
}

/** 区根（顶层）不可拖；没有 rel 的行指认不了，也不可拖 */
export const canDrag = (rows: readonly DragRow[], i: number): boolean => !!rows[i] && rows[i].parent >= 0 && !!rows[i].rel

export function dropAt(rows: readonly DragRow[], from: number, y: number, rh = 32): Drop | null {
  if (!rows.length || !rows[from]) return null
  const k = Math.max(0, Math.min(rows.length - 1, Math.floor(y / rh)))
  const end = spanEnd(rows, from)
  if (k >= from && k < end) return null
  const r = rows[k]
  if (!r.rel) return null
  const fr = Math.max(0, Math.min(1, y / rh - k))
  let d: Drop
  if (r.dir && fr >= 0.28 && fr <= 0.72) d = { folder: k, place: {}, line: null, into: k }
  else if (fr < (r.dir ? 0.28 : 0.5)) d = { folder: r.parent, place: { before: r.rel }, line: { y: k * rh, depth: r.depth }, into: null }
  else if (r.dir && r.open) d = { folder: k, place: { first: true }, line: { y: (k + 1) * rh, depth: r.depth + 1 }, into: null }
  else d = { folder: r.parent, place: { after: r.rel }, line: { y: spanEnd(rows, k) * rh, depth: r.depth }, into: null }
  if (d.folder < 0) return null                          // 与四区并列：不能新造区
  if (d.folder >= from && d.folder < end) return null    // 进了自己或子孙
  if (d.folder === rows[from].parent) {                  // 同父：原位不算落点
    const sib = rows.map((x, i) => (x.parent === d.folder ? i : -1)).filter((i) => i >= 0)
    const at = sib.indexOf(from)
    const prev = rows[sib[at - 1]], next = rows[sib[at + 1]]
    const p = d.place
    if (p.before && next?.rel === p.before) return null
    if (p.after && prev?.rel === p.after) return null
    if (p.first && at === 0) return null
    if (!p.before && !p.after && !p.first && at === sib.length - 1) return null
  }
  return d
}

/** 乐观显示：把 node 挪进 folder 的指定位置，返回新树（不改入参）。找不到 node 原样返回 */
export function applyDrop(tree: { children: TreeNode[] }, node: string, folder: string, place: TreePlace): { children: TreeNode[] } {
  let moved = null as TreeNode | null
  const strip = (ns: TreeNode[]): TreeNode[] =>
    ns.filter((n) => { if (n.rel === node) { moved = n; return false } return true }).map((n) => ({ ...n, children: strip(n.children) }))
  const out = strip(tree.children)
  const m = moved
  if (!m) return tree
  const put = (ns: TreeNode[]): TreeNode[] => ns.map((n) => {
    if (!(n.dir && n.rel === folder)) return { ...n, children: put(n.children) }
    const kids = [...n.children]
    const ref = place.before ?? place.after
    const hit = ref ? kids.findIndex((c) => c.rel === ref) : -1
    const at = place.first ? 0 : hit < 0 ? kids.length : hit + (place.after ? 1 : 0)
    kids.splice(at, 0, m)
    return { ...n, children: kids }
  })
  return { children: put(out) }
}
