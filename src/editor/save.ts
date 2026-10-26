import type { EditorIo } from './io'
import type { SaveStatus } from './io'

// 自动保存：停止输入 1 秒写盘，带着上次读 / 写时的 hash；磁盘上已不是这个 hash（别处改过）Host 拒写 → 冲突态，停止自动保存。
// 内容与磁盘上一致时不写（打开不改、改了又撤回都不产生写入）
export interface Saver {
  schedule(text: string): void
  flush(): Promise<void>
  overwrite(): Promise<void>
  /** 收到库变化推送时调：自己写的忽略；别处改了且本地没有未存内容 → 给出新原文重载；有未存内容 → 冲突 */
  external(): Promise<{ kind: 'ignored' } | { kind: 'reload'; text: string } | { kind: 'conflict' }>
  reset(text: string, hash: string): void
  /** 编辑器卸载后调：状态不再上报（编辑态 store 可能已换给下一页），失败重试最多 3 次 */
  detach(): void
  /** 本次编辑自己写过盘，且盘上内容与载入（或最近一次重载）时不同——退出编辑（查看）时据此决定刷不刷 updated */
  readonly changed: boolean
  readonly conflict: boolean
  readonly dirty: boolean
}

export function createSaver(io: Pick<EditorIo, 'load' | 'save'>, text: string, hash: string, onStatus: (s: SaveStatus) => void): Saver {
  let orig = text          // 载入或最近一次重载时的原文
  let wrote = false        // 自己写成功过
  let detached = false
  let retries = 0
  let disk = text          // 磁盘上（就本编辑器所知）的内容
  let base = hash
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflight: Promise<void> | null = null
  let conflict = false
  const set = (s: SaveStatus) => { if (!detached) onStatus(s) }
  const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void flush(), ms) }

  async function flush() {
    clearTimeout(timer)
    while (inflight) await inflight
    if (pending === null || conflict) return
    const t = pending
    pending = null
    if (t === disk) { set('saved'); return }
    set('saving')
    inflight = io.save(t, base).then((r) => {
      if (r.ok) { base = r.hash; disk = t; wrote = true; retries = 0; if (pending === null) set('saved'); else { set('dirty'); arm(1000) } }
      else { pending ??= t; conflict = true; set('conflict') }
    }, () => { pending ??= t; set('error'); if (!detached || ++retries <= 3) arm(3000) }).finally(() => { inflight = null })
    await inflight
  }

  return {
    schedule(t) { pending = t; if (conflict) return; set('dirty'); arm(1000) },
    flush,
    async overwrite() {
      // 重读失败（文件恰被删 / RPC 断）：留着冲突态，不裸抛（包内纪律：不允许裸 promise）
      let cur: { text: string; hash: string }
      try { cur = await io.load() } catch (e) { console.error('[dsh-knowledge-brain] 覆盖时重读失败', e); return }
      base = cur.hash; disk = cur.text; conflict = false
      pending ??= disk
      await flush()
    },
    async external() {
      while (inflight) await inflight
      const cur = await io.load()
      if (cur.hash === base) return { kind: 'ignored' }
      if (pending === null || pending === disk) { base = cur.hash; disk = cur.text; orig = cur.text; wrote = false; pending = null; set('saved'); return { kind: 'reload', text: cur.text } }
      conflict = true; clearTimeout(timer); set('conflict')
      return { kind: 'conflict' }
    },
    reset(t, h) { clearTimeout(timer); disk = t; orig = t; wrote = false; base = h; pending = null; conflict = false; set('saved') },
    detach() { detached = true },
    get changed() { return wrote && disk !== orig },
    get conflict() { return conflict },
    get dirty() { return pending !== null && pending !== disk },
  }
}
