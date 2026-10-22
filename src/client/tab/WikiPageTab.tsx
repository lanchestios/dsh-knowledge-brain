import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconMoreLeft, IconMoreRight, IconQuote, IconSearch } from '../../icon'
import { Main } from '../components/Main'
import { SearchDialog } from '../components/SearchDialog'
import { useEnv } from '../env'
import { NavProvider, useLoad, useNav } from '../lib/nav'
import { PageCtx, RawCtx } from '../lib/page'
import { wikiRefInsert } from '../reference/mention'
import s from './WikiPageTab.module.css'

// 右侧栏 wiki 页 tab：会话作用域，自带一栈导航；刷新后 params 会丢，丢了就显示沉淀主页
export function WikiPageTab(props: any) {
  const info = props.useTabInfo?.()
  const id: string | undefined = info?.tab?.navigation?.params?.id
  return (
    <NavProvider key={id ?? ''} initial={id ? { kind: 'page', id } : { kind: 'kb' }}>
      <TabShell quote={props.quote} />
    </NavProvider>
  )
}

function TabShell({ quote }: { quote?: (label: string, id: string) => boolean }) {
  const { api } = useEnv()
  const { route, back, forward, canBack, canForward } = useNav()
  const pageId = route.kind === 'page' ? route.id : null
  const { v: page, err: pageErr } = useLoad(() => (pageId ? api.page(pageId) : Promise.resolve(undefined)), [pageId], pageId ? { page: pageId } : 'all')
  const current = pageId ? page : undefined
  const rawPath = route.kind === 'raw' ? route.path : null
  const { v: raw, err: rawErr } = useLoad(() => (rawPath ? api.raw(rawPath) : Promise.resolve(undefined)), [rawPath], 'documents')
  // 失败不再是永远的「载入中」
  const loadErr = pageId ? pageErr : rawPath ? rawErr : null
  const [searchOpen, setSearchOpen] = useState(false)
  const p = current?.ok && current.page.id === pageId ? current.page : null
  return (
    <PageCtx.Provider value={current}>
    <RawCtx.Provider value={rawPath ? raw : undefined}>
      <div className={s.root}>
        <div className={s.bar}>
          <Button variant="ghost" size="sm" icon={<IconMoreLeft size={16} />} disabled={!canBack} onClick={() => back?.()} aria-label="后退" />
          <Button variant="ghost" size="sm" icon={<IconMoreRight size={16} />} disabled={!canForward} onClick={() => forward?.()} aria-label="前进" />
          <Button variant="ghost" size="sm" icon={<IconSearch size={16} />} onClick={() => setSearchOpen(true)} aria-label="搜索" />
          <div className={s.spacer} />
          {p && quote && (
            <Button variant="ghost" size="sm" icon={<IconQuote size={16} />} onClick={() => quote(p.title, p.id)}>引用到对话</Button>
          )}
        </div>
        <div className={s.main}>{loadErr ? (
          <div className={s.fail}><p className={s.failTitle}>载入失败</p><p className={s.failMsg}>{loadErr}</p></div>
        ) : <Main compact />}</div>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </RawCtx.Provider>
    </PageCtx.Provider>
  )
}

// 插原子引用到这个会话的输入框；拿不到会话输入对象就退回插纯文本
export function makeQuote(c: any, props: any) {
  return (label: string, id: string) => {
    const ins = wikiRefInsert(label, id)
    const span = props.inputActions?.captureInsertion?.()
    if (!span) return false
    try {
      const scope = c.get('sessions')?.scope?.(props.sessionId)
      const input = scope && c.get('conversation')?.input?.for?.(scope)
      if (input?.insertReference(ins, span)) return true
    } catch { /* 退回纯文本 */ }
    return !!props.inputActions.insertText(ins.ref + ' ', span)
  }
}
