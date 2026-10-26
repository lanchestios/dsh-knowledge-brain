import z from '@deepseek-ai/schemastery'

/** 库路径必填、可热改；机器人列表可热改（volatile），改了由 mount.ts 的签名比对重启 */
export interface Config {
  vaultDir: { get(): string }
  larkApps: { get(): unknown }
  mcpServers?: { get(): unknown }
}

export const Config = z.object({
  vaultDir: z.string().description('知识库目录（绝对路径），在 profile 的 cordis.patch.yml 里给 dsh-knowledge-brain 配 config.vaultDir').volatile(),
  // 机器人列表：一个元素 = {appId, appSecret, folder, model?}（一个机器人答一个文件夹的所有
  // 会话）。schema 故意放行任何形状——手改 yml 打错结构不能炸插件加载（那会拖死整个知识库），
  // 校验全交给 normalizeApps：非法项剔除并带原因，其余照常；secret 只存配置，不打日志、不进 RPC 响应。
  // schema 外的键（旧版的 feishuAppId / feishuAppSecret / feishuApps 等）schemastery 原样忽略，存量 yml 里还写着也不会炸加载
  larkApps: z.any().default([]).description('Lark机器人列表（app_id+app_secret+文件夹）').volatile(),
  // MCP 端点列表：一个元素 = {name, folder, token}（一个端点只开放一个文件夹，只读）。schema 放行任何形状，
  // 校验交给 mcp/entries.normalizeMcpEntries（非法剔除带原因）；token 只存配置，不打日志、不进 RPC 响应
  mcpServers: z.any().default([]).description('MCP 端点列表（endpoint+name+folder+token）').volatile(),
}) as unknown as z<Config>

/** 生效的机器人列表 */
export function larkAppsOf(config: Config): any[] {
  const lark = (config as any).larkApps?.get?.()
  return Array.isArray(lark) ? lark : []
}

