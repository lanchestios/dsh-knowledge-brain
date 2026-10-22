// 通道接线：来了一条消息怎么办。全部依赖注入（绑定从 config 读、回复走 Lark、派发走
// askSession 进真实 DSH 会话、chat→会话映射在 ChatSessions），channel.ts 只负责把 Lark
// 事件变成 Incoming 塞进来——单测全用假实现跑全链。
// 新会话两个入口都在这层汇合：进群事件（onChatNew）与手动指令（整条消息就是「新会话」，
// 单聊群聊都能用，群聊同样要 @ 机器人）。
import { route, questionOf, conversationKey, ChatLocks, type Incoming } from './route.js'
import { SeenEvents } from './state.js'
import { askSession, type SessionAskDeps } from './ask.js'
import type { Binding } from './bindings.js'
import type { ChatSessions } from './chats.js'
import { askerLabel, type Origin } from './origin.js'
import { LiveReply, type LiveOpts } from './live.js'
import type { ImageKeys } from './post.js'

export interface LarkServiceDeps {
  appId: string
  /** 当前合法绑定（config 热改后取到的是新值） */
  bindings(): Binding[]
  /** 机器人 open_id（连接后从 Lark 取；没取到前群聊一律不答） */
  botOpenId(): string | null
  /** 机器人名字（/bot/v3/info 取；嵌进首条人设，取不到用默认名） */
  botName?(): string
  /** inThread：消息在话题里时回进话题；keys：答案里已上传的图 */
  reply(messageId: string, text: string, inThread?: boolean, keys?: ImageKeys): Promise<void>
  /** 答案里库内图片 → image_key（mount 每个机器人一个，见 images.ts）；不给则库内图一律不发 */
  images?: { resolve(markdown: string): Promise<ReadonlyMap<string, string>> }
  /** 卡片回复（思考过程实时展示 → 原位换成答案，见 live.ts）：两项都给才走卡片，否则照旧
   *  富文本回复。replyCard 把卡片作为对提问消息的回复发出，得卡片消息 id */
  replyCard?(messageId: string, card: object, inThread?: boolean): Promise<string>
  updateCard?(messageId: string, card: object): Promise<void>
  /** 卡片计时（单测注入毫秒级） */
  liveOpts?: Partial<LiveOpts>
  ask: SessionAskDeps
  sessions: ChatSessions
  /** 消息来源（单聊/群/话题群、群名、提问人）：起会话标题、群聊问题前缀用。mount 注入带缓存的
   *  解析器；不给或解析抛错退最小来源（按 chatType，提问人用 open_id 短码），不拦答题。
   *  question 是剥净 @ 的问题（话题会话拿它的首句当标题） */
  origin?(msg: Incoming, question: string): Promise<Origin>
  /** 该 chat 有挂起的追问卡片时把文字消息当自由作答回填；true=已消费，不再走问答（mount 注入） */
  pendingText?(chatId: string, text: string): boolean
  now?(): number
  warn(msg: string): void
  info(msg: string): void
}

const BUSY_TEXT = '上一条还在想，稍等一下再问'
// 失败统一话术：超时 / 出错都是这一句（用户不用区分原因，细节进日志）
const FAIL_TEXT = '这条没答上来，稍后再试'
const BLOCKED_TEXT = '当前问答会话已归档，请发送「新会话」后再提问'
/** 手动新会话指令（questionOf 已把 @ 占位与空白剥净，整条相等即命中） */
const NEW_SESSION_CMD = '新会话'
const NEW_SESSION_TEXT = '已准备好新会话，可以继续提问了'

export interface LarkService {
  /** 通道把消息/新会话事件的入口接进来（channel.start 前调） */
  start(hooks: {
    onMessage(h: (m: Incoming) => void): void
    onChatNew(h: (e: { chatId: string; chatType: 'p2p' | 'group' }) => void): void
  }): void
  /** 单条消息的完整处理；测试直调，通道经 onMessage 间接调到这里 */
  handle(msg: Incoming): void
  /** 新会话事件：把该 chat 的当前会话轮换进历史（下条消息懒建新的） */
  rotate(chatId: string, chatType: 'p2p' | 'group'): void
  /** 该会话键正在答的问题的回复卡片（AI 追问时 mount 用它把同一张卡换成题卡）；没有为空 */
  live(key: string): LiveReply | undefined
}

