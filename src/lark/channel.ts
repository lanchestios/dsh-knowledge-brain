// Lark 长连接通道（SDK 高层 createLarkChannel）：收 im.message.receive_v1（SDK 归一成
// NormalizedMessage，这里再折成 Incoming）、card.action.trigger（交互卡片按钮回传 →
// onCardAction）、im.chat.member.bot.added_v1（进群 → onChatNew）。卡片回传要求 Lark 后台
// 「事件与回调 → 卡片回传交互」选长连接接收（配置引导有这一步）。
// 已知取舍：高层通道的事件表没有 p2p.chat_create（单聊首聊），单聊没有平台侧新会话事件；
// 手动轮换由 service 层承担（整条消息发「新会话」即归档当前会话，单聊群聊都能用），群聊
// 进群轮换不受影响。SDK 细节不出这个文件，单测不碰。
import { Client, createLarkChannel, AppType, LoggerLevel } from '@larksuiteoapi/node-sdk'
import type { Incoming } from './route.js'
import { toLarkPost, type ImageKeys } from './post.js'

export interface ChatNewEvent { chatId: string; chatType: 'p2p' | 'group' }

/** 卡片按钮回传（SDK 归一后只留我们要的字段；value 是按钮 value 原样带回） */
export interface CardAction { messageId: string; chatId: string; value: unknown }

export interface Channel {
  onMessage(h: (m: Incoming) => void): void
  onChatNew(h: (e: ChatNewEvent) => void): void
  onCardAction(h: (a: CardAction) => void): void
  /** 回文消息（问答答案走这里） */
  reply(messageId: string, text: string, inThread?: boolean): Promise<void>
  /** 卡片作为对提问消息的回复发出（问答的回复卡片：思考中 → 答案），得卡片消息 id */
  replyCard?(messageId: string, card: object, inThread?: boolean): Promise<string>
  /** 发交互卡片（AI 追问的选择题），得卡片消息 id */
  sendCard(chatId: string, card: object, threadRoot?: string): Promise<{ messageId: string }>
  /** 原地改卡片（锁定已选/取消态） */
  updateCard(messageId: string, card: object): Promise<void>
  /** 来源查询（会话标题、提问人名字）；没有的实现整条退最小来源 */
  chatInfo?(chatId: string): Promise<{ name: string; mode: string }>
  userName?(openId: string): Promise<string>
  start(): Promise<void>
  stop(): Promise<void>
  botOpenId: string | null
  /** 机器人名字（连接后从 /bot/v3/info 取；设置卡卡头显示用，取不到为空） */
  botName?: string
}

// —— 保存前验证草稿凭证（设置卡「检测」按钮）——SDK 细节同样不出这个文件 ——

/** missing：已发布版本里没授权的权限（按 level 排：required 缺了就判不通过）；
 *  scopeError：授权状态查不到（接口失败），权限一项没核对 */
export interface VerifyResult {
  ok: boolean; botName?: string; detail?: string
  missing?: { scope: string; label: string; level: ScopeLevel }[]
  scopeError?: string
}

// 问答通道用到的权限：required 缺了就答不了；group 缺了群里 @ 收不到；optional 缺了只少一项功能。
// 名字取飞书开放平台权限码（设置卡照原样列出，便于到「权限管理」里搜）
export type ScopeLevel = 'required' | 'group' | 'optional'
export const LARK_SCOPES: { scope: string; label: string; level: ScopeLevel }[] = [
  { scope: 'im:message:send_as_bot', label: '以应用身份发消息（回复、追问卡片）', level: 'required' },
  { scope: 'im:message.p2p_msg:readonly', label: '读取用户发给机器人的单聊消息', level: 'required' },
  { scope: 'im:resource', label: '上传图片（答案里的图直接显示）', level: 'required' },
  { scope: 'im:message.group_at_msg:readonly', label: '接收群聊中 @ 机器人的消息', level: 'group' },
  { scope: 'im:message.group_msg', label: '获取群组中所有消息（群里新开话题不 @ 也答）', level: 'optional' },
  { scope: 'im:chat:readonly', label: '读取群名与群类型（会话标题分普通群/话题群）', level: 'optional' },
  { scope: 'contact:contact.base:readonly', label: '读取提问人名字（会话标题、群聊问题前缀；人要在通讯录可见范围内）', level: 'optional' },
]

