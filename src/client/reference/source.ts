import type { WikiApi } from '../api'
import { wikiRefInsert } from './mention'

// 输入框 @ 补全里的 wiki 页：候选来自全文搜索，选中插成原子引用；点引用在右侧打开这页
export function wikiSource(api: WikiApi, openPage: (id: string) => void) {
  return {
    trigger: '@' as const,
    name: 'wiki',
    order: 50,
    showGroupTitle: true,
    async candidates(_session: unknown, { query, signal }: { query: string; signal: AbortSignal }) {
      if (!query.trim()) return []
      const hits = await api.search(query)
      if (signal.aborted) return []
      return hits.slice(0, 8).map((h) => ({
        name: h.name, label: h.name, description: h.crumb, section: '格物致知',
        value: JSON.stringify({ id: h.id, label: h.name }),
      }))
    },
    onPick({ candidate }: { candidate: { value?: string } }) {
      try {
        const v = JSON.parse(candidate.value ?? '')
        return { insert: wikiRefInsert(v.label, v.id) }
      } catch { return undefined }
    },
    openReference(_session: unknown, { ref }: { ref: string }) {
      const m = /\(dsh-knowledge-(?:brain|vault):([^)\s]+)\)/.exec(ref)
      if (!m) return false
      let id = m[1]
      try { id = decodeURIComponent(id) } catch { /* 保持原样 */ }
      openPage(id)
      return true
    },
    codec: { clipboardText: (ref: string) => ref, serialize: (ref: string) => Promise.resolve(ref) },
  }
}
