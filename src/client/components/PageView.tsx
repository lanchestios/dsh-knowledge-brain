import { useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconMoreRight } from '../../icon'
import { InspectorBody } from './Inspector'
import { useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import type { PageResult } from '../../core/api'
import { WikiEditor } from './WikiEditor'
import s from './PageView.module.css'

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

  if (!result || (result.ok && result.page.id !== id)) return <div className={s.loading}>载入中…</div>
  if (!result.ok) {
    return (
      <div className={s.missing}>
        <h1 className={s.missingTitle}>此页已移动或删除</h1>
        <p className={s.mono}>{id}</p>
        {result.candidates.length > 0 && <p>同名的页：</p>}
        {result.candidates.map((c) => (
          <button key={c.id} className={s.cand} onClick={() => go({ kind: 'page', id: c.id })}>{c.crumb ? c.crumb + ' › ' : ''}{c.name}</button>
        ))}
      </div>
    )
  }
  const p = result.page
  const propertyLabel = propertiesOpen ? '收起属性' : '展开属性'
  return (
    <article className={cx(s.page, compact && s.compact)}>
      <div className={s.titleRow}>
        <h1 className={s.title}>{p.title}</h1>
        {!p.offline && (
          <Tooltip label={propertyLabel} side="bottom" delayMs={500}>
            <button type="button" className={cx(s.propertyToggle, propertiesOpen && s.propertyToggleOpen)}
              aria-label={propertyLabel} aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen((open) => !open)}>
              <IconMoreRight size={16} />
            </button>
          </Tooltip>
        )}
      </div>
      {p.offline
        ? <p className={s.offline}>文件未下载到本机。在访达里对它选「始终保留在此设备上」，或打开一次让 OneDrive 取回。</p>
        : <div className={cx(s.body)}><WikiEditor path={p.id} page anchor={anchor} frontmatterVisible={propertiesOpen} /></div>}
      {compact && <div className={s.foot}><InspectorBody page={p} toc={p.toc} tocKey={p.id} html={p.html} /></div>}
    </article>
  )
}
