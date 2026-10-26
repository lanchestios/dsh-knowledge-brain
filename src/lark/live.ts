// 一个问题一张回复卡片，原位切换四种形态：
//   思考中（只列检索与阅读，同时最多 5 项、已用时）→ AI 追问时改成选择题（cards.buildAskCard）
//   → 作答后回到思考中 → 收场换成答案（或失败话术）。
// 快答（没到 delayMs 就收场）不出思考卡，直接发答案卡。卡片写入全部串行进一条链，后发的
// 写入一定落在先发的之后——否则思考卡的节流刷新可能盖掉刚换上的题卡或答案。卡片发不出 /
// 改不了时答案退回富文本回复（replyText），宁可样式差也不丢答案。
// 纯件：发卡 / 改卡 / 回文字全注入（真实现在 service.ts 接 channel），计时参数可注入，单测直跑。
import { larkRows, type LarkInline, type ImageKeys } from './post.js'

export interface LiveIo {
  /** 把卡片作为对提问消息的回复发出（话题里回进话题），得卡片消息 id */
  sendCard(card: object): Promise<string>
  updateCard(messageId: string, card: object): Promise<void>
  /** 卡片路不通时的退路：富文本回复（keys：答案里已上传的图） */
  replyText(text: string, keys?: ImageKeys): Promise<void>
  warn(msg: string): void
}

export interface LiveOpts {
  /** 回合跑多久还没收场才出思考卡（快答不闪卡） */
  delayMs: number
  /** 两次思考卡刷新的最小间隔（飞书改卡 5 QPS / 消息） */
  throttleMs: number
  /** 没有新步骤时也按这个间隔刷一次，用时不停 */
  heartbeatMs: number
}

export const LIVE_DEFAULTS: LiveOpts = { delayMs: 10_000, throttleMs: 2_000, heartbeatMs: 15_000 }

/** 思考卡同时展示的项数（最近的几项；更早的直接滚出，不加「前面还有」） */
const MAX_LINES = 5

// lark_md 转义最小集（与 cards.ts 同款：& 和 <）
const md = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const plain = (text: string) => ({ tag: 'plain_text', content: text })
const note = (text: string) => ({ tag: 'note', elements: [plain(text)] })
const div = (content: string) => ({ tag: 'div', text: { tag: 'lark_md', content } })

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

const lastSegment = (p: string) => {
  const parts = p.split('/').filter(Boolean)
  return (parts[parts.length - 1] ?? p).replace(/\.md$/i, '')
}

/** 一条 tool/call → 思考卡上的一行。只展示检索与阅读；其余工具（目录、追问等）不出行 */
export function stepLine(name: string, rawArgs: string): string | null {
  if (name !== 'wiki_search' && name !== 'wiki_read_page') return null
  let a: any = {}
  try { a = JSON.parse(rawArgs || '{}') ?? {} } catch { a = {} }
  if (name === 'wiki_search') return `🔍 检索：${String(a.query ?? '').trim() || '（空）'}`
  return `📖 阅读：${lastSegment(String(a.id ?? a.name ?? '')) || '（页）'}`
}

export function buildThinkingCard(lines: string[], elapsedMs: number): object {
  const shown = lines.slice(-MAX_LINES)
  const els: object[] = [div(`**正在查资料** · 已用时 ${formatElapsed(elapsedMs)}`)]
  els.push(div(shown.length ? shown.map(md).join('\n') : '理解问题中…'))
  return { config: { wide_screen_mode: true, update_multi: true }, header: { title: plain('知识问答 · 思考中'), template: 'blue' }, elements: els }
}

/** post 的一行 → lark_md（粗体/斜体/删除线/链接；空白段不加样式标记，免得 ** ** 原样露出） */
const rowMd = (row: LarkInline[]): string => row.map((e) => {
  const raw = e.text
  if (e.tag === 'a') return `[${md(raw)}](${e.href})`
  if (!e.style?.length || !raw.trim()) return md(raw)
  let t = md(raw)
  if (e.style.includes('lineThrough')) t = `~~${t}~~`
  if (e.style.includes('italic')) t = `*${t}*`
  if (e.style.includes('bold')) t = `**${t}**`
  return t
}).join('')

export interface AnswerStats { elapsedMs: number; searches: number; reads: number }

const statsLine = (s: AnswerStats) => {
  const parts = [`用时 ${formatElapsed(s.elapsedMs)}`]
  if (s.searches) parts.push(`检索 ${s.searches} 次`)
  if (s.reads) parts.push(`阅读 ${s.reads} 页`)
  return parts.join(' · ')
}

/** 答案卡：markdown 先过 post 规整（标题转粗、表格转行、代码按行），再按行拼 lark_md；
 *  40 行一个 div，单块别太长；有 key 的图在原位置插 img 元素 */
export function buildAnswerCard(markdown: string, stats: AnswerStats, keys?: ImageKeys): object {
  const els: object[] = []
  let buf: string[] = []
  const flush = () => {
    for (let i = 0; i < buf.length; i += 40) els.push(div(buf.slice(i, i + 40).join('\n')))
    buf = []
  }
  for (const row of larkRows(markdown, keys)) {
    if (Array.isArray(row)) { buf.push(rowMd(row)); continue }
    flush()
    els.push({ tag: 'img', img_key: row.img, alt: plain(row.alt || '图片') })
  }
  flush()
  els.push(note(statsLine(stats)))
  return { config: { wide_screen_mode: true, update_multi: true }, elements: els }
}

