// @vitest-environment jsdom
// 沉淀两页（草稿/动态）：行渲染、区筛选、行点击进页；两页共用一表两种口径
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { DraftsPage, ActivityPage } from '../src/client/components/PagesList.tsx'
import { NavProvider, createNavStore } from '../src/client/lib/nav.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

const ROW = (o = {}) => ({ id: '知识/a.md', name: '某页', area: '知识', updated: '2026-10-03', ...o })

async function mountPage(Page, api, store, initial) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(h(WikiEnvProvider, { value: { api, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(NavProvider, { initial, store }, h(Page))))
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return host
}

test('草稿页：全量草稿渲染，行点击进页', async () => {
  const store = createNavStore({ kind: 'drafts' })
  const rows = [ROW({ id: '知识/草稿1.md', name: '草稿一' }), ROW({ id: '认知/草稿2.md', name: '草稿二', area: '认知' })]
  const host = await mountPage(DraftsPage, { drafts: async () => rows, onChanged: () => () => {} }, store, { kind: 'drafts' })
  assert.ok(host.textContent.includes('2 页草稿还没写完'), '头行数对')
  assert.ok(host.textContent.includes('草稿一') && host.textContent.includes('草稿二'))
  const name = [...host.querySelectorAll('td')].find((td) => td.textContent.trim() === '草稿二')
  await act(async () => { name.click() })
  assert.deepEqual(store.get().route, { kind: 'page', id: '认知/草稿2.md' })
})

test('动态页：区 chip 筛选只留该区', async () => {
  const store = createNavStore({ kind: 'activity' })
  const rows = [ROW({ name: '认知页', area: '认知' }), ROW({ name: '知识页' }), ROW({ name: '又一知识页' })]
  const host = await mountPage(ActivityPage, { recent: async () => rows, onChanged: () => () => {} }, store, { kind: 'activity' })
  assert.ok(host.textContent.includes('3 页 · 按更新时间倒序'))
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.includes('知识')).click() })
  assert.ok(!host.textContent.includes('认知页'), '别区的行被筛掉')
  assert.ok(host.textContent.includes('知识页') && host.textContent.includes('又一知识页'))
})

test('草稿页空态文案', async () => {
  const host = await mountPage(DraftsPage, { drafts: async () => [], onChanged: () => () => {} }, createNavStore({ kind: 'drafts' }), { kind: 'drafts' })
  assert.ok(host.textContent.includes('没有草稿，都写完了。'))
})
