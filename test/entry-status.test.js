import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mcpEntryStatus, larkEntryStatus } from '../src/client/settings/entryStatus.ts'

// 一张卡一个状态：按表自上而下，第一条命中即是
const OK_LARK = { folderExists: true, connected: true, botReady: true }

test('MCP：表内每一行', () => {
  assert.deepEqual(mcpEntryStatus('ok', undefined), { tone: 'draft', text: '保存中…' })
  assert.deepEqual(mcpEntryStatus('none', { folderExists: false }), { tone: 'warn', text: '知识库未初始化' })
  assert.deepEqual(mcpEntryStatus('validating', { folderExists: false }), { tone: 'loading', text: '知识库校验中', loading: true })
  assert.deepEqual(mcpEntryStatus('failed', { folderExists: false }), { tone: 'warn', text: '知识库校验失败' })
  assert.deepEqual(mcpEntryStatus('ok', { folderExists: false }), { tone: 'err', text: '知识库不存在该文件夹' })
  assert.deepEqual(mcpEntryStatus('ok', { folderExists: true }), { tone: 'ok', text: '已连接' })
})

test('MCP：未保存先于库阶段', () => {
  assert.equal(mcpEntryStatus('validating', undefined).text, '保存中…')
})

test('Lark：表内每一行', () => {
  assert.deepEqual(larkEntryStatus('ok', undefined), { tone: 'draft', text: '保存中…' })
  assert.deepEqual(larkEntryStatus('none', OK_LARK), { tone: 'warn', text: '知识库未初始化' })
  assert.deepEqual(larkEntryStatus('validating', OK_LARK), { tone: 'loading', text: '知识库校验中', loading: true })
  assert.deepEqual(larkEntryStatus('failed', OK_LARK), { tone: 'warn', text: '知识库校验失败' })
  assert.deepEqual(larkEntryStatus('ok', { ...OK_LARK, folderExists: false }), { tone: 'err', text: '知识库不存在该文件夹' })
  assert.deepEqual(larkEntryStatus('ok', { ...OK_LARK, connected: false, botReady: false }), { tone: 'off', text: '未连接' })
  assert.deepEqual(larkEntryStatus('ok', { ...OK_LARK, botReady: false }), { tone: 'warn', text: '群聊暂不可用' })
  assert.deepEqual(larkEntryStatus('ok', OK_LARK), { tone: 'ok', text: '已连接' })
})

test('Lark 优先级：库阶段压过连接与文件夹', () => {
  const v = larkEntryStatus('validating', OK_LARK)
  assert.equal(v.text, '知识库校验中')
  assert.equal(v.loading, true)
  assert.equal(larkEntryStatus('failed', { ...OK_LARK, folderExists: false }).text, '知识库校验失败')
  assert.equal(larkEntryStatus('ok', { ...OK_LARK, folderExists: false }).text, '知识库不存在该文件夹')
  assert.equal(larkEntryStatus('ok', { ...OK_LARK, folderExists: false, connected: false }).text, '知识库不存在该文件夹')
  assert.equal(larkEntryStatus('ok', { ...OK_LARK, botReady: false }).text, '群聊暂不可用')
})

test('非加载态不带 loading 字段', () => {
  assert.ok(!('loading' in larkEntryStatus('ok', OK_LARK)))
  assert.ok(!('loading' in mcpEntryStatus('failed', { folderExists: true })))
})

test('校验中用单独的加载色调，不和「保存中…」共用最浅的 draft', () => {
  assert.equal(mcpEntryStatus('validating', { folderExists: true }).tone, 'loading')
  assert.equal(larkEntryStatus('validating', OK_LARK).tone, 'loading')
  assert.equal(mcpEntryStatus('ok', undefined).tone, 'draft')
})
