// 「填指令」请求：场景按钮发出，sessions.wireFills 接住——新开一场右栏会话，指令直接发送
export type FillRequest =
  | { kind: 'chapter'; book: string; id: string; text: string | null }     // 把这一章沉淀进知识（text = 章节原文路径）
  | { kind: 'deposit'; paths: string[] }                                   // 文档表「知识沉淀」：沉淀这几份文档
const ls = new Set<(r: FillRequest) => void>()
export const onFill = (l: (r: FillRequest) => void) => { ls.add(l); return () => { ls.delete(l) } }
export const requestFill = (r: FillRequest) => { if (!ls.size) console.error('[dsh-knowledge-brain] 没有会话接住填指令请求', r); ls.forEach((l) => l(r)) }
