// /mcp/<endpoint> 路由：不在 /api 下（那里宿主强制浏览器 cookie），鉴权自己做。
// 顺序：Origin → 403（只服务非浏览器客户端，不发 CORS，堵 DNS rebinding）；endpoint + Bearer token → 401
// （不区分「没这个端点」与「token 错」）；非 POST → 405；体 >1MiB → 413。之后 node req/res ⇄ Web
// Request/Response，交给按 endpoint+folder+name 缓存的 SDK handler（name 进 serverInfo.title，改名也要重建）。
// 任何异常都兜成 500，不让 uncaught 炸宿主。
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { Readable, pipeline } from 'node:stream'
import { createFolderHandler } from './server'
import type { McpEntry } from './entries'
import type { Model } from '../core/model'

export const MCP_PREFIX = '/mcp'
export const MAX_BODY = 1024 * 1024
// authorization 只有本层要用，不转给 SDK
const HOP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade', 'authorization'])

const digest = (s: string) => createHash('sha256').update(s).digest()
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

function bearerOf(req: IncomingMessage): string | null {
  const m = /^\s*bearer\s+(.+?)\s*$/i.exec(String(req.headers.authorization ?? ''))
  return m ? m[1] : null
}

/** /mcp/<endpoint> 的 endpoint；不是恰好一段、解码失败、解码后含 / 都回 null */
function endpointOf(rawUrl: string | undefined): string | null {
  const path = new URL(rawUrl ?? '/', 'http://x').pathname
  const m = /^\/mcp\/([^/]+)$/.exec(path)
  if (!m) return null
  try { const n = decodeURIComponent(m[1]); return n === m[1] && !n.includes('/') ? n : null } catch { return null }
}

const send = (res: ServerResponse, status: number, text: string) => {
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let n = 0
    let over = false
    req.on('data', (c: Buffer) => { if (over) return; n += c.length; if (n > max) { over = true; chunks.length = 0 } else chunks.push(c) })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function createMcpRoute(deps: { entries(): McpEntry[]; getModel(): Model }) {
  const handlers = new Map<string, ReturnType<typeof createFolderHandler>>()   // `${endpoint}\0${folder}\0${name}` → handler
  const keyOf = (e: McpEntry) => `${e.endpoint}\0${e.folder}\0${e.name}`
  const handlerOf = (e: McpEntry) => {
    const key = keyOf(e)
    let h = handlers.get(key)
    if (!h) { h = createFolderHandler(deps.getModel, e.folder, e.name); handlers.set(key, h) }
    // 配置改过：丢掉不再存在的 endpoint+folder+name 组合
    const live = new Set(deps.entries().map(keyOf))
    for (const [k, old] of handlers) if (!live.has(k)) { handlers.delete(k); void old.close().catch(() => {}) }
    return h
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.headers.origin !== undefined) return send(res, 403, 'forbidden')
      const endpoint = endpointOf(req.url)
      const token = bearerOf(req)
      const entry = endpoint ? deps.entries().find((e) => e.endpoint === endpoint) : undefined
      if (!entry || token === null || !sameToken(token, entry.token)) return send(res, 401, 'unauthorized')
      if (req.method !== 'POST') return send(res, 405, 'method not allowed')
      const body = await readBody(req, MAX_BODY)
      if (body === null) return send(res, 413, 'payload too large')
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || HOP.has(k)) continue
        for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x)
      }
      const web = await handlerOf(entry).fetch(new Request(`http://127.0.0.1${req.url}`, { method: 'POST', headers, body: new Uint8Array(body) }))
      const out: Record<string, string> = {}
      web.headers.forEach((v, k) => { out[k] = v })
      res.writeHead(web.status, out)
      if (!web.body) { res.end(); return }
      // pipeline 两侧都挂 error、任一侧出错/客户端断开即销毁两侧（上游 Web body 随之 cancel）；回调吞掉错误
      pipeline(Readable.fromWeb(web.body as any), res, () => {})
    } catch (e) {
      console.error('[dsh-knowledge-brain] MCP 请求出错', e instanceof Error ? e.message : String(e))
      send(res, 500, 'internal error')
    }
  }

  return {
    handle,
    async close() { await Promise.allSettled([...handlers.values()].map((h) => h.close())); handlers.clear() },
  }
}
