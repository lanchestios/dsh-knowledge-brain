// @vitest-environment jsdom
// 挂载回归：「插件设置页打不开」——模型目录 effect 在挂载期同步抛（在 undefined 上调 .then），
// React 没有错误边界兜着就把整棵设置树卸了。这里按真实客户端形态喂 c：宿主把插件 ctx 包成
// 白名单代理，服务要么没有要么是普通对象，链上任何一环缺了/抛了都不能炸树，拿不到目录就
// 退回文本输入。真桌面端的原始事故形态 = 场景「目录链路缺这一环」。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { trackRoot, portalView } from './helpers/portals.js'
import { LarkSettings } from '../src/client/settings/LarkSettings.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

const api = {
  tree: async () => ({ children: [{ dir: true, rel: '认知', children: [] }] }),
  larkStatus: async () => ({ connected: false, apps: [] }),
  onChanged: () => () => {},
}
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
Element.prototype.scrollIntoView ??= function () {}
const state = { writable: true, larkApps: { text: '' } }

async function mountWith(c, envExtra = {}, apiExtra = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  trackRoot(root, host)
  await act(async () => {
    root.render(h(WikiEnvProvider, { value: { api: { ...api, ...apiExtra }, c, openExternal: () => {}, openExplorable: () => {}, useDark: () => false, ...envExtra } },
      h(LarkSettings, { state, edit: () => {} })))
  })
  // 排空微任务，让 modelCatalog 链上的 then/catch 落地
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return portalView(host)
}

// 打开「新增」Modal（tree 里有一个文件夹，按钮才可用），返回承载 Modal 的宿主
async function openAddModal(host) {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === '新增')
  await act(async () => { btn.click() })
  return portalView(host)
}

const MODEL_INPUT = 'input[placeholder^="provider/model"]'

test('目录正常：模型下拉带 provider 分组', async () => {
  const host = await mountWith({ get: (name) => name === 'remote.session'
    ? { modelCatalog: () => Promise.resolve({ ok: true, value: { groups: [{ id: 'deepseek', models: [{ id: 'chat' }] }] } }) }
    : undefined })
  await openAddModal(host)
  await act(async () => host.querySelector('button[aria-label="选择模型"]').click())
  const opt = document.querySelector('[cmdk-item][data-value="deepseek/chat"]')
  assert.ok(opt, '模型列表里应有 deepseek/chat 选项')
  assert.equal(opt.closest('[cmdk-group]').querySelector('[cmdk-group-heading]').textContent, 'deepseek')
})

test('目录链路缺这一环（真桌面端事故形态）：不炸树，退回文本输入', async () => {
  const host = await mountWith({ get: () => undefined })
  await openAddModal(host)
  assert.ok(host.querySelector(MODEL_INPUT), '拿不到目录时应退回 provider/model 文本输入')
})

test('modelCatalog 同步抛：不炸树，退回文本输入', async () => {
  const host = await mountWith({ get: (name) => name === 'remote.session'
    ? { modelCatalog: () => { throw new Error('connection not ready') } }
    : undefined })
  await openAddModal(host)
  assert.ok(host.querySelector(MODEL_INPUT))
})

test('modelCatalog 返回非 thenable：不炸树，退回文本输入', async () => {
  const host = await mountWith({ get: (name) => name === 'remote.session'
    ? { modelCatalog: () => undefined }
    : undefined })
  await openAddModal(host)
  assert.ok(host.querySelector(MODEL_INPUT))
})

test('modelCatalog 拒绝：不炸树，退回文本输入', async () => {
  const host = await mountWith({ get: (name) => name === 'remote.session'
    ? { modelCatalog: () => Promise.reject(new Error('boom')) }
    : undefined })
  await openAddModal(host)
  assert.ok(host.querySelector(MODEL_INPUT))
})

const findBtn = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)

test('机器人卡仅保留编辑、检测、删除操作', async () => {
  const old = state.larkApps.text
  state.larkApps.text = '[{"appId":"cli_x","appSecret":"s","folder":"认知","model":""}]'
  try {
    const host = await mountWith({ get: () => undefined })
    assert.deepEqual([...host.querySelectorAll('[data-slot="connection-actions"] button')].map((b) => b.textContent), ['编辑', '检测', '删除'])
    await act(async () => findBtn(host, '编辑').click())
    assert.ok(document.querySelector('[data-wiki-dialog]').textContent.includes('编辑机器人'))
  } finally {
    state.larkApps.text = old
  }
})

// 空态重排：零机器人时七步引导直接顶在「知识问答」标题下，没有折叠开关；说明行全场景已删
test('零机器人：引导直接展开在标题下，「配置引导」开关与说明行都不在', async () => {
  const host = await mountWith({ get: () => undefined })
  assert.ok(host.querySelector('ol'), '七步引导直接可见')
  assert.ok(!host.textContent.includes('一个机器人答一个文件夹'), '说明行已删')
  assert.ok(![...host.querySelectorAll('button')].some((b) => b.textContent.includes('配置引导')), '空态不需要折叠开关')
})

