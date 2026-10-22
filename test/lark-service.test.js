import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLarkService } from '../src/lark/service.ts'
import { ChatSessions } from '../src/lark/chats.ts'
import { TurnHub } from '../src/lark/ask.ts'

// 通道接线层：Incoming 进来，走 askSession（假实现，ensure 顺手 bind 进会话映射，与真实现
// 同款）→ 答案回 Lark。钉死：去重/路由/群聊 @ 判定沿用 route/questionOf；每 chat 串行；
// 会话映射 touch/rotate；错误回复不炸、detail 进日志。

const BINDING = { name: 'cli-a', folder: '认知', chatId: '', model: '' }

const setup = (over = {}) => {
  const replies = []
  const asks = []
  const origins = []
  const logs = { warn: [], info: [] }
  const sessions = new ChatSessions({ load: () => ({}), save: () => {} }, () => Date.now())
  const hub = new TurnHub()
  let n = 0
  const ask = {
    // 仿真实 mount：ensure 懒建时把会话 bind 进映射（current=id，title 记序号）
    ensureSession: async (appId, chatId, chatType, origin) => {
      asks.push({ kind: 'ensure', appId, chatId, chatType })
      origins.push(origin)
      const id = `sid-${n}`
      const first = n === 0
      n += 1
      sessions.bind(appId, chatId, id, `会话 #${n}`, chatType)
      return { id, first }
    },
    send: async (id, msg) => asks.push({ kind: 'send', id, text: msg.text, ...(msg.context ? { context: msg.context } : {}) }),
    hub,
    cancel: async () => {},
    ...over.ask,
  }
  const svc = createLarkService({
    appId: 'cli_a',
    bindings: () => [BINDING],
    botOpenId: () => 'ou_bot',
    reply: async (messageId, text, inThread) => { replies.push({ messageId, text, ...(inThread ? { inThread } : {}) }) },
    ask,
    sessions,
    warn: (m) => logs.warn.push(m),
    info: (m) => logs.info.push(m),
    ...over.deps,
  })
  const msg = (m = {}) => ({ eventId: 'e1', chatId: 'oc_1', chatType: 'p2p', messageId: 'm1', messageType: 'text', text: '你好', mentionKeys: [], mentionOpenIds: [], ...m })
  return { svc, msg, replies, asks, origins, logs, sessions, hub }
}

// 让挂起的回合立刻出答案（直通 hub 上挂着的 waiter）
const finishTurn = (hub, id, text) => {
  hub.onStatus(id, true)
  if (text) hub.onEvent(id, { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: [text] }] } })
  hub.onStatus(id, false)
}
const drain = () => new Promise((r) => setTimeout(r, 0))

