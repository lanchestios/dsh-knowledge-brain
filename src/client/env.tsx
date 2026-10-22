import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { WikiApi } from './api'

export interface WikiEnv {
  api: WikiApi
  /** 平台上下文：会话桥（discuss 建工作区会话、切会话界面）要用；平台服务面没有类型，保持 any */
  c: any
  openExternal(url: string): void
  openExplorable(rel: string): void
  useDark(): boolean
  /** 切到知识库面板打开一页（文档沉淀卡里点引用页用）；index.tsx 建好面板后赋值 */
  openKb?: (id: string) => void
  /** 切到知识库面板打开某机器人的会话记录页（设置卡「会话」按钮用）；index.tsx 建好面板后赋值 */
  openLarkSessions?: (appId: string) => void
}

export const isDark = () => typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme')

export function createEnv(ctx: Context, api: WikiApi): WikiEnv {
  const c = ctx as any
  // 照 ui-chat 的链接偏好：默认在右侧栏浏览器 tab 打开，没有会话可挂就开新窗口
  const openInSidebar = (url: string) => {
    const pref = c.get?.('configForms')?.get?.('ui-chat')?.getSnapshot?.()?.value?.linkOpening ?? 'sidebar'
    if (pref === 'sidebar' && c.get?.('sidebarRightTabs')?.get?.('browser') !== undefined) {
      try { c.get('sidebarRight').openTab('browser', { params: { url } }); return } catch { /* 退回新窗口 */ }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  // 图谱等老代码听 window 的 themechange；DSH 换主题时照发一个
  const subs = new Set<() => void>()
  ctx.on('theme/change' as any, () => {
    // body 属性由 ui-layout 在同一轮里改，等它落地再通知
    requestAnimationFrame(() => { window.dispatchEvent(new Event('themechange')); subs.forEach((l) => l()) })
  })
  const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l) } }
  return {
    api,
    c,
    openExternal: (url) => { if (/^https?:\/\//i.test(url)) openInSidebar(url) },
    openExplorable: (rel) => {
      if (rel.startsWith('asset/')) openInSidebar(new URL('api/wiki.asset?path=' + encodeURIComponent(rel) + '&theme=' + (isDark() ? 'dark' : 'light'), document.baseURI).href)
    },
    useDark: () => useSyncExternalStore(subscribe, isDark),
  }
}

const Ctx = createContext<WikiEnv | null>(null)
export const WikiEnvProvider = ({ value, children }: { value: WikiEnv; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>
export function useEnv(): WikiEnv {
  const e = useContext(Ctx)
  if (!e) throw new Error('useEnv 须在 WikiEnvProvider 内')
  return e
}
