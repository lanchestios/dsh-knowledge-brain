// larkApps 的表单字段 spec：卡片里用机器人行编辑器（app_id、secret、文件夹三样，model 可空），
// 落进暂存表单的是一段稳定序列化的 JSON 文本（键序固定，避免同值异串的假 dirty）。
// parse 不合法返回 undefined，挡住保存；parseAppsDraft 宽容版管显示，打到一半的行不消失。
import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import { normFolder, folderText } from '../../core/folder'

export interface AppRow { appId: string; appSecret: string; folder: string; model: string }

const MODEL = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function serializeApps(rows: AppRow[]): string {
  return JSON.stringify(rows.map((r) => ({ appId: r.appId.trim(), appSecret: r.appSecret.trim(), folder: r.folder, model: r.model.trim() })))
}

export function parseApps(text: string): AppRow[] | null {
  try {
    const v = JSON.parse(text)
    if (!Array.isArray(v)) return null
    const rows: AppRow[] = v.map((r: any) => ({ appId: String(r?.appId ?? '').trim(), appSecret: String(r?.appSecret ?? '').trim(), folder: normFolder(folderText(r?.folder)) ?? '', model: String(r?.model ?? '').trim() }))
    const ok = rows.every((r) => r.appId && r.appSecret && r.folder && (!r.model || MODEL.test(r.model)))
    return ok ? rows : null
  } catch { return null }
}

/** 草稿宽容解析：只管把 JSON 数组还原成行给编辑器显示，不做合法性校验（严格 parseApps 在保存关口把关） */
export function parseAppsDraft(text: string): AppRow[] | null {
  try {
    const v = JSON.parse(text)
    if (!Array.isArray(v)) return null
    return v.filter((r: any) => r && typeof r === 'object' && !Array.isArray(r))
      .map((r: any) => ({ appId: String(r.appId ?? '').trim(), appSecret: String(r.appSecret ?? ''), folder: normFolder(folderText(r?.folder)) ?? '', model: String(r.model ?? '').trim() }))
  } catch { return null }
}

/** 值→行：宽容归一（老文档的行缺后加的列不炸 format——显示路径永不抛，parseAppsDraft 同一纪律） */
const rowsOfValue = (v: unknown): AppRow[] => {
  try { return parseAppsDraft(JSON.stringify(v)) ?? [] } catch { return [] }
}

export function larkAppsField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (v) => (Array.isArray(v) ? serializeApps(rowsOfValue(v)) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (!trimmed) return { kind: 'clear' }
      const rows = parseApps(trimmed)
      return rows ? { kind: 'set', value: rows } : undefined
    },
  }
}

// tree() 的目录树拍平成文件夹相对路径列表（机器人范围只认目录）。必须吃目录节点的 rel：
// path 是索引页的页 id（无索引页的目录干脆是 null），displayName 首层还会被索引页标题
// 替换——按那两个拼出来的「文件夹」前缀永远匹配不到任何页。
export function flattenFolders(nodes: any[], out: string[] = []): string[] {
  for (const n of nodes ?? []) {
    if (n?.dir && typeof n.rel === 'string' && n.rel) out.push(n.rel)
    if (n?.children) flattenFolders(n.children, out)
  }
  return out
}

/** 行配齐可保存（Modal「确定」的启用条件）：与 parseApps 同一条规则——三样在，model 空或 provider/model */
export function rowValid(r: AppRow): boolean {
  return !!r.appId.trim() && !!r.appSecret.trim() && normFolder(r.folder) !== null && (!r.model.trim() || MODEL.test(r.model.trim()))
}

