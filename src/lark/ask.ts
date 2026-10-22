// 走真实 DSH 会话答一条 Lark 问题：ensureSession 懒建/续用会话 → followup 发消息 →
// 从宿主 durable 事件里收这一回合的 assistant 文本 → 回合结束（agent/status 离开 running）
// 即答案。全部依赖注入（真实实现在 mount.ts：sessionController/agents/sessions + ctx.on
// 事件扇出），不碰 SDK、不碰 cordis ctx——单测全假。
import { PERSONA } from './persona.js'
import { framedQuestion, type Origin } from './origin.js'

// 回合兜底上限：不再 2 分钟硬停（长问题要查十几页），思考过程由回复卡片实时展示（live.ts）；
// 这条只防回合卡死一直占着会话锁
export const ASK_TIMEOUT_MS = 15 * 60_000
const MAX_ANSWER = 4000

/** 一轮要发的消息：context 是给模型的上下文（宿主折叠显示，不算用户发言），text 是用户问题
 *  （宿主显示成用户气泡）。两条分开发，界面上才看得到问了什么 */
export interface Outgoing { context?: string; text: string }

/** 群聊里问题带「提问人：」前缀（origin.framedQuestion），人设里说清楚，别让模型当成问题本身 */
const ASKER_NOTE = '群聊里每条问题开头的「名字：」是提问人，不是问题的一部分；回答时不必复述。'

/** 新会话的第一轮：人设作上下文 + 问题；后续轮次只发问题（上下文在会话里）。人设见 persona.ts：
 *  真实会话是全量 agent、工具能读整库，文件夹范围靠指令约束（软约束，用户已接受） */
export function firstMessage(folder: string, question: string, botName?: string): Outgoing {
  return { context: `${PERSONA(folder, botName)}\n\n${ASKER_NOTE}`, text: question }
}

export function truncate(text: string, max = MAX_ANSWER): string {
  return text.length <= max ? text : text.slice(0, max) + '\n\n（超长已截断）'
}

// error 必带 detail：桌面端宿主日志不落盘，回复/日志是仅有的可观测面——吞掉错误原因等于毁掉现场
export type AskResult =
  | { status: 'ok'; text: string }
  | { status: 'timeout' }
  | { status: 'blocked'; detail?: string }
  | { status: 'error'; detail: string }

/**
 * assistant/message 事件 data.stream 的文本量：durable 流是打包记录（text-chunks 是一串
 * texts 的 run），偶尔夹原始 chunk（text-delta）。两种形态都认，其余（reasoning/工具块）不计。
 */
export function textOfStream(stream: any): string {
  if (!Array.isArray(stream)) return ''
  let text = ''
  for (const r of stream) {
    if (r?.type === 'text-chunks' && Array.isArray(r.texts)) text += r.texts.join('')
    else if (r?.type === 'chunk' && r?.chunk?.type === 'text-delta') text += String(r.chunk.text ?? '')
  }
  return text
}

export type TurnOutcome =
  | { status: 'ok'; text: string }
  | { status: 'blocked' }
  | { status: 'error'; detail: string }

/** 一个回合的等待器：喂 session 事件与 agent 状态，回合结束（见过 running 后转空闲）给最终文本。
 *  一回合可能有多条 assistant/message（中间步骤），答案取最后一条非空文本。 */
export class TurnWaiter {
  private armed = false
  private lastText = ''
  private settled = false
  private resolveDone!: (v: TurnOutcome) => void
  readonly done = new Promise<TurnOutcome>((res) => { this.resolveDone = res })
  // 超时看门狗：deadline＋held。held=true（AI 追问的卡片挂着等人点）期间不计超时；unhold
  // 重置 deadline 再起表。轮询粒度 1s——回合超时的精度不需要更细。
  private held = false
  private deadline = 0
  private timer: any = null
  private fireTimeout!: () => void
  readonly timedOut = new Promise<null>((res) => { this.fireTimeout = () => res(null) })
  constructor(readonly sessionId: string, private onEvent?: (ev: any) => void) {}

  /** 起表：ms 内没收场 → timedOut 落定 */
  arm(ms: number): void {
    this.deadline = Date.now() + ms
    this.held = false
    this.watch()
  }
  private watch(): void {
    if (this.timer) clearTimeout(this.timer)
    const tick = () => {
      if (this.settled) return
      if (this.held) { this.timer = setTimeout(tick, 1_000); return }
      const left = this.deadline - Date.now()
      if (left <= 0) { this.fireTimeout(); return }
      this.timer = setTimeout(tick, Math.min(1_000, left + 5))
    }
    this.timer = setTimeout(tick, 0)
  }
  /** 挂起（等人点卡片）：不计超时 */
  hold(): void { this.held = true }
  /** 解除挂起并把剩余时长重置为 ms（答案回去后回合还要跑完） */
  unhold(ms: number): void { this.held = false; this.deadline = Date.now() + ms; this.watch() }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }

  /** 'session/event' 的 event：收 assistant 文本；blocked 代表这个会话已不能继续。 */
  event(ev: any): void {
    if (this.settled) return
    try { this.onEvent?.(ev) } catch { /* 进度展示出错不影响收答案 */ }
    if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'blocked') {
      this.settled = true
      this.resolveDone({ status: 'blocked' })
      return
    }
    if (ev?.type !== 'assistant/message') return
    const text = textOfStream(ev?.data?.stream).trim()
    if (text) this.lastText = text
  }
  /** 'agent/status'：true=回合开始（armed），armed 后的 false=回合结束 */
  running(v: boolean): void {
    if (this.settled) return
    if (v) { this.armed = true; return }
    if (!this.armed) return
    this.settled = true
    this.resolveDone(this.lastText
      ? { status: 'ok', text: truncate(this.lastText) }
      : { status: 'error', detail: '回合结束但没有文本输出' })
  }
  /** 'agent/error' 或派发失败：提前收场 */
  fail(detail: string): void {
    if (this.settled) return
    this.settled = true
    this.resolveDone({ status: 'error', detail })
  }
}

