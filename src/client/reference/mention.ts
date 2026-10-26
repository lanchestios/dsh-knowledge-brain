// 对话里引用 wiki 页的写法；Host 的 src/host/reference.ts 持同一份正则（改名前的 dsh-knowledge-vault: 照认）
export const formatWikiMention = (label: string, id: string) => `@[${label.replace(/[[\]]/g, '')}](dsh-knowledge-brain:${encodeURIComponent(id)})`
export const WIKI_MENTION_RE = /@\[([^\]]*)\]\(dsh-knowledge-(?:brain|vault):([^)\s]+)\)/g
export const wikiRefInsert = (label: string, id: string) => {
  const m = formatWikiMention(label, id)
  return { source: 'wiki', ref: m, label, appearance: 'file' as const, clipboardText: m }
}
