import s from './rows.module.css'

// 工具卡片：wiki_read_page / wiki_search 的调用与结果；点页名在右侧 wiki 页 tab 打开
type Open = (id: string) => void

// 0.2.1 起工具 block 自带惰性参数视图 args（流式中也能读已到的前缀），不用再自己 JSON.parse argsRaw
const arg = (block: any, key: string): string | undefined => block?.args?.text?.(key)
const valueOf = (block: any): any => {
  const t = block?.content?.find?.((b: any) => b.type === 'text')?.text
  try { return t ? JSON.parse(t) : undefined } catch { return undefined }
}

function Hit({ r, open }: { r: { id: string; name: string; crumb?: string }; open: Open }) {
  return (
    <button className={s.hit} onClick={() => open(r.id)} title={r.id}>
      <span className={s.name}>{r.name}</span>{r.crumb && <span className={s.crumb}>{r.crumb}</span>}
    </button>
  )
}

export function ReadPageRow({ phase, block, open }: { phase: string; block: any; open: Open }) {
  const id = arg(block, 'id')
  if (phase !== 'result') return <div className={s.row}><div className={s.head}>读 wiki：{id ?? '…'}</div></div>
  const v = valueOf(block)
  if (block?.isError || !v) return <div className={s.row}><div className={s.head}>读 wiki：{id}</div><div className={s.err}>{block?.content?.[0]?.text ?? '读取失败'}</div></div>
  if (v.found === false) return (
    <div className={s.row}>
      <div className={s.head}>没找到「{id}」，候选：</div>
      {v.candidates.map((c: any) => <Hit key={c.id} r={c} open={open} />)}
    </div>
  )
  return (
    <div className={s.row}>
      <div className={s.head}>读了 wiki 页{v.next_offset ? `（截断，续读 offset=${v.next_offset}）` : ''}</div>
      <Hit r={v} open={open} />
      {v.description && <div className={s.desc}>{v.description}</div>}
    </div>
  )
}

export function SearchRow({ phase, block, open }: { phase: string; block: any; open: Open }) {
  const query = arg(block, 'query')
  if (phase !== 'result') return <div className={s.row}><div className={s.head}>搜 wiki：{query ?? '…'}</div></div>
  const v = valueOf(block)
  if (block?.isError || !Array.isArray(v)) return <div className={s.row}><div className={s.head}>搜 wiki：{query}</div><div className={s.err}>{block?.content?.[0]?.text ?? '搜索失败'}</div></div>
  return (
    <div className={s.row}>
      <div className={s.head}>搜 wiki「{query}」· {v.length} 条</div>
      {v.map((h: any) => <Hit key={h.id} r={h} open={open} />)}
    </div>
  )
}
