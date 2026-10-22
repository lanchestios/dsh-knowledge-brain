import { test } from 'vitest'
import assert from 'node:assert/strict'
import { firstMessage, truncate, textOfStream, TurnWaiter, TurnHub, askSession, ASK_TIMEOUT_MS } from '../src/lark/ask.ts'
import { PERSONA } from '../src/lark/persona.ts'

// 会话式问答的纯件：流文本抽取、回合等待器/中枢、askSession 编排（依赖全假）。

test('firstMessage：人设（带机器人名）作上下文，问题单独一条', () => {
  const f = firstMessage('认知', '什么是注意力', '小知')
  assert.ok(f.context.startsWith(PERSONA('认知', '小知')))
  assert.match(f.context, /「名字：」是提问人/, '人设说明群聊前缀')
  assert.equal(f.text, '什么是注意力')
})

test('askSession：群聊问题带提问人前缀（首轮与续轮都带）', async () => {
  const hub = new TurnHub()
  const sent = []
  let first = true
  const d = {
    ensureSession: async () => { const r = { id: 'g', first }; first = false; return r },
    send: async (_id, msg) => { sent.push(msg) },
    hub, cancel: async () => {},
  }
  const origin = { kind: 'group', chatName: 'G', asker: '李四', topic: '' }
  for (const q of ['第一问', '第二问']) {
    const p = askSession(d, { appId: 'a', chatId: 'oc_g', chatType: 'group', origin, folder: '认知', question: q })
    await new Promise((r) => setTimeout(r, 0))
    hub.onStatus('g', true); hub.onStatus('g', false)
    await p
  }
  assert.equal(sent[0].text, '李四：第一问')
  assert.ok(sent[0].context)
  assert.deepEqual(sent[1], { text: '李四：第二问' })
})

test('truncate 超 4000 截断并注明', () => {
  const s = '长'.repeat(4100)
  const t = truncate(s)
  assert.equal(t.length, '长'.repeat(4000).length + '\n\n（超长已截断）'.length)
  assert.ok(t.endsWith('（超长已截断）'))
  assert.equal(truncate('短'), '短')
})

test('textOfStream：打包 text-chunks 与原始 text-delta 都计，reasoning/工具块不计', () => {
  const stream = [
    { type: 'text-chunks', texts: ['注意力是', '一种机制'] },
    { type: 'reasoning-chunks', texts: ['（不该计入）'] },
    { type: 'chunk', chunk: { type: 'text-delta', text: '，用于加权' } },
    { type: 'chunk', chunk: { type: 'tool-call-delta', argumentsDelta: '{"q":1}' } },
    { type: 'tool-call-chunks', args: ['x'] },
    { type: 'chunk', chunk: { type: 'reasoning-delta', text: '（也不计）' } },
  ]
  assert.equal(textOfStream(stream), '注意力是一种机制，用于加权')
  assert.equal(textOfStream(undefined), '')
  assert.equal(textOfStream('不是数组'), '')
})

test('TurnWaiter：armed 前的 idle 不收场；回合内多条 assistant 取最后一条非空；结束给答案', async () => {
  const w = new TurnWaiter('s1')
  w.running(false)                       // 启动前的空闲：忽略
  w.event({ type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['先查一下'] }] } })
  let settled = false
  w.done.then(() => { settled = true })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(settled, false, '还没见过 running，不许收场')
  w.running(true)                        // 回合开始
  w.event({ type: 'tool/result', data: {} })
  w.event({ type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['最终答案'] }] } })
  w.running(false)                       // 回合结束
  assert.deepEqual(await w.done, { status: 'ok', text: '最终答案' })
})

test('TurnWaiter：回合结束仍无文本 → error；agent/error → error；空文本的中间消息不算', async () => {
  const a = new TurnWaiter('s1')
  a.running(true)
  a.event({ type: 'assistant/message', data: { stream: [] } })   // 空 stream
  a.running(false)
  assert.deepEqual(await a.done, { status: 'error', detail: '回合结束但没有文本输出' })

  const b = new TurnWaiter('s2')
  b.running(true)
  b.fail('provider 挂了')
  assert.deepEqual(await b.done, { status: 'error', detail: 'provider 挂了' })
  b.running(false)                                                // 收场后的事件不再改结果
})

test('TurnWaiter：turn/end blocked 立即返回 blocked，后续 idle 不覆盖结果', async () => {
  const w = new TurnWaiter('s1')
  w.event({ type: 'turn/end', data: { turn: 2, reason: { kind: 'blocked' } } })
  w.running(false)
  assert.deepEqual(await w.done, { status: 'blocked' })
})

test('TurnHub：按 sessionId 扇出，wait 超时回 timeout，fail 能把等待中的回合改成 error', async () => {
  const hub = new TurnHub()
  const p = hub.wait('s1', 30)
  hub.onStatus('别的会话', true)
  hub.onStatus('s1', true)
  hub.onEvent('s1', { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['答'] }] } })
  hub.onStatus('s1', false)
  assert.deepEqual(await p, { status: 'ok', text: '答' })

  const t = hub.wait('s2', 20)
  assert.deepEqual(await t, { status: 'timeout' })

  const e = hub.wait('s3', 5_000)
  hub.fail('s3', '派发失败：连接断了')
  assert.deepEqual(await e, { status: 'error', detail: '派发失败：连接断了' })
})

