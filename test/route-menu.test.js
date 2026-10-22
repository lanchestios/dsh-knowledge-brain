// @vitest-environment jsdom
// 链接右键菜单：「打开」走 go、「在新标签页打开」走 openTab；目标是异步解析的（双链名字要 resolve），
// 解析不到什么都不做也不抛错；没有 openTab 的导航（右栏栈式）不接管右键。目录树：有路径的行右键弹菜单，
// 目录行（无 path）不弹
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { routeForRef, useRouteMenu } from '../src/client/components/RouteMenu.tsx'
import { TreePane } from '../src/client/components/TreePane.tsx'
import { NavProvider, createTabsNavStore, createNavStore } from '../src/client/lib/nav.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

const api = { onChanged: () => () => {}, resolve: async (name) => ({ id: name === '甲' ? '知识/甲.md' : null }) }
const env = { api, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false }
const menuItem = (label) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === label)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

async function mount(store, child) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => { createRoot(host).render(h(WikiEnvProvider, { value: env }, h(NavProvider, { store }, child))) })
  return host
}

test('routeForRef：双链按全站规则解析（锚点 slug）、页链、raw/ 文档链接；外链与解析不到为 null（Review Focus 5）', async () => {
  assert.deepEqual(await routeForRef(api, { kind: 'wikilink', name: '甲', anchor: '第二节 Ab' }), { kind: 'page', id: '知识/甲.md', anchor: '第二节-ab' })
  assert.equal(await routeForRef(api, { kind: 'wikilink', name: '不存在' }), null)
  assert.deepEqual(await routeForRef(api, { kind: 'page', id: '知识/乙.md', anchor: 'h' }), { kind: 'page', id: '知识/乙.md', anchor: 'h' })
  assert.deepEqual(await routeForRef(api, { kind: 'href', href: 'raw/a.md' }), { kind: 'raw', path: 'raw/a.md' })
  assert.equal(await routeForRef(api, { kind: 'href', href: 'https://x.com' }), null)
  const boom = { resolve: async () => { throw new Error('断连') } }
  assert.equal(await routeForRef(boom, { kind: 'wikilink', name: '甲' }), null, '解析抛错也是 null')
})

// 用钩子的最小组件：一个可右键的 span，目标由 props 给
function Probe({ target }) {
  const menu = useRouteMenu()
  return h('div', null,
    h('span', { 'data-probe': '', onContextMenu: (e) => { menu?.show(e, target) } }, 'link'),
    menu?.node)
}

test('useRouteMenu：右键弹「打开 / 在新标签页打开」并阻止浏览器菜单；两项分别走 go / openTab', async () => {
  const st = createTabsNavStore({ kind: 'kb' })
  const host = await mount(st, h(Probe, { target: async () => ({ kind: 'page', id: '知识/甲.md' }) }))
  const fire = () => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }); host.querySelector('[data-probe]').dispatchEvent(ev); return ev }
  let ev
  await act(async () => { ev = fire() })
  assert.equal(ev.defaultPrevented, true)
  assert.deepEqual([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent), ['打开', '在新标签页打开'])
  await act(async () => { menuItem('在新标签页打开').click() })
  await flush()
  assert.deepEqual(st.get().tabs, [{ kind: 'page', id: '知识/甲.md' }], '开了新 tab（首页在导航位，不是 tab）')
  await act(async () => { st.go({ kind: 'kb' }) })
  await act(async () => { fire() })
  await act(async () => { menuItem('打开').click() })
  await flush()
  assert.equal(st.get().active, 0, '「打开」走 go：同篇已开就跳过去')
  assert.equal(st.get().tabs.length, 1)
})

test('useRouteMenu：目标解析不到时两项都不做事、不抛错（Review Focus 5）', async () => {
  const st = createTabsNavStore({ kind: 'kb' })
  const host = await mount(st, h(Probe, { target: async () => null }))
  await act(async () => { host.querySelector('[data-probe]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  await act(async () => { menuItem('在新标签页打开').click() })
  await flush()
  assert.deepEqual([st.get().tabs, st.get().active], [[], -1])
})

test('useRouteMenu：栈式导航（右栏 WikiPageTab）没有 openTab，不接管右键', async () => {
  const host = await mount(createNavStore({ kind: 'kb' }), h(Probe, { target: async () => ({ kind: 'kb' }) }))
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  await act(async () => { host.querySelector('[data-probe]').dispatchEvent(ev) })
  assert.equal(ev.defaultPrevented, false, '浏览器默认右键照旧')
})

test('目录树：有路径的行右键弹菜单、「在新标签页打开」开新 tab；目录行（无 path）不弹', async () => {
  const tree = { children: [
    { name: '甲', path: '知识/甲.md', rel: null, desc: '', dir: false, count: 0, children: [] },
    { name: '空目录', path: null, rel: '知识/空', desc: '', dir: true, count: 0, children: [] },
  ] }
  const st = createTabsNavStore({ kind: 'kb' })
  const host = await mount(st, h(TreePane, { title: 't', load: async () => tree, currentId: null, onOpen: () => {}, menuRoute: (id) => ({ kind: 'page', id }) }))
  await flush()
  const rows = [...host.querySelectorAll('[title]')].filter((x) => x.textContent === '甲' || x.textContent === '空目录')
  const dirEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  await act(async () => { rows.find((r) => r.textContent === '空目录').dispatchEvent(dirEv) })
  assert.equal(dirEv.defaultPrevented, false, '目录行不接管')
  await act(async () => { rows.find((r) => r.textContent === '甲').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  await act(async () => { menuItem('在新标签页打开').click() })
  await flush()
  assert.deepEqual(st.get().tabs.at(-1), { kind: 'page', id: '知识/甲.md' })
})

test('正文双链 Cmd+点：解析慢于 100ms 也开新 tab，不把正在读的文档原地换掉', async () => {
  const { openWikiRef } = await import('../src/client/components/RouteMenu.tsx')
  const { installClickModifier } = await import('../src/client/lib/nav.tsx')
  const st = createTabsNavStore({ kind: 'kb' })
  st.go({ kind: 'page', id: '知识/在读.md' })                 // 停在文档 tab：普通点击会原地换
  document.body.innerHTML = '<div data-tab-source><span id="wl"></span></div>'
  const off = installClickModifier()
  document.getElementById('wl').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, metaKey: true }))
  const slow = { resolve: () => new Promise((r) => setTimeout(() => r({ id: '知识/甲.md' }), 150)) }
  const done = openWikiRef({ api: slow, go: st.go, openTab: st.openTab }, { kind: 'wikilink', name: '甲' }, 'x.md')
  await new Promise((r) => setTimeout(r, 180))
  await done
  off()
  assert.deepEqual(st.get().tabs.map((r) => r.id), ['知识/在读.md', '知识/甲.md'], '开了新 tab，在读的那篇还在')
})
