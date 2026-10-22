import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MAX_CHARS, pageForLlm, resolvePage } from '../core/llm'
import type { Hub } from '../core/hub'

// 用户消息里的 @[页名](dsh-knowledge-brain:<id>) 引用：在该消息后追加一条上下文消息，内容是页的 markdown 正文
const RE = /@\[([^\]]*)\]\(dsh-knowledge-(?:brain|vault):([^)\s]+)\)/g
const NAME = 'dsh-knowledge-brain-reference'
// 一条消息里所有引用合起来最多这么多字，超出的页只给标题，让模型自己用 wiki_read_page 读
const TOTAL_CHARS = 3 * MAX_CHARS
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const decode = (v: string) => { try { return decodeURIComponent(v) } catch { return v } }

function expand(hub: Hub, message: any): any[] {
  if (message?.source?.kind !== 'user' || !hub.engine.model) return [message]
  const ids = new Set<string>()
  for (const b of message.content ?? []) if (b.type === 'text') for (const m of String(b.text).matchAll(RE)) ids.add(decode(m[2]))
  if (!ids.size) return [message]
  const m = hub.model()
  let budget = TOTAL_CHARS
  const parts = [...ids].map((id) => {
    const r = resolvePage(m, id)
    if (!('doc' in r)) return `<wiki-page id="${attr(id)}">找不到这一页</wiki-page>`
    const p = pageForLlm(m, r.doc)
    const head = `<wiki-page id="${attr(p.id)}" title="${attr(String(p.title ?? ''))}">`
    if (p.body.length > budget) return `${head}\n（本条消息引用的页太多，这页正文没附上；用 wiki_read_page 读 ${p.id}）\n</wiki-page>`
    budget -= p.body.length
    return `${head}\n${p.body}\n</wiki-page>`
  })
  const text = `用户在消息里引用了以下 wiki 页（正文附后；截断处可用 wiki_read_page 的 offset 续读）：\n\n${parts.join('\n\n')}`
  return [message, createUserMessage({ content: [{ type: 'text', text }], source: { kind: NAME, form: 'snapshot', sections: [{ name: NAME, text }] } } as any)]
}

export function registerReference(ctx: Context, hub: Hub) {
  ctx.on('agent/pre-step' as any, async (_e: unknown, next: () => Promise<any>) => {
    const d = await next()
    if (d.kind === 'reject') return d
    return { ...d, messages: d.messages.flatMap((msg: any) => expand(hub, msg)) }
  }, { prepend: true })
}