test('有机器人：说明行不在、引导默认折起，点「配置引导」展开七步', async () => {
  const old = state.larkApps.text
  state.larkApps.text = '[{"appId":"cli_a","appSecret":"s","folder":"认知","model":""}]'
  try {
    const host = await mountWith({ get: () => undefined })
    assert.ok(!host.textContent.includes('一个机器人答一个文件夹'), '说明行全场景已删')
    assert.ok(!host.querySelector('ol'), '默认折起')
    const toggle = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('配置引导'))
    await act(async () => { toggle.click() })
    assert.ok(host.querySelector('ol'), '展开后七步可见')
  } finally {
    state.larkApps.text = old
  }
})

// 「检测」顺手补连：凭证有效且已保存、当前未连接 → 调 larkReconnect，结果并进同一行；
// 本来就连着不调；补连失败标红带原因
const ROW = '[{"appId":"cli_x","appSecret":"s","folder":"认知","model":""}]'
const verifyWith = async (connected, reconnect, verify = { ok: true, botName: '小助手' }) => {
  const old = state.larkApps.text
  state.larkApps.text = ROW
  const calls = []
  try {
    const host = await mountWith({ get: () => undefined }, {}, {
      larkStatus: async () => ({ connected, apps: [{ appId: 'cli_x', folder: '认知', model: '', name: '小助手', connected, botReady: connected, folderExists: true }] }),
      larkVerify: async () => verify,
      larkReconnect: async (id) => { calls.push(id); return reconnect() },
    })
    await act(async () => { findBtn(host, '检测').click() })
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    return { host, calls }
  } finally { state.larkApps.text = old }
}

test('检测：未连接的已存机器人顺手补连，行下显示已重新连接', async () => {
  const { host, calls } = await verifyWith(false, () => ({ saved: true, connected: true }))
  assert.deepEqual(calls, ['cli_x'])
  assert.ok(host.textContent.includes('已重新连接'), host.textContent)
})

test('检测：本来就连着不补连', async () => {
  const { host, calls } = await verifyWith(true, () => { throw new Error('不该调') })
  assert.deepEqual(calls, [])
  assert.ok(host.textContent.includes('凭证有效'))
})

test('检测：补连失败标出原因', async () => {
  const { host } = await verifyWith(false, () => ({ saved: true, connected: false, detail: '网络不通' }))
  assert.ok(host.textContent.includes('重连失败：网络不通'), host.textContent)
})


test('检测：列出权限缺项，带级别与权限码', async () => {
  const { host } = await verifyWith(true, () => ({}), { ok: true, botName: '小助手', missing: [
    { scope: 'im:message.group_at_msg:readonly', label: '接收群聊中 @ 机器人的消息', level: 'group' },
    { scope: 'im:message.group_msg', label: '获取群组中所有消息（群里新开话题不 @ 也答）', level: 'optional' },
  ] })
  const items = [...host.querySelectorAll('ul li')].map((li) => li.textContent)
  assert.ok(items.some((t) => t.includes('群聊 · 缺权限') && t.includes('im:message.group_at_msg:readonly')), items.join(' | '))
  assert.ok(items.some((t) => t.includes('可选 · 缺权限') && t.includes('im:message.group_msg')))
  assert.ok(host.textContent.includes('凭证有效'))
})

test('检测：缺必需权限判失败、不补连，缺项照列', async () => {
  const { host, calls } = await verifyWith(false, () => { throw new Error('不该调') }, {
    ok: false, botName: '小助手', detail: '缺少必需权限——去开放平台 → 权限管理开通后，创建版本并发布',
    missing: [{ scope: 'im:message:send_as_bot', label: '以应用身份发消息（回复、追问卡片）', level: 'required' }],
  })
  assert.deepEqual(calls, [], '缺必需权限连上也答不了，不补连')
  assert.ok(host.textContent.includes('缺少必需权限'))
  assert.ok([...host.querySelectorAll('ul li')].some((li) => li.textContent.includes('必需 · 缺权限') && li.textContent.includes('im:message:send_as_bot')))
})

test('检测：授权状态查不到时给一行提示，不当缺权限', async () => {
  const { host } = await verifyWith(true, () => ({}), { ok: true, botName: '小助手', scopeError: 'code 99991672' })
  const items = [...host.querySelectorAll('ul li')].map((li) => li.textContent)
  assert.deepEqual(items, ['权限授权状态未查到：code 99991672'])
})

