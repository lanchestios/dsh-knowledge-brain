import { Button } from '../ui'
import { useEffect, useState } from 'react'
import { Tooltip } from '../ui'
import { IconMoreRight } from '../../icon'
import { InspectorBody } from './Inspector'
import { useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import type { PageResult } from '../../core/api'
import { WikiEditor } from './WikiEditor'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "page": "wk:max-w-240 wk:my-0 wk:mx-auto wk:py-8 wk:px-10 wk:[@container_(max-width:_700px)]:py-5 wk:[@container_(max-width:_700px)]:px-4",
  "compact": "wk:py-4 wk:px-5 wk:[&_.wk-components-pageview-title]:text-[20px] wk:[&_.wk-components-pageview-title]:leading-[1.5] wk:[&_.wk-components-pageview-title]:font-sans wk:[&_.wk-components-pageview-title]:font-semibold wk:[@container_(max-width:_700px)]:py-3 wk:[@container_(max-width:_700px)]:px-4",
  "titleRow": "wk:flex wk:items-center wk:gap-1 wk:min-w-0",
  "title": "wk-components-pageview-title wk:min-w-0 wk:text-2xl wk:leading-normal wk:font-sans wk:font-semibold wk:tracking-[0] wk:m-0 wk:text-foreground wk:overflow-wrap-anywhere",
  "propertyToggle": "wk:flex-none wk:[display:inline-grid] wk:place-items-center wk:w-7 wk:h-7 wk:border-0 wk:rounded-[var(--wk-radius-sm)] wk:p-0 wk:bg-transparent wk:text-muted-foreground wk:cursor-pointer wk:[&:hover]:bg-accent wk:[&:hover]:text-secondary-foreground wk:[&:focus-visible]:[outline:var(--wk-focus-ring-width,_2px)_solid_var(--wk-focus-ring-color,_var(--wk-alias-state-business-primary))] wk:[&:focus-visible]:[outline-offset:-2px] wk:[&_svg]:[transition:transform_.15s]",
  "propertyToggleOpen": "wk:[&_svg]:[transform:rotate(90deg)]",
  "body": "wk:mt-4",
  "offline": "wk:mt-8 wk:py-2 wk:px-3 wk:[border-left:3px_solid_var(--wk-alias-state-warn-primary)] wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "loading": "wk:p-10 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "missing": "wk:p-10 wk:flex wk:flex-col wk:gap-3",
  "missingTitle": "wk:text-xl wk:leading-normal wk:font-sans wk:font-semibold wk:m-0",
  "mono": "wk:font-sans wk:text-xs wk:leading-normal wk:font-normal wk:text-secondary-foreground",
  "cand": "wk:block wk:border-0 wk:bg-transparent wk:p-0 wk:text-left wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-[var(--wk-alias-link)] wk:underline wk:cursor-pointer",
  "foot": "wk:mt-8 wk:pt-2 wk:[border-top:1px_solid_var(--wk-alias-border-l1)]",
}

// compact：右侧 wiki 页 tab 里用——边距收窄，检视栏内容折到页底
export function PageView({ result, id, anchor, scroller, compact }: { result: PageResult | undefined; id: string; anchor?: string; scroller: React.RefObject<HTMLDivElement | null>; compact?: boolean }) {
  const { go } = useNav()
  const page = result?.ok && result.page.id === id ? result.page : null
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  useEffect(() => { setPropertiesOpen(false) }, [page?.id])

  // 换了页或锚点才定位：有锚点滚到锚点，否则回顶
  useEffect(() => {
    if (!page) return
    const target = anchor ? document.getElementById(anchor) : null
    if (target) target.scrollIntoView()
    else scroller.current?.scrollTo({ top: 0 })
  }, [page?.id, anchor])

  if (!result || (result.ok && result.page.id !== id)) return <div data-wiki-ui="" className={s.loading}>载入中…</div>
  if (!result.ok) {
    return (
      <div data-wiki-ui="" className={s.missing}>
        <h1 data-wiki-ui="" className={s.missingTitle}>此页已移动或删除</h1>
        <p data-wiki-ui="" className={s.mono}>{id}</p>
        {result.candidates.length > 0 && <p>同名的页：</p>}
        {result.candidates.map((c) => (
          <Button size="sm" key={c.id} className={s.cand} onClick={() => go({ kind: 'page', id: c.id })}>{c.crumb ? c.crumb + ' › ' : ''}{c.name}</Button>
        ))}
      </div>
    )
  }
  const p = result.page
  const propertyLabel = propertiesOpen ? '收起属性' : '展开属性'
  return (
    <article data-wiki-ui="" className={cx(s.page, compact && s.compact)}>
      <div data-wiki-ui="" className={s.titleRow}>
        <h1 data-wiki-ui="" className={s.title}>{p.title}</h1>
        {!p.offline && (
          <Tooltip label={propertyLabel} side="bottom" delayMs={500}>
            <Button size="sm" type="button" className={cx(s.propertyToggle, propertiesOpen && s.propertyToggleOpen)}
              aria-label={propertyLabel} aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen((open) => !open)}>
              <IconMoreRight size={16} />
            </Button>
          </Tooltip>
        )}
      </div>
      {p.offline
        ? <p data-wiki-ui="" className={s.offline}>文件未下载到本机。在访达里对它选「始终保留在此设备上」，或打开一次让 OneDrive 取回。</p>
        : <div data-wiki-ui="" className={cx(s.body)}><WikiEditor path={p.id} page anchor={anchor} frontmatterVisible={propertiesOpen} /></div>}
      {compact && <div data-wiki-ui="" className={s.foot}><InspectorBody page={p} toc={p.toc} tocKey={p.id} html={p.html} /></div>}
    </article>
  )
}