// 授权状态：/application/v6/scopes 列出当前已发布版本申请的权限，grant_status=1 为已授权；
// 没列出的就是没申请（或申请了还没发布版本）。只看 tenant 身份（机器人用应用身份调）
async function missingScopes(client: LarkClient): Promise<VerifyResult['missing']> {
  const r: any = await client.request({ method: 'GET', url: '/open-apis/application/v6/scopes' })
  if (r?.code !== undefined && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `：${r.msg}` : ''}`)
  const list: any[] = r?.data?.scopes ?? r?.scopes ?? []
  const granted = new Set(list.filter((x) => x?.scope_type !== 'user' && x?.grant_status === 1).map((x) => String(x.scope_name)))
  return LARK_SCOPES.filter((s) => !granted.has(s.scope))
}

type LarkClient = { request(o: { method: string; url: string }): Promise<any> }

const makeLarkClient = (appId: string, appSecret: string): LarkClient =>
  new Client({ appId, appSecret, appType: AppType.SelfBuild, loggerLevel: LoggerLevel.error } as any) as any

// secret 类错误的特征：取 token 失败（99991663 密钥不匹配等）。命中就归类成中文提示并保留原文
const BAD_SECRET = /99991663|app_secret|tenant_access_token|app_access_token/i

/** /bot/v3/info 响应 → { openId, name }：响应体的 bot 挂在顶层（宽容兼容 data.bot）；
 *  名字 bot_name / app_name 都认（不同版本字段不同），取不到给空串。start 和 verify 共用 */
export function parseBotInfo(r: any): { openId: string | null; name: string } {
  const bot = r?.bot ?? r?.data?.bot
  return { openId: bot?.open_id ? String(bot.open_id) : null, name: String(bot?.bot_name ?? bot?.app_name ?? '') }
}

/** 临时 Client 打 /bot/v3/info：secret 错在取 tenant_access_token 时就抛；凭证对但应用
 *  没加「机器人」能力则取不到 bot。凭证与机器人能力都过了再核对权限：缺 required 判不通过，
 *  其余缺项只列出来；授权状态查不到不拦（记 scopeError）。结果绝不含 secret。 */
export async function verifyApp(
  appId: string, appSecret: string,
  makeClient: (appId: string, appSecret: string) => LarkClient = makeLarkClient,
): Promise<VerifyResult> {
  if (!appId.trim() || !appSecret.trim()) return { ok: false, detail: 'app_id 和 app_secret 都要填' }
  try {
    const client = makeClient(appId, appSecret)
    const r: any = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' })
    const { openId, name } = parseBotInfo(r)
    if (!openId) return { ok: false, detail: '应用未添加「机器人」能力——去Lark开放平台 → 应用能力 → 添加机器人' }
    const botName = name || '机器人'
    let missing: NonNullable<VerifyResult['missing']>
    try { missing = (await missingScopes(client)) ?? [] } catch (e) {
      return { ok: true, botName, scopeError: e instanceof Error ? e.message : String(e) }
    }
    const lacksRequired = missing.some((m) => m.level === 'required')
    return {
      ok: !lacksRequired, botName,
      ...(missing.length ? { missing } : {}),
      ...(lacksRequired ? { detail: '缺少必需权限——去开放平台 → 权限管理开通后，创建版本并发布' } : {}),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, detail: BAD_SECRET.test(msg) ? `app_id 或 app_secret 不对：${msg}` : msg }
  }
}

export class LarkChannel implements Channel {
  private handler: ((m: Incoming) => void) | null = null
  private newHandler: ((e: ChatNewEvent) => void) | null = null
  private cardHandler: ((a: CardAction) => void) | null = null
  private inner: any = null
  private stopped = false
  botOpenId: string | null = null
  /** 机器人名字（连接后从 /bot/v3/info 取；设置卡卡头显示用，取不到为空） */
  botName = ''

  constructor(private cfg: { appId: string; appSecret: string; warn: (m: string) => void; info: (m: string) => void }) {}

  onMessage(h: (m: Incoming) => void): void { this.handler = h }
  onChatNew(h: (e: ChatNewEvent) => void): void { this.newHandler = h }
  onCardAction(h: (a: CardAction) => void): void { this.cardHandler = h }

  async start(): Promise<void> {
    const { appId, appSecret } = this.cfg
    // requireMention 关掉：群聊该不该答由 route.questionOf 统一判定（唯一判定点，别让 SDK 的
    // 策略层先挡一道）；includeRawEvent 拿 event_id 做去重（归一消息本体不带，见 dispatch）
    const inner = this.inner = createLarkChannel({
      appId, appSecret, loggerLevel: LoggerLevel.error, includeRawEvent: true,
      policy: { requireMention: false, respondToMentionAll: true },
    } as any)
    inner.on({
      message: (m: any) => this.dispatch(m),
      cardAction: (e: any) => this.cardHandler?.({
        messageId: String(e?.messageId ?? ''), chatId: String(e?.chatId ?? ''), value: e?.action?.value,
      }),
      botAdded: (e: any) => { if (e?.chatId) this.newHandler?.({ chatId: String(e.chatId), chatType: 'group' }) },
      error: (e: any) => this.cfg.warn(`Lark 通道错误：${e instanceof Error ? e.message : String(e)}`),
    })
    // stop 可能在任一 await 间隙到来（config 连改两次）：续体各查一次 stopped，
    // 不许把连接建成无人引用、无人能停的幽灵
    await inner.connect()
    if (this.stopped) { try { await inner.disconnect() } catch { /* 尽力而为 */ } return }
    const id = inner.botIdentity
    this.botOpenId = id?.openId ?? null
    this.botName = id?.name ?? ''
    if (!this.botOpenId) {
      // 高层通道 connect 内部会取机器人身份，这里只是兜底：真取不到只影响群聊判定，单聊照常
      try {
        const r = await inner.rawClient.request({ method: 'GET', url: '/open-apis/bot/v3/info' })
        const { openId, name } = parseBotInfo(r)
        this.botOpenId = openId
        if (!this.botName) this.botName = name
      } catch (e) { this.cfg.warn(`取机器人 open_id 失败（群聊暂不答）：${e instanceof Error ? e.message : String(e)}`) }
    }
    if (this.stopped) { try { await inner.disconnect() } catch { /* 尽力而为 */ } return }
    this.cfg.info('Lark长连接已建立')
  }

  async stop(): Promise<void> {
    this.stopped = true
    try { await this.inner?.disconnect() } catch { /* 尽力而为 */ }
  }

  // inThread：回进话题（reply_in_thread），否则在群主消息流里引用回复；keys：答案里已上传的图
  async reply(messageId: string, text: string, inThread = false, keys?: ImageKeys): Promise<void> {
    await this.inner.rawClient.im.v1.message.reply({
      path: { message_id: messageId },
      data: { content: JSON.stringify(toLarkPost(text, keys)), msg_type: 'post', ...(inThread ? { reply_in_thread: true } : {}) },
    })
  }

  async replyCard(messageId: string, card: object, inThread = false): Promise<string> {
    const r: any = await this.inner.rawClient.im.v1.message.reply({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card), msg_type: 'interactive', ...(inThread ? { reply_in_thread: true } : {}) },
    })
    if (r?.code !== undefined && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `：${r.msg}` : ''}`)
    const id = String(r?.data?.message_id ?? '')
    if (!id) throw new Error('回复卡片未返回 message_id')
    return id
  }

  // 答案里的图先传成 image_key（需应用权限 im:resource）。SDK 对 code≠0 多是抛 axios 错，
  // 飞书错误码在 response.data 里——统一挂到 err.code，images.ts 据此认缺权限
  async uploadImage(buf: Buffer): Promise<string> {
    let r: any
    try {
      r = await this.inner.rawClient.im.v1.image.create({ data: { image_type: 'message', image: buf } })
    } catch (e: any) {
      const d = e?.response?.data
      throw Object.assign(new Error(d?.msg ? `code ${d.code}：${d.msg}` : (e?.message ?? String(e))), { code: d?.code ?? e?.code })
    }
    if (r?.code !== undefined && r.code !== 0) throw Object.assign(new Error(`code ${r.code}${r?.msg ? `：${r.msg}` : ''}`), { code: r.code })
    const key = String(r?.image_key ?? r?.data?.image_key ?? '')
    if (!key) throw new Error('上传图片未返回 image_key')
    return key
  }


  // threadRoot：话题里的追问卡片回到这条根消息的话题里；不给则发到 chat 主消息流
  async sendCard(chatId: string, card: object, threadRoot?: string): Promise<{ messageId: string }> {
    const r = await this.inner.send(chatId, { card }, threadRoot ? { replyTo: threadRoot, replyInThread: true } : undefined)
    return { messageId: String(r?.messageId ?? '') }
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    await this.inner.updateCard(messageId, card)
  }

  // —— 来源查询（origin.ts 的 lookup 实现；缓存与降级在 origin 解析器里）——
  // 都走 rawClient.request：失败抛出，code≠0 也当失败（没开权限是最常见的 code）

  private async api(url: string, params?: Record<string, string>): Promise<any> {
    const r: any = await this.inner.rawClient.request({ method: 'GET', url, ...(params ? { params } : {}) })
    if (r?.code !== undefined && r.code !== 0) throw new Error(`code ${r.code}${r?.msg ? `：${r.msg}` : ''}`)
    return r?.data ?? {}
  }

  /** 群名与 chat_mode（p2p / group / topic） */
  async chatInfo(chatId: string): Promise<{ name: string; mode: string }> {
    const d = await this.api(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`)
    return { name: String(d?.name ?? ''), mode: String(d?.chat_mode ?? '') }
  }

  /** 通讯录里的名字：应用身份调要 contact:contact.base:readonly（只开 contact:user.base:readonly 报 99991672），
   *  且这个人在应用的通讯录可见范围里。不翻群成员：大群翻不完，名字统一靠通讯录 */
  async userName(openId: string): Promise<string> {
    const d = await this.api(`/open-apis/contact/v3/users/${encodeURIComponent(openId)}`, { user_id_type: 'open_id' })
    return String(d?.user?.name ?? '')
  }

  /** SDK 归一消息 → Incoming。归一已剥掉 @机器人 占位、mentions 带 key/openId；
   *  event_id 不在消息本体里，includeRawEvent 挂在 raw 上（SDK 事件体被摊平，在顶层） */
  private dispatch(m: any): void {
    const mentions: any[] = Array.isArray(m?.mentions) ? m.mentions : []
    this.handler?.({
      eventId: String(m?.raw?.event_id ?? m?.raw?.header?.event_id ?? ''),
      chatId: String(m?.chatId ?? ''),
      chatType: m?.chatType === 'group' ? 'group' : 'p2p',
      messageId: String(m?.messageId ?? ''),
      ...(m?.senderId ? { senderId: String(m.senderId) } : {}),
      messageType: String(m?.rawContentType ?? ''),
      text: String(m?.content ?? ''),
      mentionKeys: mentions.map((x) => String(x?.key ?? '')).filter(Boolean),
      mentionOpenIds: mentions.map((x) => String(x?.openId ?? '')).filter(Boolean),
      // 话题字段只在话题里的消息上带（不在话题里不出这两个键）
      ...(m?.threadId ? { threadId: String(m.threadId) } : {}),
      ...(m?.rootId ? { rootId: String(m.rootId) } : {}),
    })
  }
}
