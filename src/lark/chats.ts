// 三层关系「机器人 → 会话(chat) → DSH 会话」的持久映射：appId → chatId → ChatRecord。
// 一个机器人对应多个人/多个群，各维护一个当前 DSH 会话；切新会话（Lark 新会话事件）时
// 旧的挪进 past 列表。纯状态机：load/save 注入（真实持久化在 store.ts 的 storageDomain，
// 单测给内存假实现），DSH 会话本体由宿主自动落盘，这里只记「每个 chat 正用哪个」。
import { nameOf } from './bindings.js'

/** past 里的一条（轮换下来的旧会话） */
export interface SessionRef { id: string; title: string }

/** 一个 chat 的记录：current 为空串 = 当前没有会话（轮换后、下次消息再懒建） */
export interface ChatRecord {
  current: string
  currentTitle: string
  past: SessionRef[]
  lastAt: number
  chatType: string
}

export type ChatsMap = Record<string, Record<string, ChatRecord>>

export interface ChatSessionsStore {
  load(): ChatsMap
  /** 同步或异步都收：真实现落盘异步、失败只吞（丢一次 touch 无伤大雅，bind/rotate 也在下一跳重写） */
  save(map: ChatsMap): void | Promise<void>
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()

export class ChatSessions {
  private map: ChatsMap
  constructor(private store: ChatSessionsStore, private now: () => number = () => Date.now()) {
    this.map = store.load()
  }
  private persist(): void {
    const r = this.store.save(this.map)
    if (r && typeof (r as any).then === 'function') void (r as Promise<void>).catch(() => {})
  }
  private rec(appId: string, chatId: string): ChatRecord | undefined { return this.map[appId]?.[chatId] }

  /** chat 下一个新会话的确定性 id：lark-<appId 派生>-<chatId>-<序号>；序号避开已在册的 id */
  nextId(appId: string, chatId: string): string {
    const rec = this.rec(appId, chatId)
    const taken = new Set<string>((rec?.past ?? []).map((p) => p.id))
    if (rec?.current) taken.add(rec.current)
    const base = `lark-${slug(nameOf(appId))}-${slug(chatId)}`
    let n = rec?.past.length ?? 0
    while (taken.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }

  /** 把一个已存在但非当前的会话 id 记进 past（nextId 会跳过）：确定性 id 被一个 cwd 不合的
   *  老会话占住、create 拒绝领养时用——归档是真的（那本来就是这个 chat 的历史会话） */
  reserve(appId: string, chatId: string, id: string, title: string): void {
    const apps = (this.map[appId] ??= {})
    const rec = (apps[chatId] ??= { current: '', currentTitle: '', past: [], lastAt: 0, chatType: '' })
    if (rec.current === id || rec.past.some((p) => p.id === id)) return
    rec.past = [{ id, title }, ...rec.past]
    this.persist()
  }

  /** 把（新建的）会话记为当前会话 */
  bind(appId: string, chatId: string, id: string, title: string, chatType: string): void {
    const apps = (this.map[appId] ??= {})
    apps[chatId] = { ...(apps[chatId] ?? { current: '', currentTitle: '', past: [], lastAt: 0, chatType }), current: id, currentTitle: title, lastAt: this.now(), chatType }
    this.persist()
  }

  /** 轮换：当前会话挪进 past 头部、清空 current（下条消息懒建新的）。没有当前会话则无操作 */
  rotate(appId: string, chatId: string): SessionRef | null {
    const rec = this.rec(appId, chatId)
    if (!rec?.current) return null
    const moved: SessionRef = { id: rec.current, title: rec.currentTitle }
    rec.past = [moved, ...rec.past]
    rec.current = ''
    rec.currentTitle = ''
    this.persist()
    return moved
  }

  /** 记活跃（每条消息后刷 lastAt/chatType；没在册的不硬造记录——bind 才建） */
  touch(appId: string, chatId: string, chatType: string): void {
    const rec = this.rec(appId, chatId)
    if (!rec) return
    rec.lastAt = this.now()
    rec.chatType = chatType
    this.persist()
  }

  list(appId: string): (ChatRecord & { chatId: string })[] {
    return Object.entries(this.map[appId] ?? {})
      .map(([chatId, rec]) => ({ chatId, ...rec }))
      .sort((a, b) => b.lastAt - a.lastAt)
  }

  /** 删机器人时清掉它的映射（DSH 会话本体保留，历史还能在宿主会话列表里找到） */
  drop(appId: string): void {
    delete this.map[appId]
    this.persist()
  }
}
