import { useEffect, useState } from 'react'
import { LocalGraph } from './LocalGraph'
import { useChapter, usePage, useRaw } from '../lib/page'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import type { Chapter, PageData, TocItem } from '../../core/api'
import s from './Inspector.module.css'

const Label = ({ children }: { children: React.ReactNode }) => <div className={s.label}>{children}</div>

// 右栏：阅读器三栏里单独一栏；右侧 wiki 页 tab 里折到页底（compact）。
// 探索区详情页的「属性」tab 也是它：一章 = 文章目录 + 知识沉淀；一份文档 md = 文章目录
export function Inspector() {
  const { route } = useNav()
  const result = usePage()
  const page = route.kind === 'page' && result?.ok && result.page.id === route.id ? result.page : null
  // 文档 md 只有文章目录，没有被引用与局部图
  const rawRes = useRaw()
  const raw = route.kind === 'raw' && rawRes?.ok && rawRes.raw.path === route.path ? rawRes.raw : null
  const ch = useChapter()
  const chapter = route.kind === 'chapter' && ch?.book === route.book && ch.chapter.id === route.id ? ch : null
  const toc = page?.toc ?? raw?.toc ?? chapter?.toc ?? []
  if (!page && !chapter && !toc.length) return null
  return <div className={s.scroll}><InspectorBody page={page} chapter={chapter?.chapter} toc={toc} tocKey={page?.id ?? raw?.path ?? (chapter ? chapter.book + '/' + chapter.chapter.id : '')} html={page?.html ?? raw?.html ?? chapter?.html ?? ''} /></div>
}

export function InspectorBody({ page, chapter, toc, tocKey, html }: { page: PageData | null; chapter?: Chapter; toc: TocItem[]; tocKey: string; html: string }) {
  const { go } = useNav()
  const { openKb } = useEnv()
  const [active, setActive] = useState<string | null>(null)

  // 文章目录跟随滚动：取视口上沿以下第一个标题
  useEffect(() => {
    if (!toc.length) return
    const els = toc.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActive(vis[0].target.id)
    }, { rootMargin: '0px 0px -70% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [tocKey, html])

  return (
    <div className={s.body}>
      {toc.length > 0 && (
        <section>
          <Label>文章目录</Label>
          {toc.map((t) => (
            <button key={t.id} onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth' })}
              className={cx(s.toc, t.depth === 3 && s.h3, active === t.id && s.active)}>
              {t.text}
            </button>
          ))}
        </section>
      )}
      {chapter && (
        <section>
          <Label>知识沉淀 {chapter.pages.length}</Label>
          {chapter.dest && <div className={s.snippet}>去向：{chapter.dest}</div>}
          {chapter.pages.length === 0 && <div className={s.empty}>这一章还没有登记沉淀页</div>}
          {/* 沉淀页点了直接进（同一个面板）；页名解析不到的只显示名字 */}
          {chapter.pages.map((p) => p.id
            ? <button key={p.name} onClick={() => openKb?.(p.id!)} className={s.link}><div className={s.linkName}>{p.name}</div></button>
            : <div key={p.name} className={s.link}><div className={s.linkName}>{p.name}</div><div className={s.snippet}>找不到这一页</div></div>)}
        </section>
      )}
      {page && (<>
        {page.children.length > 0 && (
          <section>
            <Label>知识下拆 {page.children.length}</Label>
            {page.children.map((c) => (
              <button key={c.id} onClick={() => go({ kind: 'page', id: c.id })} className={s.link}>
                <div className={s.linkName}>{c.name}</div>
                {c.desc && <div className={s.snippet}>{c.desc}</div>}
              </button>
            ))}
          </section>
        )}
        <section>
          <Label>知识引用 {page.backlinks.length}</Label>
          {page.backlinks.length === 0 && <div className={s.empty}>除父层导览外没有页链向这里</div>}
          {page.backlinks.map((b) => (
            <button key={b.from.id} onClick={() => go({ kind: 'page', id: b.from.id })} className={s.link}>
              <div className={s.linkName}>{b.from.name}</div>
              <div className={s.snippet} dangerouslySetInnerHTML={{ __html: b.snippet }} />
            </button>
          ))}
        </section>
        <section>
          <Label>局部图谱</Label>
          <LocalGraph id={page.id} />
        </section>
      </>)}
    </div>
  )
}