export function buildFailCard(text: string, stats: AnswerStats): object {
  return { config: { wide_screen_mode: true, update_multi: true }, elements: [div(md(text)), note(statsLine(stats))] }
}

type Phase = 'idle' | 'thinking' | 'asking' | 'done'

export class LiveReply {
  private phase: Phase = 'idle'
  private lines: string[] = []
  private searches = new Set<string>()
  private reads = new Set<string>()
  private messageId = ''
  private startedAt = 0
  private chain: Promise<unknown> = Promise.resolve()
  private delayTimer: any = null
  private refreshTimer: any = null
  private heartbeat: any = null
  private lastRefresh = 0
  private readonly opts: LiveOpts

  constructor(private io: LiveIo, opts: Partial<LiveOpts> = {}) {
    this.opts = { ...LIVE_DEFAULTS, ...opts }
  }

  /** 串行写卡：每次写入排在前一次之后，前一次失败不挡后一次 */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const p = this.chain.then(op, op)
    this.chain = p.catch(() => {})
    return p
  }

  /** 有卡就改，没卡就发（发出后记下 id，之后都改这一张） */
  private async put(card: object): Promise<void> {
    if (this.messageId) await this.io.updateCard(this.messageId, card)
    else this.messageId = await this.io.sendCard(card)
  }

  private stats(): AnswerStats {
    return { elapsedMs: Date.now() - this.startedAt, searches: this.searches.size, reads: this.reads.size }
  }

  /** 回合开跑：起延迟表，到点还在想就发思考卡 */
  start(): void {
    this.startedAt = Date.now()
    this.phase = 'thinking'
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null
      if (this.phase !== 'thinking') return
      this.refreshNow()
      this.heartbeat = setInterval(() => this.schedule(), this.opts.heartbeatMs)
    }, this.opts.delayMs)
  }

  private visible(): boolean { return !!this.messageId || (!this.delayTimer && this.phase === 'thinking') }

  private refreshNow(): void {
    if (this.phase !== 'thinking') return
    this.lastRefresh = Date.now()
    const card = buildThinkingCard(this.lines, Date.now() - this.startedAt)
    void this.enqueue(async () => {
      if (this.phase !== 'thinking') return   // 排队期间已换成题卡 / 答案：别盖回思考卡
      await this.put(card)
    }).catch((e) => this.io.warn(`刷新思考卡失败：${e instanceof Error ? e.message : String(e)}`))
  }

  /** 节流刷新：距上次不足 throttleMs 就挂一次延后的，期间再来的合并 */
  private schedule(): void {
    if (this.phase !== 'thinking' || !this.visible() || this.refreshTimer) return
    const wait = Math.max(0, this.opts.throttleMs - (Date.now() - this.lastRefresh))
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refreshNow() }, wait)
  }

  /** 宿主 session/event：只认 tool/call，记一行并（节流）刷卡 */
  step(ev: any): void {
    if (this.phase === 'done' || ev?.type !== 'tool/call') return
    const name = String(ev?.data?.name ?? '')
    const args = String(ev?.data?.arguments ?? '')
    const line = stepLine(name, args)
    if (!line) return
    if (name === 'wiki_search') this.searches.add(line)
    if (name === 'wiki_read_page') this.reads.add(line)
    this.lines.push(line)
    this.schedule()
  }

  /** AI 追问：把这张卡换成题卡（还没发卡就直接作为回复发出），得卡片消息 id 供按钮回调认领 */
  ask(questionCard: object): Promise<string> {
    this.phase = 'asking'
    if (this.delayTimer) { clearTimeout(this.delayTimer); this.delayTimer = null }
    return this.enqueue(async () => { await this.put(questionCard); return this.messageId })
  }

  /** 题卡挂起期间改题卡（多选勾选态）：同样排进串行链，且只在仍在追问时落笔 */
  updateAsk(questionCard: object): Promise<void> {
    return this.enqueue(async () => { if (this.phase === 'asking' && this.messageId) await this.io.updateCard(this.messageId, questionCard) })
  }

  /** 作答完毕：回到思考中并立刻刷回思考卡 */
  resume(): void {
    if (this.phase !== 'asking') return
    this.phase = 'thinking'
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.schedule(), this.opts.heartbeatMs)
    this.refreshNow()
  }

  private stop(): void {
    this.phase = 'done'
    if (this.delayTimer) clearTimeout(this.delayTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.delayTimer = this.refreshTimer = this.heartbeat = null
  }

  private async settle(card: object, fallbackText: string, keys?: ImageKeys): Promise<void> {
    this.stop()
    try {
      await this.enqueue(() => this.put(card))
    } catch (e) {
      this.io.warn(`答案卡片发送失败，退回富文本：${e instanceof Error ? e.message : String(e)}`)
      await this.io.replyText(fallbackText, keys)
    }
  }

  /** 收场：卡片换成答案（keys：答案里已上传的图） */
  finish(answer: string, keys?: ImageKeys): Promise<void> { return this.settle(buildAnswerCard(answer, this.stats(), keys), answer, keys) }

  /** 失败收场：卡片换成失败话术 */
  fail(text: string): Promise<void> { return this.settle(buildFailCard(text, this.stats()), text) }
}
