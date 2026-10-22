import { test } from 'vitest'
import assert from 'node:assert/strict'
import { vaultPhase } from '../src/core/vault-phase.ts'

// 设置卡按库的阶段显示状态：没配库 / 校验中 / 校验失败 / 可用（降级但开着也算可用）
const hub = (dir, engine) => ({ dir: () => dir, engine: { model: null, validating: false, ...engine } })

test('没配库目录 → none', () => {
  assert.equal(vaultPhase(hub('', {})), 'none')
  assert.equal(vaultPhase(hub('', { validating: true })), 'none')
})
test('有目录、正在校验 → validating（哪怕还挂着旧 model）', () => {
  assert.equal(vaultPhase(hub('/v', { validating: true })), 'validating')
  assert.equal(vaultPhase(hub('/v', { validating: true, model: {} })), 'validating')
})
test('有目录、model 在 → ok；降级开着也是 ok', () => {
  assert.equal(vaultPhase(hub('/v', { model: {} })), 'ok')
  assert.equal(vaultPhase(hub('/v', { model: {}, degraded: true })), 'ok')
})
test('有目录、不在校验、没 model → failed', () => {
  assert.equal(vaultPhase(hub('/v', { error: '不是知识库' })), 'failed')
})
