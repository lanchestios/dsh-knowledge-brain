// 阅读器 tab 持久化：重启后恢复上次的 tab 与停在哪个。存本机 localStorage（不跨设备），按库目录
// v2 存 { hub, tabs, active }（active = -1 停在导航位）。旧版本存档不迁移：读到版本不对的直接删掉，当没有存档
// 分键（换库不串）；只存路由与活动下标——标题、路径由 pane 加载后重新上报。读出来的路由逐个校验，
// 坏的丢掉（页已删 / 改名的照样恢复，打开时走「载入失败」视图）。localStorage 读写全包 try/catch：
// 读不到、配额满都只是不记住，不影响使用
import { isDoc, type DocumentFilter, type Route, type TabsNavStore } from '../../lib/nav'

const VERSION = 2
const FILTERS: readonly DocumentFilter[] = ['待沉淀', '未沉淀', '沉淀中', '已引用', '完成', '全部']

export const storageKey = (dir: string): string => `dsh-knowledge-brain:tabs:${dir.replace(/\/+$/, '')}`

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string'

/** 一条存档里的路由 → Route；字段缺 / 类型不对 / 不认识的 kind 返回 null */
export function parseRoute(x: unknown): Route | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  switch (r.kind) {
    case 'kb': case 'books': case 'drafts': case 'activity':
      return { kind: r.kind }
    case 'page':
      return str(r.id) && optStr(r.anchor) ? { kind: 'page', id: r.id, ...(r.anchor ? { anchor: r.anchor as string } : {}) } : null
    case 'graph':
      return optStr(r.focus) ? { kind: 'graph', ...(r.focus ? { focus: r.focus as string } : {}) } : null
    case 'tag':
      return str(r.tag) ? { kind: 'tag', tag: r.tag } : null
    case 'raw':
      return str(r.path) ? { kind: 'raw', path: r.path } : null
    case 'book':
      return str(r.name) ? { kind: 'book', name: r.name } : null
    case 'chapter':
      // title 要带回：重启后非活动 tab 不挂 pane、没人上报真标题，tab 条只能靠它占位（丢了就退成章号）
      return str(r.book) && str(r.id) && optStr(r.title) ? { kind: 'chapter', book: r.book, id: r.id, ...(r.title ? { title: r.title as string } : {}) } : null
    case 'documents':
      if (r.status === undefined) return { kind: 'documents' }
      return FILTERS.includes(r.status as DocumentFilter) ? { kind: 'documents', status: r.status as DocumentFilter } : null
    default:
      return null
  }
}

const local = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }

export function loadTabs(dir: string, storage: Storage | null = local()): { hub: Route; tabs: Route[]; active: number } | null {
  try {
    const raw = storage?.getItem(storageKey(dir))
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v || v.v !== VERSION) {
      // 旧版本（上一版的 v: 1 等）不迁移：删掉，当没有存档
      try { storage?.removeItem(storageKey(dir)) } catch { /* 删不掉也只是下次再删 */ }
      return null
    }
    if (!Array.isArray(v.tabs)) return null
    const h = parseRoute(v.hub)
    const hub: Route = h && !isDoc(h) ? h : { kind: 'kb' }
    const tabs: Route[] = []
    let active = -1
    v.tabs.forEach((x: unknown, i: number) => {
      const r = parseRoute(x)
      if (!r || !isDoc(r)) return
      if (i === v.active) active = tabs.length
      tabs.push(r)
    })
    return { hub, tabs, active }
  } catch { return null }
}

export function saveTabs(dir: string, hub: Route, tabs: readonly Route[], active: number, storage: Storage | null = local()): void {
  try { storage?.setItem(storageKey(dir), JSON.stringify({ v: VERSION, hub, tabs, active })) } catch { /* 配额满 / 不可用：只是不记住 */ }
}

/** 接上持久化：store 没动过就恢复存档；之后每次变化防抖写入。返回退订（顺手把没落盘的那次写掉）。
 *  switched = 从别的库换过来：手上的 tab 属于旧库（旧库的退订已经写回旧库），不管动没动过都换成
 *  新库的存档，新库没存档就回到只有首页的导航位——换库不串 */
export function persistTabs(store: TabsNavStore, dir: string, o: { storage?: Storage | null; delayMs?: number; switched?: boolean } = {}): () => void {
  const storage = o.storage === undefined ? local() : o.storage
  const delay = o.delayMs ?? 300
  if (o.switched || store.pristine()) {
    const got = loadTabs(dir, storage)
    if (got) store.restore(got.hub, got.tabs, got.active)
    else if (o.switched) store.restore({ kind: 'kb' }, [], -1)
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => { timer = null; const s = store.get(); saveTabs(dir, s.hub, s.tabs, s.active, storage) }
  const off = store.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delay)
  })
  return () => {
    off()
    if (timer) { clearTimeout(timer); flush() }
  }
}
