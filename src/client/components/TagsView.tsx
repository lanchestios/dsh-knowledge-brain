import { Button } from '../ui'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:max-w-224 wk:my-0 wk:mx-auto wk:p-10 wk:flex wk:flex-col wk:gap-6 wk:[@container_(max-width:_700px)]:py-6 wk:[@container_(max-width:_700px)]:px-4",
  "narrow": "wk:max-w-192 wk:gap-4",
  "h1": "wk:text-xl wk:leading-normal wk:font-sans wk:font-semibold wk:m-0",
  "count": "wk:text-secondary-foreground wk:text-base wk:leading-normal wk:font-sans wk:font-normal",
  "list": "wk:flex wk:flex-col",
  "item": "wk:block wk:w-[calc(100%_+_16px)] wk:text-left wk:py-3 wk:px-2 wk:mt-0 wk:-mr-2 wk:mb-0 wk:-ml-2 wk:border-0 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:rounded-[var(--wk-radius-sm)] wk:bg-transparent wk:text-[length:inherit] wk:[font-family:inherit] wk:text-[length:inherit] wk:leading-[inherit] wk:[font-weight:inherit] wk:cursor-pointer wk:[&:hover]:bg-accent",
  "name": "wk:font-medium",
  "crumb": "wk:ml-2 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "desc": "wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
}

export function TagView({ tag }: { tag: string }) {
  const { api } = useEnv()
  const { go } = useNav()
  const pages = useData(() => api.tag(tag), [tag], 'stats')
  if (!pages) return null
  return (
    <div data-wiki-ui="" className={cx(s.root, s.narrow)}>
      <h1 data-wiki-ui="" className={s.h1}>#{tag} <span data-wiki-ui="" className={s.count}>{pages.length} 页</span></h1>
      <div data-wiki-ui="" className={s.list}>
        {pages.map((p) => (
          <Button size="sm" key={p.ref.id} onClick={() => go({ kind: 'page', id: p.ref.id })} className={s.item}>
            <div data-wiki-ui="" className={s.name}>{p.ref.name}<span data-wiki-ui="" className={s.crumb}>{p.ref.crumb}</span></div>
            {p.desc && <div data-wiki-ui="" className={s.desc}>{p.desc}</div>}
          </Button>
        ))}
      </div>
    </div>
  )
}
