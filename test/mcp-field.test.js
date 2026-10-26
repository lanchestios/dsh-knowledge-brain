import { test } from 'vitest'
import assert from 'node:assert/strict'
import { genToken, serializeMcp, parseMcp, parseMcpDraft, endpointError, nameError, maskToken, endpointUrl, mcpParams, mcpServersField } from '../src/client/settings/mcpField.ts'
import * as field from '../src/client/settings/mcpField.ts'

const T = 'a'.repeat(43)
const row = (endpoint, folder = '认知', token = T, name = '笔记') => ({ endpoint, name, folder, token })

test('genToken：43 位 base64url、每次不同', () => {
  const a = genToken(), b = genToken()
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
})

test('序列化稳定（键序 endpoint/name/folder/token）、严格解析把关', () => {
  const text = serializeMcp([{ endpoint: ' ml ', name: ' 笔记 ', folder: '认知', token: T }])
  assert.equal(text, JSON.stringify([{ endpoint: 'ml', name: '笔记', folder: '认知', token: T }]))
  assert.deepEqual(parseMcp(text), [row('ml')])
  assert.equal(parseMcp(serializeMcp([row('has space')])), null)
  assert.equal(parseMcp(serializeMcp([row('ml'), row('ml', '学习')])), null)
  assert.equal(parseMcp(serializeMcp([row('ml', '')])), null)
  assert.equal(parseMcp(serializeMcp([row('ml', '认知', 'short')])), null)
  assert.equal(parseMcp(serializeMcp([row('ml', '认知', T, '')])), null, '缺 name')
  assert.equal(parseMcp(serializeMcp([row('ml', '认知', T, '知'.repeat(33))])), null, 'name 超长')
  assert.deepEqual(parseMcp(serializeMcp([row('a1', '认知', T, '同名'), row('a2', '学习', T, '同名')])).length, 2, 'name 可重名')
  assert.equal(parseMcp('not json'), null)
})

test('草稿宽容解析：打到一半的行照样还原；旧形状只有 name', () => {
  assert.deepEqual(parseMcpDraft(JSON.stringify([{ endpoint: 'has space', folder: '' }])), [{ endpoint: 'has space', name: '', folder: '', token: '' }])
  assert.deepEqual(parseMcpDraft(JSON.stringify([{ name: 'old', folder: '认知', token: T }])), [{ endpoint: '', name: 'old', folder: '认知', token: T }])
  assert.equal(parseMcpDraft(JSON.stringify([{ endpoint: 'x', name: 5 }]))[0].name, '', '非字符串 name 归空')
  assert.equal(parseMcpDraft('oops'), null)
})

test('endpointError：必填 / 规则 / 重名（排除自己）', () => {
  const rows = [row('ml'), row('x')]
  assert.equal(endpointError('', rows, -1), '必填')
  assert.equal(endpointError('a b', rows, -1), '只能用字母、数字、- 和 _，最多 32 位')
  assert.equal(endpointError('ml', rows, -1), '已经有同名的端点了')
  assert.equal(endpointError('ml', rows, 0), '')
  assert.equal(endpointError(' new ', rows, -1), '')
})

test('nameError：必填 / 最多 32 个字（按码点）', () => {
  assert.equal(nameError(''), '必填')
  assert.equal(nameError('   '), '必填')
  assert.equal(nameError('知'.repeat(32)), '')
  assert.equal(nameError('😀'.repeat(32)), '')
  assert.equal(nameError('知'.repeat(33)), '最多 32 个字')
  assert.equal(nameError('机器学习笔记'), '')
})

test('字段 spec：空 = clear；非法 = undefined 挡住保存；format 稳定', () => {
  const f = mcpServersField('mcpServers')
  assert.deepEqual(f.parse('  '), { kind: 'clear' })
  assert.equal(f.parse(serializeMcp([row('a b')])), undefined)
  assert.deepEqual(f.parse(serializeMcp([row('ml')])), { kind: 'set', value: [row('ml')] })
  assert.equal(f.format([{ token: T, folder: '认知', name: '笔记', endpoint: 'ml' }]), serializeMcp([row('ml')]))
  assert.equal(f.format(undefined), '')
})

test('maskToken 只露首尾 4 位；endpointUrl 去尾斜杠', () => {
  assert.equal(maskToken('abcd' + 'x'.repeat(35) + 'wxyz'), 'abcd••••••••wxyz')
  assert.equal(endpointUrl('http://127.0.0.1:19387', 'ml'), 'http://127.0.0.1:19387/mcp/ml')
  assert.equal(endpointUrl('http://127.0.0.1:3080//', 'ml'), 'http://127.0.0.1:3080/mcp/ml')
})

test('mcpParams：通用 MCP 配置，键是 endpoint、带完整 token；copyFormats 已删', () => {
  const url = endpointUrl('http://127.0.0.1:19387', 'ml')
  const text = mcpParams(url, row('ml'))
  assert.deepEqual(JSON.parse(text), { mcpServers: { ml: { type: 'http', url, headers: { Authorization: `Bearer ${T}` } } } })
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2))
  assert.ok(text.includes(T))
  assert.ok(!text.includes('笔记'), '显示名称不进配置')
  assert.equal(field.copyFormats, undefined)
  assert.equal(field.endpointOf, undefined)
})

test('手写 folder 的首尾斜杠按服务端口径去掉（否则对不上 mcpStatus）', () => {
  const raw = JSON.stringify([{ endpoint: 'ml', name: '笔记', folder: '/knowledge/ML/', token: T }])
  assert.deepEqual(parseMcp(raw), [row('ml', 'knowledge/ML')])
  assert.deepEqual(parseMcpDraft(raw), [row('ml', 'knowledge/ML')])
  assert.deepEqual(mcpServersField('mcpServers').parse(raw), { kind: 'set', value: [row('ml', 'knowledge/ML')] })
})

test('folder：「/」保留为知识库；..、空段判非法挡住保存；草稿里非法值归成空', () => {
  assert.deepEqual(parseMcp(serializeMcp([row('ml', '/')])), [row('ml', '/')])
  assert.deepEqual(parseMcp(serializeMcp([row('ml', ' // ')])), [row('ml', '/')])
  assert.equal(parseMcp(serializeMcp([row('ml', '知识/../系统')])), null)
  assert.equal(parseMcpDraft(JSON.stringify([{ endpoint: 'ml', name: 'n', folder: 'a//b', token: T }]))[0].folder, '')
  assert.equal(parseMcpDraft(JSON.stringify([{ endpoint: 'ml', name: 'n', folder: ['/'], token: T }]))[0].folder, '', '非字符串不强转成知识库')
})
