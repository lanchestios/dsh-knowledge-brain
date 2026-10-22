import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import type { Book, Chapter } from '../../core/api'
import s from './books.module.css'

export function ChapterBar({ book, ticks }: { book: Book; ticks?: boolean }) {
  return (<>
    <div className={s.bar}>{book.chapters.map((c) => <i key={c.id} className={s[c.state]} title={`${c.id} ${c.title}`} />)}</div>
    {ticks && <div className={s.ticks}>{book.chapters.map((c) => <span key={c.id}>{c.id}</span>)}</div>}
  </>)
}

export const stat = (b: Book) => ({
  read: b.chapters.filter((c) => c.read).length,
  depositing: b.chapters.filter((c) => c.state === 'depositing').length,
  done: b.chapters.filter((c) => c.state === 'done').length,
  next: b.chapters.find((c) => c.state === 'unread'),
})

export const STATE_LABEL: Record<Chapter['state'], string> = { unread: '未读', read: '已读', depositing: '沉淀中', done: '完成' }
export const MATERIAL_LABEL = {
  unavailable: '无源文件', init: '整理中 · 1/5 待转文本', text: '整理中 · 2/5 待补图', figures: '整理中 · 3/5 待梳理',
  proofread: '整理中 · 4/5 待质检', readable: '可读', failed: '转换失败',
} as const

// 章节表的行：组（分组标题）变化时先插一行组标题；顶层章（group 为 null）不插
export type ChapterRow = { kind: 'group'; title: string } | { kind: 'chapter'; chapter: Chapter }
export function chapterRows(chapters: Chapter[]): ChapterRow[] {
  const rows: ChapterRow[] = []
  let last: string | null = null
  for (const c of chapters) {
    if (c.group && c.group !== last) rows.push({ kind: 'group', title: c.group })
    last = c.group
    rows.push({ kind: 'chapter', chapter: c })
  }
  return rows
}

const isScanned = (b: Book) => /扫描版/.test(b.materialError)

// 书页「转换」按钮的文案，null = 不给按钮。扫描版也给（换成文字版 PDF 后要能重试），文案改成「重新检测」
export function convertAction(b: Book): '转换为文字' | '重新检测' | null {
  if (!b.source || (b.materialStatus !== 'init' && b.materialStatus !== 'failed')) return null
  return isScanned(b) ? '重新检测' : '转换为文字'
}

// 书架：在读的书一张大卡（下一步动作），其余一排小卡
export function BooksShelf() {
  const { api } = useEnv()
  const { go } = useNav()
  const books = useData(() => api.books(), [], 'documents')
  if (!books) return null
  const reading = books.filter((b) => b.progress === '在读')
  const rest = books.filter((b) => b.progress !== '在读')
  return (
    <div className={s.root}><div className={s.page}>
      <h1 className={s.h1}>书架</h1>
      {reading.map((b) => {
        const st = stat(b)
        return (
          <div key={b.name} className={cx(s.card, s.big)}>
            <div className={s.row}><span className={s.title}>{b.name}</span><span className={cx(s.pill, s.reading)}>在读</span>
              <span className={cx(s.meta, s.right)}>读过 {st.read} / {b.chapters.length} 章 · 沉淀中 {st.depositing} · 完成 {st.done} 章</span></div>
            <div className={s.row}><span className={s.meta}>{b.source?.split('/').pop() ?? '没有源文件'}</span><span className={cx(s.material, s['material-' + b.materialStatus])}>{MATERIAL_LABEL[b.materialStatus]}</span></div>
            <ChapterBar book={b} ticks />
            <div className={s.acts}>
              {st.next?.text && <Button variant="primary" size="sm" onClick={() => go({ kind: 'chapter', book: b.name, id: st.next!.id, title: st.next!.title })}>接着读 {st.next.id} {st.next.title}</Button>}
              <span className={s.right}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'book', name: b.name })}>章节总览 →</Button></span>
            </div>
          </div>
        )
      })}
      {rest.length > 0 && <div>
        <h2 className={s.h2}>{reading.length ? '其他' : '全部'}</h2>
        <div className={s.grid}>{rest.map((b) => (
          <div key={b.name} className={cx(s.card, s.small)} onClick={() => go({ kind: 'book', name: b.name })}>
            <div className={s.name}>{b.name}</div>
            <div className={s.meta}>{b.source?.split('/').pop() ?? '没有源文件'} · {MATERIAL_LABEL[b.materialStatus]}</div>
            <ChapterBar book={b} />
            <div className={s.meta} style={{ marginTop: 8 }}>{b.progress || '未读'} · {b.chapters.length} 章</div>
          </div>
        ))}</div>
      </div>}
      <div className={s.legend}>进度条每格一章：<span><i style={{ background: 'var(--wk-ch-done)' }} />完成</span><span><i style={{ background: 'var(--wk-ch-depositing)' }} />沉淀中</span><span><i style={{ background: 'var(--wk-read)' }} />已读</span><span><i style={{ background: 'var(--wk-unread)' }} />未读</span></div>
    </div></div>
  )
}

