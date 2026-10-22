// mcpServers 归一（纯函数，客户端也 import ENDPOINT_RE / MAX_NAME——这里不许引 node 模块）。folder 归一用 src/core/folder.ts（同样不引模块）。
// 每条 { endpoint, name, folder, token }：endpoint 是 /mcp/<endpoint> 里的代号（唯一），name 是显示名称（可中文、可重名）。
// 口径同 lark/bindings 的 normalizeApps：非法条目剔除并带原因，其余照常。problems 会进宿主日志：没过 ENDPOINT_RE 的
// endpoint 不回显，只用 1 起的序号指代；name 是自由文本，一律不回显（token 误贴进去原样打出来就泄露了）；folder、token 也不回显。
import { folderText, normFolder } from '../core/folder'

export const ENDPOINT_RE = /^[A-Za-z0-9_-]{1,32}$/
export const MAX_NAME = 32
export const MIN_TOKEN = 32

export interface McpEntry { endpoint: string; name: string; folder: string; token: string }

export function normalizeMcpEntries(raw: unknown): { ok: McpEntry[]; problems: string[] } {
  const ok: McpEntry[] = []
  const problems: string[] = []
  if (raw === undefined || raw === null) return { ok, problems }
  if (!Array.isArray(raw)) return { ok, problems: ['mcpServers 不是数组'] }
  for (const [i, item] of raw.entries()) {
    const nth = `第 ${i + 1} 项`
    if (item === null || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${nth}：不是对象`); continue }
    const endpoint = String((item as any).endpoint ?? '').trim()
    if (!endpoint) { problems.push(`${nth}：缺 endpoint`); continue }
    if (!ENDPOINT_RE.test(endpoint)) { problems.push(`${nth}：endpoint 只能用字母、数字、- 和 _，最多 32 位`); continue }
    const name = typeof (item as any).name === 'string' ? (item as any).name.trim() : ''
    if (!name) { problems.push(`${endpoint}：缺 name`); continue }
    if ([...name].length > MAX_NAME) { problems.push(`${endpoint}：name 最多 32 个字`); continue }
    const rawFolder = folderText((item as any).folder)
    if (!rawFolder.trim()) { problems.push(`${endpoint}：缺 folder`); continue }
    const folder = normFolder(rawFolder)
    if (folder === null) { problems.push(`${endpoint}：folder 不能含空段、. 或 .. 段`); continue }
    const token = String((item as any).token ?? '').trim()
    if (token.length < MIN_TOKEN) { problems.push(`${endpoint}：token 太短（至少 ${MIN_TOKEN} 位）`); continue }
    if (ok.some((e) => e.endpoint === endpoint)) { problems.push(`${endpoint}：endpoint 重名`); continue }
    ok.push({ endpoint, name, folder, token })
  }
  return { ok, problems }
}
