import { useEffect, useLayoutEffect, useRef } from 'react'
import { scrollMemo } from '../reader/tabs/scrollMemo'
import { PageView } from './PageView'
import { HomeView } from './HomeView'
import { TagView } from './TagsView'
import { GraphView } from './GraphView'
import { BooksShelf, BookPage } from '../explore/BooksShelf'
import { ChapterReader } from '../explore/ChapterReader'
import { DocumentsTable } from '../explore/DocumentsTable'
import { DraftsPage, ActivityPage } from './PagesList'
import { RawView } from './RawView'
import { usePage, useRaw } from '../lib/page'
import { useNav, type Route } from '../lib/nav'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "scroll": "wk:h-full wk:overflow-y-auto",
}

// 按路由分派中栏。route 可外给（ReaderPage 的每个 TabPane 传自己 tab 的路由）；
// 缺省回落上下文里的活动路由（WikiPageTab 单栈场景）。契约：常挂 pane 内的组件只许
// useNav().go、不要读 route——route 恒为活动 tab 的路由，非活动 pane 读了会跟着活动 tab 跑
export function Main({ compact, route: propRoute, memoKey, skipRestore }: { compact?: boolean; route?: Route; memoKey?: string; skipRestore?: boolean }) {
  const navRoute = useNav().route
  const route = propRoute ?? navRoute
  const page = usePage()
  const raw = useRaw()
  const scroller = useRef<HTMLDivElement>(null)
  // 滚动记忆（阅读器 TabPane 传 memoKey）：滚动时记下最新位置，卸载时存进 scrollMemo；挂上时
  // 等内容撑开再还原（页数据是异步到的），人一动滚轮 / 鼠标就不再还原。路由带锚点时以锚点为准
  const lastTop = useRef(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!memoKey || !el) return
    const onScroll = () => { lastTop.current = el.scrollTop }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); scrollMemo.remember(memoKey, lastTop.current) }
  }, [memoKey])
  useEffect(() => {
    const el = scroller.current
    const want = memoKey ? scrollMemo.take(memoKey) : undefined
    if (!el || want === undefined || skipRestore) return
    let raf = 0
    const until = Date.now() + 2000
    const stop = () => { cancelAnimationFrame(raf); el.removeEventListener('wheel', stop); el.removeEventListener('mousedown', stop) }
    const tick = () => {
      if (el.scrollHeight - el.clientHeight >= want || Date.now() > until) { el.scrollTop = want; lastTop.current = want; stop(); return }
      raf = requestAnimationFrame(tick)
    }
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('mousedown', stop)
    tick()
    return stop
  }, [memoKey, skipRestore])
  if (route.kind === 'graph') return <GraphView focus={route.focus} />
  // 读一章：两栏各自滚动，不进外层滚动容器
  if (route.kind === 'chapter') return <ChapterReader book={route.book} id={route.id} />
  return (
    <div data-wiki-ui="" ref={scroller} className={s.scroll} data-scroll="">
      {route.kind === 'page' && <PageView result={page} id={route.id} anchor={route.anchor} scroller={scroller} compact={compact} />}
      {route.kind === 'kb' && <HomeView />}
      {route.kind === 'tag' && <TagView tag={route.tag} />}
      {route.kind === 'raw' && <RawView result={raw} path={route.path} scroller={scroller} />}
      {/* 探索区：书 ｜ 文档 */}
      {route.kind === 'books' && <BooksShelf />}
      {route.kind === 'book' && <BookPage name={route.name} />}
      {route.kind === 'documents' && <DocumentsTable status={route.status ?? '待沉淀'} />}
      {/* 沉淀两页：草稿全量 / 动态（全部页按更新时间） */}
      {route.kind === 'drafts' && <DraftsPage />}
      {route.kind === 'activity' && <ActivityPage />}
    </div>
  )
}
