import { Button } from '../ui'
import type { ComponentType } from 'react'
import { LeftPane } from '../components/LeftPane'
import { NavProvider, type TabsNavStore } from '../lib/nav'
import type { EditStore } from '../lib/edit'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:h-full wk:min-h-0 wk:flex wk:flex-col",
  "rail": "wk:flex wk:justify-center wk:pt-2",
}

// 打开「知识库」时顶替 DSH 左栏的工作区 / 会话列表：显示沉淀目录树（与中栏阅读器共用导航 store）；
// 探索区没有树，导航全在主区（首页两卡、面包屑）。侧栏收起成窄条时只留一个图标，点了展开
export function WikiSidebar({ wide, expandSidebar, store, edit, Icon, label }: {
  wide?: boolean; expandSidebar?: () => void; store: TabsNavStore; edit?: EditStore; Icon: ComponentType<{ size?: number }>; label: string
}) {
  if (wide === false) return <div data-wiki-ui="" className={s.rail}><Button variant="ghost" size="sm" icon={<Icon size={16} />} onClick={expandSidebar} aria-label={label} /></div>
  return <div data-wiki-ui="" className={s.root}><NavProvider store={store}><LeftPane tabs={store} edit={edit} /></NavProvider></div>
}
