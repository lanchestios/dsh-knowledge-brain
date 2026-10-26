// @vitest-environment jsdom
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { trackRoot, portalView } from './helpers/portals.js'
import { McpSettings } from '../src/client/settings/McpSettings.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T = 'abcd' + 'x'.repeat(35) + 'wxyz'
const ROWS = JSON.stringify([{ endpoint: 'ml', name: '机器学习', folder: '认知', token: T }, { endpoint: 'old', name: '旧笔记', folder: '学习/旧', token: T }])
const BASE = 'http://127.0.0.1:19387'
const st = (servers, extra = {}) => ({ phase: 'ok', endpointBase: BASE, servers, ...extra })
const ML = { endpoint: 'ml', name: '机器学习', folder: '认知', folderExists: true }
const OLD = { endpoint: 'old', name: '旧笔记', folder: '学习/旧', folderExists: true }
const tree = async () => ({ children: [{ dir: true, rel: '认知', children: [] }, { dir: true, rel: '学习', children: [] }] })
let clip
beforeEach(() => { clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { clip.push(t) } } }) })

async function mount({ text = '', status = { phase: 'ok', endpointBase: 'http://127.0.0.1:19387', servers: [] }, writable = true, saving, mcpStatus } = {}) {
  const edits = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  trackRoot(root, host)
  const api = { tree, mcpStatus: mcpStatus ?? (async () => status), onChanged: () => () => {} }
  const env = { api, c: {}, openExternal: () => {}, openExplorable: () => {}, useDark: () => false }
  const rerender = async (state) => {
    await act(async () => {
      root.render(h(WikiEnvProvider, { value: env }, h(McpSettings, { state, edit: (f, t) => edits.push([f, t]) })))
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
  await rerender({ writable, saving, mcpServers: { text } })
  return { host: portalView(host), edits, root, rerender }
}
// 每张卡的状态 chip 文本（一张卡应恰好一个）
const chipsOf = (host) => [...host.querySelectorAll('[data-slot="connection-card"]')].map((c) => [...c.querySelectorAll('[data-slot="connection-header"] [data-slot="status-chip"]')].map((x) => x.textContent))
const EP = '比如 ml-notes', NM = '比如 机器学习笔记'
const btn = (host, label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const click = (el) => act(async () => { el.click() })
const type = async (inp, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, value)
  await act(async () => { inp.dispatchEvent(new Event('input', { bubbles: true })) })
}
// 本文件的 tree 只有两个一级文件夹（认知、学习），打开就都在根下可见，不用展开
const pickFolder = async (host, rel) => {
  await click(host.querySelector('button[aria-haspopup="tree"]'))
  // 面板 portal 到 document.body，行不在 host 里
  await click([...document.querySelectorAll('[role="treeitem"]')].find((r) => r.dataset.rel === rel))
}

test('空态：说明直接顶在标题下，新增可点', async () => {
  const { host } = await mount()
  assert.match(host.textContent, /MCP 服务/)
  assert.match(host.textContent, /只能搜索、读取这个文件夹/)
  assert.match(host.textContent, /填端点和名称/)
  assert.match(host.textContent, /MCP参数/)
  assert.equal(btn(host, '新增').disabled, false)
})

test('新增：端点 + 名称 + 文件夹都齐才能确定；确定后写回带 43 位 token 的一行', async () => {
  const { host, edits } = await mount()
  await click(btn(host, '新增'))
  const ep = host.querySelector(`input[placeholder="${EP}"]`)
  const nm = host.querySelector(`input[placeholder="${NM}"]`)
  assert.ok(ep && nm)
  assert.ok(!/地址：/.test(host.textContent), '弹窗不再显示地址')
  assert.ok(!/必填/.test(host.textContent), '空字段不提前报错')
  await type(ep, 'a b')
  assert.equal(btn(host, '确定').disabled, true)
  assert.match(host.textContent, /只能用字母/)
  await type(ep, 'notes')
  assert.ok(!/只能用字母/.test(host.textContent))
  await pickFolder(host, '认知')
  assert.equal(btn(host, '确定').disabled, true, '没填名称不能确定')
  await type(nm, '知'.repeat(33))
  assert.match(host.textContent, /最多 32 个字/)
  assert.equal(btn(host, '确定').disabled, true)
  await type(nm, '  我的笔记 ')
  assert.equal(btn(host, '确定').disabled, false)
  assert.ok(!/只开放这个文件夹/.test(host.textContent), '文件夹下不再有说明')
  assert.ok(!/地址：/.test(host.textContent))
  await click(btn(host, '确定'))
  const [field, text] = edits.at(-1)
  assert.equal(field, 'mcpServers')
  const rows = JSON.parse(text)
  assert.equal(rows.length, 1)
  assert.deepEqual(Object.keys(rows[0]), ['endpoint', 'name', 'folder', 'token'])
  assert.equal(rows[0].endpoint, 'notes')
  assert.equal(rows[0].name, '我的笔记')
  assert.equal(rows[0].folder, '认知')
  assert.match(rows[0].token, /^[A-Za-z0-9_-]{43}$/)
})

test('新增：没选文件夹不能确定', async () => {
  const { host } = await mount()
  await click(btn(host, '新增'))
  await type(host.querySelector(`input[placeholder="${EP}"]`), 'notes')
  await type(host.querySelector(`input[placeholder="${NM}"]`), '笔记')
  assert.equal(btn(host, '确定').disabled, true)
  assert.match(host.textContent, /选一个文件夹…/)
})

test('新增：端点重名报错', async () => {
  const { host } = await mount({ text: ROWS })
  await click(btn(host, '新增'))
  await type(host.querySelector(`input[placeholder="${EP}"]`), 'ml')
  assert.match(host.textContent, /已经有同名的端点了/)
})

test('卡片：显示名称 + 端点代号；地址来自 endpointBase（不取 location）；状态 chip；token 只出现掩码', async () => {
  const { host } = await mount({ text: ROWS, status: st([ML, { ...OLD, folderExists: false }]) })
  const names = [...host.querySelectorAll('[data-slot="connection-name"]')].map((x) => x.textContent)
  assert.deepEqual(names, ['机器学习', '旧笔记'])
  const ids = [...host.querySelectorAll('[data-slot="connection-id"]')].map((x) => x.textContent)
  assert.deepEqual(ids, ['ml', 'old'])
  const urls = [...host.querySelectorAll('[data-slot="endpoint-url"]')].map((x) => x.textContent)
  assert.deepEqual(urls, ['http://127.0.0.1:19387/mcp/ml', 'http://127.0.0.1:19387/mcp/old'])
  assert.ok(!host.textContent.includes(location.origin), `不该用页面 origin（${location.origin}）`)
  assert.ok(!/dsh-app|localhost/.test(host.textContent))
  assert.deepEqual(chipsOf(host), [['已连接'], ['知识库不存在该文件夹']])
  assert.ok(!host.textContent.includes('可用'))
  assert.ok(!host.innerHTML.includes(T), 'DOM 里不能有完整 token')
})

test('卡片：没名称的行退回显示端点，不重复显示代号', async () => {
  const { host } = await mount({ text: JSON.stringify([{ endpoint: 'ml', name: '', folder: '认知', token: T }]), status: st([]) })
  assert.equal(host.querySelector('[data-slot="connection-name"]').textContent, 'ml')
  assert.ok(host.querySelector('[data-slot="connection-id"]') === null)
})

test('状态 chip 按 endpoint+folder 对：名字不同也认', async () => {
  const { host } = await mount({ text: ROWS, status: st([{ ...ML, name: '别的' }]) })
  assert.deepEqual(chipsOf(host), [['已连接'], ['保存中…']])
})

test('库校验中：每张卡只有一个状态「知识库校验中」，带转圈图标', async () => {
  const { host } = await mount({ text: ROWS, status: st([{ ...ML, folderExists: false }, { ...OLD, folderExists: false }], { phase: 'validating' }) })
  assert.deepEqual(chipsOf(host), [['知识库校验中'], ['知识库校验中']])
  for (const card of host.querySelectorAll('[data-slot="connection-card"]')) {
    const chip = card.querySelector('[data-slot="status-chip"]')
    assert.ok(chip.querySelector('[data-icon="loading"]') !== null, '转圈图标在 chip 里')
    assert.equal(chip.getAttribute('data-tone'), 'loading', '校验中使用加载态')
  }
  assert.ok(!host.textContent.includes('不存在'))
})

test('没配库 / 校验失败：只显示库阶段', async () => {
  const gone = [{ ...ML, folderExists: false }, { ...OLD, folderExists: false }]
  const none = await mount({ text: ROWS, status: st(gone, { phase: 'none' }) })
  assert.deepEqual(chipsOf(none.host), [['知识库未初始化'], ['知识库未初始化']])
  const failed = await mount({ text: ROWS, status: st(gone, { phase: 'failed' }) })
  assert.deepEqual(chipsOf(failed.host), [['知识库校验失败'], ['知识库校验失败']])
  assert.ok(failed.host.querySelector('[data-icon="loading"]') === null)
})

test('MCP参数：剪贴板拿到通用 JSON（完整 token）；卡上预览打码；没有旧的复制菜单', async () => {
  const { host } = await mount({ text: ROWS, status: st([ML]) })
  assert.ok(host.querySelector('button[data-act="copy"]') === null)
  assert.ok(!/复制配置/.test(host.textContent))
  const b = host.querySelectorAll('button[data-act="params"]')[0]
  assert.equal(b.textContent.trim(), 'MCP参数')
  assert.equal(b.disabled, false)
  await click(b)
  await act(async () => { await Promise.resolve() })
  assert.equal(clip.length, 1)
  assert.deepEqual(JSON.parse(clip[0]), { mcpServers: { ml: { type: 'http', url: 'http://127.0.0.1:19387/mcp/ml', headers: { Authorization: `Bearer ${T}` } } } })
  assert.match(host.textContent, /✓ 已复制MCP参数/)
  const pre = host.querySelector('[data-slot="mcp-preview"]').textContent
  assert.match(pre, /abcd••••••••wxyz/)
  assert.ok(!host.innerHTML.includes(T))
})

test('endpointBase 为 null：不显示地址，MCP参数 按钮不可点并说明原因', async () => {
  const { host } = await mount({ text: ROWS, status: st([ML, OLD], { endpointBase: null }) })
  assert.ok(host.querySelector('[data-slot="endpoint-url"]') === null)
  assert.ok(!/\/mcp\//.test(host.textContent))
  const b = host.querySelectorAll('button[data-act="params"]')[0]
  assert.equal(b.disabled, true)
  assert.equal(b.getAttribute('title'), 'DSH 还没给出端点地址')
})

test('删除要二次确认；确认后写回剩下的行', async () => {
  const { host, edits } = await mount({ text: ROWS })
  await click(host.querySelectorAll('button[data-act="delete"]')[0])
  assert.equal(edits.length, 0)
  assert.match(host.textContent, /会立刻失效/)
  await click(btn(host, '确认删除'))
  assert.deepEqual(JSON.parse(edits.at(-1)[1]).map((r) => r.endpoint), ['old'])
})

test('编辑时重新生成 token、改端点：分别提示要重新复制 MCP参数；只改名称不提示', async () => {
  const { host } = await mount({ text: ROWS })
  await click(host.querySelectorAll('button[data-act="edit"]')[0])
  await type(host.querySelector(`input[placeholder="${NM}"]`), '新名字')
  assert.ok(!/改端点会改地址/.test(host.textContent))
  await click(btn(host, '重新生成'))
  assert.match(host.textContent, /token 换了，确定后，用旧 token 的客户端会连不上，要重新复制 MCP参数。/)
  await type(host.querySelector(`input[placeholder="${EP}"]`), 'ml2')
  assert.match(host.textContent, /改端点会改地址，已经配好的客户端要重新复制 MCP参数。/)
})

test('配置引导：折叠入口文字是「配置引导」', async () => {
  const { host } = await mount({ text: ROWS })
  const t = host.querySelector('[data-slot="guide-trigger"]')
  assert.match(t.textContent, /配置引导/)
  assert.ok(!/说明/.test(t.textContent))
  await click(t)
  assert.match(host.textContent, /Claude Code 的 \.mcp\.json、Cursor 的 mcp\.json/)
})

test('mcpStatus 抛错：不炸树，卡片照常显示（无地址）', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const api = { tree, mcpStatus: () => { throw new Error('boom') }, onChanged: () => () => {} }
  await act(async () => {
    createRoot(host).render(h(WikiEnvProvider, { value: { api, c: {}, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(McpSettings, { state: { writable: true, mcpServers: { text: ROWS } }, edit: () => {} })))
  })
  assert.match(host.textContent, /机器学习/)
  assert.ok(!/保存中/.test(host.textContent), '状态取不到时不该一直显示保存中')
})

test('保存落定后重查状态：保存中 → 已连接', async () => {
  let saved = false
  const mcpStatus = async () => (saved ? st([ML, OLD]) : st([]))
  const { host, rerender } = await mount({ text: ROWS, saving: true, mcpStatus })
  assert.match(host.textContent, /保存中/)
  saved = true
  await rerender({ writable: true, saving: false, mcpServers: { text: ROWS } })
  assert.deepEqual(chipsOf(host), [['已连接'], ['已连接']])
  assert.ok(!/保存中/.test(host.textContent))
})

test('选「知识库」写回 folder「/」，卡片显示「知识库」', async () => {
  const { host, edits } = await mount()
  await click(btn(host, '新增'))
  await type(host.querySelector(`input[placeholder="${EP}"]`), 'all')
  await type(host.querySelector(`input[placeholder="${NM}"]`), '全库')
  await pickFolder(host, '/')
  await click(btn(host, '确定'))
  assert.equal(JSON.parse(edits.at(-1)[1])[0].folder, '/')
  const again = await mount({ text: JSON.stringify([{ endpoint: 'all', name: '全库', folder: '/', token: T }]) })
  assert.equal(again.host.querySelector('[data-slot="connection-meta"] > span')?.textContent, '知识库')
})
