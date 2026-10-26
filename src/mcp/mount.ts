// MCP 端点挂载：webServer 前缀路由 /mcp（与 ws.ts 一样走 ctx.inject(['webServer'])），每请求现读配置，
// 改了 cordis.patch.yml / 设置卡保存即生效，不用重启。status 给设置卡用，不含 token。
import type { Context } from '@deepseek-ai/cordis'
import type { Hub } from '../core/hub'
import { normalizeMcpEntries } from './entries'
import { createMcpRoute, MCP_PREFIX } from './http'
import { folderHasPages } from '../host/wiki-ops'
import { vaultPhase, type VaultPhase } from '../core/vault-phase'

/** endpointBase：MCP 客户端连的地址前缀（127.0.0.1 + 宿主实际监听端口）；宿主还没给端口时为 null。
 *  不让客户端用 location.origin 拼——桌面端页面 origin 是 dsh-app://app */
export interface McpStatusView {
  /** 库所处阶段：设置卡据此显示「未初始化 / 校验中 / 校验失败」 */
  phase: VaultPhase
  endpointBase: string | null
  servers: { endpoint: string; name: string; folder: string; folderExists: boolean }[]
}
export interface McpHandle { status(): McpStatusView }

export function mountMcp(ctx: Context, hub: Hub, cfg: { servers(): unknown }): McpHandle {
  let lastProblems = ''
  const entries = () => {
    const { ok, problems } = normalizeMcpEntries(cfg.servers())
    const sig = problems.join('；')
    if (sig && sig !== lastProblems) console.warn('[dsh-knowledge-brain] mcpServers 有条目被忽略：' + sig)
    lastProblems = sig
    return ok
  }
  const route = createMcpRoute({ entries, getModel: () => hub.model() })
  let webServer: any = null

  ;(ctx as any).inject(['webServer'], (wc: any) => {
    // 端口现读（宿主 listen 落定前可能还没有）；webServer 作用域卸掉就不再给地址
    webServer = wc.webServer
    wc.effect(() => () => { webServer = null }, 'dsh-knowledge-brain.mcp.port')
    wc.effect(() => () => { void route.close().catch(() => {}) }, 'dsh-knowledge-brain.mcp.close')
    wc.effect(() => wc.webServer.register({
      kind: 'prefix', path: MCP_PREFIX,
      handler: (req: any, res: any) => route.handle(req, res).catch(() => { try { res.destroy() } catch { /* 已关 */ } }),
    }), 'dsh-knowledge-brain.mcp')
  })

  return {
    status() {
      const m = hub.engine.model
      const port = portOf(webServer)
      return {
        phase: vaultPhase(hub),
        endpointBase: port ? `http://127.0.0.1:${port}` : null,
        servers: entries().map((e) => ({ endpoint: e.endpoint, name: e.name, folder: e.folder, folderExists: !!m && folderHasPages(m, e.folder) })),
      }
    },
  }
}

/** 宿主 WebServer 的 get port()（实际监听端口）；没有、不是正整数、getter 抛都当没有 */
function portOf(ws: any): number | null {
  try {
    const p = ws?.port
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : null
  } catch { return null }
}
