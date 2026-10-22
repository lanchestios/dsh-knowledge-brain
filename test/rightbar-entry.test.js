// @vitest-environment jsdom
// 右栏入口拆成顶栏两颗按钮（属性 / AI），栏内不再切换；会话栏头照 DSH 会话头：标题 + 子智能体胶囊
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TopBar } from '../src/client/components/TopBar.tsx'
import { NavProvider } from '../src/client/lib/nav.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'
import { createPanelState } from '../src/client/reader/panel.ts'
import { SessionHeader, ancestry, subagents } from '../src/client/sidebar/SessionHeader.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  return host
}

const api = { onChanged: () => () => {}, status: async () => ({ ok: true, dir: '/tmp/v', pages: 0, error: null, degraded: false }), tree: async () => null }
const env = { api, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false }
const bar = (panel) => h(WikiEnvProvider, { value: env }, h(NavProvider, { store: panel.nav }, h(TopBar, { inspector: panel.inspector, tab: panel.tab })))
const btn = (host, label) => host.querySelector(`button[aria-label="${label}"]`) ?? host.querySelector(`button[aria-label="收起${label}"]`)

test('有属性的页：两颗按钮，点哪颗开栏并切到它，再点同一颗收栏', async () => {
  const panel = createPanelState()
  panel.nav.go({ kind: 'page', id: '知识/甲.md' })
  const host = await mount(bar(panel))
  assert.ok(btn(host, '属性') && btn(host, 'AI'))
  assert.equal(btn(host, '属性').textContent, '属性', '右栏入口带文字')
  assert.equal(btn(host, 'AI').textContent, 'AI')
  await act(async () => { btn(host, '属性').click() })
  assert.equal(panel.inspector.get(), true)
  assert.equal(panel.tab.get(), 'props')
  await act(async () => { btn(host, 'AI').click() })
  assert.equal(panel.inspector.get(), true, '换内容不收栏')
  assert.equal(panel.tab.get(), 'session')
  assert.equal(btn(host, 'AI').getAttribute('aria-pressed'), 'true')
  await act(async () => { btn(host, 'AI').click() })
  assert.equal(panel.inspector.get(), false, '点亮着的那颗收栏')
})

test('没属性的页（首页）：只有 AI 按钮；残留的 props tab 不影响它亮', async () => {
  const panel = createPanelState()
  panel.tab.set('props')
  const host = await mount(bar(panel))
  assert.equal(host.querySelector('button[aria-label="属性"]'), null)
  await act(async () => { btn(host, 'AI').click() })
  assert.equal(panel.inspector.get(), true)
  assert.equal(btn(host, 'AI').getAttribute('aria-pressed'), 'true')
})

test('ancestry：沿子智能体 parentId 上溯到根会话，防环', () => {
  const byId = {
    root: { id: 'root', displayTitle: '根' },
    a: { id: 'a', displayTitle: 'A', origin: 'subagent', parentId: 'root' },
    b: { id: 'b', displayTitle: 'B', origin: 'subagent', parentId: 'a' },
    x: { id: 'x', displayTitle: 'X', origin: 'subagent', parentId: 'y' },
    y: { id: 'y', displayTitle: 'Y', origin: 'subagent', parentId: 'x' },
  }
  assert.deepEqual(ancestry(byId, 'b').map((x) => x.id), ['root', 'a', 'b'])
  assert.deepEqual(ancestry(byId, 'root').map((x) => x.id), ['root'])
  assert.deepEqual(ancestry(byId, 'x').map((x) => x.id), ['y', 'x'])
})

function fakeSessions(snap) {
  const refreshed = []
  return { refreshed, c: { get: (n) => n === 'sessions' ? { list: { getSnapshot: () => snap, subscribe: () => () => {} }, refreshProjections: (id) => refreshed.push(id) } : undefined } }
}

test('会话栏头：标题、子智能体胶囊计数与运行态，点子项右栏换场', async () => {
  const snap = {
    byId: {
      s: { id: 's', displayTitle: '整理第一章' },
      k1: { id: 'k1', displayTitle: 'k1', running: true, origin: 'subagent', parentId: 's' },
      k2: { id: 'k2', displayTitle: 'k2', origin: 'subagent', parentId: 's' },
    },
    projectionsBySession: { s: { values: { subagentCatalog: [{ id: 'k1', label: '检索', mode: 'one-shot' }, { id: 'k2', mode: 'continuable' }] } } },
  }
  assert.deepEqual(subagents(snap, 's').map((r) => [r.label, r.running]), [['检索', true], ['k2', false]])
  const { c, refreshed } = fakeSessions(snap)
  const opened = []
  const host = await mount(h(SessionHeader, { c, sessionId: 's', onOpen: (id) => opened.push(id) }))
  assert.ok(host.textContent.includes('整理第一章'))
  assert.deepEqual(refreshed, ['s'], '挂上就要一次子智能体目录')
  const chip = host.querySelector('button[aria-haspopup="menu"]')
  assert.equal(chip.getAttribute('aria-label'), '1 个子智能体，正在运行')
  await act(async () => { chip.click() })
  const rows = host.querySelectorAll('[role="menuitem"]')
  assert.equal(rows.length, 2)
  await act(async () => { rows[1].click() })
  assert.deepEqual(opened, ['k2'])
  assert.equal(host.querySelector('[role="menu"]'), null, '挑了就关')
})

test('子智能体会话：祖先面包屑可点回父会话；没派生过子智能体不出胶囊', async () => {
  const snap = { byId: { p: { id: 'p', displayTitle: '父' }, k: { id: 'k', displayTitle: '子', origin: 'subagent', parentId: 'p' } } }
  const opened = []
  const host = await mount(h(SessionHeader, { c: fakeSessions(snap).c, sessionId: 'k', onOpen: (id) => opened.push(id) }))
  assert.equal(host.querySelector('button[aria-haspopup="menu"]'), null)
  const crumb = [...host.querySelectorAll('nav button')].find((b) => b.textContent === '父')
  await act(async () => { crumb.click() })
  assert.deepEqual(opened, ['p'])
})
