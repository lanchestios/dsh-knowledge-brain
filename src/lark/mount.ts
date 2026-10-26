// cordis 挂载：一个机器人（appId+appSecret+文件夹）一条长连接。问答不再派 one-shot 子
// agent，而是走真实 DSH 会话：sessionController 按 chat 懒建（确定性 id + 标题 + 模型）、
// agents.withoutInitiator 里 followup 发消息、sessions.flush 落盘；答案从宿主 durable 事件
// （session/event 的 assistant/message）收集，回合结束信号是 agent/status 离开 running。
// 所有问答会话归进宿主侧栏的一个 Workspace 组（组=目录，默认 ~/.dsh/知识问答）。
// AI 在回合里 AskUserQuestion 追问时，宿主 user-questions 瀑布把问题接到这里：转成 Lark
// 交互卡片（按钮/文字作答），挂起期间回合不计超时；只有会话在册的 Lark 问答会话才认领，
// 其余原样放行给宿主 UI。
// chat→会话路由仅保存在 ChatSessions（cfg.chats）的内存里。agents/sessions/sessionController 都是
// 可选服务：没注入的部署整个问答通道静默不启用，库功能不受影响——挂载主体包在 ctx.inject
// 里，外层返回委托句柄（RPC 的 status 视图随时可查）。
import { mkdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { Hub } from '../core/hub.js'
import { inside } from '../core/guard.js'
import { folderHasPages } from '../host/wiki-ops.js'
import { vaultPhase } from '../core/vault-phase.js'
import { normalizeApps, nameOf, type AppEntry } from './bindings.js'
import type { Binding } from './bindings.js'
import { createLarkService } from './service.js'
import { LarkChannel, type ChatNewEvent, type CardAction } from './channel.js'
import { TurnHub, ASK_TIMEOUT_MS, type Outgoing } from './ask.js'
import { createOriginResolver, sessionTitle, type Origin } from './origin.js'
import type { LiveOpts, LiveReply } from './live.js'
import { createImageResolver } from './images.js'
import type { ImageKeys } from './post.js'
import { buildAskCard, buildSettledCard, applyCardAction, type CardQuestion, type Picked, type Settled } from './cards.js'
import type { ChatSessions } from './chats.js'
import { parseConversationKey, type Incoming } from './route.js'

export interface LarkHandle {
  status(): Record<string, any>
  restart(): void
  /** 设置卡「检测」后补连：已存配置里有这个机器人、当前没连着就再连一次，等到结果为止 */
  reconnect(appId: string): Promise<ReconnectResult>
}

/** connected：本次连上或本来就连着（already）；saved=false：已存配置里没有这个机器人（只是草稿） */
export interface ReconnectResult { saved: boolean; connected: boolean; already?: boolean; detail?: string }

interface Cfg {
  apps(): unknown
  chats: ChatSessions
  /** 问答会话组的锚目录（默认 ~/.dsh/知识问答）；测试注入临时目录 */
  groupDir?(): string
  /** 回复卡片计时（测试注入毫秒级；默认见 live.LIVE_DEFAULTS） */
  liveOpts?: Partial<LiveOpts>
}

/** 通道工厂：默认真 SDK；测试注入假实现（channel 是唯一碰 SDK 的文件） */
type ChannelFactory = (c: { appId: string; appSecret: string; warn(m: string): void; info(m: string): void }) => {
  onMessage(h: (m: Incoming) => void): void; onChatNew(h: (e: ChatNewEvent) => void): void
  onCardAction(h: (a: CardAction) => void): void
  reply(messageId: string, text: string, inThread?: boolean, keys?: ImageKeys): Promise<void>
  uploadImage?(buf: Buffer): Promise<string>
  sendCard(chatId: string, card: object, threadRoot?: string): Promise<{ messageId: string }>
  updateCard(messageId: string, card: object): Promise<void>
  replyCard?(messageId: string, card: object, inThread?: boolean): Promise<string>
  chatInfo?(chatId: string): Promise<{ name: string; mode: string }>
  userName?(openId: string): Promise<string>
  start(): Promise<void>; stop(): Promise<void>; botOpenId: string | null; botName?: string
}

export function mountLark(ctx: Context, hub: Hub, cfg: Cfg, makeChannel: ChannelFactory = (c) => new LarkChannel(c)): LarkHandle {
  let inner: LarkHandle | null = null
  ctx.inject(['agents', 'sessions', 'sessionController', 'workspaceRegistry', 'permissionPresets'] as any, (c: Context) => { inner = mountInner(c, hub, cfg, makeChannel) })
  return {
    status: () => inner?.status() ?? {
      connected: false, serving: 0, phase: vaultPhase(hub),
      // 显式挑字段（appSecret 绝不进 RPC 响应，哪怕没连上也一样）
      apps: normalizeApps(cfg.apps()).ok.map((a) => ({ appId: a.appId, folder: a.folder, model: a.model, name: '', connected: false, botReady: false, folderExists: folderOf(hub, a.folder) })),
    },
    restart: () => inner?.restart(),
    reconnect: async (appId) => inner ? inner.reconnect(appId) : { saved: false, connected: false, detail: '问答通道未挂载（宿主会话服务未就绪）' },
  }
}

// 文件夹在不在按「有没有页」判断（改名 / 删了 / 空文件夹都算不在），与工具层同一口径；「/」= 整库
const folderOf = (hub: Hub, folder: string) => { const m = hub.engine.model; return !!m && folderHasPages(m, folder) }

// 问答会话只读：切到宿主内置的「仅可查看」预设（read-only，沙箱 read-only ＋ 审批 ask），
// 界面上显示预设名而不是「自定义」。走 permissionPresets.set：它记预设身份、只改不同的那项。
// 每问之前对一次：老会话、被人在 DSH 里改过权限的会话都拉回来；已是该预设不追加事件。
// 拿不到预设服务（或部署里没有 read-only 预设）就拒绝派发——宁可答不了，也不在不受限的会话里答。
export const READ_ONLY_PRESET = 'read-only'
export function pinReadOnly(ctx: any, session: any): void {
  const presets = ctx.permissionPresets
  if (!presets || !session) throw new Error('宿主缺少权限预设服务，问答会话无法限定只读，拒绝作答')
  if (presets.current(session) !== READ_ONLY_PRESET) presets.set(session, READ_ONLY_PRESET)
}

// 一个机器人化为一条「兜底绑定」喂给现成的 service/route 层：name 从 appId 派生，
// chatId 恒空 = 这个机器人答它收到的所有会话
const appBinding = (a: AppEntry): Binding => ({ name: nameOf(a.appId), folder: a.folder, chatId: '', model: a.model })

function mountInner(ctx: Context, hub: Hub, cfg: Cfg, makeChannel: ChannelFactory): LarkHandle {
  const log = ctx.logger
  const controller = () => (ctx as any).sessionController
  const turns = new TurnHub()
  let chans: { app: AppEntry; ch: NonNullable<ReturnType<ChannelFactory>>; svc: ReturnType<typeof createLarkService> }[] = []
  let mountedApps = new Set<string>()
  let lastSig = ''

  // —— 问答会话组：宿主侧栏的组就是 Workspace（一个组一个真实目录）。挂载期建锚目录并
  // 注册（create 按 canonical path 幂等复用），之后问答会话统一 create 进这个组。拿不到
  // workspaceRegistry 或建组失败 → 退回库目录 cwd（分组前的老行为），问答不中断。
  // 成功才缓存；失败不缓存，下一问重试（create 幂等，重试无副作用）。
  const groupPath = cfg.groupDir ? cfg.groupDir() : join(homedir(), '.dsh', '知识问答')
  let wsId: string | null = null
  let wsInFlight: Promise<string | null> | null = null
  const ensureWorkspace = (): Promise<string | null> => {
    if (wsId) return Promise.resolve(wsId)
    return wsInFlight ??= (async () => {
      try {
        await mkdir(groupPath, { recursive: true })
        const ws = await (ctx as any).workspaceRegistry.create(groupPath)
        if (!ws?.id) throw new Error('workspaceRegistry.create 未返回 id')
        wsId = String(ws.id)
        log.info(`Lark 问答会话已归组「${String(ws.title ?? '知识问答')}」（${String(ws.path ?? groupPath)}）`)
        return wsId
      } catch (e) {
        log.warn(`问答会话组未建立，会话退回库目录：${e instanceof Error ? e.message : String(e)}`)
        return null
      } finally { wsInFlight = null }
    })()
  }

  // 宿主事件 → 回合等待者。session 可能是对象或 id，agent 的键就是 sessionId（agents.get 的键）
  ctx.effect(() => (ctx as any).on('session/event', (s: any, ev: any) =>
    turns.onEvent(String(typeof s === 'object' ? s?.id : s), ev)), 'dsh-knowledge-brain.lark.events')
  ctx.effect(() => (ctx as any).on('agent/status', ({ agent, status }: any) =>
    turns.onStatus(String(agent?.id ?? ''), status === 'running')), 'dsh-knowledge-brain.lark.status')
  ctx.effect(() => (ctx as any).on('agent/error', ({ agent, error }: any) =>
    turns.onError(String(agent?.id ?? ''), String(error ?? 'agent 出错'))), 'dsh-knowledge-brain.lark.error')

  const status = () => {
    const { ok } = normalizeApps(cfg.apps())
    return {
      // 全部机器人都连上才算总体已连接；逐个状态在 apps 里看
      connected: ok.length > 0 && chans.length === ok.length,
      serving: ok.length,
      phase: vaultPhase(hub),
      apps: ok.map((a) => {
        const e = chans.find((x) => x.app.appId === a.appId)
        return { appId: a.appId, folder: a.folder, model: a.model, name: e?.ch.botName ?? '', connected: !!e, botReady: !!e?.ch.botOpenId, folderExists: folderOf(hub, a.folder) }
      }),
    }
  }

  // —— 真实会话桥（SessionAskDeps 的实现）——
  // chat 没有当前会话时懒建：本次运行内稳定的 id、按来源起标题（单聊/群/话题群 · 群名 · 提问人或话题）、
  // 按机器人配置选模型；create 同 id 同 cwd
  // 是领养语义（幂等）。建组成功走 workspaceId（cwd 即组目录），否则退库目录。确定性 id 若
  // 被一个 cwd 不合的会话占住，create 拒绝领养：把占住的 id 记入本次运行历史
  // 跳号重试，有界防死循环。已有 current 直接续用（resolveAgent 会按需把落盘会话接回来）。
  const ensureSession = (app: AppEntry) => async (appId: string, chatId: string, chatType: string, origin: Origin) => {
    const sessions = cfg.chats
    const rec = sessions.list(appId).find((r) => r.chatId === chatId)
    if (rec?.current) return { id: rec.current, first: false }
    const workspaceId = await ensureWorkspace()
    const where = workspaceId ? { workspaceId } : { cwd: hub.dir() }
    for (let attempt = 0; attempt < 8; attempt++) {
      const past = sessions.list(appId).find((r) => r.chatId === chatId)?.past.length ?? 0
      const id = sessions.nextId(appId, chatId)
      const title = sessionTitle(origin, past + 1)
      try {
        await controller().create({ sessionId: id, ...where })
        try { await controller().rename({ sessionId: id, title }) } catch { /* 改不了名不影响答题 */ }
        if (app.model) {
          const at = app.model.indexOf('/')
          try { await controller().selectModel({ sessionId: id, provider: app.model.slice(0, at), model: app.model.slice(at + 1) }) } catch { /* 选模失败退宿主默认 */ }
        }
        sessions.bind(appId, chatId, id, title, chatType)
        return { id, first: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!/belongs to "|records no cwd/.test(msg)) throw e
        sessions.reserve(appId, chatId, id, title)
      }
    }
    throw new Error('问答会话创建反复被拒（cwd 冲突），已重试 8 次')
  }

  // —— AI 追问（AskUserQuestion）→ Lark 交互卡片 ——
  // 挂起的追问：卡片消息 id / chatId 双索引（前者收按钮点按，后者收文字自由作答）。
  // 10 分钟没人点就取消回合（与回合超时同路：卡片锁「超时未作答」，会话收到失败答复）。
  const CARD_ASK_TIMEOUT_MS = 10 * 60_000

  interface PendingAsk {
    ch: NonNullable<ReturnType<ChannelFactory>>
    chatId: string
    sessionId: string
    questions: CardQuestion[]
    picked: Picked
    settled: Settled
    customs: Record<string, string>
    messageId: string
    /** 题卡就是问题的回复卡片（live）时：作答后切回思考中，不锁成「已作答」卡 */
    live?: LiveReply
    resolve(a: { answers: { id: string; selected: string[]; custom?: string }[] }): void
    reject(e: Error): void
    timer: any
    off(): void
  }
  const pendingByCard = new Map<string, PendingAsk>()
  const pendingByChat = new Map<string, PendingAsk>()

  const dropPending = (p: PendingAsk): void => {
    pendingByCard.delete(p.messageId)
    if (pendingByChat.get(p.chatId) === p) pendingByChat.delete(p.chatId)
    clearTimeout(p.timer)
    p.off()
  }
  const answerOf = (p: PendingAsk) => ({
    // custom 只在有文字作答时带（undefined 键会让宿主侧的形状校验多一个字段）
    answers: p.questions.map((q) => {
      const a: { id: string; selected: string[]; custom?: string } = { id: q.id, selected: p.settled[q.id] ?? [] }
      if (p.customs[q.id] !== undefined) a.custom = p.customs[q.id]
      return a
    }),
  })
  const allSettled = (p: PendingAsk) => p.questions.every((q) => p.settled[q.id] !== undefined)
  const finishPending = (p: PendingAsk, banner: string): void => {
    dropPending(p)
    p.resolve(answerOf(p))
    if (p.live) { p.live.resume(); return }
    void p.ch.updateCard(p.messageId, buildSettledCard(p.questions, p.settled, p.customs, banner)).catch((e) =>
      log.warn(`更新问答卡片失败：${e instanceof Error ? e.message : String(e)}`))
  }
  const refreshPending = (p: PendingAsk): void => {
    const card = buildAskCard(p.questions, p.picked, p.customs)
    if (p.live) { void p.live.updateAsk(card).catch(() => { /* 刷新勾选态失败不致命 */ }); return }
    void p.ch.updateCard(p.messageId, card).catch(() => { /* 刷新勾选态失败不致命 */ })
  }

  /** 按钮点按：单选点按即定稿；多选勾选/提交；全部定稿 → 答案回瀑布、卡片锁「已作答」 */
  const onCardAction = (a: CardAction): void => {
    const p = pendingByCard.get(a.messageId)
    if (!p) return
    const r = applyCardAction(p.questions, p.picked, a.value)
    if (!r) return
    p.picked = r.picked
    Object.assign(p.settled, r.settled)
    if (allSettled(p)) finishPending(p, '已作答')
    else refreshPending(p)
  }

  /** 文字自由作答：回填第一道未定稿的纯文字题（没有就第一道未定稿的题；selected 空、正文进 custom）；
   *  有按钮的题留给按钮，免得用户先回文字、再点按钮时文字占错题。全部定稿即收卡 */
  const takePendingText = (chatId: string, text: string): boolean => {
    const p = pendingByChat.get(chatId)
    if (!p) return false
    const open = p.questions.filter((x) => p.settled[x.id] === undefined)
    const q = open.find((x) => !x.options?.length) ?? open[0]
    if (!q) return false
    p.settled[q.id] = []
    p.customs[q.id] = text
    if (allSettled(p)) finishPending(p, '已作答')
    else refreshPending(p)
    return true
  }

  /** 通道整体重建/停用前：挂着的追问全部作废（旧通道已没法改卡片，别留僵尸） */
  const failPendings = (detail: string): void => {
    for (const p of [...pendingByCard.values()]) {
      dropPending(p)
      p.reject(new Error(detail))
    }
  }

  // 宿主 user-questions 瀑布：认领的判据是「这个会话是某个在册机器人的当前问答会话」，
  // 别人的问题（宿主界面里开的会话）原样 next() 交回。挂起期间回合不计超时；答案回去后
  // 剩余超时重置为整段（回合还要跑完）。
  const askViaCard = async (
    ch: NonNullable<ReturnType<ChannelFactory>>, chatId: string, sessionId: string, req: any, live?: LiveReply,
  ): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }> => {
    const questions: CardQuestion[] = (Array.isArray(req?.questions) ? req.questions : [])
      .map((q: any) => ({
        id: String(q?.id ?? ''), question: String(q?.question ?? ''),
        detail: q?.detail === undefined ? undefined : String(q.detail),
        header: q?.header === undefined ? undefined : String(q.header),
        multiSelect: !!q?.multiSelect,
        options: Array.isArray(q?.options) ? q.options.map((o: any) => ({ label: String(o?.label ?? ''), description: o?.description === undefined ? undefined : String(o.description) })) : undefined,
      }))
      .filter((q: CardQuestion) => q.id && q.question)
    turns.hold(sessionId)
    let resolve!: PendingAsk['resolve'], reject!: PendingAsk['reject']
    const answer = new Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>((res, rej) => { resolve = res; reject = rej })
    let p: PendingAsk | null = null
    try {
      // chatId 是会话键：话题里的会话带着根消息 id，卡片回进同一个话题，不冒到群主消息流
      // 有回复卡片（live）：把这张卡换成题卡，作答后切回思考中；换不成退回另发一张题卡
      let messageId = ''
      let viaLive: LiveReply | undefined
      if (live) {
        try { messageId = await live.ask(buildAskCard(questions, {})); viaLive = live } catch (e) {
          log.warn(`回复卡片换题卡失败，另发题卡：${e instanceof Error ? e.message : String(e)}`)
          live.resume()
        }
      }
      if (!messageId) {
        const where = parseConversationKey(chatId)
        messageId = (await ch.sendCard(where.chatId, buildAskCard(questions, {}), where.root || undefined)).messageId
      }
      p = { ch, chatId, sessionId, questions, picked: {}, settled: {}, customs: {}, messageId, ...(viaLive ? { live: viaLive } : {}), resolve, reject, timer: 0, off: () => {} }
      pendingByCard.set(p.messageId, p)
      pendingByChat.set(chatId, p)
      p.timer = setTimeout(() => {
        dropPending(p!)
        // live：回合被叫停后答题路径会把这张卡换成失败话术，这里不另写（免得两笔写入抢序）
        if (!p!.live) void p!.ch.updateCard(p!.messageId, buildSettledCard(questions, p!.settled, p!.customs, '超时未作答，本条已放弃')).catch(() => {})
        void cancel(sessionId)
        reject(new Error('问答卡片超时未作答'))
      }, CARD_ASK_TIMEOUT_MS)
      if (req?.signal) {
        const onAbort = () => {
          if (!pendingByCard.has(p!.messageId)) return
          dropPending(p!)
          if (!p!.live) void p!.ch.updateCard(p!.messageId, buildSettledCard(questions, p!.settled, p!.customs, '回合已中止')).catch(() => {})
          reject(new Error('问答卡片随回合中止'))
        }
        req.signal.addEventListener('abort', onAbort, { once: true })
        p.off = () => { try { req.signal.removeEventListener('abort', onAbort) } catch { /* 尽力而为 */ } }
      }
      return await answer
    } catch (e) {
      if (p) dropPending(p)
      throw e
    } finally {
      if (p) dropPending(p)
      turns.unhold(sessionId, ASK_TIMEOUT_MS)
    }
  }

  ctx.effect(() => (ctx as any).on('user-questions/request', async (req: any, next: () => Promise<any>) => {
    const sessionId = String(req?.agent?.id ?? '')
    if (sessionId) {
      for (const { ch, app, svc } of chans) {
        const rec = cfg.chats.list(app.appId).find((r) => r.current === sessionId)
        if (rec) return await askViaCard(ch, rec.chatId, sessionId, req, svc.live(rec.chatId))
      }
    }
    return await next()
  }, 'dsh-knowledge-brain.lark.ask'))

  // 首轮人设：不能单独排进 inbox——next-turn 排队的每一条都自成一回合（宿主 followup 语义：
  // 「the sole ordinary message of its own turn」），人设会先跑一轮、模型回一句「你好」。
  // 改成登记在这里，等问题所在回合的第一步进场（agent/pre-step）时插到问题前面，同一步进
  // 模型；进场即落进历史，之后的步骤与轮次不再插。回合没跑起来就被叫停，登记留着，下一问
  // 的第一步照样补上（这个会话还没见过人设）。键是 sessionId（agent 的键就是它）。
  const pendingPersona = new Map<string, string>()
  ctx.effect(() => (ctx as any).on('agent/pre-step', async (e: any, next: () => Promise<any>) => {
    const d = await next()
    const sid = String(e?.agent?.id ?? e?.agent?.session?.id ?? '')
    const persona = pendingPersona.get(sid)
    if (!persona || d?.kind !== 'enter' || !Array.isArray(d.messages)) return d
    const at = d.messages.findIndex((m: any) => m?.source?.kind === 'user')
    if (at < 0) return d
    pendingPersona.delete(sid)
    const context = createUserMessage({ content: [{ type: 'text', text: persona }], source: { kind: 'lark' } } as any)
    return { ...d, messages: [...d.messages.slice(0, at), context, ...d.messages.slice(at)] }
  }), 'dsh-knowledge-brain.lark.persona')

  // 发这一轮并等落盘。withoutInitiator：别把这轮记到当时碰巧开着的 DSH 界面用户头上。
  // 问题 source=user：宿主显示成用户气泡；人设（msg.context）登记给上面的 pre-step 插进同一步，
  // source=lark，宿主当注入上下文折叠显示
  const send = async (sessionId: string, msg: Outgoing): Promise<void> => {
    const { agent } = await controller().resolveAgent(sessionId)
    pinReadOnly(ctx, agent.session)
    if (msg.context) pendingPersona.set(sessionId, msg.context)
    const question = createUserMessage({ content: [{ type: 'text', text: msg.text }], source: { kind: 'user' } } as any)
    const drive = async () => {
      agent.followup(question)
      await (ctx as any).sessions.flush(agent.session)
    }
    const agents = (ctx as any).agents
    if (typeof agents?.withoutInitiator === 'function') await agents.withoutInitiator(drive)
    else await drive()
  }

  const cancel = async (sessionId: string): Promise<void> => {
    try { await controller().cancel({ sessionId }) } catch { /* 尽力而为 */ }
  }

  const restart = () => {
    const { ok, problems } = normalizeApps(cfg.apps())
    for (const p of problems) log.warn(`Lark 机器人配置问题：${p}`)
    // 签名里放 secret 的单向摘要而不是长度：Lark「重置密钥」是定长换值，按长度比对
    // 会漏掉轮换（旧 secret 已失效、连接假活）；sha256 不外露原文
    const sig = JSON.stringify(ok.map((a) => [a.appId, createHash('sha256').update(a.appSecret).digest('hex'), a.folder, a.model]))
    if (sig === lastSig) return
    lastSig = sig
    // 先拆旧：挂着的追问卡片全部作废（旧通道马上就停，没法再改卡），再全部下线重建
    failPendings('机器人配置已变更，追问卡片作废')
    for (const { ch } of chans) { void ch.stop().catch(() => {}) }
    chans = []
    // 删掉的机器人：映射清掉（DSH 会话本体保留，还能在宿主会话列表里找到）
    const keep = new Set(ok.map((a) => a.appId))
    for (const id of mountedApps) if (!keep.has(id)) cfg.chats.drop(id)
    mountedApps = keep
    if (!ok.length) { log.info('Lark 通道未连接：没有配置机器人'); return }
    for (const app of ok) void connect(app).catch(() => { /* 失败已记日志并摘掉自己；检测按钮可补连 */ })
  }

  // 来源解析器：一条通道一个（缓存跟着通道走，重连即刷新）。通道没实现查询就整条退最小来源
  const originOf = (ch: NonNullable<ReturnType<ChannelFactory>>) => {
    if (!ch.chatInfo || !ch.userName) return undefined
    const r = createOriginResolver({ chatInfo: (id) => ch.chatInfo!(id), userName: (id) => ch.userName!(id) })
    return (m: Incoming, question: string) => r.resolve({
      chatId: m.chatId, chatType: m.chatType, senderId: m.senderId ?? '', text: question,
      ...(m.threadId ? { threadId: m.threadId } : {}),
    })
  }

  // 一个机器人建一条通道：建 service、登记进 chans、起长连接。连上 resolve；失败记日志、
  // 摘掉自己这一条（其余机器人照常）再 reject。restart 与 reconnect 共用
  const connect = (app: AppEntry): Promise<void> => {
    const pseudo = appBinding(app)
    const ch = makeChannel({ appId: app.appId, appSecret: app.appSecret, warn: (m) => log.warn(m), info: (m) => log.info(m) })
    ch.onCardAction(onCardAction)
    const svc = createLarkService({
      appId: app.appId,
      bindings: () => [pseudo],   // 单兜底绑定：这个机器人答所有会话
      botOpenId: () => ch.botOpenId,
      botName: () => ch.botName ?? '',
      reply: (messageId, text, inThread, keys) => ch.reply(messageId, text, inThread, keys),
      // 通道能回卡片才走回复卡片（思考过程 → 答案原位替换）；否则照旧富文本
      ...(ch.replyCard ? {
        replyCard: (messageId: string, card: object, inThread?: boolean) => ch.replyCard!(messageId, card, inThread),
        updateCard: (messageId: string, card: object) => ch.updateCard(messageId, card),
      } : {}),
      ...(cfg.liveOpts ? { liveOpts: cfg.liveOpts } : {}),
      ask: {
        ensureSession: ensureSession(app),
        send,
        hub: turns,
        cancel,
      },
      sessions: cfg.chats,
      // 答案带图：一个机器人一个 resolver（image_key 只在本应用内有效；重连即新建，缺权限标记随之清掉）
      ...(ch.uploadImage ? {
        images: createImageResolver({
          locate: (rel) => inside(hub.dir(), rel, rel.startsWith('raw/') ? 'raw' : 'asset'),
          stat: (abs) => stat(abs),
          read: (abs) => readFile(abs),
          upload: (buf) => ch.uploadImage!(buf),
          warn: (m) => log.warn(m),
        }),
      } : {}),
      origin: originOf(ch),
      pendingText: takePendingText,
      warn: (m) => log.warn(m),
      info: (m) => log.info(m),
    })
    svc.start({
      onMessage: (h) => ch.onMessage(h),
      onChatNew: (h) => ch.onChatNew(h),
    })
    const entry = { app, ch, svc }
    chans.push(entry)
    // 代际守卫：整体重建后 chans 里已没有旧代条目（indexOf -1，迟到失败不动）；
    // 当代的失败摘掉自己那一条，其余机器人照常
    return ch.start().catch((e) => {
      log.error(`Lark 长连接失败（${app.appId}）：${e instanceof Error ? e.message : String(e)}`)
      const i = chans.indexOf(entry)
      if (i >= 0) chans.splice(i, 1)
      throw e
    })
  }

  // 补连只认已存配置里的机器人（凭证取存档，不用检测时的草稿）。启动那一下连接失败的机器人
  // 已被摘出 chans、不会自己重试，这里给它再起一条；还在 chans 里（连着或正在连）就不另起，
  // 免得同一 app_id 两条长连接分抢消息。同一 app_id 并发点检测共用一次在途的补连
  const inFlight = new Map<string, Promise<ReconnectResult>>()
  const reconnect = (appId: string): Promise<ReconnectResult> => {
    const app = normalizeApps(cfg.apps()).ok.find((a) => a.appId === appId)
    if (!app) return Promise.resolve({ saved: false, connected: false })
    const pending = inFlight.get(appId)
    if (pending) return pending
    if (chans.some((x) => x.app.appId === appId)) return Promise.resolve({ saved: true, connected: true, already: true })
    const p = connect(app).then(
      (): ReconnectResult => ({ saved: true, connected: true }),
      (e): ReconnectResult => ({ saved: true, connected: false, detail: e instanceof Error ? e.message : String(e) }),
    ).finally(() => inFlight.delete(appId))
    inFlight.set(appId, p)
    return p
  }

  restart()
  ctx.effect(() => () => {
    failPendings('插件停用，追问卡片作废')
    for (const { ch } of chans) void ch.stop().catch(() => {})
  }, 'dsh-knowledge-brain.lark')

  return { status, restart, reconnect }
}
