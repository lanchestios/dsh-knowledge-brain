// @vitest-environment jsdom
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { createElement as h, act } from 'react'
import { createRoot } from 'react-dom/client'
import { mountWikiSettings } from '../src/client/settings/transport.ts'
import { WikiSettingsCard } from '../src/client/settings/WikiSettingsCard.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('通过宿主 plugins.item 提供摘要和详情，配置读写接回同一模型', async () => {
  const effects = [], entries = []
  let snapshot = { status: 'ready', writable: true, revision: 1, value: { vaultDir: '/vault' } }
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: vi.fn(async (ops) => {
    snapshot = { ...snapshot, revision: 2, value: { ...snapshot.value, vaultDir: ops[0].value } }
    return true
  }) }
  const disposeEntry = vi.fn(), disposeWatch = vi.fn()
  const c = {
    inject: (names, mount) => { assert.deepEqual(names, ['configForms']); mount(c) },
    effect: (mount) => { effects.push(mount()) },
    configForms: {
      get: (id) => { assert.equal(id, 'dsh-knowledge-brain'); return scope },
      whileServed: (ids, register) => { assert.deepEqual(ids, ['dsh-knowledge-brain']); register(); return disposeWatch },
    },
    slots: {
      inject: (slot, mount) => { assert.equal(slot, 'plugins.item'); return mount() },
      register: (entry, Card) => { entries.push({ entry, Card }); return disposeEntry },
    },
  }
  const model = mountWikiSettings(c, WikiSettingsCard)
  const [{ entry, Card }] = entries
  assert.equal(entry.id, 'dsh-knowledge-brain')
  assert.equal(entry.label(), '格物致知')
  assert.equal(Card, WikiSettingsCard)
  const props = entry.inject()
  assert.equal(props.wikiForm, model)
  props.edit('vaultDir', '/new-vault')
  await props.save()
  assert.deepEqual(scope.mutate.mock.calls[0], [[{ op: 'set', path: ['vaultDir'], value: '/new-vault' }], 1])
  effects.reverse().forEach((dispose) => dispose())
  assert.equal(disposeWatch.mock.calls.length, 1)
})

test('宿主插件列表只渲染摘要，不挂载表单或丢弃详情草稿', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const unexpected = () => { throw new Error('摘要不能访问表单') }
  await act(async () => root.render(h(WikiSettingsCard, {
    view: 'summary', wikiForm: { subscribe: unexpected, getSnapshot: unexpected },
    edit: unexpected, save: unexpected, discard: unexpected,
  })))
  assert.equal(host.textContent, '所闻、所见、所学、所知')
  assert.equal(host.querySelector('input,button'), null)
  await act(async () => root.unmount())
})
