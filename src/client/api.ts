import type { Context } from '@deepseek-ai/cordis'
import type { Book, ChapterData, Document, GraphData, HomeData, PageResult, RawResult, RecentPage, SearchHit, TagPage, TreeNode, VaultStatus } from '../core/api'

// 平台 browse 目录清单的形状（对齐 @deepseek-ai/dsh-host-directory-picker 的 DirectoryListing；
// 那是 Host 包，客户端编译面不能引，这里按契约本地声明）
export interface DirEntry { name: string; path: string; hidden: boolean }
export interface DirListing { path: string; home: string; crumbs: DirEntry[]; entries: DirEntry[]; truncated: boolean }

// Lark问答通道的只读视图（对齐 src/lark/mount.ts 的 LarkHandle；两处都不含 app_secret）
export interface LarkStatusApp { appId: string; folder: string; model: string; name: string; connected: boolean; botReady: boolean; folderExists: boolean }
export type VaultPhaseView = 'none' | 'validating' | 'failed' | 'ok'
export interface LarkStatusView { connected: boolean; serving: number; phase: VaultPhaseView; apps: LarkStatusApp[] }
// MCP 端点的只读视图（对齐 src/mcp/mount.ts 的 McpStatusView；不含 token）
export interface McpStatusView {
  /** 库所处阶段（none 没配库 / validating 校验中 / failed 校验失败或打不开 / ok） */
  phase: VaultPhaseView
  /** 'http://127.0.0.1:<端口>'；宿主还没给端口时 null */
  endpointBase: string | null
  servers: { endpoint: string; name: string; folder: string; folderExists: boolean }[]
}

export type ClientChangeEvent =
  | { kind: 'patch'; ids: string[]; flags: { tree?: boolean; stats?: boolean; graph?: boolean; documents?: boolean } }
  | { kind: 'structural' }

// 载荷解析：旧宿主裸文本 'changed' 一律按 structural 兜底——协议自愈，无版本协商；形状不对返回 null（当没收到）
export function parseChange(text: string): ClientChangeEvent | null {
  if (text === 'changed') return { kind: 'structural' }
  try {
    const v = JSON.parse(text)
    if (v && v.kind === 'structural') return { kind: 'structural' }
    if (v && v.kind === 'patch' && Array.isArray(v.ids)) return { kind: 'patch', ids: v.ids.map(String), flags: v.flags ?? {} }
  } catch { /* 坏帧 */ }
  return null
}

export type TreePlace = { before?: string; after?: string; first?: true }

export interface WikiApi {
  status(): Promise<VaultStatus>
  /** 问后端形态：native 直接返回选好的路径（取消为 null），browse 让前端弹层浏览 */
  pickDir(): Promise<{ kind: 'browse' } | { kind: 'native'; path: string | null }>
  /** browse：列一层子目录（path 空 = 主目录），条目自带绝对路径，前端不拼路径 */
  fsDirs(path: string): Promise<DirListing>
  initPlan(dir: string): Promise<import('../core/vault/create').InitPlan>
  reopen(): Promise<{ ok: boolean }>
  create(dir: string, template: 'minimal' | 'preset'): Promise<import('../core/vault/create').InitReport>
  /** browse：当前目录下新建文件夹，返回新目录绝对路径 */
  fsMkdir(path: string, name: string): Promise<{ path: string }>
  home(): Promise<HomeData>
  /** 沉淀草稿页全量（首页看板只取前 7） */
  drafts(): Promise<RecentPage[]>
  /** 沉淀动态：全部页按更新时间倒序 */
  recent(): Promise<RecentPage[]>
  page(id: string): Promise<PageResult>
  tree(): Promise<{ children: TreeNode[] }>
  graph(): Promise<GraphData>
  tag(tag: string): Promise<TagPage[]>
  search(q: string): Promise<SearchHit[]>
  rawTree(): Promise<{ children: TreeNode[] }>
  raw(path: string): Promise<RawResult>
  onChanged(cb: (ev: ClientChangeEvent) => void): () => void
  // 探索区：书与文档（读）
  books(): Promise<Book[]>
  book(name: string): Promise<Book>
  chapter(book: string, id: string): Promise<ChapterData>
  documents(): Promise<Document[]>
  document(path: string): Promise<Document>
  // 写库（只这四个，Host 端校验）
  readChapter(book: string, id: string): Promise<{ ok: true }>
  convertBook(book: string): Promise<{ ok: true }>
  deposit(book: string, id: string, done?: boolean): Promise<{ ok: true }>
  cover(path: string, grade: 'processing' | 'done'): Promise<{ ok: true }>
  mark(path: string): Promise<{ ok: true }>
  // 目录拖动（Host 白名单：沉淀四区之内）。place 都不给 = 排最后
  reorder(node: string, place: TreePlace): Promise<{ ok: true }>
  move(node: string, folder: string, place: TreePlace): Promise<{ ok: true }>
  /** 跨文件夹确认框：库里别处有几页链进被移节点 */
  moveImpact(node: string): Promise<{ pages: number }>
  // 编辑正文（沉淀页或 raw/ 下的 md；Host 白名单）
  source(path: string): Promise<{ text: string; hash: string }>
  save(path: string, text: string, baseHash: string): Promise<{ ok: true; hash: string } | { ok: false; conflict: true; hash: string }>
  touchUpdated(path: string): Promise<{ hash: string }>
  /** excalidraw 场景保存（后写覆盖；Host 白名单 asset/diagrams/**.excalidraw） */
  saveExcalidraw(path: string, scene: unknown): Promise<{ ok: true }>
  renderBlocks(path: string, srcs: string[]): Promise<{ htmls: string[] }>
  resolveNames(names: string[]): Promise<Record<string, { id: string | null; dead?: string }>>
  resolve(name: string): Promise<{ id: string | null }>
  // Lark问答通道（只读视图；status 不含 secret）
  larkStatus(): Promise<LarkStatusView>
  // 验证草稿凭证（未保存也能验）：secret 只进请求，结果只有 ok/botName/detail
  // missing：未授权的权限（level=required 缺了即不通过）；scopeError：授权状态没查到
  larkVerify(appId: string, appSecret: string): Promise<{
    ok: boolean; botName?: string; detail?: string
    missing?: { scope: string; label: string; level: 'required' | 'group' | 'optional' }[]
    scopeError?: string
  }>
  // 补连已存配置里的机器人（检测通过后调；没连着才真连，等到结果）
  larkReconnect(appId: string): Promise<{ saved: boolean; connected: boolean; already?: boolean; detail?: string }>
  /** MCP 端点状态（设置卡 MCP 区用；不含 token） */
  mcpStatus(): Promise<McpStatusView>
}

