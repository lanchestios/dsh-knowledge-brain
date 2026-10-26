import { useCallback, useState, type ReactNode } from 'react'
import { Menu } from '../ui'
import { slug } from 'github-slugger'
import { takeModifier, useNav, type Route } from '../lib/nav'
import type { EditRef } from '../../editor/io'

// 链接右键菜单（双链、目录树）：「打开」= 普通点击（go）、「在新标签页打开」= openTab。只在有 openTab
// 的导航下接管右键（阅读器、DSH 左栏目录树）；右栏 WikiPageTab 是栈式导航，useRouteMenu 返回 null，
// 浏览器默认右键照旧。目标可以是异步的（双链名字要 resolve），选中那一刻才解析，解析不到什么都不做

/** 编辑器链接 → 路由：双链按全站规则解析（锚点按标题 slug）、页链直接成路由、raw/ 文档链接成
 *  文档路由；外链、解析不到、解析出错都为 null */
export async function routeForRef(api: { resolve(name: string): Promise<{ id: string | null }> }, ref: EditRef): Promise<Route | null> {
  if (ref.kind === 'page') return { kind: 'page', id: ref.id, ...(ref.anchor ? { anchor: ref.anchor } : {}) }
  if (ref.kind === 'href') return ref.href.startsWith('raw/') ? { kind: 'raw', path: ref.href } : null
  try {
    const { id } = await api.resolve(ref.name)
    return id ? { kind: 'page', id, ...(ref.anchor ? { anchor: slug(ref.anchor) } : {}) } : null
  } catch { return null }
}

/** 左键打开编辑器链接（双链 / 页链 / raw/ 文档链接）。修饰键在解析之前同步取走：双链名字的 resolve 可能
 *  慢过 100ms，等回来再让 go 自己读修饰键就过期了，Cmd+点会把正在读的文档原地换掉。外链不归这里 */
export async function openWikiRef(
  o: { api: { resolve(name: string): Promise<{ id: string | null }> }; go(r: Route): void; openTab?(r: Route): void },
  ref: EditRef,
): Promise<void> {
  const newTab = takeModifier()
  const r = await routeForRef(o.api, ref)
  if (!r) return
  if (newTab && o.openTab) o.openTab(r)
  else o.go(r)
}

type Target = () => Route | null | Promise<Route | null>
type At = { x: number; y: number; target: Target }

export function useRouteMenu(): { show(e: { clientX: number; clientY: number; preventDefault(): void }, target: Target): boolean; node: ReactNode } | null {
  const { go, openTab } = useNav()
  const [at, setAt] = useState<At | null>(null)
  const show = useCallback((e: { clientX: number; clientY: number; preventDefault(): void }, target: Target) => {
    e.preventDefault()
    setAt({ x: e.clientX, y: e.clientY, target })
    return true
  }, [])
  if (!openTab) return null
  const pick = (id: string) => {
    const a = at
    setAt(null)
    if (!a) return
    // 宿主崩溃纪律：异步解析不留裸 promise
    void Promise.resolve().then(a.target).then((r) => {
      if (!r) return
      if (id === 'open') go(r)
      else if (id === 'tab') openTab(r)
    }).catch(() => { /* 解析失败：什么都不做 */ })
  }
  const node = (
    <Menu open={!!at} onClose={() => setAt(null)} onSelect={pick}
      items={[{ id: 'open', label: '打开' }, { id: 'tab', label: '在新标签页打开' }]}
      getAnchorRect={() => (at ? new DOMRect(at.x, at.y, 0, 0) : null)} />
  )
  return { show, node }
}
