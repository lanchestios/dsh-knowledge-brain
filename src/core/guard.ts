import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * rel 解析后必须落在 root（或 root/sub）之内；越界返回 null。
 * 先按文字查，再按真实路径查一次——raw/ 或 asset/ 里的符号链接可能指到库外。
 * 文件不存在时只做文字检查（调用方自己会 404）。
 */
export function inside(root: string, rel: string, sub?: string): string | null {
  if (!rel || rel.includes('\0')) return null
  const base = resolve(root, sub ?? '.')
  const abs = resolve(root, rel)
  if (!abs.startsWith(base + sep)) return null
  let real: string, realBase: string
  try { real = realpathSync(abs); realBase = realpathSync(base) } catch { return abs }
  return real.startsWith(realBase + sep) ? abs : null
}
