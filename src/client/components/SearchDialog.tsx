import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import type { SearchHit } from '../../core/api'
import s from './SearchDialog.module.css'

// onPick 缺省时在阅读器内跳页；右侧 tab 复用时传自己的跳转
export function SearchDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick?: (id: string) => void }) {
  const { api } = useEnv()
  const { go } = useNav()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    let live = true
    const t = setTimeout(() => api.search(q).then((h) => { if (live) setHits(h) }), 80)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const pick = (id: string) => { onOpenChange(false); (onPick ?? ((i: string) => go({ kind: 'page', id: i })))(id) }

  return (
    <Modal open={open} onClose={() => onOpenChange(false)} title="搜索" headless className={s.modal}>
      <Command shouldFilter={false} className={s.cmd} label="搜索">
        <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="搜索页名与正文…" className={s.input} />
        <Command.List className={s.list}>
          {q.trim() && <Command.Empty className={s.empty}>没有结果</Command.Empty>}
          {hits.map((h) => (
            <Command.Item key={h.id} value={h.id} onSelect={() => pick(h.id)} className={s.item}>
              <div className={s.head}><span className={s.name}>{h.name}</span><span className={s.crumb}>{h.crumb}</span></div>
              <div className={s.snippet} dangerouslySetInnerHTML={{ __html: h.snippet }} />
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Modal>
  )
}
