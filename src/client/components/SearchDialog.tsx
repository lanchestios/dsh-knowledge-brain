import { useEffect, useState } from 'react'
import { Modal, Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '../ui'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import type { SearchHit } from '../../core/api'

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
    <Modal open={open} onClose={() => onOpenChange(false)} title="搜索" headless className="wk:w-[min(672px,92vw)]">
      <Command shouldFilter={false}  label="搜索">
        <CommandInput autoFocus value={q} onValueChange={setQ} placeholder="搜索页名与正文…" className="wk:h-11 wk:text-base" />
        <CommandList className="wk:max-h-[60vh] wk:p-1.5">
          {q.trim() && <CommandEmpty className="wk:p-6 wk:text-sm">没有结果</CommandEmpty>}
          {hits.map((h) => (
            <CommandItem key={h.id} value={h.id} onSelect={() => pick(h.id)} className="wk:items-stretch wk:flex-col wk:gap-0.5 wk:px-2.5">
              <div data-wiki-ui="" className="wk:flex wk:min-w-0 wk:items-baseline wk:gap-2"><span data-wiki-ui="" className="wk:truncate wk:text-sm wk:font-medium">{h.name}</span><span data-wiki-ui="" className="wk:truncate wk:text-xs wk:text-muted-foreground">{h.crumb}</span></div>
              <div data-wiki-ui="" className="wk:line-clamp-2 wk:text-xs wk:text-muted-foreground wk:[&_mark]:rounded-sm wk:[&_mark]:bg-[var(--wk-mark)] wk:[&_mark]:px-[.1em] wk:[&_mark]:text-inherit" dangerouslySetInnerHTML={{ __html: h.snippet }} />
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </Modal>
  )
}
