import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEnv } from '../env'
import { useData, useNav, type DocumentFilter } from '../lib/nav'
import { requestFill } from '../lib/fill'
import { DOCUMENT_LABEL, matches } from '../lib/explore'
import { cx } from '../lib/cx'
import type { Document } from '../../core/api'
import { Spark } from './Spark'
import s from './documents.module.css'

const TYPES = ['pdf', 'html', 'md', '其他'] as const
const typeOf = (m: Document) => (['pdf', 'html', 'md'].includes(m.ext) ? m.ext : '其他')

// 文档表：状态筛选跟着路由（DSH 左栏「按状态」同一个），类型 / 到达日在页内筛；勾选若干份「知识沉淀」（新开会话直接发送；已引用列表不给：已有页引了）
export function DocumentsTable({ status }: { status: DocumentFilter }) {
  const { api } = useEnv()
  const { go } = useNav()
  const all = useData(() => api.documents(), [], 'documents')
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [date, setDate] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const dates = useMemo(() => [...new Set((all ?? []).map((m) => m.date))], [all])
  const rows = useMemo(() => (all ?? []).filter((m) => matches(m, status) && (!types.size || types.has(typeOf(m))) && (!date || m.date === date)), [all, status, types, date])
  if (!all) return null
  const n = (f: DocumentFilter) => all.filter((m) => matches(m, f)).length
  const toggle = (set: Set<string>, v: string) => { const x = new Set(set); if (x.has(v)) x.delete(v); else x.add(v); return x }
  const allOn = rows.length > 0 && rows.every((m) => picked.has(m.path))
  return (
    <div className={s.root}><div className={s.page}>
      <div className={s.headrow}>
        <div><h1 className={s.h1}>文档</h1>
          <div className={s.meta}>{all.length} 份 · 待沉淀 {n('待沉淀')}（未沉淀 {n('未沉淀')} · 沉淀中 {n('沉淀中')}）· 已引用 {n('已引用')} · 完成 {n('完成')}</div></div>
        <Spark all={all} />
      </div>
      <div className={s.bar}>
        {(['待沉淀', '全部'] as DocumentFilter[]).includes(status) ? null : <button className={cx(s.chip, s.on)} onClick={() => go({ kind: 'documents', status: '待沉淀' })}>{status} ✕</button>}
        {(['待沉淀', '全部'] as DocumentFilter[]).map((f) => <button key={f} className={cx(s.chip, status === f && s.on)} onClick={() => go({ kind: 'documents', status: f })}>{f}</button>)}
        <span className={s.meta}>｜</span>
        {TYPES.map((t) => <button key={t} className={cx(s.chip, types.has(t) && s.on)} onClick={() => setTypes(toggle(types, t))}>{t}</button>)}
        <select className={s.select} value={date} onChange={(e) => setDate(e.target.value)}><option value="">到达日：全部</option>{dates.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        {status !== '已引用' && <span className={s.go}><Button variant="primary" size="sm" disabled={!picked.size} onClick={() => requestFill({ kind: 'deposit', paths: [...picked] })}>知识沉淀{picked.size ? ` ${picked.size} 份` : ''}</Button></span>}
      </div>
      {rows.length === 0 ? <div className={s.empty}>没有符合条件的文档</div> : (
        <table className={s.table}>
          <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 110 }} /><col style={{ width: 90 }} /><col style={{ width: 60 }} /></colgroup>
          <thead><tr><th><input type="checkbox" className={s.cb} checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((m) => m.path)))} aria-label="全选" /></th><th>名称</th><th>类型</th><th>到达</th><th>状态</th><th>被引</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.path}>
              <td><input type="checkbox" className={s.cb} checked={picked.has(m.path)} onChange={() => setPicked(toggle(picked, m.path))} aria-label={m.name} /></td>
              <td className={s.name} title={m.path} onClick={() => go({ kind: 'raw', path: m.path })}>{m.name}</td>
              <td className={s.muted}>{m.ext}</td><td className={s.muted}>{m.date.slice(5)}</td>
              <td><span className={cx(s.st, s[m.status])}>{DOCUMENT_LABEL[m.status]}</span></td>
              <td className={s.muted}>{m.citedBy.length || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div></div>
  )
}