test('一条 p2p 文本：ensure/send/回复并 touch 会话映射（不加表情回复）', async () => {
  const { svc, msg, replies, asks, sessions, hub } = setup()
  svc.handle(msg())
  await drain()
  assert.deepEqual(asks[0], { kind: 'ensure', appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p' })
  assert.equal(asks[1].id, 'sid-0')
  assert.ok(asks[1].text.includes('你好'))
  finishTurn(hub, 'sid-0', '答：你好')
  await drain()
  assert.deepEqual(replies, [{ messageId: 'm1', text: '答：你好' }])
  const [row] = sessions.list('cli_a')
  assert.equal(row.chatId, 'oc_1')
  assert.equal(row.current, 'sid-0')
})

test('同一 event_id 重推只答一次；非文本与群聊没 @ 机器人都不答', async () => {
  const { svc, msg, replies, asks, hub } = setup()
  svc.handle(msg())
  svc.handle(msg())                                  // 重推（同 event_id）
  svc.handle(msg({ eventId: 'e2', messageType: 'image' }))
  svc.handle(msg({ eventId: 'e3', chatType: 'group', mentionOpenIds: ['ou_别的人'] }))
  await drain()
  assert.equal(asks.filter((a) => a.kind === 'ensure').length, 1, '只有第一条进了问答')
  finishTurn(hub, 'sid-0', '答')
  await drain()
  assert.equal(replies.length, 1)
})

test('忙时回「还在想」不排队；答完释放锁，下一条能进', async () => {
  const { svc, msg, replies, asks, hub } = setup()
  svc.handle(msg({ text: '第一问' }))
  svc.handle(msg({ eventId: 'e2', text: '第二问' }))
  await drain()
  assert.deepEqual(replies.map((r) => r.text), ['上一条还在想，稍等一下再问'])
  finishTurn(hub, 'sid-0', '答一')
  await drain()
  assert.equal(replies[1].text, '答一')
  svc.handle(msg({ eventId: 'e3', text: '第三问' }))
  await drain()
  assert.equal(asks.filter((a) => a.kind === 'ensure').length, 2, '锁已释放，第三问正常派发')
  finishTurn(hub, 'sid-1', '答三')
  await drain()
  assert.equal(replies[2].text, '答三')
})

test('ask error：回兜底文案并 warn detail；agent 出错同理', async () => {
  const e1 = setup({ ask: { ensureSession: async () => { throw new Error('会话服务没就绪') } } })
  e1.svc.handle(e1.msg())
  await drain()
  assert.equal(e1.replies[0].text, '这条没答上来，稍后再试')
  assert.ok(e1.logs.warn.some((m) => m.includes('会话服务没就绪')), 'detail 要进日志')

  const e2 = setup()
  e2.svc.handle(e2.msg())
  await drain()
  e2.hub.onStatus('sid-0', true)
  e2.hub.onError('sid-0', 'provider 挂了')
  await drain()
  assert.equal(e2.replies[0].text, '这条没答上来，稍后再试')
  assert.ok(e2.logs.warn.some((m) => m.includes('provider 挂了')))
})

test('归档回合：提示发送「新会话」，不再使用通用失败文案', async () => {
  const x = setup()
  x.svc.handle(x.msg())
  await drain()
  x.hub.onEvent('sid-0', { type: 'turn/end', data: { reason: { kind: 'blocked' } } })
  await drain()
  assert.equal(x.replies[0].text, '当前问答会话已归档，请发送「新会话」后再提问')
})

test('rotate：新会话事件把当前会话归档（无绑定 chat 无操作），下条消息开新会话', async () => {
  const { svc, msg, asks, sessions, logs, hub } = setup()
  svc.rotate('oc_未绑定', 'p2p')
  assert.equal(sessions.list('cli_a').length, 0, '没绑定的 chat 轮换不建记录')
  svc.handle(msg())
  await drain()
  finishTurn(hub, 'sid-0', '答')
  await drain()
  svc.rotate('oc_1', 'p2p')
  const [row] = sessions.list('cli_a')
  assert.equal(row.current, '', '当前会话被清空')
  assert.deepEqual(row.past, [{ id: 'sid-0', title: '会话 #1' }], '旧会话进 past')
  assert.ok(logs.info.some((m) => m.includes('Lark 新会话')), '轮换要留一条日志')
  svc.handle(msg({ eventId: 'e9', text: '新会话的第一问' }))
  await drain()
  const last = asks.filter((a) => a.kind === 'send').pop()
  assert.equal(last.id, 'sid-1', '轮换后新消息走新会话')
  assert.ok(last.text.includes('新会话的第一问'))
})

test('手动「新会话」指令：归档当前会话、回确认，不进问答；群聊没 @ 不当指令', async () => {
  const { svc, msg, replies, asks, sessions, hub } = setup()
  svc.handle(msg())
  await drain()
  finishTurn(hub, 'sid-0', '答')
  await drain()
  svc.handle(msg({ eventId: 'e2', text: '新会话' }))
  await drain()
  assert.deepEqual(replies.map((r) => r.text), ['答', '已准备好新会话，可以继续提问了'])
  assert.equal(asks.filter((a) => a.kind === 'ensure').length, 1, '指令不进问答')
  const [row] = sessions.list('cli_a')
  assert.equal(row.current, '', '当前会话被清空')
  assert.deepEqual(row.past, [{ id: 'sid-0', title: '会话 #1' }], '旧会话进 past')
  svc.handle(msg({ eventId: 'e3', text: '下一题' }))
  await drain()
  const last = asks.filter((a) => a.kind === 'send').pop()
  assert.equal(last.id, 'sid-1', '下条消息开新会话')
  svc.handle(msg({ eventId: 'e4', chatType: 'group', text: '新会话', mentionOpenIds: ['ou_别的人'] }))
  await drain()
  assert.equal(replies.length, 2, '群聊没 @ 机器人不算指令')
})

test('start：把 handle/rotate 分别接进 onMessage/onChatNew', () => {
  const { svc, msg, replies } = setup()
  let onM = null, onN = null
  svc.start({ onMessage: (h) => { onM = h }, onChatNew: (h) => { onN = h } })
  assert.equal(typeof onM, 'function')
  assert.equal(typeof onN, 'function')
  onN({ chatId: 'oc_1', chatType: 'p2p' })
  onM(msg({ text: 'x' }))
  assert.equal(replies.length, 0, '还在等答案，未回复')
})


// 话题：新话题不 @ 也答、回进话题；话题内追问（@ 了）回到同一个会话；两个话题各一个会话、
// 互不占锁（一个在答时另一个照答）；回复都带 inThread
test('话题：新话题直接答并回进话题，追问同会话，两个话题互不占锁', async () => {
  const { svc, msg, replies, asks, hub, sessions } = setup()
  const G = (o) => msg({ chatType: 'group', ...o })
  svc.handle(G({ eventId: 'e1', messageId: 'om_a', threadId: 'omt_a', text: '报销怎么走' }))
  svc.handle(G({ eventId: 'e2', messageId: 'om_b', threadId: 'omt_b', text: '请假怎么走' }))
  await drain()
  const ensures = asks.filter((x) => x.kind === 'ensure')
  assert.deepEqual(ensures.map((x) => x.chatId), ['oc_1#om_a', 'oc_1#om_b'], '两个话题各建一个会话，第二个没被「还在想」挡掉')
  assert.equal(replies.length, 0, '都还在答')
  finishTurn(hub, 'sid-0', '答 A')
  finishTurn(hub, 'sid-1', '答 B')
  await drain()
  assert.deepEqual(replies, [
    { messageId: 'om_a', text: '答 A', inThread: true },
    { messageId: 'om_b', text: '答 B', inThread: true },
  ])
  // 话题 A 里 @ 机器人追问：回到 sid-0，不新建
  svc.handle(G({ eventId: 'e3', messageId: 'om_a2', threadId: 'omt_a', rootId: 'om_a', text: '@_user_1 那差旅呢', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_bot'] }))
  await drain()
  // ensure 每问都调（复用在真 mount 里按键查映射）；这里钉的是追问带的键 = 话题 A 的键
  assert.equal(asks.filter((x) => x.kind === 'ensure').at(-1).chatId, 'oc_1#om_a', '追问落回话题 A 的会话键')
  assert.equal(sessions.list('cli_a').filter((r) => r.chatId.startsWith('oc_1#')).length, 2, '仍只有两个话题会话')
  // 话题 A 里不 @ 的追问：静默
  svc.handle(G({ eventId: 'e4', messageId: 'om_a3', threadId: 'omt_a', rootId: 'om_a', text: '谢谢' }))
  await drain()
  assert.equal(asks.filter((x) => x.kind === 'send').length, 3, '只多了 @ 的那一条')
})

test('话题外照旧：普通群不 @ 不答，单聊回复不带 inThread', async () => {
  const { svc, msg, replies, asks, hub } = setup()
  svc.handle(msg({ chatType: 'group', eventId: 'e1', text: '大家好' }))
  await drain()
  assert.equal(asks.length, 0)
  svc.handle(msg({ eventId: 'e2' }))
  await drain()
  finishTurn(hub, 'sid-0', '你好')
  await drain()
  assert.deepEqual(replies, [{ messageId: 'm1', text: '你好' }])
})

test('机器人名一路带进首轮人设上下文；取不到用默认名', async () => {
  for (const [name, want] of [['小招', '「小招」'], ['', '「知识问答Agent」']]) {
    const { svc, msg, asks, hub } = setup({ deps: { botName: () => name } })
    svc.handle(msg())
    await drain()
    const sent = asks.find((a) => a.kind === 'send')
    assert.ok(sent.context.includes(want), `首轮人设上下文要带 ${want}`)
    finishTurn(hub, 'sid-0', '好')
    await drain()
  }
})

test('来源：注入的解析器拿到剥净的问题；群聊问题带提问人前缀，来源透传给建会话', async () => {
  const seen = []
  const origin = async (m, q) => { seen.push({ chatId: m.chatId, q }); return { kind: 'group', chatName: '产品群', asker: '张三', topic: '' } }
  const { svc, msg, asks, origins, hub } = setup({ deps: { origin } })
  svc.handle(msg({ chatType: 'group', text: '@_user_1 报销怎么走', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_bot'], senderId: 'ou_u' }))
  await drain()
  assert.deepEqual(seen, [{ chatId: 'oc_1', q: '报销怎么走' }])
  assert.deepEqual(origins[0], { kind: 'group', chatName: '产品群', asker: '张三', topic: '' })
  assert.equal(asks[1].text, '张三：报销怎么走')
  assert.ok(asks[1].context, '首轮带人设上下文')
  finishTurn(hub, 'sid-0', 'ok')
  await drain()
})

test('来源：没注入解析器 / 解析抛错都退最小来源（按 chatType，open_id 短码），照常答', async () => {
  const a = setup()
  a.svc.handle(a.msg({ senderId: 'ou_abcdef123456' }))
  await drain()
  assert.deepEqual(a.origins[0], { kind: 'p2p', chatName: '', asker: '用户123456', topic: '' })
  assert.equal(a.asks[1].text, '你好', '单聊不加前缀')
  finishTurn(a.hub, 'sid-0', 'ok')

  const b = setup({ deps: { origin: async () => { throw new Error('boom') } } })
  b.svc.handle(b.msg({ chatType: 'group', threadId: 't1', mentionOpenIds: ['ou_bot'], senderId: 'ou_abcdef123456' }))
  await drain()
  assert.deepEqual(b.origins[0], { kind: 'thread', chatName: '', asker: '用户123456', topic: '你好' })
  assert.ok(b.logs.warn.some((m) => /来源解析失败.*boom/.test(m)))
  finishTurn(b.hub, 'sid-0', 'ok')
  await drain()
})

// 卡片回复：通道给了 replyCard/updateCard 就走 LiveReply（思考卡 → 答案卡），否则照旧富文本
const cardDeps = (cards) => ({
  replyCard: async (messageId, card, inThread) => { const id = `om_c${cards.length + 1}`; cards.push({ op: 'send', messageId, id, card, ...(inThread ? { inThread } : {}) }); return id },
  updateCard: async (id, card) => { cards.push({ op: 'update', id, card }) },
  liveOpts: { delayMs: 20, throttleMs: 5, heartbeatMs: 1_000 },
})

test('卡片回复：慢答出思考卡、步骤刷卡、收场原位换答案；不再发富文本', async () => {
  const cards = []
  const { svc, msg, replies, hub } = setup({ deps: cardDeps(cards) })
  svc.handle(msg())
  await drain()
  assert.ok(svc.live('oc_1'), '答题期间能按会话键找到回复卡片')
  hub.onStatus('sid-0', true)
  hub.onEvent('sid-0', { type: 'tool/call', data: { name: 'wiki_search', arguments: '{"query":"报销"}' } })
  await new Promise((r) => setTimeout(r, 35))
  assert.equal(cards[0].op, 'send')
  assert.equal(cards[0].messageId, 'm1', '卡片是对提问消息的回复')
  assert.match(JSON.stringify(cards[0].card), /检索：报销/)
  hub.onEvent('sid-0', { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['答案在此'] }] } })
  hub.onStatus('sid-0', false)
  await new Promise((r) => setTimeout(r, 10))
  const last = cards.at(-1)
  assert.equal(last.op, 'update')
  assert.equal(last.id, cards[0].id)
  assert.match(JSON.stringify(last.card), /答案在此/)
  assert.deepEqual(replies, [], '卡片路通时不再另发富文本')
  assert.equal(svc.live('oc_1'), undefined, '收场后摘掉')
})

test('卡片回复：快答直接一张答案卡；失败换失败话术；话题里卡片回进话题', async () => {
  const cards = []
  const { svc, msg, hub } = setup({ deps: cardDeps(cards) })
  svc.handle(msg({ chatType: 'group', threadId: 't1', mentionOpenIds: ['ou_bot'] }))
  await drain()
  finishTurn(hub, 'sid-0', '快答')
  await drain()
  assert.equal(cards.length, 1)
  assert.equal(cards[0].op, 'send')
  assert.equal(cards[0].inThread, true)
  assert.match(JSON.stringify(cards[0].card), /快答/)

  const cards2 = []
  const b = setup({ deps: cardDeps(cards2), ask: { send: async () => { throw new Error('连接没就绪') } } })
  b.svc.handle(b.msg())
  await drain()
  await drain()
  assert.match(JSON.stringify(cards2.at(-1).card), /这条没答上来/)
})

// 答案带图：ok 收场前过 images.resolve，keys 进答案卡 / 富文本；resolve 抛错不挡答案；失败话术不解析
test('答案带图：卡片路答案卡出 img；富文本路 reply 带 keys', async () => {
  const keys = new Map([['asset/a.png', 'img_a']])
  const seen = []
  const images = { resolve: async (md) => { seen.push(md); return keys } }

  const cards = []
  const a = setup({ deps: { ...cardDeps(cards), images } })
  a.svc.handle(a.msg())
  await drain()
  finishTurn(a.hub, 'sid-0', '见图 ![流程](asset/a.png)')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(seen, ['见图 ![流程](asset/a.png)'])
  assert.match(JSON.stringify(cards.at(-1).card), /"img_key":"img_a"/)

  const got = []
  const b = setup({ deps: { images, reply: async (messageId, text, inThread, k) => { got.push({ text, k }) } } })
  b.svc.handle(b.msg())
  await drain()
  finishTurn(b.hub, 'sid-0', '![流程](asset/a.png)')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(got[0].k, keys)
})

test('答案带图：resolve 抛错照发答案（图退链接）并记 warn；失败话术不解析图', async () => {
  const cards = []
  const a = setup({ deps: { ...cardDeps(cards), images: { resolve: async () => { throw new Error('炸了') } } } })
  a.svc.handle(a.msg())
  await drain()
  finishTurn(a.hub, 'sid-0', '答案 ![x](asset/a.png)')
  await new Promise((r) => setTimeout(r, 10))
  assert.match(JSON.stringify(cards.at(-1).card), /答案/)
  assert.ok(a.logs.warn.some((m) => /炸了/.test(m)))

  let called = 0
  const cards2 = []
  const b = setup({ deps: { ...cardDeps(cards2), images: { resolve: async () => { called++; return new Map() } } }, ask: { send: async () => { throw new Error('连接没就绪') } } })
  b.svc.handle(b.msg())
  await drain()
  await drain()
  assert.equal(called, 0)
})

test('答案带图：带 keys 的富文本发送失败，去掉图再发一次（答案不丢）', async () => {
  const keys = new Map([['asset/a.png', 'img_bad']])
  const got = []
  const b = setup({ deps: {
    images: { resolve: async () => keys },
    reply: async (messageId, text, inThread, k) => { if (k?.size) throw new Error('invalid image_key'); got.push(text) },
  } })
  b.svc.handle(b.msg())
  await drain()
  finishTurn(b.hub, 'sid-0', '答案 ![x](asset/a.png)')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(got, ['答案 ![x](asset/a.png)'])
  assert.ok(b.logs.warn.some((m) => /invalid image_key/.test(m)))
})
