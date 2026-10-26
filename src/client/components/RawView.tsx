import { useEffect } from 'react'
import { cx } from '../lib/cx'
import type { RawResult } from '../../core/api'
import { WikiEditor } from './WikiEditor'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "loading": "wk:p-10 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "missing": "wk:p-10 wk:flex wk:flex-col wk:gap-2",
  "h1": "wk:text-xl wk:leading-normal wk:font-sans wk:font-semibold wk:m-0",
  "mono": "wk:font-mono wk:text-[var(--dsh-code-font-size,_12px)] wk:text-secondary-foreground",
  "frameWrap": "wk:h-full wk:flex wk:flex-col",
  "frameBar": "wk:h-10 wk:shrink-0 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:flex wk:items-center wk:gap-3 wk:py-0 wk:px-4 wk:text-sm wk:leading-normal wk:font-sans wk:font-normal",
  "name": "wk:font-medium wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "small": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "frame": "wk:flex-1 wk:w-full wk:border-0",
  "htmlFrame": "wk:bg-[#fff]",
  "center": "wk:h-full wk:grid wk:place-items-center wk:p-10",
  "card": "wk:w-110 wk:bg-[var(--wk-alias-bg-layer-1)] wk:[border:1px_solid_var(--wk-alias-border-l1)] wk:rounded-[var(--wk-radius-md)] wk:p-[var(--wk-pad)] wk:flex wk:flex-col wk:gap-2",
  "cardTitle": "wk:text-base wk:leading-normal wk:font-sans wk:font-semibold wk:[word-break:break-all]",
  "page": "wk:max-w-240 wk:my-0 wk:mx-auto wk:py-8 wk:px-10 wk:[@container_(max-width:_700px)]:py-5 wk:[@container_(max-width:_700px)]:px-4",
  "title": "wk:text-2xl wk:leading-normal wk:font-sans wk:font-semibold wk:mt-0 wk:mr-0 wk:mb-2 wk:ml-0",
  "meta": "wk:flex wk:items-center wk:gap-2",
  "body": "wk:mt-6",
}

const sizeOf = (n: number) => (n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(0) + ' KB' : (n / 1024 ** 2).toFixed(1) + ' MB')

// 探索区文档：md 走同一套渲染；pdf 用浏览器自带查看器；html 放进不跑脚本的 iframe；其余只给说明
export function RawView({ result, path, scroller }: { result: RawResult | undefined; path: string; scroller: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [path])
  const category = '文档'

  if (!result || (result.ok && result.raw.path !== path)) return <div data-wiki-ui="" className={s.loading}>载入中…</div>
  if (!result.ok) return <div data-wiki-ui="" className={s.missing}><h1 data-wiki-ui="" className={s.h1}>{category}已移动或删除</h1><p data-wiki-ui="" className={s.mono}>{path}</p></div>
  const r = result.raw

  if ((r.kind === 'pdf' || r.kind === 'html') && !r.offline) {
    return (
      <div data-wiki-ui="" className={s.frameWrap}>
        <div data-wiki-ui="" className={s.frameBar}>
          <span data-wiki-ui="" className={s.name}>{r.name}</span>
          <span data-wiki-ui="" className={s.small}>{r.kind.toUpperCase()} · {sizeOf(r.size)}</span>
        </div>
        {r.kind === 'pdf'
          ? <iframe data-wiki-ui="" key={r.url} src={r.url} className={s.frame} title={r.name} />
          : <iframe data-wiki-ui="" key={r.url} src={r.url} sandbox="" className={cx(s.frame, s.htmlFrame)} title={r.name} />}
      </div>
    )
  }

  if (r.kind === 'other' || r.offline) {
    return (
      <div data-wiki-ui="" className={s.center}>
        <div data-wiki-ui="" className={s.card}>
          <div data-wiki-ui="" className={s.cardTitle}>{r.name}</div>
          <div data-wiki-ui="" className={s.small}>{r.offline ? '文件未下载到本机。在访达里对它选「始终保留在此设备上」让 OneDrive 取回。' : '这类文件在这里看不了。'} · {sizeOf(r.size)}</div>
        </div>
      </div>
    )
  }

  return (
    <article data-wiki-ui="" className={s.page}>
      <h1 data-wiki-ui="" className={s.title}>{r.name}</h1>
      <div data-wiki-ui="" className={s.meta}>
        <span data-wiki-ui="" className={s.small}>{category} · {sizeOf(r.size)}</span>
      </div>
      <div data-wiki-ui="" className={s.body}><WikiEditor path={r.path} page={false} /></div>
    </article>
  )
}