/** 按 sessionId 分发的回合等待中枢：mount 把宿主事件喂进来，ask 从这里等答案 */
export class TurnHub {
  private waiters = new Map<string, Set<TurnWaiter>>()

  onEvent(sessionId: string, ev: any): void { for (const w of this.waiters.get(sessionId) ?? []) w.event(ev) }
  onStatus(agentId: string, running: boolean): void { for (const w of this.waiters.get(agentId) ?? []) w.running(running) }
  onError(agentId: string, detail: string): void { for (const w of this.waiters.get(agentId) ?? []) w.fail(detail) }
  /** 派发失败收不了场时，替等待中的回合给个错误结果 */
  fail(sessionId: string, detail: string): void { this.onError(sessionId, detail) }
  /** 挂起该会话所有等待回合的超时（AI 追问转卡片等人期间） */
  hold(sessionId: string): void { for (const w of this.waiters.get(sessionId) ?? []) w.hold() }
  /** 解除挂起并把剩余时长重置为 ms */
  unhold(sessionId: string, ms: number): void { for (const w of this.waiters.get(sessionId) ?? []) w.unhold(ms) }

  async wait(sessionId: string, timeoutMs: number, onEvent?: (ev: any) => void): Promise<AskResult> {
    const w = new TurnWaiter(sessionId, onEvent)
    let set = this.waiters.get(sessionId)
    if (!set) { set = new Set(); this.waiters.set(sessionId, set) }
    set.add(w)
    w.arm(timeoutMs)
    try {
      const r = await Promise.race([
        w.done.then((v) => ({ kind: 'done' as const, v })),
        w.timedOut.then(() => ({ kind: 'to' as const })),
      ])
      return r.kind === 'to' ? { status: 'timeout' } : r.v
    } finally {
      w.dispose()
      set!.delete(w)
      if (!set!.size) this.waiters.delete(sessionId)
    }
  }
}

export interface SessionAskDeps {
  /** chat 没有当前会话时懒建（确定性 id、按来源起标题、选模型），已有则直接续用 */
  ensureSession(appId: string, chatId: string, chatType: string, origin: Origin): Promise<{ id: string; first: boolean }>
  /** 往会话发这一轮的消息（上下文 + 用户问题，followup + flush） */
  send(sessionId: string, msg: Outgoing): Promise<void>
  /** 等这一回合的答案（事件扇出在 mount） */
  hub: Pick<TurnHub, 'wait' | 'fail'>
  /** 超时后叫停回合（尽力而为） */
  cancel(sessionId: string): Promise<void>
}

const isArchivedError = (detail: string) => /归档|archived|\bblocked\b/i.test(detail)

/** 通用回合的最小依赖：lark 问答与场景草稿共用（真实实现在各自的 mount） */
export interface TurnDeps {
  ensure(): Promise<{ id: string; first: boolean }>
  send(id: string, msg: Outgoing): Promise<void>
  hub: Pick<TurnHub, 'wait' | 'fail'>
  cancel(id: string): Promise<void>
}

/** 通用回合：建/续会话 → 先挂 waiter 再发消息 → 收答案；超时叫停；派发失败给错误结果 */
export async function runTurn(deps: TurnDeps, o: { first: Outgoing; followup: Outgoing; timeoutMs?: number; onEvent?: (ev: any) => void }): Promise<AskResult> {
  const timeoutMs = o.timeoutMs ?? ASK_TIMEOUT_MS
  try {
    const { id, first } = await deps.ensure()
    // 先挂 waiter 再发消息：followup 一返回 agent 就开跑，晚挂会错过开头的 running/事件
    const answer = deps.hub.wait(id, timeoutMs, o.onEvent)
    try {
      await deps.send(id, first ? o.first : o.followup)
    } catch (e) {
      const detail = `派发失败：${e instanceof Error ? e.message : String(e)}`
      deps.hub.fail(id, detail)
      await answer.catch(() => ({ status: 'error', detail }) as const)
      return isArchivedError(detail) ? { status: 'blocked', detail } : { status: 'error', detail }
    }
    const r = await answer
    if (r.status === 'timeout') await deps.cancel(id).catch(() => {})
    return r
  } catch (e) {
    // 建会话失败之类：一条错误答复，不炸通道；原因进 detail
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function askSession(deps: SessionAskDeps, o: {
  appId: string; chatId: string; chatType: string; folder: string; question: string; origin: Origin; botName?: string; timeoutMs?: number
  /** 这一回合的宿主事件（思考卡片列步骤用） */
  onEvent?: (ev: any) => void
}): Promise<AskResult> {
  const question = framedQuestion(o.origin, o.question)
  return runTurn({
    ensure: () => deps.ensureSession(o.appId, o.chatId, o.chatType, o.origin),
    send: (id, msg) => deps.send(id, msg),
    hub: deps.hub,
    cancel: (id) => deps.cancel(id),
  }, { first: firstMessage(o.folder, question, o.botName), followup: { text: question }, timeoutMs: o.timeoutMs, onEvent: o.onEvent })
}
