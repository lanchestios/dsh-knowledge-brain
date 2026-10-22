import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconMoreRight } from '../../icon'
import type { Book, Document } from '../../core/api'
import { useNav, type DocumentFilter } from '../lib/nav'
import { matches } from '../lib/explore'
import { cx } from '../lib/cx'
import { ChapterBar, stat } from './BooksShelf'
import { Spark } from './Spark'
import books from './books.module.css'
import documents from './documents.module.css'
import s from './home.module.css'

// 首页探索区的三张入口卡。这里只露出足够接着做事的 5 条内容，完整信息进各自页面看。
// 数据由 HomeView 一并取来，这里只管画
export function ExploreCards({ shelf, all }: { shelf: Book[]; all: Document[] }) {
  const { go } = useNav()
  const reading = shelf.filter((b) => b.progress === '在读')
  const rest = shelf.filter((b) => b.progress !== '在读')
  const chapters = shelf.flatMap((b) => b.chapters)
  const unfinished = chapters.length
    ? Math.round(chapters.filter((c) => c.state !== 'done').length / chapters.length * 100)
    : 0
  const n = (f: DocumentFilter) => all.filter((m) => matches(m, f)).length
  const recent = all.filter((m) => matches(m, '待沉淀')).slice(0, 5)
  return (
    <div className={cx(s.grid, books.root, documents.root)}>
      <section className={s.tile}>
        <header className={s.tileHead}>
          <span className={s.tileTitle}>书籍</span>
          <span className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'books' })}><span className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span>
        </header>
        <div className={s.body}>
          <div className={s.row}>
            <button className={s.big} onClick={() => go({ kind: 'books' })} aria-label={`${unfinished}% 待读`}>
              <span className={cx(s.num, s.numBooks)}>{unfinished}%</span><span className={s.meta}>待读</span>
            </button>
            {/* 一本书一根柱：按章状态 100% 堆叠，悬停看数 */}
            <span className={s.more}><div className={documents.spark} aria-label="各书进度">{shelf.map((b) => {
              const k = (st: string) => b.chapters.filter((c) => c.state === st).length
              return <b key={b.name} title={`${b.name} · ${b.chapters.length} 章 · 读过 ${stat(b).read} · 沉淀中 ${k('depositing')} · 完成 ${k('done')}`}>
                {(['unread', 'read', 'depositing', 'done'] as const).map((st) => <i key={st} style={{ flex: k(st), background: `var(--wk-${st === 'done' || st === 'depositing' ? 'ch-' + st : st})` }} />)}
              </b>
            })}</div></span>
          </div>
          <div className={s.lbl}>书目 · 在读优先</div>
          <div className={s.list}>
            {[...reading, ...rest].slice(0, 5).map((b) => {
              return (
                <button key={b.name} className={s.item} onClick={() => go({ kind: 'book', name: b.name })} title={b.name}>
                  <span className={s.itemName}>{b.name}</span>
                  <span className={s.mini}><ChapterBar book={b} /></span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <section className={s.tile}>
        <header className={s.tileHead}>
          <span className={s.tileTitle}>文档</span>
          <span className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'documents', status: '待沉淀' })}><span className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span>
        </header>
        <div className={s.body}>
          <div className={s.row}>
            <button className={s.big} onClick={() => go({ kind: 'documents', status: '待沉淀' })}>
              <span className={s.num}>{n('待沉淀')}</span><span className={s.meta}>待沉淀</span>
            </button>
            <span className={s.more}><Spark all={all} /></span>
          </div>
          <div className={s.lbl}>最近待沉淀</div>
          <div className={s.list}>
            {recent.map((m) => (
              <button key={m.path} className={s.item} onClick={() => go({ kind: 'raw', path: m.path })} title={m.path}>
                <span className={s.itemName}>{m.name}</span>
                <span className={s.meta}>{m.date.slice(5)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
