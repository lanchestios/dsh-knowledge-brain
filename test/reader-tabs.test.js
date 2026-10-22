// @vitest-environment jsdom
// ReaderPage 多 tab：普通点按原地替换、Cmd+点开新 tab、去重聚焦、保活（非活动 pane 常挂 hidden）、
// panel.view 只由活动 tab 上报、真标题进标题表、tab 条出现/关闭/归一
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { ReaderPage } from '../src/client/reader/ReaderPage.tsx'
import { createPanelState } from '../src/client/reader/panel.ts'
import { WikiEnvProvider } from '../src/client/env.tsx'
import { routeKey, tabKey } from '../src/client/lib/nav.tsx'

// jsdom 没有 ResizeObserver：PageView 里的局部图（local-graph）挂载要用，给个空实现
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
// jsdom 的元素没有 scrollTo：PageView 挂载期的锚点滚动会调，空实现即可
Element.prototype.scrollTo = () => {}

let vaultSeq = 0
const status = () => ({ ok: true, dir: `/tmp/vault-${++vaultSeq}`, pages: 3, error: null, degraded: false })
// done ≥ 1 避开空库 Launchpad；drafts / recent 各给一行，保证沉淀带两栏都出「去查看」
const HOME = { stats: { done: 1, drafts: [{ id: '知识/草.md', name: '草', area: '知识', updated: '2026-10-01' }], recent: [{ id: '知识/甲.md', name: '甲', area: '知识', updated: '2026-10-01' }] } }
const PAGE = (id, title) => ({ ok: true, page: { id, title, description: '', tags: [], area: '知识', crumbs: [], children: [], status: 'draft', html: `<p>${title}</p>`, toc: [], prev: null, next: null, backlinks: [], offline: false } })

function mkApi() {
  const STATUS = status()
  return {
    __status: STATUS,
    status: async () => STATUS,
    onChanged: () => () => {},
    home: async () => HOME,
    books: async () => [],
    documents: async () => [],
    listenState: async () => ({ current: null, history: [], sources: { mic: true, system: true }, systemDeviceId: '' }),
    drafts: async () => [],
    recent: async () => [],
    page: async (id) => PAGE(id, id.includes('乙') ? '乙页' : '甲页'),
    raw: async () => ({ ok: false }),
    chapter: async (book, id) => ({ book, chapter: { id, title: '第一章', state: 'unread', read: false, text: 'raw/book/书/章节/01.md', dest: null, pages: [] }, raw: '正文', html: null, toc: [] }),
    book: async (name) => ({ name, path: 'raw/book/书', progress: '', source: null, materialStatus: 'ready', materialError: '', chapters: [] }),
  }
}

async function mountReader(api) {
  const panel = createPanelState()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(h(WikiEnvProvider, { value: { api, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(ReaderPage, { panel })))
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return { host, panel }
}

const goBtns = (host) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === '去查看')
const panes = (host) => [...host.querySelectorAll('[data-pane]')]

test('首页上点「去查看」进列表页：导航位换页、不开 tab；按住 Cmd 也一样（首页不是 tab 来源，Review Focus 3）', async () => {
  const { host, panel } = await mountReader(mkApi())
  assert.equal(goBtns(host).length, 2, '首页两个「去查看」入口')
  await act(async () => { goBtns(host)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })) })
  assert.deepEqual([panel.nav.get().route.kind, panel.nav.get().active, panel.nav.get().tabs.length], ['drafts', -1, 0])
  assert.ok(!host.querySelector('[role="tablist"]'), '导航位没有 tab 条')
})

test('导航位 pane 常挂：开着文档时回导航位，导航位 pane 可见、文档 pane 藏起；再切回文档反过来', async () => {
  const { host, panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.openTab({ kind: 'page', id: '知识/甲.md' }) })
  assert.equal(panes(host).length, 2, '导航位 + 一篇文档')
  assert.equal(panes(host)[0].hasAttribute('hidden'), true, '停在文档：导航位藏起')
  await act(async () => { panel.nav.go({ kind: 'kb' }) })
  assert.equal(panes(host)[0].hasAttribute('hidden'), false, '回导航位：导航位可见')
  assert.equal(panes(host)[1].hasAttribute('hidden'), true)
})

