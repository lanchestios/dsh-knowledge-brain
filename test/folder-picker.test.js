// @vitest-environment jsdom
import { test, beforeAll, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FolderPicker, buildFolderTree, crumbParts } from '../src/client/components/FolderPicker.tsx'
import { visibleRows } from '../src/client/components/TreePicker.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const FOLDERS = [
  '认知', '认知/方法论',
  '知识', '知识/机器学习', '知识/机器学习/建模', '知识/机器学习/建模/Loss', '知识/机器学习/建模/模型族',
  '系统', '系统/OA系统', '系统/OA系统/技术实现', '系统/OA系统/技术实现/Flowable监听器实现', '系统/OA系统/技术实现/Flowable监听器实现/全局监听器',
]

// 面板走 portal 挂在 document.body 上，不在 host 里：面板内的东西一律从 document 找。
// 每个测试后卸掉所有挂上的根、拆掉 host 和外面按钮，免得上一个测试没关的面板被下一个找到
const mounted = []
afterEach(async () => {
  for (const { root, host, outside } of mounted.splice(0)) { await act(async () => { root.unmount() }); host.remove(); outside.remove() }
})

// 受控包一层：onChange 写回 value，同时记下每次选择
async function mount(initial = '', folders = FOLDERS) {
  const picks = []
  const host = document.createElement('div')
  const outside = document.createElement('button'); outside.textContent = '外面'
  document.body.append(host, outside)
  function Harness() {
    const [v, setV] = useState(initial)
    return h(FolderPicker, { value: v, folders, onChange: (f) => { picks.push(f); setV(f) } })
  }
  const root = createRoot(host)
  mounted.push({ root, host, outside })
  await act(async () => { root.render(h(Harness)) })
  return { host, outside, picks }
}
const trigger = (host) => host.querySelector('button[aria-haspopup="tree"]')
// 面板内：从 document 找（参数留着只为调用处不改）
const search = (_host) => document.querySelector('input[type="search"]')
const rows = (_host) => [...document.querySelectorAll('[role="treeitem"]')]
const tree = () => document.querySelector('[role="tree"]')
const rels = (host) => rows(host).map((r) => r.dataset.rel)
const openIt = async (host) => {
  await act(async () => { trigger(host).click() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const typeQ = (host, q) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search(host), q)
  search(host).dispatchEvent(new Event('input', { bubbles: true }))
})
const key = (host, k, extra = {}) => act(async () => { search(host).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })) })

test('buildFolderTree：根「知识库」在最上，区挂在它下面；父缺失的挂到根', () => {
  const { root, byRel } = buildFolderTree([...FOLDERS, '孤儿/子'])
  assert.equal(root.rel, '/')
  assert.equal(root.name, '知识库')
  assert.deepEqual(root.children.map((c) => c.rel), ['认知', '知识', '系统', '孤儿/子'])
  assert.equal(byRel.get('知识/机器学习/建模').depth, 3)
})

test('visibleRows：不搜时只出展开的；按名搜保留祖先并调淡；带 / 按路径搜；根从不命中', () => {
  const { root } = buildFolderTree(FOLDERS)
  assert.deepEqual(visibleRows(root, '', new Set(['/'])).map((r) => r.node.rel), ['/', '认知', '知识', '系统'])
  const hit = visibleRows(root, '监听器', new Set())
  assert.deepEqual(hit.map((r) => r.node.rel), ['/', '系统', '系统/OA系统', '系统/OA系统/技术实现', '系统/OA系统/技术实现/Flowable监听器实现', '系统/OA系统/技术实现/Flowable监听器实现/全局监听器'])
  assert.deepEqual(hit.map((r) => r.ghost), [true, true, true, true, false, false])
  assert.equal(visibleRows(root, '建模/loss', new Set()).at(-1).node.rel, '知识/机器学习/建模/Loss')
  assert.deepEqual(visibleRows(root, '知识库', new Set()), [], '根名不算命中')
})

test('crumbParts：「/」叫知识库；超过 4 段中间折成 …', () => {
  assert.deepEqual(crumbParts('/'), ['知识库'])
  assert.deepEqual(crumbParts('知识/机器学习/建模'), ['知识', '机器学习', '建模'])
  assert.deepEqual(crumbParts('系统/OA系统/技术实现/Flowable监听器实现/全局监听器'), ['系统', '…', 'Flowable监听器实现', '全局监听器'])
})