// 一本书：章节表
export function BookPage({ name }: { name: string }) {
  const { api, openKb } = useEnv()
  const { go } = useNav()
  const [bump, setBump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const b = useData(() => api.book(name), [name, bump], 'documents')
  if (!b) return null
  const st = stat(b)
  const convert = async () => {
    setBusy(true); setError('')
    try { await api.convertBook(b.name); setBump((x) => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBump((x) => x + 1) }
    finally { setBusy(false) }
  }
  // 扫描版点按钮只会再失败一次：转写走 wiki-write-book-ingest
  const scanned = isScanned(b)
  const action = convertAction(b)
  return (
    <div className={s.root}><div className={s.page} style={{ gap: 18 }}>
      <div className={s.row}>
        <h1 className={s.h1}>{b.name}</h1>
        {b.progress === '在读' && <span className={cx(s.pill, s.reading)}>在读</span>}
        <span className={cx(s.material, s['material-' + b.materialStatus])}>{busy ? '转换中' : MATERIAL_LABEL[b.materialStatus]}</span>
        {action && <span className={s.right}><Button variant={scanned ? 'ghost' : 'primary'} size="sm" disabled={busy} onClick={() => void convert()}>{busy ? '转换中' : action}</Button></span>}
      </div>
      {(error || b.materialError) && <div className={s.error}>{error || b.materialError}</div>}
      <ChapterBar book={b} />
      <table className={s.table}>
        <thead><tr><th>章</th><th>状态</th><th>沉淀去向</th></tr></thead>
        <tbody>{chapterRows(b.chapters).map((r) => r.kind === 'group'
          ? <tr key={`g:${r.title}`} className={s.group}><td colSpan={3}>{r.title}</td></tr>
          : ((c) => (
          <tr key={c.id} className={c.text ? s.go : undefined} onClick={c.text ? () => go({ kind: 'chapter', book: b.name, id: c.id, title: c.title }) : undefined}>
            <td className={c.id === st.next?.id ? s.cur : undefined}>{c.id} {c.title}</td>
            <td><span className={cx(s.state, s['st-' + c.state])}>{STATE_LABEL[c.state]}</span></td>
            <td className={s.dest}>{c.pages.length
              ? c.pages.map((pg) => pg.id
                ? <button key={pg.name} className={cx(s.pill, s.done, s.link)} onClick={(e) => { e.stopPropagation(); openKb?.(pg.id!) }} title="打开沉淀页">{pg.name}</button>
                : <span key={pg.name} className={s.pill} title="库里找不到这一页">{pg.name}</span>)
              : c.dest ? <span className={cx(s.pill, s.done)}>{c.dest}</span> : null}</td>
          </tr>
        ))(r.chapter))}</tbody>
      </table>
      {b.materialStatus === 'failed' && <div className={s.meta}>转换失败：照上面的原因处理源文件后点「转换为文字」重试；要换源文件或转不出来，在 AI 里用 wiki-write-book-ingest 处理。</div>}
      {b.materialStatus === 'init' && scanned && <div className={s.meta}>这是扫描版，没有文字层，按钮转不出来。在 AI 里用 wiki-write-book-ingest：确认后由 AI 看页图逐页转写（慢、耗 token）。换成文字版 PDF 后点「重新检测」。</div>}
      {b.materialStatus === 'init' && !!b.materialError && !scanned && <div className={s.meta}>上次转换没完成：照上面的原因处理后再点「转换为文字」。</div>}
      {b.materialStatus === 'init' && !b.materialError && <div className={s.meta}>先转换为章节文字；之后的补图、逐段梳理与质检在 AI 里用 wiki-write-book-ingest 完成，完成后才能在插件内阅读。</div>}
      {(b.materialStatus === 'text' || b.materialStatus === 'figures' || b.materialStatus === 'proofread') && <div className={s.meta}>这本书还在整理，在 AI 里用 wiki-write-book-ingest 接着做；质检通过转为「可读」后才能在插件内阅读。</div>}
      {b.materialStatus === 'unavailable' && <div className={s.meta}>这本书没有源文件，可以继续用进度页维护纸质书阅读记录。</div>}
    </div></div>
  )
}
