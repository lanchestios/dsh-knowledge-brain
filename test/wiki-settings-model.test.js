import { test } from 'vitest'
import assert from 'node:assert/strict'
import { WikiSettingsModel, vaultDirField } from '../src/client/settings/model.ts'
import { larkAppsField } from '../src/client/settings/larkField.ts'
import { mcpServersField } from '../src/client/settings/mcpField.ts'

function fixture(extra = {}) {
  let snap = { status: 'ready', writable: true, revision: 5, value: { vaultDir: '/old', larkApps: [], mcpServers: [] }, ...extra }
  const listeners = new Set(), writes = []
  const update = (next) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()) }
  const scope = {
    getSnapshot: () => snap,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    mutate: async (ops, revision) => {
      writes.push({ ops, revision })
      if (revision !== snap.revision) return false
      const value = { ...snap.value }
      for (const op of ops) { if (op.op === 'set') value[op.path[0]] = op.value; else delete value[op.path[0]] }
      update({ value, revision: snap.revision + 1 })
      return true
    },
  }
  const model = new WikiSettingsModel([vaultDirField, larkAppsField('larkApps'), mcpServersField('mcpServers')])
  model.connect(scope)
  return { model, scope, writes, update }
}

test('保存一次原子提交三种设置，保留 revision fence；成功后重读宿主值', async () => {
  const { model, writes } = fixture()
  model.edit('vaultDir', '/new')
  model.edit('larkApps', JSON.stringify([{ appId: 'app', appSecret: 'secret', folder: '认知', model: '' }]))
  model.edit('mcpServers', JSON.stringify([{ endpoint: 'notes', name: '笔记', folder: '认知', token: 'a'.repeat(43) }]))
  await model.save()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].revision, 5)
  assert.equal(writes[0].ops.length, 3)
  assert.equal(model.getSnapshot().dirty, false)
  assert.equal(model.getSnapshot().vaultDir.text, '/new')
})

test('不合法的范围/密钥和只读设置不会发出写请求', async () => {
  const { model, writes, update } = fixture()
  model.edit('larkApps', '[{"appId":"app","appSecret":"s","folder":""}]')
  assert.equal(model.getSnapshot().invalid, true)
  await model.save(); assert.equal(writes.length, 0)
  model.discard(); update({ writable: false })
  model.edit('vaultDir', '/new'); await model.save()
  assert.equal(model.getSnapshot().dirty, false)
  assert.equal(writes.length, 0)
})

test('并发修改触发 revision 拒绝，保留草稿；用户重试才覆盖新版本', async () => {
  const { model, writes, update } = fixture()
  model.edit('vaultDir', '/mine')
  update({ revision: 6, value: { vaultDir: '/theirs' } })
  await model.save()
  assert.equal(model.getSnapshot().failed, true)
  assert.equal(model.getSnapshot().vaultDir.text, '/mine')
  assert.equal(writes[0].revision, 5)
  await model.save()
  assert.equal(writes[1].revision, 6)
  assert.equal(model.getSnapshot().failed, false)
  assert.equal(model.getSnapshot().dirty, false)
})

test('网络失败保留草稿和错误，稍后可以重试', async () => {
  const { model, scope } = fixture()
  const mutate = scope.mutate
  scope.mutate = async () => { throw new Error('offline') }
  model.edit('vaultDir', '/new'); await model.save()
  assert.equal(model.getSnapshot().failed, true)
  assert.equal(model.getSnapshot().saving, false)
  assert.equal(model.getSnapshot().vaultDir.text, '/new')
  scope.mutate = mutate; await model.save()
  assert.equal(model.getSnapshot().dirty, false)
})

test('保存期间的新编辑不被旧请求的回包清掉，也不会重复并发保存', async () => {
  const { model, scope, writes } = fixture()
  const mutate = scope.mutate
  let release
  scope.mutate = (ops, rev) => new Promise((resolve) => { release = async () => resolve(await mutate(ops, rev)) })
  model.edit('vaultDir', '/first')
  const pending = model.save()
  model.edit('vaultDir', '/second'); await model.save()
  await release(); await pending
  assert.equal(writes.length, 1)
  assert.equal(model.getSnapshot().vaultDir.text, '/second')
  assert.equal(model.getSnapshot().dirty, true)
  scope.mutate = mutate; await model.save()
  assert.equal(writes[1].revision, 6)
  assert.equal(model.getSnapshot().dirty, false)
})

test('清空只 unset 对应字段，取消草稿恢复最新宿主值', async () => {
  const { model, writes, update } = fixture()
  model.edit('vaultDir', ''); await model.save()
  assert.deepEqual(writes[0].ops, [{ op: 'unset', path: ['vaultDir'] }])
  model.edit('vaultDir', '/draft')
  update({ value: { vaultDir: '/remote' } })
  model.discard()
  assert.equal(model.getSnapshot().vaultDir.text, '/remote')
})

test('保存途中改回原值仍是新编辑，旧请求不能覆盖它', async () => {
  const { model, scope } = fixture()
  const mutate = scope.mutate
  let release
  scope.mutate = (ops, rev) => new Promise((resolve) => { release = async () => resolve(await mutate(ops, rev)) })
  model.edit('vaultDir', '/first')
  const pending = model.save()
  model.edit('vaultDir', '/old')
  await release(); await pending
  assert.equal(model.getSnapshot().vaultDir.text, '/old')
  assert.equal(model.getSnapshot().dirty, true)
  scope.mutate = mutate; await model.save()
  assert.equal(scope.getSnapshot().value.vaultDir, '/old')
  assert.equal(model.getSnapshot().dirty, false)
})