export function createLarkService(deps: LarkServiceDeps): LarkService {
  const now = deps.now ?? (() => Date.now())
  const locks = new ChatLocks()
  const seen = new SeenEvents(200)

  // 回复失败要留痕：reply 被拒时用户侧什么都看不到，日志是唯一线索
  const replySafe = async (messageId: string, text: string, inThread = false, keys?: ImageKeys) => {
    try { await deps.reply(messageId, text, inThread, keys) } catch (e) {
      // 带图发不出（image_key 失效等）：去掉图再发一次，答案不丢
      if (keys?.size) {
        deps.warn(`回复 Lark 带图失败，改发纯文字：${e instanceof Error ? e.message : String(e)}`)
        return replySafe(messageId, text, inThread)
      }
      deps.warn(`回复 Lark 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 正在答的问题 → 回复卡片（会话键；每会话串行，同一时刻至多一张）
  const lives = new Map<string, LiveReply>()
  const makeLive = (messageId: string, inThread: boolean): LiveReply | null => {
    const { replyCard, updateCard } = deps
    if (!replyCard || !updateCard) return null
    return new LiveReply({
      sendCard: (card) => replyCard(messageId, card, inThread),
      updateCard: (id, card) => updateCard(id, card),
      replyText: (text, keys) => replySafe(messageId, text, inThread, keys),
      warn: deps.warn,
    }, deps.liveOpts)
  }

  const fallbackOrigin = (msg: Incoming, q: string): Origin => ({
    kind: msg.chatType === 'p2p' ? 'p2p' : msg.threadId ? 'thread' : 'group',
    chatName: '', asker: askerLabel('', msg.senderId ?? ''), topic: msg.threadId ? q : '',
  })
  const originOf = async (msg: Incoming, q: string): Promise<Origin> => {
    if (!deps.origin) return fallbackOrigin(msg, q)
    try { return await deps.origin(msg, q) } catch (e) {
      deps.warn(`Lark 消息来源解析失败：${e instanceof Error ? e.message : String(e)}`)
      return fallbackOrigin(msg, q)
    }
  }

  // 收场前把答案里的库内图换成 image_key；任何失败都当没图（那张不发），不挡答案
  const keysOf = async (text: string): Promise<ImageKeys | undefined> => {
    if (!deps.images) return undefined
    try { return await deps.images.resolve(text) } catch (e) {
      deps.warn(`Lark 答案图片处理失败：${e instanceof Error ? e.message : String(e)}`)
      return undefined
    }
  }

  const handle = (msg: Incoming) => {
    if (seen.dup(msg.eventId)) return
    const binding = route(msg.chatId, deps.bindings())
    if (!binding) return
    const q = questionOf(msg, deps.botOpenId())
    if (!q) return
    // 会话键：话题里按「chat＋话题根」一个会话（各话题互不串上下文、互不占锁），话题外照旧按 chat。
    // 锁、会话映射、挂起追问全按这个键；回复在话题里就回进话题
    const key = conversationKey(msg)
    const inThread = !!msg.threadId
    // 挂起的追问卡片优先：这条文字是给人的选择题的自由作答，不是新问题
    if (deps.pendingText?.(key, q)) return
    // 手动新会话：归档当前会话，下条消息懒建新的。不占问答锁（正在跑的回合照常答完）
    if (q === NEW_SESSION_CMD) {
      rotateChat(key)
      void replySafe(msg.messageId, NEW_SESSION_TEXT, inThread)
      return
    }
    // 每会话串行：忙时立即回「还在想」并丢弃，不排队（agent 回合要 10–30s，排队只会越积越多）
    if (!locks.try(key)) { void replySafe(msg.messageId, BUSY_TEXT, inThread); return }
    const live = makeLive(msg.messageId, inThread)
    if (live) lives.set(key, live)
    void (async () => {
      try {
        live?.start()
        const origin = await originOf(msg, q)
        const r = await askSession(deps.ask, {
          appId: deps.appId, chatId: key, chatType: msg.chatType,
          folder: binding.folder, question: q, origin, botName: deps.botName?.(),
          ...(live ? { onEvent: (ev: any) => live.step(ev) } : {}),
        })
        deps.sessions.touch(deps.appId, key, msg.chatType)
        if (r.status === 'error') deps.warn(`Lark 问答失败（${key}）：${r.detail}`)
        if (r.status === 'blocked' && r.detail) deps.warn(`Lark 问答会话已归档（${key}）：${r.detail}`)
        if (r.status === 'timeout') deps.warn(`Lark 问答超过兜底上限未收场（${key}），已叫停`)
        const text = r.status === 'ok' ? r.text : r.status === 'blocked' ? BLOCKED_TEXT : FAIL_TEXT
        const keys = r.status === 'ok' ? await keysOf(text) : undefined
        if (!live) await replySafe(msg.messageId, text, inThread, keys)
        else if (r.status === 'ok') await live.finish(text, keys)
        else await live.fail(text)
      } finally {
        if (live && lives.get(key) === live) lives.delete(key)
        locks.release(key)
      }
    })()
  }

  // 轮换本体：进群事件与手动指令共用（当前会话归档、清空 current，下条消息懒建新的）
  const rotateChat = (chatId: string) => {
    const moved = deps.sessions.rotate(deps.appId, chatId)
    if (moved) deps.info(`Lark 新会话：${chatId} 的旧会话「${moved.title}」已归档，下条消息开新会话`)
  }

  const rotate = (chatId: string, _chatType: 'p2p' | 'group') => {
    const binding = route(chatId, deps.bindings())
    if (!binding) return
    rotateChat(chatId)
  }

  return {
    start: (hooks) => {
      hooks.onMessage(handle)
      hooks.onChatNew((e) => rotate(e.chatId, e.chatType))
    },
    handle,
    rotate,
    live: (key) => lives.get(key),
  }
}
