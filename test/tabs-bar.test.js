// @vitest-environment jsdom
// tab 条：只装文档、停在文档 tab 上才显示（只开一篇也显示）、停在导航位不显示；标题占位与真标题、点切换、
// × 关闭（关最后一个回导航位、条退场）、键盘切换、右键菜单、复制路径、拖动排序、压窄不滚动
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TabsBar, pathOf, tabLabel } from '../src/client/reader/TabsBar.tsx'
import { createTabsNavStore, tabKey } from '../src/client/lib/nav.tsx'

async function mount(st) {
  // 上一个用例没收起的右键菜单（门户在 body 上）别串进这个用例的 querySelector
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(h(TabsBar, { store: st })) })
  return host
}
const KB = { kind: 'kb' }
const P = (id) => ({ kind: 'page', id })
const tabs = (host) => [...host.querySelectorAll('[role="tab"]')]
const menuItem = (label) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === label)
const rightClick = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 12 }))

test('停在导航位不显示（有没有文档都一样）；停在文档 tab 上显示，只开一篇也显示', async () => {
  const st = createTabsNavStore(KB)
  const host = await mount(st)
  assert.equal(host.textContent, '', '没有文档')
  await act(async () => { st.go(P('知识/甲.md')) })
  assert.equal(tabs(host).length, 1, '只开一篇也有条')
  await act(async () => { st.go({ kind: 'books' }) })
  assert.equal(host.textContent, '', '回到导航位：条退场')
})

test('占位标题剥 .md、真标题覆盖、点切换、× 关最后一个回导航位', async () => {
  const st = createTabsNavStore(KB)
  st.openTab(P('知识/甲.md')); st.openTab(P('知识/乙.md'))
  st.setTitle(P('知识/乙.md'), '乙页')
  const host = await mount(st)
  assert.deepEqual(tabs(host).map((t) => t.querySelector('span').textContent), ['甲', '乙页'])
  await act(async () => { tabs(host)[0].click() })
  assert.equal(st.get().active, 0)
  await act(async () => { tabs(host)[0].querySelector('button').click() })
  await act(async () => { tabs(host)[0].querySelector('button').click() })
  assert.deepEqual([st.get().tabs, st.get().active], [[], -1])
  assert.equal(host.textContent, '')
})

test('键盘可达：活动 tab 进 tab 序、左右方向键循环切', async () => {
  const st = createTabsNavStore(KB)
  st.openTab(P('a.md')); st.openTab(P('b.md')); st.openTab(P('c.md'))
  const host = await mount(st)
  assert.equal(tabs(host)[2].tabIndex, 0)
  assert.equal(tabs(host)[0].tabIndex, -1)
  await act(async () => { tabs(host)[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  assert.equal(st.get().active, 0)
  assert.equal(document.activeElement, tabs(host)[0])
})

test('章节占位：打开时带了标题就显示标题（与 pane 上报的真标题一致），没带退回章节号；带不带标题是同一个 tab', () => {
  const bare = { kind: 'chapter', book: '书', id: '1.1' }
  const titled = { ...bare, title: '什么是向量' }
  assert.equal(tabLabel(titled), '什么是向量')
  assert.equal(tabLabel(bare), '1.1')
  assert.equal(tabKey(titled), tabKey(bare))
  const st = createTabsNavStore(KB)
  st.openTab(titled); st.openTab(bare)
  assert.equal(st.get().tabs.length, 1)
})

test('pathOf：页 / 文档看路由；章节看上报的路径表（没到为 null）；其余为 undefined', () => {
  const ch = { kind: 'chapter', book: '《书》', id: '01' }
  assert.equal(pathOf(P('知识/甲.md'), new Map()), '知识/甲.md')
  assert.equal(pathOf({ kind: 'raw', path: 'raw/a.md' }, new Map()), 'raw/a.md')
  assert.equal(pathOf(ch, new Map()), null)
  assert.equal(pathOf(ch, new Map([[tabKey(ch), 'raw/book/书/章节/01.md']])), 'raw/book/书/章节/01.md')
  assert.equal(pathOf(KB, new Map()), undefined)
})

test('右键 tab：四项、阻止浏览器菜单；关闭右侧 / 关闭其他落到 store；只剩一个时「关闭其他」「关闭右侧」禁用', async () => {
  const st = createTabsNavStore(KB)
  st.openTab(P('a.md')); st.openTab(P('b.md')); st.openTab(P('c.md'))
  const host = await mount(st)
  let ev
  await act(async () => { ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); tabs(host)[0].dispatchEvent(ev) })
  assert.equal(ev.defaultPrevented, true)
  assert.deepEqual([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent), ['关闭', '关闭其他', '关闭右侧', '复制路径'])
  await act(async () => { menuItem('关闭右侧').click() })
  assert.deepEqual(st.get().tabs, [P('a.md')])
  await act(async () => { rightClick(tabs(host)[0]) })
  assert.equal(menuItem('关闭其他').disabled, true)
  assert.equal(menuItem('关闭右侧').disabled, true)
})

test('复制路径：章节路径没到时禁用；页写进剪贴板；剪贴板不可用不抛错', async () => {
  const written = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { written.push(t) } } })
  const st = createTabsNavStore(KB)
  st.openTab({ kind: 'chapter', book: '《书》', id: '01' }); st.openTab(P('知识/甲.md'))
  const host = await mount(st)
  await act(async () => { rightClick(tabs(host)[0]) })
  assert.equal(menuItem('复制路径').disabled, true)
  await act(async () => { document.querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await act(async () => { rightClick(tabs(host)[1]) })
  await act(async () => { menuItem('复制路径').click() })
  assert.deepEqual(written, ['知识/甲.md'])
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied') } } })
  await act(async () => { rightClick(tabs(host)[1]) })
  await act(async () => { menuItem('复制路径').click() })
})

// 指针拖动：jsdom 没有 PointerEvent，用同名 MouseEvent 派发（React 与 document 监听只认事件名）
const ptr = (target, type, x, extra = {}) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0, ...extra }))
const rects = (host) => tabs(host).forEach((t, i) => { t.getBoundingClientRect = () => ({ left: i * 100, width: 100, right: i * 100 + 100, top: 0, bottom: 30, height: 30, x: i * 100, y: 0 }) })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 180)) })

