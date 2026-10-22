import { useSyncExternalStore } from 'react'
import { Button, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconAiAssistant, IconMenu } from '../../icon'
import { isExplore, useNav } from '../lib/nav'
import { usePage, useRaw } from '../lib/page'
import { hasProps, type RightTab } from '../reader/panel'
import { ExploreCrumb } from '../explore/ExploreCrumb'
import { KbCrumb } from './KbCrumb'
import { EditControls } from './EditControls'
import s from './TopBar.module.css'

// 编辑入口挂哪条路径（wiki 路由知识，只 TopBar 用，就放这）：沉淀页用页 id，md 文档用文档路径；没载入、离线、非 md 文档都算没有
function useEditPath(): string | null {
  const { route } = useNav()
  const page = usePage()
  const raw = useRaw()
  if (route.kind === 'page') {
    const p = page?.ok && page.page.id === route.id ? page.page : null
    return p && !p.offline ? p.id : null
  }
  if (route.kind === 'raw' && raw?.ok && raw.raw.path === route.path && raw.raw.kind === 'md' && !raw.raw.offline) return route.path
  return null
}

// 顶栏：面包屑（探索区 / 沉淀区各一版，按路由推导）、编辑、图谱；搜索只走 ⌘⇧K（shortcuts.ts），顶栏不再占位；后退前进已由多 tab 接管退场；主页从 DSH 左栏的入口进，位置由目录树表达
type Box<T> = { get(): T; set(v: T): void; subscribe(l: () => void): () => void }

export function TopBar({ inspector, tab, graph }: { inspector?: Box<boolean>; tab?: Box<RightTab>; graph?: Box<boolean> }) {
  const { route } = useNav()
  const explore = isExplore(route.kind)
  const editPath = useEditPath()
  const noBool: Box<boolean> = { get: () => false, set: () => {}, subscribe: () => () => {} }
  const noTab: Box<RightTab> = { get: () => 'session', set: () => {}, subscribe: () => () => {} }
  const on = useSyncExternalStore((inspector ?? noBool).subscribe, (inspector ?? noBool).get)
  const cur = useSyncExternalStore((tab ?? noTab).subscribe, (tab ?? noTab).get)
  // 图谱视图开关（正文位换当前页局部图谱）：只在知识页给；noBool 兜底（测试 / 无面板环境）
  const noG: Box<boolean> = { get: () => false, set: () => {}, subscribe: () => () => {} }
  const gOn = useSyncExternalStore((graph ?? noG).subscribe, (graph ?? noG).get)
  const props = hasProps(route)
  // 没有属性的页右栏只放会话：栏开着就算「AI」那颗按下
  const shown: RightTab = props ? cur : 'session'
  // 右栏开关拆成两颗：点没亮的那颗 = 开栏并切到它；点亮着的那颗 = 收栏
  const pick = (want: RightTab) => {
    if (!inspector || !tab) return
    if (on && shown === want) { inspector.set(false); return }
    tab.set(want)
    inspector.set(true)
  }
  // 右栏入口带文字（样式 D）：属性同图谱，按下描边；AI 品牌色，按下填浅品牌底。窄了先收编辑 / 图谱的字，再收这两颗的（TopBar.module.css）
  const rail = (want: RightTab, label: string, icon: JSX.Element) => {
    const pressed = on && shown === want
    const title = pressed ? `收起${label}` : label
    return (
      <Button variant={pressed && want === 'props' ? 'outline' : 'ghost'} size="sm" className={want === 'session' ? s.ai : s.rail} icon={icon} onClick={() => pick(want)}
        title={title} aria-label={title} aria-pressed={pressed} data-collapse="rail"><span data-label>{label}</span></Button>
    )
  }
  return (
    <header className={s.bar}>
      {explore ? <ExploreCrumb /> : <KbCrumb />}
      <div className={s.spacer} />
      {editPath && <EditControls path={editPath} />}
      {/* 图谱视图开关（2026-10-20 用户裁定统一）：所有沉淀区路由同一交互——点开把内容位换成
          图谱（知识页＝该页局部图谱，其余＝全局图；runGraph 全交互：布局 / 缩放 / 平移 / 悬停）、
          再点收回。没有跳转形态；探索区不给。global graph 路由仍存在（右栏「在全局图里看」用） */}
      {!explore && (
        <Button variant={gOn ? 'outline' : 'ghost'} size="sm" icon={<IconBranchOutlineRegular size={16} />} onClick={() => (graph ?? noG).set(!gOn)}
          title={gOn ? '收起图谱视图' : '图谱视图'} aria-label="图谱视图" aria-pressed={gOn} data-collapse="act"><span data-label>图谱</span></Button>
      )}
      {/* 右栏入口：属性（这页有属性才给）+ AI（会话）。只有带右栏的页传 inspector，其余页两颗都不给 */}
      {inspector && tab && props && rail('props', '属性', <IconMenu size={16} />)}
      {inspector && tab && rail('session', 'AI', <IconAiAssistant size={16} />)}
    </header>
  )
}
