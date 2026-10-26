// 目录拖动接线：移动成功后只关被移节点下的 tab（名字以它开头的兄弟不关）；有没保存的改动不让移动、
// 也不调 API；同文件夹排序不看编辑态（路径不变）
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { under, closeUnder, unsaved, makeTreeEdit } from '../src/client/lib/treeEdit.ts'
import { createTabsNavStore } from '../src/client/lib/nav.tsx'

const P = (id) => ({ kind: 'page', id })
const ids = (st) => st.get().tabs.map((r) => r.id ?? r.kind)

test('under：自己或在它下面；名字前缀相同的兄弟不算', () => {
  assert.equal(under('知识/K', '知识/K'), true)
  assert.equal(under('知识/K/a.md', '知识/K'), true)
  assert.equal(under('知识/K2.md', '知识/K'), false)
  assert.equal(under('知识/K.md', '知识/K'), false)
})

test('closeUnder：关被移文件夹里的页 tab，留兄弟与非页 tab', () => {
  const st = createTabsNavStore({ kind: 'kb' })
  for (const r of [P('知识/K/K.md'), P('知识/K2.md'), P('知识/K/a.md'), { kind: 'raw', path: '知识/K/x.md' }, P('知识/甲.md')]) st.openTab(r)
  closeUnder(st, '知识/K')
  assert.deepEqual(ids(st), ['知识/K2.md', 'raw', '知识/甲.md'])
})

test('unsaved：编辑页在被移节点下且是 dirty / saving / conflict / error', () => {
  assert.equal(unsaved({ path: '知识/K/a.md', status: 'dirty' }, '知识/K'), true)
  assert.equal(unsaved({ path: '知识/K/a.md', status: 'error' }, '知识/K'), true)
  assert.equal(unsaved({ path: '知识/K/a.md', status: 'saved' }, '知识/K'), false)
  assert.equal(unsaved({ path: '知识/K2.md', status: 'dirty' }, '知识/K'), false)
  assert.equal(unsaved({ path: null, status: 'saved' }, '知识/K'), false)
})

test('makeTreeEdit：move 成功关 tab；有没保存的改动 blocked 给原因、move 拒绝且不调 API；reorder 不看编辑态', async () => {
  const calls = []
  const api = {
    reorder: async (...a) => { calls.push(['reorder', ...a]); return { ok: true } },
    move: async (...a) => { calls.push(['move', ...a]); return { ok: true } },
    moveImpact: async () => ({ pages: 2 }),
  }
  const st = createTabsNavStore({ kind: 'kb' })
  st.openTab(P('知识/K/a.md')); st.openTab(P('知识/甲.md'))
  let state = { path: null, status: 'saved' }
  const e = makeTreeEdit({ api, tabs: st, edit: () => state })
  assert.deepEqual(await e.impact('知识/K'), { pages: 2 })
  assert.equal(e.blocked('知识/K'), null)
  await e.move('知识/K', '工作', { first: true })
  assert.deepEqual(ids(st), ['知识/甲.md'])
  state = { path: '知识/甲.md', status: 'dirty' }
  assert.match(e.blocked('知识/甲.md'), /先保存再移动/)
  await assert.rejects(e.move('知识/甲.md', '工作', {}), /先保存再移动/)
  await e.reorder('知识/甲.md', { first: true })
  assert.deepEqual(calls, [['move', '知识/K', '工作', { first: true }], ['reorder', '知识/甲.md', { first: true }]])
})
