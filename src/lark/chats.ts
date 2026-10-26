// 三层关系「机器人 → 会话(chat) → DSH 会话」的内存路由：appId → chatId → ChatRecord。
// 一个机器人对应多个人/多个群，各维护一个当前 DSH 会话；切新会话（Lark 新会话事件）时
// 旧的挪进本次运行的 past 列表。DSH 会话本体由宿主自动落盘，插件不保存关联。
// 每次运行使用新的命名空间，避免重启后按同一个 id 重新接回旧对话。
import { randomUUID } from 'node:crypto'
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

type ChatsMap = Record<string, Record<string, ChatRecord>>

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()

export class ChatSessions {
  private map: ChatsMap = {}
  constructor(private now: () => number = () => Date.now(), private namespace = randomUUID()) {}
  private rec(appId: string, chatId: string): ChatRecord | undefined { return this.map[appId]?.[chatId] }

  /** id 在本次运行内稳定，跨运行隔离；序号避开本次已在册的 id。 */
  nextId(appId: string, chatId: string): string {
    const rec = this.rec(appId, chatId)
    const taken = new Set<string>((rec?.past ?? []).map((p) => p.id))
    if (rec?.current) taken.add(rec.current)
    const base = `lark-${slug(nameOf(appId))}-${slug(chatId)}-${this.namespace}`
    let n = rec?.past.length ?? 0
    while (taken.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }

  /** create 因 cwd 冲突拒绝复用 id 时记入已占用列表，让 nextId 跳过。 */
  reserve(appId: string, chatId: string, id: string, title: string): void {
    const apps = (this.map[appId] ??= {})
    const rec = (apps[chatId] ??= { current: '', currentTitle: '', past: [], lastAt: 0, chatType: '' })
    if (rec.current === id || rec.past.some((p) => p.id === id)) return
    rec.past = [{ id, title }, ...rec.past]
  }

  /** 把（新建的）会话记为当前会话 */
  bind(appId: string, chatId: string, id: string, title: string, chatType: string): void {
    const apps = (this.map[appId] ??= {})
    apps[chatId] = { ...(apps[chatId] ?? { current: '', currentTitle: '', past: [], lastAt: 0, chatType }), current: id, currentTitle: title, lastAt: this.now(), chatType }
  }

  /** 轮换：当前会话挪进 past 头部、清空 current（下条消息懒建新的）。没有当前会话则无操作 */
  rotate(appId: string, chatId: string): SessionRef | null {
    const rec = this.rec(appId, chatId)
    if (!rec?.current) return null
    const moved: SessionRef = { id: rec.current, title: rec.currentTitle }
    rec.past = [moved, ...rec.past]
    rec.current = ''
    rec.currentTitle = ''
    return moved
  }

  /** 记活跃（每条消息后刷 lastAt/chatType；没在册的不硬造记录——bind 才建） */
  touch(appId: string, chatId: string, chatType: string): void {
    const rec = this.rec(appId, chatId)
    if (!rec) return
    rec.lastAt = this.now()
    rec.chatType = chatType
  }

  list(appId: string): (ChatRecord & { chatId: string })[] {
    return Object.entries(this.map[appId] ?? {})
      .map(([chatId, rec]) => ({ chatId, ...rec }))
      .sort((a, b) => b.lastAt - a.lastAt)
  }

  /** 删机器人时清掉它的映射（DSH 会话本体保留，历史还能在宿主会话列表里找到） */
  drop(appId: string): void {
    delete this.map[appId]
  }
}