test('字段：未选显示占位；「/」显示知识库；已删值标红；树为空时不标红', async () => {
  assert.match(trigger((await mount('')).host).textContent, /选一个文件夹…/)
  assert.equal(trigger((await mount('/')).host).textContent.includes('知识库'), true)
  const gone = await mount('知识/旧/已删')
  assert.match(trigger(gone.host).textContent, /已不在库里，重新选一个/)
  const empty = await mount('知识/旧/已删', [])
  assert.ok(!/已不在库里/.test(trigger(empty.host).textContent))
})

test('打开：搜索框聚焦；根与选中项的祖先展开；选中项高亮且 aria-selected', async () => {
  const { host } = await mount('知识/机器学习/建模')
  await openIt(host)
  assert.ok(document.activeElement === search(host), '搜索框应有焦点')
  assert.equal(trigger(host).getAttribute('aria-expanded'), 'true')
  assert.deepEqual(rels(host), ['/', '认知', '知识', '知识/机器学习', '知识/机器学习/建模', '系统'])
  const sel = rows(host).find((r) => r.dataset.rel === '知识/机器学习/建模')
  assert.equal(sel.getAttribute('aria-selected'), 'true')
})

test('点行选中并关闭；点折叠箭头只展开不选', async () => {
  const { host, picks } = await mount('')
  await openIt(host)
  await act(async () => { document.querySelector('[data-twisty="知识"]').click() })
  assert.ok(rels(host).includes('知识/机器学习'))
  assert.deepEqual(picks, [])
  await act(async () => { rows(host).find((r) => r.dataset.rel === '知识/机器学习').click() })
  assert.deepEqual(picks, ['知识/机器学习'])
  assert.equal(search(host), null, '选完关闭')
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.ok(document.activeElement === trigger(host), '焦点回到字段')
})

test('选「知识库」写回 /', async () => {
  const { host, picks } = await mount('')
  await openIt(host)
  await act(async () => { rows(host).find((r) => r.dataset.rel === '/').click() })
  assert.deepEqual(picks, ['/'])
})

test('搜索：命中高亮；没有命中给提示', async () => {
  const { host } = await mount('')
  await openIt(host)
  await typeQ(host, 'loss')
  assert.equal(document.querySelector('mark')?.textContent, 'Loss')
  await typeQ(host, '不存在的')
  assert.equal(rows(host).length, 0)
  assert.match(tree().textContent, /没有名字里带「不存在的」的文件夹/)
})

test('键盘：↑↓ 移动，→ 展开 / 进第一个子，← 收起 / 回父，Enter 选中', async () => {
  const { host, picks } = await mount('')
  await openIt(host)
  const active = () => document.querySelector('[role="treeitem"][data-active="true"]')?.dataset.rel
  assert.equal(active(), undefined, '未选时打开没有活动行（新增不预选）')
  await key(host, 'Enter')
  assert.deepEqual(picks, [], '没有活动行时 Enter 不选，免得误选成整个知识库')
  assert.ok(search(host), 'Enter 没选时面板不关')
  await key(host, 'ArrowDown')
  assert.equal(active(), '/', '没有活动行时 ↓ 到第一行')
  await key(host, 'ArrowDown'); await key(host, 'ArrowDown')
  assert.equal(active(), '知识')
  await key(host, 'ArrowRight')
  assert.ok(rels(host).includes('知识/机器学习'))
  await key(host, 'ArrowRight')
  assert.equal(active(), '知识/机器学习')
  await key(host, 'ArrowLeft')
  assert.equal(active(), '知识')
  await key(host, 'ArrowLeft')
  assert.ok(!rels(host).includes('知识/机器学习'))
  await key(host, 'Enter')
  assert.deepEqual(picks, ['知识'])
})

test('Esc 只关面板、焦点回字段、不往外冒（外层弹窗不跟着关）；输入法组字中的 Enter 不处理', async () => {
  const { host, picks } = await mount('')
  let outerEsc = 0
  const onDoc = (e) => { if (e.key === 'Escape') outerEsc++ }
  document.addEventListener('keydown', onDoc)
  try {
    await openIt(host)
    await key(host, 'Enter', { isComposing: true })
    assert.deepEqual(picks, [], '组字中不选')
    let ev
    await act(async () => { ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); search(host).dispatchEvent(ev) })
    assert.equal(search(host), null)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    assert.ok(document.activeElement === trigger(host), '关闭后焦点回字段')
    assert.equal(ev.defaultPrevented, true, '跨 portal 也 preventDefault：宿主 Modal 不关')
    assert.equal(outerEsc, 0)
  } finally { document.removeEventListener('keydown', onDoc) }
})

