import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ClientChangeEvent } from '../api'

// 编辑态：一个面板一份，顶栏（编辑 / 查看按钮、保存状态）与正文（阅读 ↔ 编辑器）共用。
// 右侧 wiki 页 tab 不提供 EditCtx，所以不给编辑
export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'conflict' | 'error'
export interface EditState { path: string | null; status: SaveStatus }
export interface EditHandle { reload(): void; overwrite(): void }
export interface EditStore {
  get(): EditState
  subscribe(l: () => void): () => void
  start(path: string): void
  stop(): void
  setStatus(s: SaveStatus): void
  /** 编辑器挂上来的冲突处理，顶栏的「重新载入」「覆盖」调它 */
  handle: EditHandle | null
}

export function createEditStore(): EditStore {
  let v: EditState = { path: null, status: 'saved' }
  const ls = new Set<() => void>()
  const set = (n: EditState) => { v = n; ls.forEach((l) => l()) }
  return {
    get: () => v,
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l) } },
    start: (path) => set({ path, status: 'saved' }),
    stop: () => { if (v.path !== null) set({ path: null, status: 'saved' }) },
    setStatus: (status) => { if (status !== v.status) set({ ...v, status }) },
    handle: null,
  }
}

export const EditCtx = createContext<EditStore | null>(null)
const IDLE: EditState = { path: null, status: 'saved' }
const none = () => () => {}

export function useEdit(): EditState & { store: EditStore | null } {
  const store = useContext(EditCtx)
  const st = useSyncExternalStore(store?.subscribe ?? none, store?.get ?? (() => IDLE))
  return { ...st, store }
}

// 这份编辑对象要不要回询：structural 恒要；patch 看它在不在 ids 里；
// documents 面只关 raw/ 下的编辑对象（文档正文）。自己保存 → 自己路径必在 ids → hash 相符即 ignored。
export function touches(path: string, ev: ClientChangeEvent): boolean {
  if (ev.kind === 'structural') return true
  if (ev.ids.includes(path)) return true
  return !!ev.flags.documents && path.startsWith('raw/')
}

// patch 事件里被重写的 excalidraw 场景路径（rpc saveExcalidraw 广播、id 用资产路径）：
// WikiEditor 对这些 bump 版本 + refreshBlocks 定点重建块，不整页 reload
export function assetRefreshRels(ev: ClientChangeEvent): string[] {
  return ev.kind === 'patch' ? ev.ids.filter((i) => i.endsWith('.excalidraw')) : []
}
