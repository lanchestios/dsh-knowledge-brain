import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeMcpEntries, ENDPOINT_RE, MAX_NAME } from '../src/mcp/entries.ts'

const T = 'a'.repeat(43)
const e = (endpoint, folder = 'a', name = '笔记', token = T) => ({ endpoint, name, folder, token })

test('合法条目原样保留（endpoint / name / folder / token 去首尾空白，folder 去首尾斜杠）', () => {
  assert.deepEqual(normalizeMcpEntries([{ endpoint: ' ml-notes ', name: ' 机器学习 ', folder: '/knowledge/ML/', token: ` ${T} ` }]),
    { ok: [{ endpoint: 'ml-notes', name: '机器学习', folder: 'knowledge/ML', token: T }], problems: [] })
})

test('导出常量：ENDPOINT_RE / MAX_NAME', () => {
  assert.ok(ENDPOINT_RE.test('a-b_C9'))
  assert.ok(!ENDPOINT_RE.test('a b'))
  assert.equal(MAX_NAME, 32)
})

test('空 / undefined 是零条，不算问题；非数组整体无效', () => {
  assert.deepEqual(normalizeMcpEntries(undefined), { ok: [], problems: [] })
  assert.deepEqual(normalizeMcpEntries(null), { ok: [], problems: [] })
  assert.deepEqual(normalizeMcpEntries({}), { ok: [], problems: ['mcpServers 不是数组'] })
})

test('每条剔除规则都带原因，其余照常', () => {
  const r = normalizeMcpEntries([
    'x',
    { name: '旧条目', folder: 'a', token: T },          // 旧形状：只有 name 没 endpoint
    e('has space'),
    e('a'.repeat(33)),
    { endpoint: 'noname', folder: 'a', token: T },
    e('blankname', 'a', '   '),
    e('longname', 'a', 'x'.repeat(33)),
    { endpoint: 'nofolder', name: 'n', token: T },
    e('dotdot', 'knowledge/../X'),
    e('short', 'a', 'n', 'abc'),
    e('ok', 'a'),
    e('ok', 'b'),
  ])
  assert.deepEqual(r.ok, [e('ok', 'a')])
  assert.deepEqual(r.problems, [
    '第 1 项：不是对象',
    '第 2 项：缺 endpoint',
    '第 3 项：endpoint 只能用字母、数字、- 和 _，最多 32 位',
    '第 4 项：endpoint 只能用字母、数字、- 和 _，最多 32 位',
    'noname：缺 name',
    'blankname：缺 name',
    'longname：name 最多 32 个字',
    'nofolder：缺 folder',
    'dotdot：folder 不能含空段、. 或 .. 段',
    'short：token 太短（至少 32 位）',
    'ok：endpoint 重名',
  ])
})

test('name 按码点计数：32 个汉字通过，33 个不过；非字符串 name 算缺', () => {
  const r = normalizeMcpEntries([e('zh32', 'a', '知'.repeat(32)), e('zh33', 'a', '知'.repeat(33)), e('emoji', 'a', '😀'.repeat(32)), e('num', 'a', 123)])
  assert.deepEqual(r.ok.map((x) => x.endpoint), ['zh32', 'emoji'])
  assert.deepEqual(r.problems, ['zh33：name 最多 32 个字', 'num：缺 name'])
})

test('name 可以重名', () => {
  const r = normalizeMcpEntries([e('a1', 'a', '同名'), e('a2', 'b', '同名')])
  assert.equal(r.ok.length, 2)
  assert.deepEqual(r.problems, [])
})

test('问题文案里不出现 token', () => {
  const r = normalizeMcpEntries([e('bad endpoint')])
  assert.ok(r.problems.every((p) => !p.includes(T)))
})

test('未过校验的值不回显：token 误贴进 endpoint / name、或整项就是 token，都不进问题文案', () => {
  const tok = genLike()
  const r = normalizeMcpEntries([
    e(tok), tok, e(`x ${tok}`),
    e('n1', 'a', tok),                  // 43 位 token 误贴进 name：超长，只报 endpoint
    e('n2', 'a', tok.slice(0, 32)), e('n2', 'b', tok.slice(0, 32)),   // 名字合法但 endpoint 重名：也不回显 name
  ])
  assert.equal(r.problems.length, 5)
  assert.ok(r.problems.every((p) => !p.includes(tok.slice(0, 32))), JSON.stringify(r.problems))
})

function genLike() { return 'Ab3_-'.repeat(8) + 'xyz' }   // 43 位 base64url，形同 genToken 产物

test('folder「/」（含 // 与带空白）= 知识库；空段非法；空仍是缺 folder', () => {
  const r = normalizeMcpEntries([e('all', '/'), e('all2', ' // '), e('gap', 'a//b'), e('blank', '   ')])
  assert.deepEqual(r.ok, [e('all', '/'), e('all2', '/')])
  assert.deepEqual(r.problems, ['gap：folder 不能含空段、. 或 .. 段', 'blank：缺 folder'])
})

test('folder 非字符串：数组、对象、布尔一律「缺 folder」（["/"] 绝不变成知识库）；数字照字符串收', () => {
  const r = normalizeMcpEntries([e('arr', ['/']), e('arr2', ['//']), e('obj', {}), e('bool', true), e('num', 2026)])
  assert.deepEqual(r.ok, [e('num', '2026')])
  assert.deepEqual(r.problems, ['arr：缺 folder', 'arr2：缺 folder', 'obj：缺 folder', 'bool：缺 folder'])
})
