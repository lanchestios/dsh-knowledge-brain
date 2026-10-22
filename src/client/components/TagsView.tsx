import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { cx } from '../lib/cx'
import s from './TagsView.module.css'

export function TagView({ tag }: { tag: string }) {
  const { api } = useEnv()
  const { go } = useNav()
  const pages = useData(() => api.tag(tag), [tag], 'stats')
  if (!pages) return null
  return (
    <div className={cx(s.root, s.narrow)}>
      <h1 className={s.h1}>#{tag} <span className={s.count}>{pages.length} 页</span></h1>
      <div className={s.list}>
        {pages.map((p) => (
          <button key={p.ref.id} onClick={() => go({ kind: 'page', id: p.ref.id })} className={s.item}>
            <div className={s.name}>{p.ref.name}<span className={s.crumb}>{p.ref.crumb}</span></div>
            {p.desc && <div className={s.desc}>{p.desc}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
