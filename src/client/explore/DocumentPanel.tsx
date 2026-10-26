import { Button } from '../ui'
import { useEnv } from '../env'
import { useData } from '../lib/nav'
import { cx } from '../lib/cx'
import s from './documents.styles'

// 右栏「属性」里的沉淀卡（读一份文档时）：引用清单（source 指向它的沉淀页）、取用清单（coverage.conf 的 detail）。
// 状态与「标记完成」在顶栏（ExploreCrumb）
export function DocumentPanel({ path }: { path: string }) {
  const { api, openKb } = useEnv()
  const m = useData(() => api.document(path), [path], 'documents')
  if (!m || m.path !== path) return <div data-wiki-ui="" className={s.panel} />
  return (
    <div data-wiki-ui="" className={cx(s.root, s.panel)}>
      <div><div data-wiki-ui="" className={s.lbl}>引用清单 {m.citedBy.length}</div>
        {m.citedBy.length === 0 && <div data-wiki-ui="" className={s.meta}>还没有沉淀页引用它</div>}
        {m.citedBy.map((p) => <Button size="sm" key={p.id} className={s.link} onClick={() => openKb?.(p.id)}>{p.crumb ? p.crumb + ' › ' : ''}{p.name}</Button>)}</div>
      {m.detail && <div><div data-wiki-ui="" className={s.lbl}>取用清单</div><div data-wiki-ui="" className={s.meta}>{m.detail}</div></div>}
    </div>
  )
}
