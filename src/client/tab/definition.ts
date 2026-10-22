export const WIKI_TAB_ID = 'dsh-knowledge-brain/page'
export const WIKI_TAB_KIND = 'wikiPage'

// params: { id?: string }——右侧栏刷新后不保留 params

export const wikiTabDefinition = { id: WIKI_TAB_ID, kind: WIKI_TAB_KIND, multiple: true, priority: 'extension' as const, title: () => '格物致知' }
