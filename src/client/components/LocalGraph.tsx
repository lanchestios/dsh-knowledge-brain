import { useEffect, useRef, useState } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { drawLocal } from '../lib/local-graph'
import s from './LocalGraph.module.css'

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
    <div className={s.root}>
      <canvas ref={cv} className={s.canvas} />
      <div className={s.meta}>
        <span>{meta}</span>
        <button className={s.more} onClick={() => go({ kind: 'graph', focus: id })}>在全局图里看 →</button>
      </div>
    </div>
  )
}
