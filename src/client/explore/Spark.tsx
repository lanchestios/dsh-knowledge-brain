import { useMemo } from 'react'
import type { Document } from '../../core/api'
import s from './documents.styles'

// 到达日 100% 堆叠小图：已沉淀（非未沉淀）/ 未沉淀，悬停看数；最早的在左
export function Spark({ all }: { all: Document[] }) {
  const trend = useMemo(() => [...new Set(all.map((m) => m.date))].reverse().map((d) => {
    const ms = all.filter((m) => m.date === d)
    return { d, total: ms.length, done: ms.filter((m) => m.status !== 'unprocessed').length }
  }), [all])
  return (
    <div data-wiki-ui="" className={s.spark} aria-label="到达趋势">{trend.map((t) => (
      <b key={t.d} title={`${t.d} · 共 ${t.total} 份 · 未沉淀 ${t.total - t.done}`}><i style={{ flex: t.total - t.done, background: 'var(--wk-todo)' }} /><i style={{ flex: t.done, background: 'var(--wk-done)' }} /></b>
    ))}</div>
  )
}