test('新增机器人：文件夹不预选，经 FolderPicker 选「知识库」写回 /', async () => {
  const edits = []
  const host = document.createElement('div'); document.body.appendChild(host)
  const prevText = state.larkApps.text
  state.larkApps.text = ''
  try {
  await act(async () => {
    const root = createRoot(host); trackRoot(root, host)
    root.render(h(WikiEnvProvider, { value: { api, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(LarkSettings, { state, edit: (f, t) => edits.push([f, t]) })))
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  await openAddModal(host)
  assert.match(document.querySelector('[data-wiki-dialog]').textContent, /选一个文件夹…/)
  const setInput = async (ph, v) => {
    const inp = [...document.querySelectorAll('[data-wiki-dialog] input')].find((i) => i.placeholder?.startsWith(ph))
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, v)
    await act(async () => { inp.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await setInput('cli_', 'cli_new')
  await setInput('Lark', 'secret')
  const ok = () => [...document.querySelectorAll('[data-wiki-dialog] button')].find((b) => b.textContent === '确定')
  assert.equal(ok().disabled, true, '没选文件夹不能确定')
  await act(async () => { document.querySelector('[data-wiki-dialog] button[aria-haspopup="tree"]').click() })
  // 面板 portal 到 document.body，行不在 host 里
  await act(async () => { [...document.querySelectorAll('[role="treeitem"]')].find((r) => r.dataset.rel === '/').click() })
  assert.equal(ok().disabled, false)
  await act(async () => { ok().click() })
  assert.equal(JSON.parse(edits.at(-1)[1])[0].folder, '/')
  } finally { state.larkApps.text = prevText }   // state 是文件级共享对象，别漏给后面的测试
})

// 一张卡一个状态：库阶段压过连接；连接之下再分群聊可用与否
const chipsOf = (host) => [...host.querySelectorAll('[data-slot="connection-card"]')].map((c) => [...c.querySelectorAll('[data-slot="connection-header"] [data-slot="status-chip"]')].map((x) => x.textContent))
const statusWith = async (phase, app) => {
  const old = state.larkApps.text
  state.larkApps.text = ROW
  try {
    return await mountWith({ get: () => undefined }, {}, {
      larkStatus: async () => ({ connected: app.connected, phase, apps: [{ appId: 'cli_x', folder: '认知', model: '', name: '小助手', connected: true, botReady: true, folderExists: true, ...app }] }),
    })
  } finally { state.larkApps.text = old }
}

test('状态：库校验中时只显示「知识库校验中」（带转圈），不显示已连接', async () => {
  const host = await statusWith('validating', { connected: true })
  assert.deepEqual(chipsOf(host), [['知识库校验中']])
  assert.ok(host.querySelector('[data-slot="connection-header"] [data-icon="loading"]') !== null)
  assert.ok(!host.textContent.includes('已连接'))
})

test('状态：库就绪 + 连上 + 有身份 → 只有「已连接」', async () => {
  const host = await statusWith('ok', { connected: true })
  assert.deepEqual(chipsOf(host), [['已连接']])
  assert.ok(host.querySelector('[data-icon="loading"]') === null)
})

test('状态：连上但没取到机器人身份 → 只有「群聊暂不可用」', async () => {
  const host = await statusWith('ok', { connected: true, botReady: false })
  assert.deepEqual(chipsOf(host), [['群聊暂不可用']])
})

test('状态：文件夹没页 → 只有「知识库不存在该文件夹」', async () => {
  const host = await statusWith('ok', { connected: true, folderExists: false })
  assert.deepEqual(chipsOf(host), [['知识库不存在该文件夹']])
})

test('状态：没配库 / 校验失败 / 未连接', async () => {
  assert.deepEqual(chipsOf(await statusWith('none', { connected: true })), [['知识库未初始化']])
  assert.deepEqual(chipsOf(await statusWith('failed', { connected: true, folderExists: false })), [['知识库校验失败']])
  assert.deepEqual(chipsOf(await statusWith('ok', { connected: false, botReady: false })), [['未连接']])
})

test('状态：保存落定（saving 翻回 false）后重查，保存中… → 已连接', async () => {
  let saved = false
  const larkStatus = async () => (saved
    ? { connected: true, phase: 'ok', apps: [{ appId: 'cli_x', folder: '认知', model: '', name: '小助手', connected: true, botReady: true, folderExists: true }] }
    : { connected: false, phase: 'ok', apps: [] })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  trackRoot(root, host)
  const env = { api: { ...api, larkStatus }, c: { get: () => undefined }, openExternal: () => {}, openExplorable: () => {}, useDark: () => false }
  const render = async (st) => {
    await act(async () => { root.render(h(WikiEnvProvider, { value: env }, h(LarkSettings, { state: st, edit: () => {} }))) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
  await render({ writable: true, saving: true, larkApps: { text: ROW } })
  assert.deepEqual(chipsOf(host), [['保存中…']])
  saved = true
  await render({ writable: true, saving: false, larkApps: { text: ROW } })
  assert.deepEqual(chipsOf(host), [['已连接']])
})
