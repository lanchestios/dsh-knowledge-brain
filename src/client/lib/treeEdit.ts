import type { WikiApi } from '../api'
import type { TabsNavStore } from './nav'
import type { EditState } from './edit'
import type { TreeEdit } from '../components/TreePane'

// 目录拖动接到阅读器：落盘走 API；跨文件夹移动前看编辑态（有没保存的改动不让动，关 tab 会把改动丢了），
// 移动成功后关掉被移节点下的页 tab（路径变了，旧 tab 指着不存在的页）。同文件夹排序路径不变，都不用管

/** id 是 rel 自己，或在 rel 这个文件夹下面（知识/K2.md 不在 知识/K 下面） */
export const under = (id: string, rel: string): boolean => id === rel || id.startsWith(rel + '/')

export function closeUnder(tabs: TabsNavStore, rel: string): void {
  const list = tabs.get().tabs
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (r.kind === 'page' && under(r.id, rel)) tabs.closeTab(i)
  }
}

export const unsaved = (e: EditState, rel: string): boolean =>
  !!e.path && under(e.path, rel) && (e.status === 'dirty' || e.status === 'saving' || e.status === 'conflict' || e.status === 'error')

export function makeTreeEdit(d: { api: Pick<WikiApi, 'reorder' | 'move' | 'moveImpact'>; tabs?: TabsNavStore; edit?: () => EditState }): TreeEdit {
  const blocked = (node: string) => {
    const e = d.edit?.()
    if (!e || !unsaved(e, node)) return null
    return `「${e.path!.split('/').pop()!.replace(/\.md$/i, '')}」有没保存的改动，先保存再移动`
  }
  return {
    reorder: (node, place) => d.api.reorder(node, place),
    impact: (node) => d.api.moveImpact(node),
    blocked,
    move: async (node, folder, place) => {
      const why = blocked(node)
      if (why) throw new Error(why)
      await d.api.move(node, folder, place)
      if (d.tabs) closeUnder(d.tabs, node)
    },
  }
}
