// mcpServers 的表单字段 spec 与卡片用的纯函数。落进暂存表单的是稳定序列化的 JSON 文本（键序固定，
// 避免同值异串的假 dirty）；parse 不合法返回 undefined 挡住保存，parseMcpDraft 宽容版管显示。
// endpoint / name 规则与服务端同一份（mcp/entries 不引 node 模块，客户端可直接 import）。
import type { SettingsFieldSpec } from './model'
import { ENDPOINT_RE, MAX_NAME, MIN_TOKEN } from '../../mcp/entries'
import { normFolder, folderText } from '../../core/folder'

/** endpoint：/mcp/<endpoint> 里的代号；name：显示名称 */
export interface McpRow { endpoint: string; name: string; folder: string; token: string }

/** 32 字节随机 → base64url 无填充（43 位） */
export function genToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function serializeMcp(rows: McpRow[]): string {
  return JSON.stringify(rows.map((r) => ({ endpoint: r.endpoint.trim(), name: r.name.trim(), folder: r.folder, token: r.token.trim() })))
}

const rowOf = (r: any): McpRow => ({
  endpoint: String(r?.endpoint ?? '').trim(),
  name: typeof r?.name === 'string' ? r.name.trim() : '',
  folder: normFolder(folderText(r?.folder)) ?? '',
  token: String(r?.token ?? '').trim(),
})

export function parseMcpDraft(text: string): McpRow[] | null {
  try {
    const v = JSON.parse(text)
    if (!Array.isArray(v)) return null
    return v.filter((r: any) => r && typeof r === 'object' && !Array.isArray(r)).map(rowOf)
  } catch { return null }
}

export function endpointError(endpoint: string, rows: McpRow[], self: number): string {
  const n = endpoint.trim()
  if (!n) return '必填'
  if (!ENDPOINT_RE.test(n)) return '只能用字母、数字、- 和 _，最多 32 位'
  if (rows.some((r, j) => j !== self && r.endpoint === n)) return '已经有同名的端点了'
  return ''
}

/** 显示名称：可中文、可重名，按码点计长 */
export function nameError(name: string): string {
  const n = name.trim()
  if (!n) return '必填'
  if ([...n].length > MAX_NAME) return '最多 32 个字'
  return ''
}

export function parseMcp(text: string): McpRow[] | null {
  const rows = parseMcpDraft(text)
  if (!rows) return null
  const ok = rows.every((r, i) => !endpointError(r.endpoint, rows, i) && !nameError(r.name) && !!r.folder && r.token.length >= MIN_TOKEN)
  return ok ? rows : null
}

/** 值→文本：宽容归一，显示路径永不抛 */
const rowsOfValue = (v: unknown): McpRow[] => { try { return parseMcpDraft(JSON.stringify(v)) ?? [] } catch { return [] } }

export function mcpServersField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (v) => (Array.isArray(v) ? serializeMcp(rowsOfValue(v)) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (!trimmed) return { kind: 'clear' }
      const rows = parseMcp(trimmed)
      return rows ? { kind: 'set', value: rows } : undefined
    },
  }
}

export const maskToken = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}••••••••${t.slice(-4)}` : '••••••••')
export const endpointUrl = (base: string, endpoint: string) => `${base.replace(/\/+$/, '')}/mcp/${endpoint}`

/** 通用 MCP 配置（Claude Code .mcp.json / Cursor mcp.json 同形）；键用 endpoint，带完整 token */
export function mcpParams(url: string, r: McpRow): string {
  return JSON.stringify({ mcpServers: { [r.endpoint]: { type: 'http', url, headers: { Authorization: `Bearer ${r.token}` } } } }, null, 2)
}