const P2P = { kind: 'p2p', chatName: '', asker: '张三', topic: '' }

// askSession 编排：假 deps 钉死四件事——首条带 PERSONA、续用会话只发问题、超时叫停、失败带 detail
const deps = (over = {}) => {
  const calls = { ensure: [], send: [], cancel: 0 }
  const hub = new TurnHub()
  const d = {
    ensureSession: async (appId, chatId, chatType, origin) => { calls.ensure.push({ appId, chatId, chatType, origin }); return over.id ? { id: over.id, first: over.first ?? false } : { id: 'sid-0', first: true } },
    send: async (id, msg) => { calls.send.push({ id, ...msg }) },
    hub,
    cancel: async () => { calls.cancel += 1 },
    ...over.extra,
  }
  return { d: { ...d, ...over.deps }, calls, hub }
}

test('askSession：新会话首条=PERSONA+问题；会话事件进来后给答案', async () => {
  const { d, calls, hub } = deps()
  const p = askSession(d, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: '什么是知识', botName: '小知' })
  await new Promise((r) => setTimeout(r, 0))     // ensure+send 完成、waiter 已挂
  assert.equal(calls.ensure.length, 1)
  assert.equal(calls.send.length, 1)
  assert.ok(calls.send[0].context.startsWith(PERSONA('认知', '小知')), '首轮上下文带约束指令')
  assert.equal(calls.send[0].text, '什么是知识', '问题单独一条，不和人设拼在一起')
  assert.deepEqual(calls.ensure[0].origin, P2P, '来源透传给建会话（起标题用）')
  hub.onStatus('sid-0', true)
  hub.onEvent('sid-0', { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['知识是被验证过的信念'] }] } })
  hub.onStatus('sid-0', false)
  assert.deepEqual(await p, { status: 'ok', text: '知识是被验证过的信念' })
  assert.equal(calls.cancel, 0)
})

test('askSession：续用会话（first=false）只发问题本身', async () => {
  const { d, calls, hub } = deps({ id: 'sid-0', first: false })
  const p = askSession(d, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: '接着说' })
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls.send[0], { id: 'sid-0', text: '接着说' }, '续用会话不带上下文')
  hub.onStatus('sid-0', true); hub.onStatus('sid-0', false)
  await p
})

test('askSession：超时回 timeout 文案并叫停回合', async () => {
  const { d, calls } = deps()
  const r = await askSession(d, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: '慢问题', timeoutMs: 20 })
  assert.deepEqual(r, { status: 'timeout' })
  assert.equal(calls.cancel, 1, '超时要 cancel')
})

test('askSession：send 抛错 → error 带 detail，不炸；ensure 抛错同理', async () => {
  const { d, hub } = deps({ extra: {} })
  const d2 = { ...d, send: async () => { throw new Error('连接没就绪') } }
  const r = await askSession(d2, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: 'q' })
  assert.equal(r.status, 'error')
  assert.ok(r.detail.includes('派发失败') && r.detail.includes('连接没就绪'))
  const d3 = { ...d, ensureSession: async () => { throw new Error('建会话被拒') } }
  const r3 = await askSession(d3, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: 'q' })
  assert.equal(r3.status, 'error')
  assert.ok(r3.detail.includes('建会话被拒'))
  void hub
})

test('askSession：send 明确报告会话已归档 → blocked', async () => {
  const { d } = deps()
  const r = await askSession({ ...d, send: async () => { throw new Error('会话已归档') } }, {
    appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: 'q',
  })
  assert.deepEqual(r, { status: 'blocked', detail: '派发失败：会话已归档' })
})

test('TurnHub hold/unhold：挂起期间不计超时，解除后剩余时长重置再计', async () => {
  const hub = new TurnHub()
  const p = hub.wait('s1', 40)
  hub.onStatus('s1', true)
  hub.hold('s1')                              // 追问卡片挂起
  await new Promise((r) => setTimeout(r, 80))  // 原超时点已过
  let done = false
  p.then(() => { done = true }, () => { done = true })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(done, false, '挂起期间不许超时')
  hub.unhold('s1', 30)                         // 答案回去，重置 30ms 再计
  assert.deepEqual(await p, { status: 'timeout' })
})

test('askSession：onEvent 收到这一回合的宿主事件（思考卡片列步骤用）；兜底上限 15 分钟', async () => {
  const { d, hub } = deps()
  const seen = []
  const p = askSession(d, { appId: 'cli_a', chatId: 'oc_1', chatType: 'p2p', origin: P2P, folder: '认知', question: 'q', onEvent: (ev) => seen.push(ev.type) })
  await new Promise((r) => setTimeout(r, 0))
  hub.onStatus('sid-0', true)
  hub.onEvent('sid-0', { type: 'tool/call', data: { name: 'wiki_search', arguments: '{}' } })
  hub.onEvent('sid-0', { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: ['好'] }] } })
  hub.onStatus('sid-0', false)
  assert.deepEqual(await p, { status: 'ok', text: '好' })
  assert.deepEqual(seen, ['tool/call', 'assistant/message'])
  assert.equal(ASK_TIMEOUT_MS, 15 * 60_000)
})
