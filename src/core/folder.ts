// 库内文件夹的配置值归一（纯函数，不引任何模块：客户端 bundle 与服务端共用一份）。
// '/' = 「知识库」（整库范围），是唯一表示；空值绝不当成整库——漏填一项就开放整个库不可接受。
export const ROOT_FOLDER = '/'

/** 配置里 folder 的原始值 → 文本：字符串原样、有限数字转字符串（yml 里不加引号的 `folder: 2026`），其余（数组、对象、布尔、null）一律空——空就是「缺 folder」，绝不让 ['/'] 之类经 String() 变成 '/' */
export function folderText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return ''
}

export function normFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  if (/^\/+$/.test(t)) return ROOT_FOLDER
  const f = t.replace(/^\/+|\/+$/g, '')
  if (f.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null
  return f
}

export const isVaultRoot = (folder: string): boolean => folder === ROOT_FOLDER

/** 卡片、字段上给人看的名字：'/' 叫「知识库」 */
export const folderLabel = (folder: string): string => (isVaultRoot(folder) ? '知识库' : folder)
