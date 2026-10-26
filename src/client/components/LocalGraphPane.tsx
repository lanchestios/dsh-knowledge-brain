// 正文位的图谱视图（顶栏「图谱」开关打开时占正文位）：与全局图页同一套交互引擎（runGraph——
// 力导布局、滚轮缩放、拖拽平移、悬停出 tipped），打开即飞到当前页并把镜头对准它；
// 点节点翻页，视图保持开着、跟着新页继续飞。镜头快照跨开关与翻页保留（同 GraphView 的纪律）。
// 第一版用右栏 drawLocal 的小图是静态 canvas（无缩放平移），用户裁定要原图谱页的展现形式，弃用
import { useEffect, useRef } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { runGraph, type Snapshot } from '../lib/global-graph'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:relative wk:h-full wk:min-h-0 wk:overflow-hidden",
  "canvas": "wk:absolute wk:inset-0",
  "tip": "wk:absolute wk:pointer-events-none wk:rounded-[var(--wk-radius-sm)] wk:[border:1px_solid_var(--wk-alias-border-l1)] wk:bg-[var(--wk-specific-menu)] wk:text-foreground wk:py-1 wk:px-2 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:[box-shadow:0_1px_3px_rgb(0_0_0_/_.08)]",
}

// 跨开关 / 跨翻页保留布局和镜头
let last: Snapshot | undefined

export function LocalGraphPane({ id }: { id: string }) {
  const { api } = useEnv()
  const { go } = useNav()
  const g = useData(() => api.graph(), [], 'graph')
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!g || !wrap.current || !cv.current || !tip.current || !id) return
    const r = runGraph(cv.current, wrap.current, tip.current, g, (to) => go({ kind: 'page', id: to }), last)
    r.fly(id)
    return () => { last = r.snapshot(); r.destroy() }
  }, [g, id, go])
  return (
    <div data-wiki-ui="" className={s.root} ref={wrap}>
      <canvas data-wiki-ui="" ref={cv} className={s.canvas} />
      <div data-wiki-ui="" ref={tip} hidden className={s.tip} />
    </div>
  )
}
