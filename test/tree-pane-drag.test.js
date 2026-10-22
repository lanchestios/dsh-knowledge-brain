// @vitest-environment jsdom
// 目录长按拖动：不满 380ms 是普通点击；浮起后同文件夹落点 → reorder（乐观先显示），跨文件夹 → 确认框写影响页数、
// 确认才 move；松手后补发的 click 不打开页；筛选中不浮起；不合法落点不调回调；被编辑挡住时报错不弹框
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TreePane } from '../src/client/components/TreePane.tsx'
import { NavProvider, createTabsNavStore } from '../src/client/lib/nav.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

Element.prototype.scrollIntoView ??= function () {}
const N = (name, rel, dir, children = []) => ({ name, rel, dir, path: dir ? null : rel, desc: '', count: 0, children })
const TREE = { children: [
  N('知识', '知识', true, [N('甲', '知识/甲.md', false), N('K', '知识/K', true, [N('子', '知识/K/子.md', false)]), N('乙', '知识/乙.md', false)]),
  N('工作', '工作', true, []),
] }
const env = { api: { onChanged: () => () => {} }, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false }
const ptr = (t, type, y) => t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 40, clientY: y, button: 0 }))
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const names = (host) => [...host.querySelectorAll('[data-row]')].map((r) => r.textContent)
const row = (host, name) => [...host.querySelectorAll('[data-row]')].find((r) => r.textContent === name)

async function mount(edit, opened = []) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const props = { title: '知识沉淀', load: async () => TREE, currentId: null, onOpen: (p) => opened.push(p), edit }
  await act(async () => { createRoot(host).render(h(WikiEnvProvider, { value: env }, h(NavProvider, { store: createTabsNavStore({ kind: 'kb' }) }, h(TreePane, props)))) })
  await wait(0)
  await act(async () => { host.querySelector('[data-row] button').click() })   // 展开「知识」：知识 甲 K 乙 工作
  host.querySelector('[data-list]').getBoundingClientRect = () => ({ top: 0, left: 0, right: 260, bottom: 400, width: 260, height: 400, x: 0, y: 0 })
  return host
}
function fakeEdit(over = {}) {
  const calls = []
  return { calls, edit: {
    reorder: async (...a) => { calls.push(['reorder', ...a]) },
    move: async (...a) => { calls.push(['move', ...a]) },
    impact: async () => ({ pages: 3 }),
    blocked: () => null,
    ...over,
  } }
}

test('长按满 380ms 浮起；同文件夹落点 → reorder，乐观先显示；松手补发的 click 不打开页', async () => {
  const { calls, edit } = fakeEdit()
  const opened = []
  const host = await mount(edit, opened)
  assert.deepEqual(names(host), ['知识', '甲', 'K', '乙', '工作'])
  await act(async () => { ptr(row(host, '甲'), 'pointerdown', 48) })
  await wait(420)
  assert.ok(host.querySelector('[data-floating]'), '浮起')
  assert.ok(row(host, '甲').className.includes('ghost'), '原行变淡')
  await act(async () => { ptr(document, 'pointermove', 3 * 32 + 26) })
  assert.ok(host.querySelector('[data-line]'), '插入线')
  await act(async () => { ptr(document, 'pointerup', 3 * 32 + 26); row(host, '甲').click() })
  assert.deepEqual(calls, [['reorder', '知识/甲.md', { after: '知识/乙.md' }]])
  assert.deepEqual(names(host), ['知识', 'K', '乙', '甲', '工作'], '乐观显示')
  assert.deepEqual(opened, [], '补发的 click 被吞掉')
  await act(async () => { row(host, '甲').click() })
  assert.deepEqual(opened, ['知识/甲.md'], '之后的点击照常')
  assert.equal(host.querySelector('[data-floating]'), null)
})

test('跨文件夹：确认框写影响页数，取消不动、确认才 move', async () => {
  const { calls, edit } = fakeEdit()
  const host = await mount(edit)
  await act(async () => { ptr(row(host, '乙'), 'pointerdown', 3 * 32 + 10) })
  await wait(420)
  await act(async () => { ptr(document, 'pointermove', 2 * 32 + 16) })
  assert.ok(row(host, 'K').className.includes('into'), '放进：整行高亮')
  await act(async () => { ptr(document, 'pointerup', 2 * 32 + 16) })
  await wait(0)
  const dlg = document.querySelector('[role="dialog"]')
  assert.ok(dlg && dlg.textContent.includes('会改 3 页里的链接'), dlg?.textContent)
  assert.ok(dlg.textContent.includes('从「知识」移到「K」'))
  assert.deepEqual(calls, [])
  await act(async () => { [...dlg.querySelectorAll('button')].find((b) => b.textContent === '移动').click() })
  assert.deepEqual(calls, [['move', '知识/乙.md', '知识/K', {}]])
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('不满 380ms 松手是普通点击；筛选中长按不浮起；不合法落点不调回调', async () => {
  const { calls, edit } = fakeEdit()
  const opened = []
  const host = await mount(edit, opened)
  await act(async () => { ptr(row(host, '甲'), 'pointerdown', 48) })
  await wait(100)
  await act(async () => { ptr(document, 'pointerup', 48); row(host, '甲').click() })
  assert.deepEqual(opened, ['知识/甲.md'])
  assert.equal(host.querySelector('[data-floating]'), null)
  await act(async () => { ptr(row(host, '乙'), 'pointerdown', 3 * 32 + 10) })
  await wait(420)
  await act(async () => { ptr(document, 'pointermove', 3); ptr(document, 'pointerup', 3) })
  assert.deepEqual(calls, [], '落到与四区并列的顶层：不动')
  await act(async () => { host.querySelector('[aria-label="筛选目录"]').click() })
  const input = host.querySelector('input')
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '甲'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { ptr(row(host, '甲'), 'pointerdown', 48) })
  await wait(420)
  assert.equal(host.querySelector('[data-floating]'), null, '筛选中不浮起')
  await act(async () => { ptr(document, 'pointerup', 48) })
})

test('被编辑挡住：报错一行、不弹框、不调 move', async () => {
  const { calls, edit } = fakeEdit({ blocked: () => '「甲」有没保存的改动，先保存再移动' })
  const host = await mount(edit)
  await act(async () => { ptr(row(host, '甲'), 'pointerdown', 48) })
  await wait(420)
  await act(async () => { ptr(document, 'pointermove', 2 * 32 + 16); ptr(document, 'pointerup', 2 * 32 + 16) })
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(host.querySelector('[role="alert"]').textContent, /先保存再移动/)
  assert.deepEqual(calls, [])
})

test('浮起后按 Esc 取消：松手补发的 click 不打开页、不调回调', async () => {
  const { calls, edit } = fakeEdit()
  const opened = []
  const host = await mount(edit, opened)
  await act(async () => { ptr(row(host, '甲'), 'pointerdown', 48) })
  await wait(420)
  await act(async () => { ptr(document, 'pointermove', 3 * 32 + 26) })
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(host.querySelector('[data-floating]'), null, 'Esc 收起')
  await act(async () => { ptr(document, 'pointerup', 3 * 32 + 26); row(host, '甲').click() })
  assert.deepEqual(opened, [], 'Esc 之后补发的 click 被吞掉')
  assert.deepEqual(calls, [])
})
