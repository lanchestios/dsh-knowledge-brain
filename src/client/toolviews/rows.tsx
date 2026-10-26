import { Button } from '../ui'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "row": "wk:flex wk:flex-col wk:gap-1 wk:py-[6px] wk:px-[10px] wk:[border:1px_solid_var(--wk-alias-border-l1)] wk:rounded-[var(--wk-radius-sm)] wk:bg-[var(--wk-alias-bg-layer-1)] wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-foreground",
  "head": "wk:flex wk:items-center wk:gap-[6px] wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "hit": "wk:flex wk:items-baseline wk:gap-2 wk:min-w-0 wk:border-0 wk:bg-transparent wk:py-[2px] wk:px-0 wk:text-left wk:[font-family:inherit] wk:text-[length:inherit] wk:leading-[inherit] wk:[font-weight:inherit] wk:text-[length:inherit] wk:cursor-pointer wk:[&:hover_.wk-toolviews-rows-name]:underline",
  "name": "wk-toolviews-rows-name wk:font-medium wk:text-[var(--wk-alias-link)] wk:whitespace-nowrap",
  "crumb": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "desc": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "err": "wk:text-destructive wk:text-xs wk:leading-normal wk:font-sans wk:font-normal",
}

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
    <Button size="sm" className={s.hit} onClick={() => open(r.id)} title={r.id}>
      <span data-wiki-ui="" className={s.name}>{r.name}</span>{r.crumb && <span data-wiki-ui="" className={s.crumb}>{r.crumb}</span>}
    </Button>
  )
}

export function ReadPageRow({ phase, block, open }: { phase: string; block: any; open: Open }) {
  const id = arg(block, 'id')
  if (phase !== 'result') return <div data-wiki-ui="" className={s.row}><div data-wiki-ui="" className={s.head}>读 wiki：{id ?? '…'}</div></div>
  const v = valueOf(block)
  if (block?.isError || !v) return <div data-wiki-ui="" className={s.row}><div data-wiki-ui="" className={s.head}>读 wiki：{id}</div><div data-wiki-ui="" className={s.err}>{block?.content?.[0]?.text ?? '读取失败'}</div></div>
  if (v.found === false) return (
    <div data-wiki-ui="" className={s.row}>
      <div data-wiki-ui="" className={s.head}>没找到「{id}」，候选：</div>
      {v.candidates.map((c: any) => <Hit key={c.id} r={c} open={open} />)}
    </div>
  )
  return (
    <div data-wiki-ui="" className={s.row}>
      <div data-wiki-ui="" className={s.head}>读了 wiki 页{v.next_offset ? `（截断，续读 offset=${v.next_offset}）` : ''}</div>
      <Hit r={v} open={open} />
      {v.description && <div data-wiki-ui="" className={s.desc}>{v.description}</div>}
    </div>
  )
}

export function SearchRow({ phase, block, open }: { phase: string; block: any; open: Open }) {
  const query = arg(block, 'query')
  if (phase !== 'result') return <div data-wiki-ui="" className={s.row}><div data-wiki-ui="" className={s.head}>搜 wiki：{query ?? '…'}</div></div>
  const v = valueOf(block)
  if (block?.isError || !Array.isArray(v)) return <div data-wiki-ui="" className={s.row}><div data-wiki-ui="" className={s.head}>搜 wiki：{query}</div><div data-wiki-ui="" className={s.err}>{block?.content?.[0]?.text ?? '搜索失败'}</div></div>
  return (
    <div data-wiki-ui="" className={s.row}>
      <div data-wiki-ui="" className={s.head}>搜 wiki「{query}」· {v.length} 条</div>
      {v.map((h: any) => <Hit key={h.id} r={h} open={open} />)}
    </div>
  )
}
