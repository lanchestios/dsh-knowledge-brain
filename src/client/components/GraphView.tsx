import { useEffect, useRef } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { IconMoreLeft } from '../../icon'
import { runGraph, type Snapshot } from '../lib/global-graph'
import s from './GraphView.module.css'

// 跨重建（改库）与跨进出图谱保留布局和镜头
let last: Snapshot | undefined

export function GraphView({ focus, embedded }: { focus?: string; embedded?: boolean }) {
  const { api } = useEnv()
  const { go, retreat, canRetreat } = useNav()
  const g = useData(() => api.graph(), [], 'graph')
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const ctl = useRef<ReturnType<typeof runGraph> | null>(null)

  useEffect(() => {
    if (!g || !wrap.current || !cv.current || !tip.current) return
    const r = runGraph(cv.current, wrap.current, tip.current, g, (id) => go({ kind: 'page', id }), last)
    ctl.current = r
    if (focus) r.fly(focus)
    return () => { last = r.snapshot(); r.destroy(); ctl.current = null }
  }, [g, go, focus])

  return (
    <div className={s.root}>
      {/* 定位到页那一行只在路由直达的独立页给；内容位开关形态（embedded）不给——
          开关总是跟着当前页走，全局图里选页没有意义（2026-10-20 用户裁定） */}
      <div className={s.bar} hidden={embedded}>
        {/* 图谱占满导航位（tab 条在导航位不显示）：给一条回进图谱前位置的出口——
            从文档 tab 进来 tab 还在（切回去），从导航页进来直接换回去；起手就在图谱不显示 */}
        {/* embedded（内容位开关形态）：返回由顶栏开关承担，不给；路由直达的独立页才给 */}
        {canRetreat && retreat && !embedded && (
          <button type="button" className={s.back} onClick={retreat} title="返回" aria-label="返回">
            <IconMoreLeft size={14} />
            <span>返回</span>
          </button>
        )}
        <span className={s.meta}>{g ? `${g.nodes.length} 页 · ${g.edges.filter((e) => e.type === 'ref').length} 条引用` : ''}</span>
      </div>
      <div ref={wrap} className={s.wrap}>
        <canvas ref={cv} className={s.canvas} />
        <div ref={tip} hidden className={s.tip} />
      </div>
    </div>
  )
}
