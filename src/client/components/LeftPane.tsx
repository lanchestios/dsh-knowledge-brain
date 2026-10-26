import { useMemo } from 'react'
import { TreePane } from './TreePane'
import { useEnv } from '../env'
import { useNav, type TabsNavStore } from '../lib/nav'
import type { EditStore } from '../lib/edit'
import { makeTreeEdit } from '../lib/treeEdit'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:h-full",
}

// 阅读器左栏：知识沉淀（四区）的目录树，与中栏阅读器共用导航 store。入口在 DSH 左栏；
// 探索区（书 ｜ 文档）不放树，导航在主区（首页入口卡、面包屑）。
// tabs / edit 是阅读器面板的 tab store 与编辑态：给了才开目录拖动（移动后关 tab、有没保存的改动不让移）
export function LeftPane({ tabs, edit }: { tabs?: TabsNavStore; edit?: EditStore }) {
  const { api } = useEnv()
  const { route, go } = useNav()
  const treeEdit = useMemo(() => (tabs ? makeTreeEdit({ api, tabs, edit: edit ? () => edit.get() : undefined }) : undefined), [api, tabs, edit])
  return (
    <div data-wiki-ui="" className={s.root}>
      <TreePane title="知识沉淀" load={api.tree} currentId={route.kind === 'page' ? route.id : null} onOpen={(id) => go({ kind: 'page', id })} menuRoute={(id) => ({ kind: 'page', id })} edit={treeEdit} />
    </div>
  )
}
