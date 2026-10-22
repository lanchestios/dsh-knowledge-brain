import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconMoreRight } from '../../icon'
import type { HomeData } from '../../core/api'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import { becameNonEmpty, exploreEmpty, homeEmpty } from '../lib/launch'
import { Launchpad } from './Launchpad'
import { ExploreCards } from '../explore/ExploreCards'
import s from './HomeView.module.css'

// 知识库首页只回答两件事：接下来读什么、接下来写什么。
// 探索是三张入口卡；沉淀是两列轻列表。每列只露最近几条，把完整浏览留给各自的列表页。
// 数字口径见 model.home。探索与沉淀双空 = 还没人用过：先给启动台，把人带进 AI 会话；
// 只空一半就在那一列给一行提示，另一列照常
export function HomeView() {
  const { api } = useEnv()
  const { go } = useNav()
  const home = useData(() => api.home(), [], 'stats')
  const shelf = useData(() => api.books(), [], 'documents')
  const all = useData(() => api.documents(), [], 'documents')
  const [landed, setLanded] = useState(false)
  const prev = useRef<HomeData | null | undefined>(null)
  // 「眼看着从空变不空」才演落成交接（启动台把看板接过来）：一上来就有内容、平常进出首页都不演
  useEffect(() => {
    if (becameNonEmpty(prev.current, home)) setLanded(true)
    prev.current = home ?? null
  }, [home])
  if (!home || !shelf || !all) return null
  const noExplore = exploreEmpty(shelf, all)
  const noDeposit = homeEmpty(home)
  if (noExplore && noDeposit) return <Launchpad />
  const { stats } = home
  return (
    <div className={cx(s.root, landed && s.landed)}>
      <header className={s.hero}>
        <div>
          <span className={s.eyebrow}>知识库</span>
          <h1 className={s.title}>格物致知</h1>
        </div>
        <p className={s.summary}>
          <span><strong>{stats.total}</strong> 页知识</span>
          <i />
          <span><strong>{stats.draft}</strong> 篇草稿</span>
          <i />
          <span><strong>{stats.done}</strong> 篇完成</span>
        </p>
      </header>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>知识探索</h2>
            <p className={s.sectionSub}>回到正在读、正在整理和刚刚听见的内容</p>
          </div>
        </header>
        <div className={s.explore}>
          {noExplore ? (
            <p className={s.halfEmpty}>书与文档都还没有——贴一篇文章、放一本书，探索就从这里开始。</p>
          ) : <ExploreCards shelf={shelf} all={all} />}
        </div>
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>知识沉淀</h2>
            <p className={s.sectionSub}>接着写，或回看最近形成的知识</p>
          </div>
        </header>
        <div className={s.depositGrid}>
          {noDeposit ? (
            <p className={s.halfEmpty}>还没有沉淀页；文档积累起来后，让 AI 在会话里沉淀出第一页。</p>
          ) : (
            <>
              <section className={s.tile}>
                <header className={s.tileHead}><span className={s.tileTitle}>草稿</span>
                  <span className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'drafts' })}><span className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span></header>
                <div className={s.body}>
                  {stats.drafts.length === 0
                    ? <div className={s.empty}>没有草稿，都写完了。</div>
                    : stats.drafts.slice(0, 4).map((r) => (
                      <button key={r.id} className={s.row} onClick={() => go({ kind: 'page', id: r.id })} title={r.name}>
                        <i className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />
                        <span className={s.rowName}>{r.name}</span>
                        <span className={s.rowTime}>{timeAgo(r.updated)}</span>
                      </button>
                    ))}
                </div>
              </section>
              <section className={s.tile}>
                <header className={s.tileHead}><span className={s.tileTitle}>最近更新</span>
                  <span className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'activity' })}><span className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span></header>
                <div className={s.body}>
                  {stats.recent.slice(0, 4).map((r) => (
                    <button key={r.id} className={s.row} onClick={() => go({ kind: 'page', id: r.id })} title={r.name}>
                      <i className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />
                      <span className={s.rowName}>{r.name}</span>
                      <span className={s.rowTime}>{timeAgo(r.updated)}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

// 'YYYY-MM-DD' → 今天 / 昨天 / N 天前 / N 周前 / MM-DD（沉淀两页的更新列也用）
export function timeAgo(d: string): string {
  const n = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5)
  if (n <= 0) return '今天'
  if (n === 1) return '昨天'
  if (n < 7) return `${n} 天前`
  if (n < 30) return `${Math.floor(n / 7)} 周前`
  return d.slice(5)
}
