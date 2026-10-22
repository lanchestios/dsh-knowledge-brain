import { useEffect } from 'react'
import { cx } from '../lib/cx'
import type { RawResult } from '../../core/api'
import { WikiEditor } from './WikiEditor'
import s from './RawView.module.css'

const sizeOf = (n: number) => (n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(0) + ' KB' : (n / 1024 ** 2).toFixed(1) + ' MB')

// 探索区文档：md 走同一套渲染；pdf 用浏览器自带查看器；html 放进不跑脚本的 iframe；其余只给说明
export function RawView({ result, path, scroller }: { result: RawResult | undefined; path: string; scroller: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [path])
  const category = '文档'

  if (!result || (result.ok && result.raw.path !== path)) return <div className={s.loading}>载入中…</div>
  if (!result.ok) return <div className={s.missing}><h1 className={s.h1}>{category}已移动或删除</h1><p className={s.mono}>{path}</p></div>
  const r = result.raw

  if ((r.kind === 'pdf' || r.kind === 'html') && !r.offline) {
    return (
      <div className={s.frameWrap}>
        <div className={s.frameBar}>
          <span className={s.name}>{r.name}</span>
          <span className={s.small}>{r.kind.toUpperCase()} · {sizeOf(r.size)}</span>
        </div>
        {r.kind === 'pdf'
          ? <iframe key={r.url} src={r.url} className={s.frame} title={r.name} />
          : <iframe key={r.url} src={r.url} sandbox="" className={cx(s.frame, s.htmlFrame)} title={r.name} />}
      </div>
    )
  }

  if (r.kind === 'other' || r.offline) {
    return (
      <div className={s.center}>
        <div className={s.card}>
          <div className={s.cardTitle}>{r.name}</div>
          <div className={s.small}>{r.offline ? '文件未下载到本机。在访达里对它选「始终保留在此设备上」让 OneDrive 取回。' : '这类文件在这里看不了。'} · {sizeOf(r.size)}</div>
        </div>
      </div>
    )
  }

  return (
    <article className={s.page}>
      <h1 className={s.title}>{r.name}</h1>
      <div className={s.meta}>
        <span className={s.small}>{category} · {sizeOf(r.size)}</span>
      </div>
      <div className={s.body}><WikiEditor path={r.path} page={false} /></div>
    </article>
  )
}
