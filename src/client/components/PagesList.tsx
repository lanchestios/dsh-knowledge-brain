import { useMemo, useState } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import { timeAgo } from './HomeView'
import mats from '../explore/documents.module.css'
import s from './PagesList.module.css'

// 沉淀两页（首页沉淀带「草稿 / 最近」的「去查看」进来）：同一张表两种口径——
// 草稿页只列 status: draft，动态页列全部页，都按更新时间倒序、不截断。
// 行 = 区色点 + 页名 + 相对时间，点行进页；区筛选用出现的区名（不摆空区）
export function PagesList({ mode }: { mode: 'drafts' | 'recent' }) {
  const { api } = useEnv()
  const { go } = useNav()
  const [area, setArea] = useState('')
  const rows = useData(() => (mode === 'drafts' ? api.drafts() : api.recent()), [mode], 'stats')
  const areas = useMemo(() => [...new Set((rows ?? []).map((r) => r.area))], [rows])
  const shown = (rows ?? []).filter((r) => !area || r.area === area)
  if (!rows) return null
  return (
    <div className={mats.root}><div className={mats.page}>
      <div className={mats.headrow}>
        <div><h1 className={mats.h1}>{mode === 'drafts' ? '草稿' : '动态'}</h1>
          <div className={mats.meta}>
            {mode === 'drafts'
              ? `${rows.length} 页草稿还没写完 · 标记完成走页内「标记完成」`
              : `${rows.length} 页 · 按更新时间倒序`}
          </div></div>
      </div>
      <div className={mats.bar}>
        <button className={cx(mats.chip, !area && mats.on)} onClick={() => setArea('')}>全部 {rows.length}</button>
        {areas.map((a) => (
          <button key={a} className={cx(mats.chip, area === a && mats.on)} onClick={() => setArea(a)}>
            <i className={s.dot} style={{ background: `var(--wk-area-${a})` }} />{a} {rows.filter((r) => r.area === a).length}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className={mats.empty}>{mode === 'drafts' ? '没有草稿，都写完了。' : '还没有沉淀页。'}</div>
      ) : (
        <table className={mats.table}>
          <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 110 }} /></colgroup>
          <thead><tr><th>名称</th><th>区</th><th>更新</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td className={mats.name} title={r.name} onClick={() => go({ kind: 'page', id: r.id })}>{r.name}</td>
              <td className={mats.muted}><span className={s.area}><i className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />{r.area}</span></td>
              <td className={mats.muted} title={r.updated}>{timeAgo(r.updated)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div></div>
  )
}

export function DraftsPage() { return <PagesList mode="drafts" /> }
export function ActivityPage() { return <PagesList mode="recent" /> }
