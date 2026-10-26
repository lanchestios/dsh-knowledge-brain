import { Button } from '../ui'
import { useEffect, useRef, useState } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { drawLocal } from '../lib/local-graph'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:flex wk:flex-col wk:gap-1",
  "canvas": "wk:w-full wk:h-50",
  "meta": "wk:flex wk:justify-between wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "more": "wk:border-0 wk:bg-transparent wk:p-0 wk:text-[length:inherit] wk:[font-family:inherit] wk:text-[length:inherit] wk:leading-[inherit] wk:[font-weight:inherit] wk:cursor-pointer wk:[&:hover]:text-foreground",
}

export function LocalGraph({ id }: { id: string }) {
  const { api } = useEnv()
  const { go } = useNav()
  const g = useData(() => api.graph(), [], 'graph')
  const cv = useRef<HTMLCanvasElement>(null)
  const [meta, setMeta] = useState('')
  useEffect(() => {
    if (!g || !cv.current) return
    return drawLocal(cv.current, g, id, (to) => go({ kind: 'page', id: to }), setMeta)
  }, [g, id, go])
  return (
    <div data-wiki-ui="" className={s.root}>
      <canvas data-wiki-ui="" ref={cv} className={s.canvas} />
      <div data-wiki-ui="" className={s.meta}>
        <span>{meta}</span>
        <Button size="sm" className={s.more} onClick={() => go({ kind: 'graph', focus: id })}>在全局图里看 →</Button>
      </div>
    </div>
  )
}
