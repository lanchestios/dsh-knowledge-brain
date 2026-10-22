import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ChatSessions } from '../src/lark/chats.ts'

// 三层关系 appId → chatId → 会话记录 的纯状态机（持久化注入内存假实现）。
const make = (start = 1000) => {
  let t = start
  const saved = []
  const cs = new ChatSessions({ load: () => ({}), save: (m) => { saved.push(m) } }, () => (t += 10))
  return { cs, saved, tick: () => (t += 100) }
}

test('nextId 确定性：lark-<bot>-<chat>-<序号>；同一 chat 的序号递增且不撞在册 id', () => {
  const { cs } = make()
  assert.equal(cs.nextId('cli_aa00', 'oc_x1'), 'lark-cli-aa00-oc-x1-0')
  cs.bind('cli_aa00', 'oc_x1', 'lark-cli-aa00-oc-x1-0', 'Lark 问答 · 小助手 #1', 'p2p')
  // 轮换后再要新 id：past 里已有 -0，序号从 past 长度出发
  cs.rotate('cli_aa00', 'oc_x1')
  assert.equal(cs.nextId('cli_aa00', 'oc_x1'), 'lark-cli-aa00-oc-x1-1')
  // 不同 chat 互不影响
  assert.equal(cs.nextId('cli_aa00', 'oc_x2'), 'lark-cli-aa00-oc-x2-0')
  // appId/chatId 里的非法字符全被压掉：nameOf('cli_%%')='cli-'，slug 再剪尾杠；纯中文 chatId 剪成空
  assert.equal(cs.nextId('cli_%%', '麦/群'), 'lark-cli--0')
})

test('bind 后 current 生效；rotate 把 current 挪进 past 头部并清空，无 current 时无操作', () => {
  const { cs } = make()
  assert.equal(cs.rotate('cli_a', 'oc_1'), null, '没记录时轮换是空操作')
  cs.bind('cli_a', 'oc_1', 'id-0', '标题一', 'p2p')
  assert.equal(cs.list('cli_a')[0].current, 'id-0')
  const moved = cs.rotate('cli_a', 'oc_1')
  assert.deepEqual(moved, { id: 'id-0', title: '标题一' })
  const [row] = cs.list('cli_a')
  assert.equal(row.current, '')
  assert.equal(row.currentTitle, '')
  assert.deepEqual(row.past, [{ id: 'id-0', title: '标题一' }])
  assert.equal(cs.rotate('cli_a', 'oc_1'), null, '已轮换过再转是空操作')
})

test('list 按 lastAt 倒序；touch 刷 lastAt 不硬造记录；drop 清整个机器人', () => {
  const { cs, tick } = make()
  cs.bind('cli_a', 'oc_1', 'a0', '一', 'p2p')
  tick()
  cs.bind('cli_a', 'oc_2', 'b0', '二', 'group')
  assert.deepEqual(cs.list('cli_a').map((r) => r.chatId), ['oc_2', 'oc_1'], '后绑的在前')
  tick()
  cs.touch('cli_a', 'oc_1', 'p2p')
  assert.deepEqual(cs.list('cli_a').map((r) => r.chatId), ['oc_1', 'oc_2'], 'touch 把 oc_1 刷到最前')
  cs.touch('cli_a', 'oc_无', 'p2p')
  assert.equal(cs.list('cli_a').length, 2, 'touch 不建记录')
  assert.deepEqual(cs.list('cli_b'), [])
  cs.drop('cli_a')
  assert.deepEqual(cs.list('cli_a'), [], 'drop 后映射清空（DSH 会话本体不动）')
})

test('每次变更都写回持久层（save 收到最新 map）', () => {
  const { cs, saved } = make()
  cs.bind('cli_a', 'oc_1', 'a0', '一', 'p2p')
  cs.rotate('cli_a', 'oc_1')
  assert.equal(saved.length, 2)
  assert.equal(saved[1]['cli_a']['oc_1'].past.length, 1)
})

test('load 时吃存量 map：重启后 current 还在、nextId 接着编号', () => {
  const store = { map: { cli_a: { oc_1: { current: 'lark-cli-a-oc-1-0', currentTitle: '旧标题', past: [], lastAt: 5, chatType: 'p2p' } } } }
  const cs = new ChatSessions({ load: () => store.map, save: () => {} }, () => 100)
  assert.equal(cs.list('cli_a')[0].current, 'lark-cli-a-oc-1-0')
  cs.rotate('cli_a', 'oc_1')
  assert.equal(cs.nextId('cli_a', 'oc_1'), 'lark-cli-a-oc-1-1')
})
