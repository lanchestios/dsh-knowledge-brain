import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { IconMoreRight } from '../../icon'
import type { HomeData } from '../../core/api'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import { becameNonEmpty, exploreEmpty, homeEmpty } from '../lib/launch'
import { Launchpad } from './Launchpad'
import { ExploreCards } from '../explore/ExploreCards'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:[--wk-done:#1baf7a] wk:max-w-290 wk:my-0 wk:mx-auto wk:pt-6 wk:pr-12 wk:pb-9 wk:pl-12 wk:flex wk:flex-col wk:gap-6 wk:dark:[--wk-done:#199e70] wk:[@container_(max-width:_700px)]:pt-5 wk:[@container_(max-width:_700px)]:pr-[18px] wk:[@container_(max-width:_700px)]:pb-8 wk:[@container_(max-width:_700px)]:pl-[18px] wk:[@container_(max-width:_700px)]:gap-6",
  "hero": "wk:flex wk:items-end wk:justify-between wk:gap-6 wk:pt-0 wk:pr-0 wk:pb-[18px] wk:pl-0 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:[@container_(max-width:_700px)]:items-start wk:[@container_(max-width:_700px)]:flex-col wk:[@container_(max-width:_700px)]:gap-3 wk:[@container_(max-width:_700px)]:pb-4",
  "eyebrow": "wk:block wk:mb-[6px] wk:text-xs wk:leading-normal wk:font-sans wk:font-semibold wk:text-primary",
  "title": "wk:m-0 wk:font-semibold wk:text-[28px] wk:leading-[36px] wk:font-sans wk:tracking-[0] wk:text-foreground",
  "summary": "wk:mt-0 wk:mr-0 wk:mb-1 wk:ml-0 wk:flex wk:items-center wk:gap-3 wk:text-[13px] wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground wk:whitespace-nowrap wk:[&_strong]:mr-[3px] wk:[&_strong]:[font-family:inherit] wk:[&_strong]:text-[inherit] wk:[&_strong]:leading-[inherit] wk:[&_strong]:font-semibold wk:[&_strong]:text-secondary-foreground wk:[&_i]:w-[3px] wk:[&_i]:h-[3px] wk:[&_i]:rounded-[50%] wk:[&_i]:bg-[var(--wk-alias-border-l2)] wk:[@container_(max-width:_700px)]:whitespace-normal wk:[@container_(max-width:_700px)]:flex-wrap wk:[@container_(max-width:_700px)]:gap-2",
  "section": "wk-components-homeview-section wk:min-w-0",
  "sectionHead": "wk:min-h-9 wk:mb-2 wk:flex wk:items-start wk:justify-between wk:[@container_(max-width:_700px)]:mb-[10px]",
  "sectionTitle": "wk:m-0 wk:font-semibold wk:text-base wk:leading-[24px] wk:font-sans wk:text-foreground",
  "sectionSub": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "explore": "wk:min-w-0",
  "depositGrid": "wk:grid wk:grid-cols-2 wk:gap-12 wk:pt-[2px] wk:[@container_(max-width:_860px)]:grid-cols-1 wk:[@container_(max-width:_860px)]:gap-6",
  "tile": "wk-components-homeview-tile wk:min-w-0 wk:flex wk:flex-col wk:[&_+_.wk-components-homeview-tile]:relative wk:[&_+_.wk-components-homeview-tile::before]:content-[''] wk:[&_+_.wk-components-homeview-tile::before]:absolute wk:[&_+_.wk-components-homeview-tile::before]:top-0 wk:[&_+_.wk-components-homeview-tile::before]:bottom-0 wk:[&_+_.wk-components-homeview-tile::before]:-left-6 wk:[&_+_.wk-components-homeview-tile::before]:w-[1px] wk:[&_+_.wk-components-homeview-tile::before]:bg-[var(--wk-alias-border-l1)] wk:[@container_(max-width:_860px)]:[&_+_.wk-components-homeview-tile]:pt-6 wk:[@container_(max-width:_860px)]:[&_+_.wk-components-homeview-tile]:[border-top:1px_solid_var(--wk-alias-border-l1)] wk:[@container_(max-width:_860px)]:[&_+_.wk-components-homeview-tile::before]:hidden",
  "tileHead": "wk:flex-none wk:flex wk:items-center wk:gap-2 wk:h-9",
  "tileTitle": "wk:text-[13px] wk:leading-normal wk:font-sans wk:font-semibold wk:text-foreground",
  "more": "wk:ml-auto",
  "go": "wk:inline-flex wk:items-center wk:gap-[2px]",
  "dot": "wk:inline-block wk:w-[7px] wk:h-[7px] wk:rounded-full wk:flex-none wk:mr-[10px]",
  "body": "wk:flex wk:flex-col wk:gap-1",
  "empty": "wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground wk:py-[10px] wk:px-0",
  "row": "wk:flex wk:items-center wk:h-[34px] wk:py-0 wk:px-2 wk:mt-0 wk:-mr-2 wk:mb-0 wk:-ml-2 wk:border-0 wk:rounded-[var(--wk-radius-sm)] wk:bg-transparent wk:cursor-pointer wk:text-left wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-foreground wk:[&:hover]:bg-accent",
  "rowName": "wk:flex-1 wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "rowTime": "wk:flex-none wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground wk:tabular-nums",
  "halfEmpty": "wk:m-0 wk:py-5 wk:px-0 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "landed": "wk:[&_.wk-components-homeview-section]:[animation:wk-components-homeview-wkRise_.3s_cubic-bezier(.2,_0,_0,_1)_both] wk:[&_.wk-components-homeview-section_+_.wk-components-homeview-section]:[animation-delay:.08s] wk:motion-reduce:[&_.wk-components-homeview-section]:animate-none",
}

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
    <div data-wiki-ui="" className={cx(s.root, landed && s.landed)}>
      <header data-wiki-ui="" className={s.hero}>
        <div>
          <span data-wiki-ui="" className={s.eyebrow}>知识库</span>
          <h1 data-wiki-ui="" className={s.title}>格物致知</h1>
        </div>
        <p data-wiki-ui="" className={s.summary}>
          <span><strong>{stats.total}</strong> 页知识</span>
          <i />
          <span><strong>{stats.draft}</strong> 篇草稿</span>
          <i />
          <span><strong>{stats.done}</strong> 篇完成</span>
        </p>
      </header>

      <section data-wiki-ui="" className={s.section}>
        <header data-wiki-ui="" className={s.sectionHead}>
          <div>
            <h2 data-wiki-ui="" className={s.sectionTitle}>知识探索</h2>
            <p data-wiki-ui="" className={s.sectionSub}>回到正在读、正在整理和刚刚听见的内容</p>
          </div>
        </header>
        <div data-wiki-ui="" className={s.explore}>
          {noExplore ? (
            <p data-wiki-ui="" className={s.halfEmpty}>书与文档都还没有——贴一篇文章、放一本书，探索就从这里开始。</p>
          ) : <ExploreCards shelf={shelf} all={all} />}
        </div>
      </section>

      <section data-wiki-ui="" className={s.section}>
        <header data-wiki-ui="" className={s.sectionHead}>
          <div>
            <h2 data-wiki-ui="" className={s.sectionTitle}>知识沉淀</h2>
            <p data-wiki-ui="" className={s.sectionSub}>接着写，或回看最近形成的知识</p>
          </div>
        </header>
        <div data-wiki-ui="" className={s.depositGrid}>
          {noDeposit ? (
            <p data-wiki-ui="" className={s.halfEmpty}>还没有沉淀页；文档积累起来后，让 AI 在会话里沉淀出第一页。</p>
          ) : (
            <>
              <section data-wiki-ui="" className={s.tile}>
                <header data-wiki-ui="" className={s.tileHead}><span data-wiki-ui="" className={s.tileTitle}>草稿</span>
                  <span data-wiki-ui="" className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'drafts' })}><span data-wiki-ui="" className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span></header>
                <div data-wiki-ui="" className={s.body}>
                  {stats.drafts.length === 0
                    ? <div data-wiki-ui="" className={s.empty}>没有草稿，都写完了。</div>
                    : stats.drafts.slice(0, 4).map((r) => (
                      <Button size="sm" key={r.id} className={s.row} onClick={() => go({ kind: 'page', id: r.id })} title={r.name}>
                        <i data-wiki-ui="" className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />
                        <span data-wiki-ui="" className={s.rowName}>{r.name}</span>
                        <span data-wiki-ui="" className={s.rowTime}>{timeAgo(r.updated)}</span>
                      </Button>
                    ))}
                </div>
              </section>
              <section data-wiki-ui="" className={s.tile}>
                <header data-wiki-ui="" className={s.tileHead}><span data-wiki-ui="" className={s.tileTitle}>最近更新</span>
                  <span data-wiki-ui="" className={s.more}><Button variant="ghost" size="sm" onClick={() => go({ kind: 'activity' })}><span data-wiki-ui="" className={s.go}>去查看<IconMoreRight size={14} /></span></Button></span></header>
                <div data-wiki-ui="" className={s.body}>
                  {stats.recent.slice(0, 4).map((r) => (
                    <Button size="sm" key={r.id} className={s.row} onClick={() => go({ kind: 'page', id: r.id })} title={r.name}>
                      <i data-wiki-ui="" className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />
                      <span data-wiki-ui="" className={s.rowName}>{r.name}</span>
                      <span data-wiki-ui="" className={s.rowTime}>{timeAgo(r.updated)}</span>
                    </Button>
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
