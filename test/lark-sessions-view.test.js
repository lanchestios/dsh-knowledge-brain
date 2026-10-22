// @vitest-environment jsdom
// 会话记录页（整页，路由 kind='lark'）：设置卡「会话」跳进来的目标页，按真实客户端形态喂 c
// （宿主把插件 ctx 包成白名单代理）。钉：按 app_id 取该机器人的 chats，当前＋归档各一行，
// 「打开」调宿主 uiWorkspace.openSession；宿主没这项服务时静默不炸；没问过出空态引导。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { LarkSessionsView } from '../src/client/components/LarkSessionsView.tsx'
import { NavProvider } from '../src/client/lib/nav.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

const api = {
  larkChats: async () => [
    { appId: 'cli_x', name: '小助手', folder: '认知', chats: [
      { chatId: 'oc_1', current: 'lark-cli-x-oc-1-0', currentTitle: 'Lark 问答 · 小助手 #2', past: [{ id: 'lark-cli-x-oc-1-1', title: 'Lark 问答 · 小助手 #1' }], lastAt: 0, chatType: 'p2p' },
      { chatId: 'oc_g', current: '', currentTitle: '', past: [], lastAt: 0, chatType: 'group' },
    ] },
    { appId: 'cli_empty', name: '', folder: '学习', chats: [] },
  ],
  onChanged: () => () => {},
}

async function mountPage(c, appId = 'cli_x') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(h(WikiEnvProvider, { value: { api, c, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(NavProvider, null, h(LarkSessionsView, { appId }))))
  })
  // 排空微任务，让 larkChats 的 then 落地
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return host
}

const openButtons = (host) => [...host.querySelectorAll('button')].filter((b) => b.textContent === '打开')

test('会话记录页：当前＋归档各一行，「打开」调 uiWorkspace.openSession；空 current 出提示行', async () => {
  const opened = []
  const host = await mountPage({ get: (name) => name === 'uiWorkspace'
    ? { openSession: (id) => { opened.push(id) } }
    : undefined })
  assert.ok(host.textContent.includes('会话记录'), '页标题')
  assert.ok(host.textContent.includes('小助手 · 认知'), '机器人行带名字与文件夹')
  assert.ok(host.textContent.includes('单聊') && host.textContent.includes('群聊'), 'chat 类型有标注')
  assert.ok(host.textContent.includes('已开新会话，下条消息起用'), '轮换后的空 current 有提示')
  const btns = openButtons(host)
  assert.equal(btns.length, 2, '当前会话 + 归档会话各一个打开按钮')
  await act(async () => { btns[0].click() })
  await act(async () => { btns[1].click() })
  assert.deepEqual(opened, ['lark-cli-x-oc-1-0', 'lark-cli-x-oc-1-1'])
})

test('uiWorkspace 缺席：点「打开」不炸树', async () => {
  const host = await mountPage({ get: () => undefined })
  const btn = openButtons(host)[0]
  await act(async () => { btn.click() })
  assert.ok(host.textContent.includes('会话记录'), '页照常渲染')
})

test('没问过的机器人：空态引导', async () => {
  const host = await mountPage({ get: () => undefined }, 'cli_empty')
  assert.ok(host.textContent.includes('还没有会话记录'), '空态引导文案')
  assert.equal(openButtons(host).length, 0)
})
