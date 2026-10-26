import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './host/config.ts'
import { Hub } from './core/hub'
import { ChatSessions } from './lark/chats'
import { registerRpc } from './host/rpc'
import { registerRoutes } from './host/routes'
import { registerExfontsRoute } from './host/exfonts'
import { registerTools } from './host/tools'
import { mountSkills } from './host/skills'
import { registerReference } from './host/reference'
import { mountLark } from './lark/mount.js'
import { normalizeApps } from './lark/bindings.js'
import { larkAppsOf } from './host/config.ts'
import { mountMcp } from './mcp/mount.js'

export { Config } from './host/config.ts'
export const name = 'dsh-knowledge-brain'
export const inject = ['connection', 'tools']

export async function apply(ctx: Context, config: Config): Promise<void> {
  const hub = new Hub(() => config.vaultDir.get())
  hub.reopen()
  ctx.effect(() => () => { hub.engine.close().catch((e) => console.error('[dsh-knowledge-brain] 关库失败', e)) }, 'dsh-knowledge-brain.vault')
  // Lark问答：会话桥接要等 agents/sessions/sessionController 服务，mountLark 内部自管；
  // 飞书路由只留在本次运行的内存里，重启后新建对话；会话本体仍由宿主保存。
  const lark = mountLark(ctx, hub, {
    apps: () => larkAppsOf(config),
    chats: new ChatSessions(),
  })
  let last = config.vaultDir.get()
  ctx.on('loader/volatile-update' as any, () => {
    if (config.vaultDir.get() !== last) { last = config.vaultDir.get(); hub.reopen() }
    lark.restart()   // 内部签名比对：config 没变就是空操作
  })
  // MCP 端点：一个条目 = 一个文件夹的只读 MCP（/mcp/<name>，Bearer token），每请求现读配置
  const mcp = mountMcp(ctx, hub, { servers: () => (config as any).mcpServers?.get?.() })
  registerRpc(ctx, hub, lark, undefined, { mcpStatus: () => mcp.status() })
  registerRoutes(ctx, hub)
  registerExfontsRoute(ctx)   // excalidraw 字体离线（断网不出系统字体）
  registerTools(ctx, hub)
  mountSkills(ctx, hub)
  registerReference(ctx, hub)
  ctx.logger.info('dsh-knowledge-brain：库 %s，%d 页，Lark 机器人 %d 个，MCP 端点 %d 个', hub.dir(), hub.engine.model?.g.order.length ?? 0, normalizeApps(larkAppsOf(config)).ok.length, mcp.status().servers.length)
}
