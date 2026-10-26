import { readerCommands } from './reader/commands'

// 阅读器快捷键：焦点不在阅读器里就 pass，交给 DSH 自己的绑定。
// DSH 注册时逐个 runtime×platform 校验默认键，任一不合法整条命令注册失败，所以按环境分别给：
// - Web 只放行 ⌘ 加 ⇧/⌥ 的两键组合（或三修饰键），不许单键；⌘K、⌘\ 已被 DSH 占
// - Web 上一页/下一页不给默认键：单键不许，⌘⇧[ 与 ⌘⌥←→ 被 Chrome 用来切标签页；页底有翻页按钮
type B = { code: string; modifiers: string[] }
const inReader = (t: unknown) => !!readerCommands.root && t instanceof Node && readerCommands.root.contains(t)

export function registerShortcuts(ctx: any) {
  const def = (id: string, label: string, defaults: Record<string, B>, pick: () => (() => void) | undefined, regions = ['page']) =>
    ctx.effect(() => {
      try {
        return ctx.shortcuts.register({
          id, label: () => label, aliases: ['wiki', label], defaults, regions, modals: [],
          resolve: ({ target }: { target?: unknown }) => {
            const fn = inReader(target) ? pick() : undefined
            return fn ? { status: 'handled', run: fn } : { status: 'pass' }
          },
        })
      } catch (e) { console.error('[dsh-knowledge-brain] 快捷键注册失败', id, e); return () => {} }
    }, `dsh-knowledge-brain: shortcut ${id}`)
  const k = (code: string, ...modifiers: string[]): B => ({ code, modifiers })
  const search = k('KeyK', 'primary', 'shift')
  def('dsh-knowledge-brain.search', '搜索 wiki', {
    'desktop:macos': search, 'desktop:windows': search, 'desktop:linux': search, 'web:macos': search, 'web:windows': search,
  }, () => readerCommands.search, ['page', 'editable'])
  def('dsh-knowledge-brain.prev', 'wiki 上一页', { 'desktop:macos': k('BracketLeft'), 'desktop:windows': k('BracketLeft') }, () => readerCommands.prev)
  def('dsh-knowledge-brain.next', 'wiki 下一页', { 'desktop:macos': k('BracketRight'), 'desktop:windows': k('BracketRight') }, () => readerCommands.next)
}
