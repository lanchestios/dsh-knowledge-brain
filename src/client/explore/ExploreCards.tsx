import { Card } from '../ui'
import { Button } from '../ui'
import { IconMoreRight } from '../../icon'
import type { Book, Document } from '../../core/api'
import { useNav, type DocumentFilter } from '../lib/nav'
import { matches } from '../lib/explore'
import { cx } from '../lib/cx'
import { ChapterBar, stat } from './BooksShelf'
import { Spark } from './Spark'
import books from './books.styles'
import documents from './documents.styles'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "grid": "wk:grid wk:grid-cols-2 wk:gap-3 wk:[@container_(max-width:_980px)]:grid-cols-1",
  "tile": "wk:min-w-0 wk:flex wk:flex-col wk:overflow-hidden wk:[border:1px_solid_var(--wk-alias-border-l1)] wk:rounded-[8px] wk:bg-[var(--wk-alias-bg-layer-1)] wk:[@container_(max-width:_980px)]:min-h-0",
  "tileHead": "wk:flex-none wk:flex wk:items-center wk:gap-2 wk:h-10 wk:py-0 wk:px-[14px]",
  "tileTitle": "wk:text-[13px] wk:leading-normal wk:font-sans wk:font-semibold wk:text-foreground",
  "more": "wk:ml-auto",
  "body": "wk:flex-1 wk:pt-0 wk:pr-[14px] wk:pb-[14px] wk:pl-[14px] wk:flex wk:flex-col wk:gap-[10px]",
  "meta": "wk:flex-none wk:whitespace-nowrap wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "row": "wk:flex wk:items-center wk:gap-2 wk:min-w-0",
  "list": "wk:flex wk:flex-col",
  "item": "wk:flex wk:items-center wk:gap-[10px] wk:h-8 wk:py-0 wk:px-2 wk:mt-0 wk:-mr-2 wk:mb-0 wk:-ml-2 wk:border-0 wk:rounded-[var(--wk-radius-sm)] wk:bg-transparent wk:text-left wk:cursor-pointer wk:text-foreground wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:[&:hover]:bg-accent",
  "itemName": "wk:flex-1 wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "mini": "wk:w-28 wk:flex-none wk:[&_>_div]:mt-0 wk:[&_>_div]:h-[6px]",
  "big": "wk:flex wk:flex-none wk:items-baseline wk:gap-2 wk:min-w-0 wk:border-0 wk:bg-transparent wk:p-0 wk:cursor-pointer wk:text-left",
  "num": "wk:font-semibold wk:text-[28px] wk:leading-[36px] wk:font-sans wk:text-[var(--wk-todo)]",
  "lbl": "wk:text-xs wk:leading-normal wk:font-sans wk:font-medium wk:text-muted-foreground wk:-mb-[6px]",
  "go": "wk:inline-flex wk:items-center wk:gap-[2px]",
  "numBooks": "wk:text-[var(--wk-read)]",
}

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
    <div data-wiki-ui="" className={cx(s.grid, books.root, documents.root)}>
      <Card asChild><section data-wiki-ui="" className={s.tile}>
        <header data-wiki-ui="" className={s.tileHead}>
          <span data-wiki-ui="" className={s.tileTitle}>书籍</span>
          <span data-wiki-ui="" className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'books' })}><span data-wiki-ui="" className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span>
        </header>
        <div data-wiki-ui="" className={s.body}>
          <div data-wiki-ui="" className={s.row}>
            <Button size="sm" className={s.big} onClick={() => go({ kind: 'books' })} aria-label={`${unfinished}% 待读`}>
              <span data-wiki-ui="" className={cx(s.num, s.numBooks)}>{unfinished}%</span><span data-wiki-ui="" className={s.meta}>待读</span>
            </Button>
            {/* 一本书一根柱：按章状态 100% 堆叠，悬停看数 */}
            <span data-wiki-ui="" className={s.more}><div data-wiki-ui="" className={documents.spark} aria-label="各书进度">{shelf.map((b) => {
              const k = (st: string) => b.chapters.filter((c) => c.state === st).length
              return <b key={b.name} title={`${b.name} · ${b.chapters.length} 章 · 读过 ${stat(b).read} · 沉淀中 ${k('depositing')} · 完成 ${k('done')}`}>
                {(['unread', 'read', 'depositing', 'done'] as const).map((st) => <i key={st} style={{ flex: k(st), background: `var(--wk-${st === 'done' || st === 'depositing' ? 'ch-' + st : st})` }} />)}
              </b>
            })}</div></span>
          </div>
          <div data-wiki-ui="" className={s.lbl}>书目 · 在读优先</div>
          <div data-wiki-ui="" className={s.list}>
            {[...reading, ...rest].slice(0, 5).map((b) => {
              return (
                <Button size="sm" key={b.name} className={s.item} onClick={() => go({ kind: 'book', name: b.name })} title={b.name}>
                  <span data-wiki-ui="" className={s.itemName}>{b.name}</span>
                  <span data-wiki-ui="" className={s.mini}><ChapterBar book={b} /></span>
                </Button>
              )
            })}
          </div>
        </div>
      </section></Card>

      <Card asChild><section data-wiki-ui="" className={s.tile}>
        <header data-wiki-ui="" className={s.tileHead}>
          <span data-wiki-ui="" className={s.tileTitle}>文档</span>
          <span data-wiki-ui="" className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'documents', status: '待沉淀' })}><span data-wiki-ui="" className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span>
        </header>
        <div data-wiki-ui="" className={s.body}>
          <div data-wiki-ui="" className={s.row}>
            <Button size="sm" className={s.big} onClick={() => go({ kind: 'documents', status: '待沉淀' })}>
              <span data-wiki-ui="" className={s.num}>{n('待沉淀')}</span><span data-wiki-ui="" className={s.meta}>待沉淀</span>
            </Button>
            <span data-wiki-ui="" className={s.more}><Spark all={all} /></span>
          </div>
          <div data-wiki-ui="" className={s.lbl}>最近待沉淀</div>
          <div data-wiki-ui="" className={s.list}>
            {recent.map((m) => (
              <Button size="sm" key={m.path} className={s.item} onClick={() => go({ kind: 'raw', path: m.path })} title={m.path}>
                <span data-wiki-ui="" className={s.itemName}>{m.name}</span>
                <span data-wiki-ui="" className={s.meta}>{m.date.slice(5)}</span>
              </Button>
            ))}
          </div>
        </div>
      </section></Card>

    </div>
  )
}
