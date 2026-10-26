// src/exfonts.ts
// excalidraw 字体资产的离线服务：包里不带字体文件、默认回退 esm.sh CDN（断网即失手绘体），
// 所以 230 个 woff2（含中文手写体 Xiaolai 的 209 个 unicode-range 子集）随插件分发在
// assets/excalidraw/，浏览器按需取子集（FontFace 按 unicode-range 触发下载，不是一次全拉）。
// connection.fetch 只收精确路径、字体 URL 是 /api/wiki.exfonts/fonts/<族>/<文件> 子路径——
// 所以走 webServer 的 prefix 原生路由（/api 通道同款挂法），auth 复用 connection.admit。
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { pkgRoot } from './pkg'
import type { Context } from '@deepseek-ai/cordis'

// 只认 fonts/<族>/<名>.woff2 与独立件 excalidraw.iife.js/.css：杜绝 ../ 与怪后缀
const FONT = /^fonts\/[A-Za-z]+\/[A-Za-z0-9._-]+\.woff2$/
const IIFE = /^excalidraw\.iife\.(js|css)$/

/** 取件纯函数（测试面）：合法返回响应体（流）与头，否则 null。root 一般是插件包根。 */
export function exfontResponse(root: string, urlPath: string): { body: ReadableStream; headers: Record<string, string> } | null {
  const rel = urlPath.replace(/^\/+/, '')
  const isFont = FONT.test(rel)
  if (!isFont && !IIFE.test(rel)) return null
  const abs = join(root, 'assets/excalidraw', rel)
  let size: number
  try { size = statSync(abs).size } catch { return null }
  return {
    body: Readable.toWeb(createReadStream(abs)) as ReadableStream,
    headers: {
      'Content-Type': isFont ? 'font/woff2' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
      'Content-Length': String(size),
      // 字体名带内容哈希、版本升级才换名——永久缓存；iife 件同名随包升级换内容，只缓存一天
      'Cache-Control': isFont ? 'private, max-age=31536000, immutable' : 'private, max-age=86400',
    },
  }
}

/** 前缀路由的路径剥壳（纯函数，测试面）：坏 % 编码返回 null（404），不外抛 URIError 炸宿主 */
export function exfontRelOf(pathname: string): string | null {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  return decoded.replace(/^\/api\/wiki\.exfonts\/?/, '')
}

/** 挂 /api/wiki.exfonts 前缀路由（GET/HEAD），照 ws.ts 的 inject(['webServer']) 挂法。 */
export function registerExfontsRoute(ctx: Context) {
  ;(ctx as any).inject(['webServer'], (wc: any) => {
    wc.effect(() => wc.webServer.register({
      kind: 'prefix',
      path: '/api/wiki.exfonts',
      handler: (req: any, res: any) => {
        const admission = (wc as any).connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection, admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
        const rel = exfontRelOf(new URL(req.url ?? '/', 'http://dsh.invalid').pathname)
        const r = rel === null ? null : exfontResponse(pkgRoot(), rel)
        if (!r) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200, r.headers)
        if (req.method === 'HEAD') { res.end(); return }
        // 管道写侧必挂 error（宿主崩溃纪律）：stat 与 open 之间文件可能消失（升级/清理竞态）
        Readable.fromWeb(r.body as any).on('error', (e: unknown) => {
          console.error('[dsh-knowledge-brain] 字体资产流出错', e)
          res.destroy()
        }).pipe(res)
      },
    }), 'dsh-knowledge-brain.exfonts')
  })
}