test('panel.view 只由活动 tab 上报；真标题进标题表；顶栏编辑入口活着（Shell 层 Ctx 反挂）', async () => {
  const { host, panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.openTab({ kind: 'page', id: '知识/甲.md' }) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panel.view.get().page?.page?.title, '甲页')
  // TopBar 的编辑入口走 useEditPath → usePage()：它在 Shell 层的 PageCtx 里拿数据，
  // 断言它渲染出来 = PageCtx 移出 Shell 后顶栏没断粮（Review Focus 5）
  assert.ok([...host.querySelectorAll('button')].some((b) => b.textContent.trim() === '编辑'), '顶栏编辑入口在')
  const properties = host.querySelector('button[aria-label="展开属性"]')
  assert.ok(properties, '文章标题右侧提供属性折叠按钮')
  assert.equal(properties.getAttribute('aria-expanded'), 'false', '属性默认收起')
  await act(async () => { properties.click() })
  assert.equal(properties.getAttribute('aria-expanded'), 'true', '点击后展开属性')
  assert.equal(properties.getAttribute('aria-label'), '收起属性')
  await act(async () => { panel.nav.openTab({ kind: 'page', id: '知识/乙.md' }) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panel.view.get().page?.page?.title, '乙页', '切 tab 换上报')
  assert.equal(panel.nav.get().titles.get(routeKey({ kind: 'page', id: '知识/乙.md' })), '乙页', '真标题上报')
})

test('无右栏路由上挑了随手会话（free）：右栏随订随开、清了随收', async () => {
  const { host, panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.go({ kind: 'drafts' }) })
  await act(async () => { await Promise.resolve() })
  assert.equal(panel.view.get().right, null, 'drafts 自身不带右栏')
  await act(async () => { panel.free.set('s1') })
  assert.equal(panel.view.get().right?.width, 400, '设 free 开栏')
  await act(async () => { panel.free.set(null) })
  assert.equal(panel.view.get().right, null, '清 free 收栏')
})

test('导航位没有 tab 条；开一篇出条；关最后一篇回导航位（上次的导航页）、条退场', async () => {
  const { host, panel } = await mountReader(mkApi())
  assert.ok(!host.querySelector('[role="tablist"]'), '起手停在导航位')
  await act(async () => { panel.nav.go({ kind: 'drafts' }) })
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/甲.md' }) })
  assert.ok(host.querySelector('[role="tablist"]'), '开一篇出条')
  await act(async () => { panel.nav.go({ kind: 'drafts' }) })
  assert.ok(!host.querySelector('[role="tablist"]'))
  await act(async () => { panel.nav.switchTab(0) })
  await act(async () => { host.querySelector('[role="tab"] button').click() })
  assert.ok(!host.querySelector('[role="tablist"]'))
  assert.equal(panel.nav.get().route.kind, 'drafts', '回到上次的导航页（草稿），不是首页')
})