test('指针拖动：越过邻居中心换位、松手吸附后落到 store；不再用原生拖放', async () => {
  const st = createTabsNavStore(KB)
  st.openTab(P('a.md')); st.openTab(P('b.md')); st.openTab(P('c.md'))
  const host = await mount(st)
  assert.equal(tabs(host)[0].getAttribute('draggable'), null, '不再 draggable')
  rects(host)
  await act(async () => { ptr(tabs(host)[0], 'pointerdown', 50); ptr(document, 'pointermove', 120); ptr(document, 'pointermove', 260) })
  assert.match(tabs(host)[1].style.transform, /translateX\(-\d+px\)/, '经过的 tab 让位')
  assert.ok(tabs(host)[0].className.includes('lift'))
  await act(async () => { ptr(document, 'pointerup', 260) })
  await settle()
  assert.deepEqual(st.get().tabs.map((r) => r.id), ['b.md', 'c.md', 'a.md'])
  assert.equal(st.get().tabs[st.get().active].id, 'c.md', '活动 tab 跟着那一篇')
  assert.ok(tabs(host).every((t) => !t.style.transform), '内联样式清掉')
})

test('没过 4px 阈值算点击；拖完补发的 click 不切 tab；Esc 取消不改顺序', async () => {
  const st = createTabsNavStore(KB)
  st.openTab(P('a.md')); st.openTab(P('b.md')); st.openTab(P('c.md'))
  const host = await mount(st)
  rects(host)
  await act(async () => { ptr(tabs(host)[0], 'pointerdown', 50); ptr(document, 'pointermove', 52); ptr(document, 'pointerup', 52); tabs(host)[0].click() })
  assert.equal(st.get().active, 0, '小抖动：普通点击切到 a')
  await act(async () => { ptr(tabs(host)[0], 'pointerdown', 50); ptr(document, 'pointermove', 160); ptr(document, 'pointerup', 160) })
  await settle()
  assert.deepEqual(st.get().tabs.map((r) => r.id), ['b.md', 'a.md', 'c.md'])
  await act(async () => { tabs(host)[0].click() })
  assert.equal(st.get().tabs[st.get().active].id, 'a.md', '拖完补发的 click 被吞掉')
  rects(host)
  await act(async () => { ptr(tabs(host)[0], 'pointerdown', 50); ptr(document, 'pointermove', 250) })
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await settle()
  assert.deepEqual(st.get().tabs.map((r) => r.id), ['b.md', 'a.md', 'c.md'], 'Esc：不改顺序')
  assert.ok(tabs(host).every((t) => !t.style.transform))
})

test('只压窄不滚动：tab 条不再横向滚动', async () => {
  // vitest 下 import.meta.url 不是 file: 协议：按仓库根（测试进程 cwd）读
  const css = (await import('node:fs')).readFileSync('src/client/reader/TabsBar.module.css', 'utf8')
  assert.doesNotMatch(css.match(/\.bar\s*\{[^}]*\}/)[0], /overflow-x:\s*auto/)
  assert.match(css, /min-width:\s*40px/)
})
