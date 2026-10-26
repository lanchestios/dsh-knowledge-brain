// 问答会话的来源：单聊 / 普通群 / 话题群 / 普通群里开的话题，群名与提问人。纯件 + 带缓存的
// 解析器（lookup 全注入，真实现在 channel.ts 打开放平台接口）。用途两处：建会话时的标题
// （宿主侧栏一眼分清来路），以及群聊里每条问题前缀提问人（模型分得清谁在问）。
// 名字只查通讯录（contact:contact.base:readonly，按 open_id 一次请求，与群大小无关）；拿不到
// （没开权限、不在通讯录可见范围、接口失败）一律降级成 open_id 短码，不拦答题。

/** p2p 单聊；group 普通群；topic 话题群（chat_mode=topic）；thread 普通群里开的话题 */
export type ChatKind = 'p2p' | 'group' | 'topic' | 'thread'

export interface Origin {
  kind: ChatKind
  /** 群名（单聊、或群信息查不到时为空） */
  chatName: string
  /** 提问人显示名（查不到退「用户<open_id 后 6 位>」） */
  asker: string
  /** 话题首句（只在话题里有：这条消息开的会话就是这个话题） */
  topic: string
}

const KIND_LABEL: Record<ChatKind, string> = { p2p: '单聊', group: '群', topic: '话题群', thread: '群话题' }
const TOPIC_MAX = 16

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 会话标题：来源类型 · 群名 · 话题首句或提问人 #序号（空段不留） */
export function sessionTitle(o: Origin, n: number): string {
  const topic = squash(o.topic)
  const tail = topic ? (topic.length > TOPIC_MAX ? `${topic.slice(0, TOPIC_MAX)}…` : topic) : o.asker
  return `${[KIND_LABEL[o.kind], o.chatName, tail].filter(Boolean).join(' · ')} #${n}`
}

export function askerLabel(name: string, openId: string): string {
  return name.trim() || `用户${openId.slice(-6)}`
}

/** 群聊（含话题）里问题前缀提问人；单聊只有一个人，原样 */
export function framedQuestion(o: Origin, question: string): string {
  return o.kind === 'p2p' ? question : `${o.asker}：${question}`
}

export interface OriginLookups {
  /** im/v1/chats/:chat_id → 群名与 chat_mode（p2p/group/topic） */
  chatInfo(chatId: string): Promise<{ name: string; mode: string }>
  /** contact/v3/users/:open_id → 名字（应用身份要 contact:contact.base:readonly） */
  userName(openId: string): Promise<string>
  now?(): number
}

export interface OriginInput {
  chatId: string
  chatType: 'p2p' | 'group'
  senderId: string
  text: string
  threadId?: string
}

// 成功长缓存（名字、群名很少改）；失败短缓存（权限可能稍后开通，别一直问也别永远放弃）
const OK_TTL_MS = 6 * 60 * 60_000
const FAIL_TTL_MS = 10 * 60_000

export function createOriginResolver(deps: OriginLookups) {
  const now = deps.now ?? (() => Date.now())
  const cache = new Map<string, { at: number; ok: boolean; v: any }>()
  const cached = async <T>(key: string, fallback: T, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key)
    if (hit && now() - hit.at < (hit.ok ? OK_TTL_MS : FAIL_TTL_MS)) return hit.ok ? hit.v : fallback
    try {
      const v = await load()
      cache.set(key, { at: now(), ok: true, v })
      return v
    } catch {
      cache.set(key, { at: now(), ok: false, v: null })
      return fallback
    }
  }

  const nameOf = (m: OriginInput): Promise<string> =>
    m.senderId ? cached(`u:${m.senderId}`, '', () => deps.userName(m.senderId)) : Promise.resolve('')

  const resolve = async (m: OriginInput): Promise<Origin> => {
    const topic = m.threadId ? squash(m.text) : ''
    if (m.chatType === 'p2p') {
      return { kind: 'p2p', chatName: '', asker: askerLabel(await nameOf(m), m.senderId), topic: '' }
    }
    const [info, name] = await Promise.all([
      cached(`c:${m.chatId}`, { name: '', mode: '' }, () => deps.chatInfo(m.chatId)),
      nameOf(m),
    ])
    const kind: ChatKind = info.mode === 'topic' ? 'topic' : m.threadId ? 'thread' : 'group'
    return { kind, chatName: info.name.trim(), asker: askerLabel(name, m.senderId), topic }
  }

  return { resolve }
}
