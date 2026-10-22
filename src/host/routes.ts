import { createReadStream, readFileSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { inside } from '../core/guard'
import type { Hub } from '../core/hub'
import { registerWsEvents, type WsServerLike } from './ws'

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.md': 'text/plain; charset=utf-8',
  '.excalidraw': 'application/json; charset=utf-8',
}

// asset/ 页嵌进正文时（![](asset/….html)）要自适应高度：页里注入一段脚本，把内容高度 postMessage 给外层，
// surface.ts 收到后给对应 iframe 定高。沙箱页没有同源，只能发消息；外层只认这一个数字字段
const HEIGHT_REPORTER = '<script>(function(){var d=document.documentElement,last=0;function r(){var h=Math.ceil(d.scrollHeight);'
  + 'if(h!==last){last=h;parent.postMessage({dshWikiEmbedHeight:h},"*")}}'
  + 'addEventListener("load",r);if(window.ResizeObserver)new ResizeObserver(r).observe(d);r()})()</script>'

// 嵌入页的明暗跟宿主（DSH 夜间是宿主 body[data-ds-dark-theme]，沙箱 iframe 里的 prefers-color-scheme
// 只跟系统走，感知不到）。约定：嵌入页的颜色只认 <html> 上的 data-dsh-theme="dark|light"。
// - 首帧：客户端给嵌入件 src 补 &theme=（embed-theme.ts），这里下发时直接把属性写进 <html> 标签，
//   不等任何消息；没带 theme 的直开页按系统兜底
// - 切换：注入的监听收到宿主广播的 dshWikiTheme 就改属性（surface.ts 的桥，沿高度上报回信、切换时重推）
// - color-scheme 统一在这里跟属性走，嵌入页自己不写：iframe 与宿主 color-scheme 不一致时 Chromium
//   在 iframe 背后垫一层不透明画布（宿主暗、嵌入页按 light 算就是白底），body 透明也透不到宿主
const THEME_STYLE = '<style>html[data-dsh-theme="dark"]{color-scheme:dark}html[data-dsh-theme="light"]{color-scheme:light}'
  + '@media (prefers-color-scheme: dark){html:not([data-dsh-theme]){color-scheme:dark}}</style>'
const THEME_LISTENER = '<script>(function(){addEventListener("message",function(e){var t=e&&e.data&&e.data.dshWikiTheme;'
  + 'if(t==="dark"||t==="light")document.documentElement.setAttribute("data-dsh-theme",t)})})()</script>'

export function injectEmbedScripts(html: string, theme?: string | null): string {
  let out = html
  if (theme === 'dark' || theme === 'light') {
    // 页里自带的 data-dsh-theme 先摘掉，以宿主为准
    out = out.replace(/<html\b([^>]*)>/i, (_m, attrs: string) =>
      `<html${attrs.replace(/\s+data-dsh-theme\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/i, '')} data-dsh-theme="${theme}">`)
  }
  const head = /<head\b[^>]*>/i.exec(out)
  out = head ? out.slice(0, head.index + head[0].length) + THEME_STYLE + out.slice(head.index + head[0].length) : THEME_STYLE + out
  const i = out.toLowerCase().lastIndexOf('</body>')
  const tail = HEIGHT_REPORTER + THEME_LISTENER
  return i < 0 ? out + tail : out.slice(0, i) + tail + out.slice(i)
}

export function registerRoutes(ctx: Context, hub: Hub, makeServer?: () => WsServerLike) {
  const fetch = (ctx as any).connection.fetch

  // 文档与听录字节：只许 raw/ 与 asset/ 下
  fetch.register({
    path: '/api/wiki.asset', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    fetch: async (req: Request) => {
      const q = new URL(req.url).searchParams
      const rel = q.get('path') ?? ''
      const abs = rel.startsWith('raw/') ? inside(hub.dir(), rel, 'raw') : inside(hub.dir(), rel, 'asset')
      if (!abs) return new Response('forbidden', { status: 403 })
      let size: number
      try { size = statSync(abs).size } catch { return new Response('not found', { status: 404 }) }
      const ext = extname(abs).toLowerCase()
      const headers: Record<string, string> = {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Content-Length': String(size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      }
      // 与 DSH 同源：可执行内容一律进 CSP 沙箱，拿不到 cookie 与 /api。
      // asset/ 的可交互页要跑脚本（不给同源）；raw/ 是抓来的网页，脚本也不给
      if (['.html', '.htm', '.svg'].includes(ext)) headers['Content-Security-Policy'] = rel.startsWith('asset/') ? 'sandbox allow-scripts' : 'sandbox'
      if (req.method === 'HEAD') return new Response(null, { headers })
      if (rel.startsWith('asset/') && (ext === '.html' || ext === '.htm')) {
        const body = injectEmbedScripts(readFileSync(abs, 'utf8'), q.get('theme'))
        headers['Content-Length'] = String(Buffer.byteLength(body))
        return new Response(body, { headers })
      }
      return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers })
    },
  })

  // 变更推送（WS，见 ws.ts 的连接池说明）：连接先发 ready，之后库每变发 JSON 载荷（tools 只喂队列不上 WS）
  registerWsEvents(ctx, '/api/wiki.events', 'dsh-knowledge-brain.events', (send) => {
    send('ready')
    return hub.onChanged((ev) => { if (ev.kind !== 'tools') send(JSON.stringify(ev)) })
  }, makeServer)
}
