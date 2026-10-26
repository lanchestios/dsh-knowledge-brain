import { Button } from '../ui'
import { useState, type ReactNode } from 'react'
import { IconArchive, IconBrowse } from '../../icon'
import { IconIncrease } from '../../icon'
import { useEnv } from '../env'
import { usePanel } from '../lib/panelCtx'
import { openScene } from '../lib/sessions'
import { FIRST_STEPS } from '../lib/launch'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:max-w-290 wk:my-0 wk:mx-auto wk:pt-6 wk:pr-12 wk:pb-9 wk:pl-12 wk:flex wk:flex-col wk:gap-6 wk:[@container_(max-width:_700px)]:pt-5 wk:[@container_(max-width:_700px)]:pr-[18px] wk:[@container_(max-width:_700px)]:pb-8 wk:[@container_(max-width:_700px)]:pl-[18px] wk:[@container_(max-width:_700px)]:gap-6",
  "hero": "wk:flex wk:items-end wk:justify-between wk:gap-6 wk:pt-0 wk:pr-0 wk:pb-[18px] wk:pl-0 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:[animation:wk-components-launchpad-wkRise_.24s_cubic-bezier(.2,_0,_0,_1)_both] wk:motion-reduce:animate-none wk:[@container_(max-width:_700px)]:items-start wk:[@container_(max-width:_700px)]:flex-col wk:[@container_(max-width:_700px)]:gap-3 wk:[@container_(max-width:_700px)]:pb-4",
  "eyebrow": "wk:block wk:mb-[6px] wk:text-xs wk:leading-normal wk:font-sans wk:font-semibold wk:text-primary",
  "title": "wk:m-0 wk:font-semibold wk:text-[28px] wk:leading-[36px] wk:font-sans wk:tracking-[0] wk:text-foreground",
  "summary": "wk:mt-0 wk:mr-0 wk:mb-1 wk:ml-0 wk:flex wk:items-center wk:gap-3 wk:text-[13px] wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground wk:whitespace-nowrap wk:[&_strong]:mr-[3px] wk:[&_strong]:[font-family:inherit] wk:[&_strong]:text-[inherit] wk:[&_strong]:leading-[inherit] wk:[&_strong]:font-semibold wk:[&_strong]:text-secondary-foreground wk:[&_i]:w-[3px] wk:[&_i]:h-[3px] wk:[&_i]:rounded-[50%] wk:[&_i]:bg-[var(--wk-alias-border-l2)] wk:[@container_(max-width:_700px)]:whitespace-normal wk:[@container_(max-width:_700px)]:flex-wrap wk:[@container_(max-width:_700px)]:gap-2",
  "err": "wk:-mt-3 wk:mr-0 wk:mb-0 wk:ml-0 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-destructive",
  "section": "wk-components-launchpad-section wk:min-w-0 wk:[animation:wk-components-launchpad-wkRise_.28s_cubic-bezier(.2,_0,_0,_1)_.04s_both] wk:[&_+_.wk-components-launchpad-section]:[animation-delay:.1s] wk:motion-reduce:animate-none",
  "sectionHead": "wk:min-h-9 wk:mb-2 wk:flex wk:items-start wk:justify-between wk:[@container_(max-width:_700px)]:mb-[10px]",
  "sectionTitle": "wk:m-0 wk:font-semibold wk:text-base wk:leading-[24px] wk:font-sans wk:text-foreground",
  "sectionSub": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "exploreGrid": "wk:grid wk:grid-cols-2 wk:gap-3 wk:[@container_(max-width:_480px)]:grid-cols-1",
  "exploreCard": "wk:min-w-0 wk:h-28 wk:p-[14px] wk:flex wk:flex-col wk:items-stretch wk:[border:1px_solid_var(--wk-alias-border-l1)] wk:rounded-[var(--wk-radius-md)] wk:bg-[var(--wk-alias-bg-layer-1)] wk:text-foreground wk:cursor-pointer wk:text-left wk:[&:hover]:bg-accent wk:[&:disabled]:cursor-default wk:[&:disabled]:opacity-65 wk:[&:disabled:hover]:bg-[var(--wk-alias-bg-layer-1)] wk:[@container_(max-width:_480px)]:h-19",
  "cardTitle": "wk:flex wk:items-center wk:gap-2 wk:text-primary wk:[&_strong]:text-[14px] wk:[&_strong]:leading-[1.5] wk:[&_strong]:font-sans wk:[&_strong]:font-semibold wk:[&_strong]:text-foreground",
  "cardAction": "wk:mt-auto wk:flex wk:items-center wk:justify-between wk:gap-3 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground wk:[&_svg]:flex-none wk:[&_svg]:text-muted-foreground",
  "depositGrid": "wk:grid wk:grid-cols-2 wk:gap-12 wk:pt-[2px] wk:[@container_(max-width:_480px)]:grid-cols-1 wk:[@container_(max-width:_480px)]:gap-4",
  "depositColumn": "wk-components-launchpad-depositColumn wk:min-w-0 wk:min-h-16 wk:py-[10px] wk:px-0 wk:flex wk:flex-col wk:justify-center wk:[border-top:1px_solid_var(--wk-alias-border-l1)] wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:[&_+_.wk-components-launchpad-depositColumn]:relative wk:[&_+_.wk-components-launchpad-depositColumn::before]:content-[''] wk:[&_+_.wk-components-launchpad-depositColumn::before]:absolute wk:[&_+_.wk-components-launchpad-depositColumn::before]:top-0 wk:[&_+_.wk-components-launchpad-depositColumn::before]:bottom-0 wk:[&_+_.wk-components-launchpad-depositColumn::before]:-left-6 wk:[&_+_.wk-components-launchpad-depositColumn::before]:w-[1px] wk:[&_+_.wk-components-launchpad-depositColumn::before]:bg-[var(--wk-alias-border-l1)] wk:[&_h3]:mt-0 wk:[&_h3]:mr-0 wk:[&_h3]:mb-[6px] wk:[&_h3]:ml-0 wk:[&_h3]:text-[13px] wk:[&_h3]:leading-[1.5] wk:[&_h3]:font-sans wk:[&_h3]:font-semibold wk:[&_h3]:text-foreground wk:[&_p]:m-0 wk:[&_p]:text-[12px] wk:[&_p]:leading-[1.5] wk:[&_p]:font-sans wk:[&_p]:font-normal wk:[&_p]:text-muted-foreground wk:[@container_(max-width:_480px)]:[&_+_.wk-components-launchpad-depositColumn::before]:hidden",
}

