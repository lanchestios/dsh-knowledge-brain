// wiki_image：只许读范围内页正文引用过的图（embedOf 是解析仓给的 asset/ raw/ 引用表，已是库根路径、NFC）。
// 每次现算不缓存——内容编辑（core/vault/ops）会就地改 embedOf，按模型实例缓存会读到旧白名单。
// 拒绝原因（不在白名单 / 格式 / 超限 / 越界 / 文件没了）统一一句，不透露哪张图存在。
import { readFileSync, statSync } from 'node:fs'
import { inside } from '../core/guard'
import { scopeFilter } from '../host/wiki-ops'
import type { Model } from '../core/model'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
const rooted = (p: string) => p.startsWith('asset/') || p.startsWith('raw/')

export function allowedImages(m: Model, folder: string): Set<string> {
  const keep = scopeFilter(folder)
  const out = new Set<string>()
  for (const [id, refs] of m.embedOf) {
    if (!keep(id)) continue
    for (const r of refs) if (rooted(r) && MIME[extOf(r)]) out.add(r)
  }
  return out
}

export function readImage(m: Model, folder: string, path: string): { data: string; mimeType: string } {
  const rel = String(path ?? '').normalize('NFC')
  const no = () => new Error(`读不到图片：${rel}（只许范围内页面里引用的 png/jpg/jpeg/gif/webp/bmp，≤5MB）`)
  if (!allowedImages(m, folder).has(rel)) throw no()
  const abs = inside(m.dir, rel, rel.startsWith('raw/') ? 'raw' : 'asset')
  if (!abs) throw no()
  let size: number
  try { const st = statSync(abs); if (!st.isFile()) throw no(); size = st.size } catch { throw no() }
  if (!size || size > MAX_IMAGE_BYTES) throw no()
  let data: string
  try { data = readFileSync(abs).toString('base64') } catch { throw no() }   // stat→read 之间文件没了：原始错误带绝对路径，不外露
  return { data, mimeType: MIME[extOf(rel)] }
}
