import { test } from 'vitest'
import assert from 'node:assert/strict'
import { sessionTitle, askerLabel, framedQuestion, createOriginResolver } from '../src/lark/origin.ts'

// 会话来源的纯件：标题（来源类型 · 群名 · 提问人/话题 #序号）、提问人标签、群聊问题前缀、
// 带缓存的名字解析（只走通讯录；失败短缓存、成功长缓存，查不到退 open_id 短码）。

test('sessionTitle：单聊 / 普通群 / 话题群 / 普通群里的话题', () => {
  assert.equal(sessionTitle({ kind: 'p2p', chatName: '', asker: '张三', topic: '' }, 1), '单聊 · 张三 #1')
  assert.equal(sessionTitle({ kind: 'group', chatName: '产品讨论群', asker: '张三', topic: '' }, 2), '群 · 产品讨论群 · 张三 #2')
  assert.equal(sessionTitle({ kind: 'topic', chatName: 'OA 答疑', asker: '张三', topic: '报销流程怎么走' }, 1), '话题群 · OA 答疑 · 报销流程怎么走 #1')
  assert.equal(sessionTitle({ kind: 'thread', chatName: '产品讨论群', asker: '张三', topic: '发版窗口' }, 1), '群话题 · 产品讨论群 · 发版窗口 #1')
})

test('sessionTitle：话题首句截 16 字、空白折叠；话题为空退提问人；群名为空不留空段', () => {
  const long = '这是一个非常非常长的话题标题需要被截断才行'
  assert.equal(sessionTitle({ kind: 'topic', chatName: 'G', asker: 'A', topic: long }, 1), `话题群 · G · ${long.slice(0, 16)}… #1`)
  assert.equal(sessionTitle({ kind: 'topic', chatName: 'G', asker: 'A', topic: ' a \n b ' }, 1), '话题群 · G · a b #1')
  assert.equal(sessionTitle({ kind: 'topic', chatName: 'G', asker: 'A', topic: '' }, 1), '话题群 · G · A #1')
  assert.equal(sessionTitle({ kind: 'group', chatName: '', asker: 'A', topic: '' }, 1), '群 · A #1')
})

test('askerLabel：有名字用名字，没名字退 open_id 后 6 位', () => {
  assert.equal(askerLabel('张三', 'ou_abcdef123456'), '张三')
  assert.equal(askerLabel('', 'ou_abcdef123456'), '用户123456')
  assert.equal(askerLabel('', ''), '用户')
})

test('framedQuestion：单聊原样；群聊前缀「提问人：」', () => {
  assert.equal(framedQuestion({ kind: 'p2p', chatName: '', asker: '张三', topic: '' }, '你好'), '你好')
  assert.equal(framedQuestion({ kind: 'group', chatName: 'G', asker: '张三', topic: '' }, '你好'), '张三：你好')
  assert.equal(framedQuestion({ kind: 'topic', chatName: 'G', asker: '张三', topic: '' }, '你好'), '张三：你好')
})

// 解析器：lookup 全注入（真实现在 channel.ts）
const lookups = (over = {}) => {
  const calls = { chat: 0, user: 0 }
  return {
    calls,
    deps: {
      chatInfo: async (chatId) => { calls.chat += 1; return over.chat ? over.chat(chatId) : { name: '产品讨论群', mode: 'group' } },
      userName: async (openId) => { calls.user += 1; return over.user ? over.user(openId) : '张三' },
      ...(over.now ? { now: over.now } : {}),
    },
  }
}
const MSG = (m = {}) => ({ chatId: 'oc_1', chatType: 'group', senderId: 'ou_abcdef123456', text: '报销怎么走', ...m })

test('resolve：单聊不查群信息；普通群取群名；话题群（chat_mode=topic）与群里话题分开', async () => {
  const a = lookups()
  assert.deepEqual(await createOriginResolver(a.deps).resolve(MSG({ chatType: 'p2p' })), { kind: 'p2p', chatName: '', asker: '张三', topic: '' })
  assert.equal(a.calls.chat, 0, '单聊不调群信息')

  const b = lookups()
  assert.deepEqual(await createOriginResolver(b.deps).resolve(MSG()), { kind: 'group', chatName: '产品讨论群', asker: '张三', topic: '' })

  const c = lookups({ chat: () => ({ name: 'OA 答疑', mode: 'topic' }) })
  assert.deepEqual(await createOriginResolver(c.deps).resolve(MSG({ threadId: 't1' })), { kind: 'topic', chatName: 'OA 答疑', asker: '张三', topic: '报销怎么走' })

  const d = lookups()
  assert.deepEqual(await createOriginResolver(d.deps).resolve(MSG({ threadId: 't1' })), { kind: 'thread', chatName: '产品讨论群', asker: '张三', topic: '报销怎么走' })
})

test('resolve：通讯录查不到（没权限 / 空名）退 open_id 短码；群信息失败退「群」不炸', async () => {
  const a = lookups({ user: () => { throw new Error('99991672 no permission') } })
  assert.equal((await createOriginResolver(a.deps).resolve(MSG())).asker, '用户123456')

  const b = lookups({ user: () => '', chat: () => { throw new Error('denied') } })
  assert.deepEqual(await createOriginResolver(b.deps).resolve(MSG()), { kind: 'group', chatName: '', asker: '用户123456', topic: '' })

  const c = lookups({ user: () => { throw new Error('99991672') } })
  assert.equal((await createOriginResolver(c.deps).resolve(MSG({ chatType: 'p2p' }))).asker, '用户123456')
  assert.equal(c.calls.chat, 0, '单聊不查群信息')
})

test('resolve：群信息话题模式查不到时，话题里的消息按「群话题」', async () => {
  const a = lookups({ chat: () => { throw new Error('denied') } })
  assert.equal((await createOriginResolver(a.deps).resolve(MSG({ threadId: 't1' }))).kind, 'thread')
})

test('缓存：成功的结果复用；失败短缓存，过期后重查', async () => {
  let t = 0
  const a = lookups({ now: () => t })
  const r = createOriginResolver(a.deps)
  await r.resolve(MSG())
  await r.resolve(MSG())
  assert.deepEqual(a.calls, { chat: 1, user: 1 }, '成功结果复用')

  let fail = true
  const b = lookups({ now: () => t, user: () => { if (fail) throw new Error('x'); return '王五' } })
  const r2 = createOriginResolver(b.deps)
  t = 0
  assert.equal((await r2.resolve(MSG({ chatType: 'p2p' }))).asker, '用户123456')
  await r2.resolve(MSG({ chatType: 'p2p' }))
  assert.equal(b.calls.user, 1, '失败在短缓存期内不重查')
  fail = false
  t = 11 * 60_000
  assert.equal((await r2.resolve(MSG({ chatType: 'p2p' }))).asker, '王五', '过期后重查')
})
