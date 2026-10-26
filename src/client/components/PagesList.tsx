import { ToggleGroup, ToggleGroupItem, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui'
import { useMemo, useState } from 'react'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { timeAgo } from './HomeView'
import mats from '../explore/documents.styles'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "dot": "wk:inline-block wk:w-2 wk:h-2 wk:rounded-full wk:flex-none",
  "area": "wk:inline-flex wk:items-center wk:gap-[6px]",
}

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
    <div data-wiki-ui="" className={mats.root}><div data-wiki-ui="" className={mats.page}>
      <div data-wiki-ui="" className={mats.headrow}>
        <div><h1 data-wiki-ui="" className={mats.h1}>{mode === 'drafts' ? '草稿' : '动态'}</h1>
          <div data-wiki-ui="" className={mats.meta}>
            {mode === 'drafts'
              ? `${rows.length} 页草稿还没写完 · 标记完成走页内「标记完成」`
              : `${rows.length} 页 · 按更新时间倒序`}
          </div></div>
      </div>
      <div data-wiki-ui="" className={mats.bar}>
        <ToggleGroup type="single" value={area || '__all__'} onValueChange={(v) => { if (v) setArea(v === '__all__' ? '' : v) }} aria-label="知识区">
          <ToggleGroupItem value="__all__">全部 {rows.length}</ToggleGroupItem>
          {areas.map((a) => <ToggleGroupItem key={a} value={a}>
            <i data-wiki-ui="" className={s.dot} style={{ background: `var(--wk-area-${a})` }} />{a} {rows.filter((r) => r.area === a).length}
          </ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {shown.length === 0 ? (
        <div data-wiki-ui="" className={mats.empty}>{mode === 'drafts' ? '没有草稿，都写完了。' : '还没有沉淀页。'}</div>
      ) : (
        <Table className="wk:table-fixed">
          <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 110 }} /></colgroup>
          <TableHeader><TableRow><TableHead>名称</TableHead><TableHead>区</TableHead><TableHead>更新</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map((r) => (
            <TableRow key={r.id}>
              <TableCell className={mats.name} title={r.name} onClick={() => go({ kind: 'page', id: r.id })}>{r.name}</TableCell>
              <TableCell className={mats.muted}><span data-wiki-ui="" className={s.area}><i data-wiki-ui="" className={s.dot} style={{ background: `var(--wk-area-${r.area})` }} />{r.area}</span></TableCell>
              <TableCell className={mats.muted} title={r.updated}>{timeAgo(r.updated)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      )}
    </div></div>
  )
}

export function DraftsPage() { return <PagesList mode="drafts" /> }
export function ActivityPage() { return <PagesList mode="recent" /> }
