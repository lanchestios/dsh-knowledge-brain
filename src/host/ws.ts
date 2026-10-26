// 事件推送的 WS 通道：webServer 上挂 upgrade 路由，connection.admit 过信任与 cookie 认证，
// 升级成 WebSocket 后每个连接各订阅一份事件。
// 为什么不用 SSE：浏览器对同源 HTTP/1.1 只有 6 条并发名额（dsh web 是裸 node:http，没有
// HTTP/2），一条常驻 SSE 就永久占一条；平台自己的 client-hmr 已每 tab 占一条，插件再各占
// 一条，三个 tab 开知识沉淀就把池吃满、第三个 tab 的 RPC 全部排队卡死。WebSocket 不占这个
// 池（平台的 /api/remote.mux 同理）。
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer } from 'ws'

/** 升级出来的连接：只用到发送与关闭面（真身是 ws 的 WebSocket，测试塞假货） */
export interface WsLike {
  readyState: number
  send(data: string): void
  terminate(): void
  on(evt: string, fn: (...a: any[]) => void): unknown
}

/** 升级服务面（真身是 ws 的 WebSocketServer{noServer:true}，测试塞假货） */
export interface WsServerLike {
  handleUpgrade(req: any, socket: any, head: any, cb: (ws: WsLike) => void): void
  close(): void
}

const OPEN = 1

/**
 * 挂一条事件 WS：onClient 在每个连接建立时收到已认证的 send（先发 ready 再各自订阅），
 * 返回退订函数，连接断开时调用；插件卸载时全部断开。
 */
export function registerWsEvents(ctx: Context, path: string, label: string,
  onClient: (send: (data: string) => void) => () => void,
  makeServer: () => WsServerLike = () => new WebSocketServer({ noServer: true }) as unknown as WsServerLike): void {
  ;(ctx as any).inject(['webServer'], (wc: any) => {
    const wss = makeServer()
    const clients = new Set<{ ws: WsLike; off: () => void }>()
    wc.effect(() => () => {
      for (const { ws } of [...clients]) { try { ws.terminate() } catch { /* 已关 */ } }
      clients.clear()
      try { wss.close() } catch { /* 已关 */ }
    }, `${label}.close`)
    wc.effect(() => wc.webServer.registerUpgrade({
      path,
      handler: (req: any, socket: any, head: any) => {
        const admission = wc.connection.admit(req)
        if ('rejection' in admission) {
          // 认证不过：往裸 socket 写一条 HTTP 拒绝响应（照 api-gateway 的 rejectRemoteStreamUpgrade）
          const status = admission.rejection as number
          const reason = status === 401 ? 'Unauthorized' : 'Forbidden'
          const body = reason.toLowerCase()
          socket.end([
            `HTTP/1.1 ${status} ${reason}`,
            'Connection: close',
            'Content-Type: text/plain; charset=utf-8',
            `Content-Length: ${Buffer.byteLength(body)}`,
            '',
            body,
          ].join('\r\n'))
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          // 宿主纪律：ws 的错误必须挂监听，未捕获会炸掉整个 DSH
          ws.on('error', () => { try { ws.terminate() } catch { /* 已关 */ } })
          const send = (data: string) => {
            if (ws.readyState !== OPEN) return
            try { ws.send(data) } catch { /* 对端刚关 */ }
          }
          const client = { ws, off: onClient(send) }
          clients.add(client)
          ws.on('close', () => {
            clients.delete(client)
            try { client.off() } catch (e) { console.error(`[${label}] 退订出错`, e) }
          })
        })
      },
    }), label)
  })
}