test('章节 tab 数据到了上报库内路径；书是导航页、不上报', async () => {
  const { panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.openTab({ kind: 'chapter', book: '《书》', id: '01' }) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panel.nav.get().paths.get(tabKey({ kind: 'chapter', book: '《书》', id: '01' })), 'raw/book/书/章节/01.md')
  await act(async () => { panel.nav.go({ kind: 'book', name: '《书》' }) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panel.nav.get().paths.size, 1)
})

test('重启恢复：存档里的 tab 照原样恢复、停在原来那个；指向已删页的 tab 照常出现、打开显示载入失败（Review Focus 1）', async () => {
  const api = mkApi()
  const gone = '知识/已删.md'
  api.page = async (id) => { if (id === gone) throw new Error('页不存在'); return PAGE(id, '甲页') }
  localStorage.setItem(`dsh-knowledge-brain:tabs:${api.__status.dir}`, JSON.stringify({ v: 2, hub: { kind: 'books' }, tabs: [{ kind: 'page', id: '知识/甲.md' }, { kind: 'page', id: gone }], active: 1 }))
  const { host, panel } = await mountReader(api)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.deepEqual(panel.nav.get().tabs.map((r) => r.id), ['知识/甲.md', gone])
  assert.equal(panel.nav.get().active, 1)
  assert.deepEqual(panel.nav.get().hub, { kind: 'books' }, '导航位也恢复')
  const visible = panes(host).find((p) => !p.hidden)
  assert.ok(visible.textContent.includes('载入失败'), '已删的页：载入失败视图，不白屏')
})

test('后台保活上限 8 只算文档：导航位常挂不占名额；最久没用的文档 pane 卸掉，切回去重新挂上', async () => {
  const { host, panel } = await mountReader(mkApi())
  for (let i = 1; i <= 10; i++) await act(async () => { panel.nav.openTab({ kind: 'page', id: `知识/p${i}.md` }) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panel.nav.get().tabs.length, 10)
  assert.equal(panes(host).length, 9, '导航位 1 + 文档 8')
  await act(async () => { panel.nav.switchTab(0) })   // p1：最久没用、已被卸
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(panes(host).length, 9)
  assert.equal(panes(host).filter((p) => !p.hidden).length, 1, '只有一个 pane 可见')
})

test('滚动记忆：pane 卸掉前记下位置，重新挂上后还原', async () => {
  const { scrollMemo } = await import('../src/client/reader/tabs/scrollMemo.ts')
  const { host, panel } = await mountReader(mkApi())
  const first = { kind: 'page', id: '知识/p1.md' }
  await act(async () => { panel.nav.go(first) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const sc = host.querySelector('[data-pane]:not([hidden]) [data-scroll]')
  // jsdom 不做布局，scrollTop 赋值无效：直接把属性钉成 420
  Object.defineProperty(sc, 'scrollTop', { configurable: true, writable: true, value: 420 })
  sc.dispatchEvent(new Event('scroll'))
  for (let i = 2; i <= 9; i++) await act(async () => { panel.nav.openTab({ kind: 'page', id: `知识/p${i}.md` }) })
  assert.equal(scrollMemo.take(tabKey(first)), 420, '卸掉时记下')
})

test('换库：旧库的 tab 写回旧库、不跟进新库；新库的存档照样恢复（换库不串）', async () => {
  const api = mkApi()
  const ls = []
  api.onChanged = (cb) => { ls.push(cb); return () => {} }
  const A = api.__status.dir, B = `${A}-B`
  localStorage.setItem(`dsh-knowledge-brain:tabs:${B}`, JSON.stringify({ v: 2, hub: { kind: 'kb' }, tabs: [{ kind: 'page', id: '知识/乙.md' }], active: 0 }))
  const { panel } = await mountReader(api)
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/甲.md' }) })
  api.status = async () => ({ ...api.__status, dir: B })
  await act(async () => { ls.forEach((cb) => cb({ kind: 'structural' })) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.deepEqual(panel.nav.get().tabs, [{ kind: 'page', id: '知识/乙.md' }], '换成 B 的存档')
  const savedA = JSON.parse(localStorage.getItem(`dsh-knowledge-brain:tabs:${A}`))
  assert.deepEqual(savedA.tabs, [{ kind: 'page', id: '知识/甲.md' }], 'A 的 tab 写回 A')
})

test('从导航位点开文档：每次开新 tab；文档里普通点击原地换', async () => {
  const { panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/甲.md' }) })
  await act(async () => { panel.nav.go({ kind: 'kb' }) })
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/乙.md' }) })
  assert.equal(panel.nav.get().tabs.length, 2, '从导航位点第二篇：又开一个')
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/丙.md' }) })
  assert.equal(panel.nav.get().tabs.length, 2, '在文档里点：原地换')
})

test('编辑一篇时点回首页：退出编辑，导航位显示首页（Review Focus 5）', async () => {
  const { panel } = await mountReader(mkApi())
  await act(async () => { panel.nav.go({ kind: 'page', id: '知识/甲.md' }) })
  await act(async () => { panel.edit.start('知识/甲.md') })
  await act(async () => { panel.nav.go({ kind: 'kb' }) })
  assert.equal(panel.edit.get().path, null, '离开正在编辑的页即退出编辑')
  assert.equal(panel.nav.get().route.kind, 'kb')
})