// Host 的 RPC 挂在 /api/wiki.rpc（见 src/host/rpc.ts）；文档相对地址，cookie 随请求带上
async function call(method: string, payload: object = {}) {
  const res = await fetch('api/wiki.rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }) })
  const r = await res.json().catch(() => ({ ok: false, error: { message: `HTTP ${res.status}` } }))
  if (!r.ok) throw new Error(r.error?.message ?? `HTTP ${res.status}`)
  return r.value as any
}

type Sock = { close(): void; addEventListener(ev: string, l: (e: any) => void): void }
const openSocket = (ctx: Context, path: string): Sock => {
  const conn = (ctx as any).get?.('connection')
  if (typeof conn?.openWebSocket === 'function') return conn.openWebSocket(path)
  const u = new URL(path.slice(1), typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(u.href)
}

export function createWikiClient(ctx: Context): WikiApi {
  const listeners = new Set<(ev: ClientChangeEvent) => void>()
  let running = false
  let sock: Sock | null = null
  let disposed = false
  const fire = (ev: ClientChangeEvent) => { for (const l of listeners) l(ev) }
  // 长连接（WS，不占浏览器同源 HTTP 并发名额——SSE 一条常驻就占一条，多 tab 就把池吃满）：
  // 每收到一条 changed 通知一次；断了 2 秒后重连，重连后收到 ready 也通知一次让视图重取
  const loop = async () => {
    if (running) return
    running = true
    let first = true
    while (listeners.size && !disposed) {
      try {
        await new Promise<void>((resolve) => {
          const ws = openSocket(ctx, '/api/wiki.events')
          sock = ws
          ws.addEventListener('message', (ev) => {
            const text = String(ev.data)
            if (text === 'ready') { if (!first) fire({ kind: 'structural' }); first = false; return }
            const c = parseChange(text)
            if (c) fire(c)
          })
          ws.addEventListener('close', () => resolve())
          ws.addEventListener('error', () => { try { ws.close() } catch { /* 已关 */ } })
        })
      } catch { /* 建连失败，稍后重连 */ }
      sock = null
      if (listeners.size && !disposed) await new Promise((r) => setTimeout(r, 2000))
    }
    running = false
  }
  ctx.on('connection/reset' as any, () => fire({ kind: 'structural' }))
  // 插件卸载时断开长连接；最后一个订阅者离开时也断开
  ctx.effect(() => () => { disposed = true; sock?.close() }, 'dsh-knowledge-brain: events')
  return {
    status: () => call('status'), pickDir: () => call('pickDir'), fsDirs: (path) => call('fsDirs', { path }), fsMkdir: (path, name) => call('fsMkdir', { path, name }),
    initPlan: (dir) => call('initPlan', { dir }), reopen: () => call('reopen'), create: (dir, template) => call('create', { dir, template }),
    home: () => call('home'), drafts: () => call('drafts'), recent: () => call('recent'),
    page: (id) => call('page', { id }),
    tree: () => call('tree'), graph: () => call('graph'), tag: (tag) => call('tag', { tag }),
    search: (q) => call('search', { q }), rawTree: () => call('rawTree'),
    raw: (path) => call('raw', { path }),
    books: () => call('books'), book: (name) => call('book', { name }), chapter: (book, id) => call('chapter', { book, id }),
    documents: () => call('documents'), document: (path) => call('document', { path }),
    readChapter: (book, id) => call('readChapter', { book, id }), convertBook: (book) => call('convertBook', { book }),
    deposit: (book, id, done) => call('deposit', { book, id, done: !!done }), cover: (path, grade) => call('cover', { path, grade }),
    mark: (path) => call('mark', { path }),
    reorder: (node, place) => call('reorder', { node, place }),
    move: (node, folder, place) => call('move', { node, folder, place }),
    moveImpact: (node) => call('moveImpact', { node }),
    source: (path) => call('source', { path }), save: (path, text, baseHash) => call('save', { path, text, baseHash }),
    touchUpdated: (path) => call('touchUpdated', { path }), renderBlocks: (path, srcs) => call('renderBlocks', { path, srcs }),
    saveExcalidraw: (path, scene) => call('saveExcalidraw', { path, scene }),
    resolveNames: (names) => call('resolveNames', { names }),
    resolve: (name) => call('resolve', { name }),
    larkStatus: () => call('larkStatus'),
    larkVerify: (appId, appSecret) => call('larkVerify', { appId, appSecret }),
    larkReconnect: (appId) => call('larkReconnect', { appId }),
    mcpStatus: () => call('mcpStatus'),
    onChanged(cb) { listeners.add(cb); void loop(); return () => { listeners.delete(cb); if (!listeners.size) sock?.close() } },
  }
}
