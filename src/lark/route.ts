// 会话路由与消息判定（纯函数，不碰 SDK）。channel.ts 把Lark事件解析成 Incoming，
// 后面所有模块只见这个形状——SDK 字段怎么变，改 channel.ts 一处。
import type { Binding } from './bindings.js'

export interface Incoming {
  eventId: string            // Lark事件号，去重用
  chatId: string             // open_chat_id
  chatType: 'p2p' | 'group'
  messageId: string          // 回复用
  senderId?: string          // 提问人 open_id（起会话标题、群聊问题前缀用）
  messageType: string        // 'text' 之外的（图片/表情…）一律忽略
  text: string               // content JSON 里解出的 text
  mentionKeys: string[]      // 文本里的 @ 占位符（如 '@_user_1'），剥掉
  mentionOpenIds: string[]   // 被 @ 的 open_id 列表，群聊判定用
  threadId?: string          // 话题 id：话题里的消息才有（话题群的每个帖子、普通群里开的话题）
  rootId?: string            // 话题根消息 id：话题里的回复才有；话题第一条（新话题）没有
}

/** 新开的话题：在话题里、自己就是根（没有 rootId）。群里不 @ 也答的唯一情形 */
export const isTopicStart = (msg: Incoming): boolean => msg.chatType === 'group' && !!msg.threadId && !msg.rootId

/** 话题根消息 id（新话题是它自己，话题内回复是 rootId）；不在话题里为空 */
export const topicRootOf = (msg: Incoming): string => (msg.threadId ? (msg.rootId || msg.messageId) : '')

// 会话键：一个话题一个问答会话（各话题互不串上下文、互不占锁），话题外照旧一个 chat 一个。
// 键里带根消息 id，追问卡片据此回进同一个话题；ChatSessions / 锁 / 挂起追问都按这个键记
const TOPIC_SEP = '#'
export const conversationKey = (msg: Incoming): string => {
  const root = topicRootOf(msg)
  return root ? `${msg.chatId}${TOPIC_SEP}${root}` : msg.chatId
}
/** 会话键 → 真实 chat_id 与话题根消息 id（键不带话题时 root 为空） */
export const parseConversationKey = (key: string): { chatId: string; root: string } => {
  const i = key.indexOf(TOPIC_SEP)
  return i < 0 ? { chatId: key, root: '' } : { chatId: key.slice(0, i), root: key.slice(i + 1) }
}

// chat_id → 绑定。精确匹配带 chatId 的绑定优先；没命中落到第一条空 chatId 的兜底绑定
// （「一个机器人一个文件夹」的用法就靠它，chatId 永远不用配）。没有兜底时未命中即
// undefined——未绑定会话记来访、静默
export function route(chatId: string, bindings: Binding[]): Binding | undefined {
  return bindings.find((b) => b.chatId && b.chatId === chatId) ?? bindings.find((b) => !b.chatId)
}

// 该不该答、答什么。null = 静默忽略（非文本、群聊没 @ 机器人、剥完 @ 没剩问题）。
// 群聊时 botOpenId 还没拿到（null）也一律不答——拿不准是不是 @ 我，宁可不说。
// 例外：新开的话题不 @ 也答（话题里的追问照旧要 @）。群里不 @ 的消息飞书只在应用开了
// 「获取群组中所有消息」权限时才推，没开这项权限时这条例外收不到消息、自然不生效
export function questionOf(msg: Incoming, botOpenId: string | null): string | null {
  if (msg.messageType !== 'text') return null
  if (msg.chatType === 'group' && !isTopicStart(msg)) {
    if (!botOpenId || !msg.mentionOpenIds.includes(botOpenId)) return null
  }
  let q = msg.text
  for (const k of msg.mentionKeys) q = q.split(k).join('')
  q = q.replace(/\s+/g, ' ').trim()
  return q || null
}

// 每会话串行：上一条没答完时来了新消息，接线层直接回「还在想」并丢弃，不排队
export class ChatLocks {
  private busy = new Set<string>()
  try(chatId: string): boolean { if (this.busy.has(chatId)) return false; this.busy.add(chatId); return true }
  release(chatId: string): void { this.busy.delete(chatId) }
}