interface ExploreStart {
  name: string
  hint: string
  say: string
  icon: ReactNode
}

const GUIDED_STARTS: ExploreStart[] = [
  {
    name: '书籍',
    hint: '导入第一本书',
    say: FIRST_STEPS[1].say,
    icon: <IconBrowse size={18} />,
  },
  {
    name: '文档',
    hint: '收下第一篇文章',
    say: FIRST_STEPS[0].say,
    icon: <IconArchive size={18} />,
  },
]

// 空库直接预演知识库首页：探索入口是真行动，沉淀区则展示内容形成后的落点。不自动开右栏、
// 不自动建会话；点一张入口卡是场景按钮——新开一场会话挂右栏，这一步的话直接发出去。
// 文件一变，HomeView 会自然切回真实首页。
export function Launchpad() {
  const { api, c } = useEnv()
  const panel = usePanel()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const step = (say: string) => {
    if (busy) return
    setBusy(true)
    setErr('')
    openScene(panel, c, api, say)
      .catch((e: unknown) => setErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false))
  }

  return (
    <div data-wiki-ui="" className={s.root}>
      <header data-wiki-ui="" className={s.hero}>
        <div>
          <span data-wiki-ui="" className={s.eyebrow}>知识库</span>
          <h1 data-wiki-ui="" className={s.title}>格物致知</h1>
        </div>
        <p data-wiki-ui="" className={s.summary} aria-label="知识库目前为空">
          <span><strong>0</strong> 页知识</span>
          <i />
          <span><strong>0</strong> 篇草稿</span>
          <i />
          <span><strong>0</strong> 篇完成</span>
        </p>
      </header>

      {err && <p data-wiki-ui="" className={s.err}>会话没建起来：{err}</p>}

      <section data-wiki-ui="" className={s.section}>
        <header data-wiki-ui="" className={s.sectionHead}>
          <div>
            <h2 data-wiki-ui="" className={s.sectionTitle}>知识探索</h2>
            <p data-wiki-ui="" className={s.sectionSub}>先添加一份内容，首页会从这里开始生长</p>
          </div>
        </header>
        <div data-wiki-ui="" className={s.exploreGrid}>
          {GUIDED_STARTS.map((item) => (
            <Button size="sm"
              key={item.name}
              type="button"
              className={s.exploreCard}
              disabled={busy}
              onClick={() => step(item.say)}
            >
              <span data-wiki-ui="" className={s.cardTitle}>{item.icon}<strong>{item.name}</strong></span>
              <span data-wiki-ui="" className={s.cardAction}>{item.hint}<IconIncrease size={16} /></span>
            </Button>
          ))}
        </div>
      </section>

      <section data-wiki-ui="" className={s.section}>
        <header data-wiki-ui="" className={s.sectionHead}>
          <div>
            <h2 data-wiki-ui="" className={s.sectionTitle}>知识沉淀</h2>
            <p data-wiki-ui="" className={s.sectionSub}>探索过的内容，会在这里形成自己的知识</p>
          </div>
        </header>
        <div data-wiki-ui="" className={s.depositGrid}>
          <section data-wiki-ui="" className={s.depositColumn}>
            <h3>草稿</h3>
            <p>还没有草稿</p>
          </section>
          <section data-wiki-ui="" className={s.depositColumn}>
            <h3>最近更新</h3>
            <p>第一页完成后会出现在这里</p>
          </section>
        </div>
      </section>
    </div>
  )
}
