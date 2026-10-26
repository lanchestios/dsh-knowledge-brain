import { useMemo, useState } from 'react'
import { Button, Checkbox, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, ToggleGroup, ToggleGroupItem, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Tag } from '../ui'
import { useEnv } from '../env'
import { useData, useNav, type DocumentFilter } from '../lib/nav'
import { requestFill } from '../lib/fill'
import { DOCUMENT_LABEL, matches } from '../lib/explore'
import type { Document } from '../../core/api'
import { Spark } from './Spark'
import s from './documents.styles'

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
    <div data-wiki-ui="" className={s.root}><div data-wiki-ui="" className={s.page}>
      <div data-wiki-ui="" className={s.headrow}>
        <div><h1 data-wiki-ui="" className={s.h1}>文档</h1>
          <div data-wiki-ui="" className={s.meta}>{all.length} 份 · 待沉淀 {n('待沉淀')}（未沉淀 {n('未沉淀')} · 沉淀中 {n('沉淀中')}）· 已引用 {n('已引用')} · 完成 {n('完成')}</div></div>
        <Spark all={all} />
      </div>
      <div data-wiki-ui="" className={s.bar}>
        {(['待沉淀', '全部'] as DocumentFilter[]).includes(status) ? null : <Button size="sm" variant="secondary" onClick={() => go({ kind: 'documents', status: '待沉淀' })}>{status} ✕</Button>}
        <ToggleGroup type="single" value={status} onValueChange={(v) => { if (v) go({ kind: 'documents', status: v as DocumentFilter }) }} aria-label="文档状态">
          {(['待沉淀', '全部'] as DocumentFilter[]).map((f) => <ToggleGroupItem key={f} value={f}>{f}</ToggleGroupItem>)}
        </ToggleGroup>
        <span data-wiki-ui="" aria-hidden="true" className="wk:h-4 wk:w-px wk:bg-border" />
        <ToggleGroup type="multiple" value={[...types]} onValueChange={(v) => setTypes(new Set(v))} aria-label="文件类型">
          {TYPES.map((t) => <ToggleGroupItem key={t} value={t}>{t}</ToggleGroupItem>)}
        </ToggleGroup>
        <Select value={date || '__all__'} onValueChange={(v) => setDate(v === '__all__' ? '' : v)}>
          <SelectTrigger aria-label="到达日"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">到达日：全部</SelectItem>{dates.filter(Boolean).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
        </Select>
        {status !== '已引用' && <span data-wiki-ui="" className={s.go}><Button variant="default" size="sm" disabled={!picked.size} onClick={() => requestFill({ kind: 'deposit', paths: [...picked] })}>知识沉淀{picked.size ? ` ${picked.size} 份` : ''}</Button></span>}
      </div>
      {rows.length === 0 ? <div data-wiki-ui="" className={s.empty}>没有符合条件的文档</div> : (
        <Table className="wk:min-w-[640px] wk:table-fixed">
          <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 110 }} /><col style={{ width: 90 }} /><col style={{ width: 60 }} /></colgroup>
          <TableHeader><TableRow><TableHead><Checkbox checked={allOn ? true : rows.some((m) => picked.has(m.path)) ? 'indeterminate' : false} onCheckedChange={(on) => setPicked(on ? new Set(rows.map((m) => m.path)) : new Set())} aria-label="全选" /></TableHead><TableHead>名称</TableHead><TableHead>类型</TableHead><TableHead>到达</TableHead><TableHead>状态</TableHead><TableHead>被引</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((m) => (
            <TableRow key={m.path}>
              <TableCell><Checkbox checked={picked.has(m.path)} onCheckedChange={() => setPicked(toggle(picked, m.path))} aria-label={m.name} /></TableCell>
              <TableCell className={s.name} title={m.path} onClick={() => go({ kind: 'raw', path: m.path })}>{m.name}</TableCell>
              <TableCell className={s.muted}>{m.ext}</TableCell><TableCell className={s.muted}>{m.date.slice(5)}</TableCell>
              <TableCell><Tag tone={({ unprocessed: 'neutral', cited: 'info', processing: 'warning', done: 'success' } as const)[m.status]}>{DOCUMENT_LABEL[m.status]}</Tag></TableCell>
              <TableCell className={s.muted}>{m.citedBy.length || '—'}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      )}
    </div></div>
  )
}
