// 答案里的图 → 飞书 image_key。飞书卡片 / post 不收外链图，只认上传后的 key：
// 收场时把答案里引用的库内图（raw/ asset/，读页时已规整成库根路径，见 core/llm.rootImages）
// 逐张上传，按「路径+mtime+size」缓存（key 只在本应用内有效，resolver 一个机器人一个）。
// 外链不下载（不替提问人去拉任意 url，渲染时照旧当链接）；库内图任何一张失败 / 超时 / 缺权限
// 就不发这一张（库内路径的链接提问人打不开，见 post.ts），答案照发。
// 纯件：定位 / 读文件 / 上传全注入，单测直跑。
import { imageUrls } from './post.js'

export interface ImageDeps {
  /** 库内相对路径（raw/… 或 asset/…）→ 绝对路径；越界返回 null（mount 用 guard.inside） */
  locate(rel: string): string | null
  stat(abs: string): Promise<{ size: number; mtimeMs: number }>
  read(abs: string): Promise<Buffer>
  /** 上传得 image_key；失败抛错，飞书错误码挂在 err.code */
  upload(buf: Buffer): Promise<string>
  warn(msg: string): void
}

export interface ImageOpts {
  /** 一条答案最多传几张（多的不发） */
  maxImages: number
  /** 飞书上传上限 10MB */
  maxBytes: number
  /** 整体限时：到点用已拿到的 key，不拖答案 */
  timeoutMs: number
}

export const IMAGE_DEFAULTS: ImageOpts = { maxImages: 5, maxBytes: 10 * 1024 * 1024, timeoutMs: 15_000 }

export interface ImageResolver {
  /** 答案里图片 url（原样）→ image_key；只含传成功的。不抛 */
  resolve(markdown: string): Promise<Map<string, string>>
}

// 飞书图片上传支持的格式里挑常见的；svg / html 嵌入飞书显示不了，不发
const EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
/** 应用未开通所需权限（这里是 im:resource） */
const NO_SCOPE = 99991672

const relOf = (url: string): string | null => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return null
  let p = url.split('#')[0]
  try { p = decodeURI(p) } catch { /* 保持原样 */ }
  return p.startsWith('raw/') || p.startsWith('asset/') ? p : null
}
const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e)

export function createImageResolver(deps: ImageDeps, opts: Partial<ImageOpts> = {}): ImageResolver {
  const o = { ...IMAGE_DEFAULTS, ...opts }
  const cache = new Map<string, string>()   // `${abs}|${mtimeMs}|${size}` → image_key
  let disabled = false

  const one = async (url: string, rel: string, out: Map<string, string>) => {
    const abs = deps.locate(rel)
    if (!abs) return
    let st: { size: number; mtimeMs: number }
    try { st = await deps.stat(abs) } catch { return }   // 模型抄错路径：不刷日志，不发
    if (!st.size || st.size > o.maxBytes) return
    const ck = `${abs}|${st.mtimeMs}|${st.size}`
    const hit = cache.get(ck)
    if (hit) { out.set(url, hit); return }
    if (disabled) return
    try {
      const key = await deps.upload(await deps.read(abs))
      cache.set(ck, key)
      out.set(url, key)
    } catch (e: any) {
      if (Number(e?.code) === NO_SCOPE) {
        if (!disabled) deps.warn('飞书应用缺 im:resource 权限，答案里的图片不会发送')
        disabled = true
      } else deps.warn(`飞书图片上传失败（${rel}）：${errMsg(e)}`)
    }
  }

  return {
    async resolve(markdown) {
      const out = new Map<string, string>()
      const picks: [string, string][] = []
      for (const url of imageUrls(markdown)) {
        const rel = relOf(url)
        if (rel && EXTS.has(extOf(rel))) picks.push([url, rel])
        if (picks.length >= o.maxImages) break
      }
      if (!picks.length) return out
      let timer: any
      const timeout = new Promise<void>((r) => { timer = setTimeout(r, o.timeoutMs) })
      await Promise.race([Promise.all(picks.map(([u, r]) => one(u, r, out))), timeout])
      clearTimeout(timer)
      // 快照：超时后才传完的那张不再塞进已交出去的结果（下次 resolve 走缓存）
      return new Map(out)
    },
  }
}