test('未选时打开按 ↑ 也到第一行', async () => {
  const { host } = await mount('')
  await openIt(host)
  await key(host, 'ArrowUp')
  assert.equal(document.querySelector('[role="treeitem"][data-active="true"]')?.dataset.rel, '/')
})

test('输入搜索词后直接 Enter 选第一个命中（不是调淡的祖先）', async () => {
  const { host, picks } = await mount('')
  await openIt(host)
  await typeQ(host, '监听器')
  await key(host, 'Enter')
  assert.deepEqual(picks, ['系统/OA系统/技术实现/Flowable监听器实现'])
})

test('搜索框有 aria-label', async () => {
  const { host } = await mount('')
  await openIt(host)
  assert.equal(search(host).getAttribute('aria-label'), '搜索文件夹')
})

test('焦点不在搜索框时（落在面板里别的元素上）Esc 也只关面板、不往外冒', async () => {
  const { host } = await mount('')
  let outerEsc = 0
  const onDoc = (e) => { if (e.key === 'Escape') outerEsc++ }
  document.addEventListener('keydown', onDoc)
  try {
    await openIt(host)
    const list = tree()
    let ev
    await act(async () => { ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); list.dispatchEvent(ev) })
    assert.equal(!!search(host), false, '面板关了')
    assert.equal(ev.defaultPrevented, true, 'preventDefault：宿主 Modal 看到 defaultPrevented 不关')
    assert.equal(outerEsc, 0)
    await openIt(host)
    await act(async () => { rows(host)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    assert.equal(!!search(host), false)
    assert.equal(outerEsc, 0)
  } finally { document.removeEventListener('keydown', onDoc) }
})

test('点面板里（非搜索框）不抢走搜索框焦点', async () => {
  const { host } = await mount('')
  await openIt(host)
  const md = (el) => { const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented }
  assert.equal(md(tree()), true)
  assert.equal(md(rows(host)[0]), true)
  assert.equal(md(search(host)), false, '搜索框自己的 mousedown 不拦（要能点进去放光标）')
})

test('焦点移出选择器（Tab 走了）面板关闭；从字段到搜索框、从搜索框到面板内不关', async () => {
  const { host, outside } = await mount('')
  await act(async () => { trigger(host).focus() })
  await openIt(host)
  assert.ok(document.activeElement === search(host), '打开时焦点从字段挪到搜索框')
  assert.ok(search(host), '字段 → 搜索框的失焦不算移出')
  const tw = document.querySelector('[data-twisty="/"]')
  let rt
  search(host).addEventListener('focusout', (e) => { rt = e.relatedTarget }, { once: true })
  await act(async () => { tw.focus() })
  assert.ok(rt === tw, 'jsdom 在 focus 移动时给 focusout 带 relatedTarget')
  assert.ok(search(host), '搜索框 → 面板内元素不关')
  await act(async () => { search(host).focus() })
  let rt2
  search(host).addEventListener('focusout', (e) => { rt2 = e.relatedTarget }, { once: true })
  await act(async () => { outside.focus() })
  assert.ok(rt2 === outside, 'focusout 的 relatedTarget 是外面的按钮')
  assert.equal(!!search(host), false, '焦点到外面，面板关')
  assert.ok(document.activeElement !== trigger(host), '移出关闭不把焦点拽回字段')
})

test('点面板外关闭', async () => {
  const { host, outside } = await mount('')
  await openIt(host)
  await act(async () => { outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); outside.focus(); outside.click() })
  assert.equal(!!search(host), false)
})

test('树为空（库未打开）：面板给提示，不炸', async () => {
  const { host } = await mount('认知', [])
  await openIt(host)
  assert.match(tree().textContent, /库未打开，选不了文件夹/)
})

test('面板浮在表单上：portal 挂到 document.body，不在字段的 DOM 里（不拉高表单）', async () => {
  const { host } = await mount('')
  await openIt(host)
  const panel = tree()?.parentElement
  assert.ok(panel, '面板开着')
  assert.ok(document.body.contains(panel), '面板在 body 的 portal 中')
  assert.equal(host.contains(panel), false, '不在 host 里')
  assert.ok(panel.contains(search(host)), '搜索框在面板里')
})

test('点面板里（列表空白处）不关；点面板外关', async () => {
  const { host, outside } = await mount('')
  await openIt(host)
  await act(async () => { tree().click() })
  assert.ok(search(host), '点面板内不关')
  await act(async () => { search(host).click() })
  assert.ok(search(host), '点搜索框不关')
  await act(async () => { outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); outside.focus(); outside.click() })
  assert.equal(!!search(host), false, '点外面关')
})
