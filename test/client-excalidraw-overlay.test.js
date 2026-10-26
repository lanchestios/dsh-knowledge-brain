// test/client-excalidraw-overlay.test.js
// @vitest-environment jsdom
// 覆盖层画布：懒加载挂载、取场景、保存走 api + bump 版本、Esc 关闭、加载失败降级
import { test, vi, expect } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const rec = vi.hoisted(() => ({ renders: [], scrollCalls: [], fakeApi: null }))

// Reuse Vitest's window so React errors and portal cleanup are observed in the
// same DOM realm as the test runner.
const dom = { window }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { createElement as h } from 'react'
import { ExcalidrawOverlay, setCanvasLoader } from '../src/client/components/ExcalidrawOverlay.tsx'
// 默认 loader 走 script 注入（jsdom 没有该路由），测试统一注入假组件
const fakeCanvas = async () => ({ default: (props) => {
  rec.renders.push(props)
  // 模拟真组件：把 api 柄交回宿主（scrollToContent 调用记录进 rec.scrollCalls）
  // 真组件在 effect 里交柄；渲染期同步 set 会被 React 拒，排队到渲染后
  useEffect(() => {   // 真组件在 effect 里交 api 柄
    if (props.excalidrawAPI) props.excalidrawAPI(rec.fakeApi ?? (rec.fakeApi = { scrollToContent: (els, opts) => { rec.scrollCalls.push({ els, opts }) } }))
  }, [])
  // 柄是稳定单例：重复 set 同对象不触发额外 effect
  return h('div', { className: 'excalidraw', 'data-fake-canvas': '' }, 'canvas')
} })
setCanvasLoader(fakeCanvas)
import { assetVersion } from '../src/editor/blocks/excalidraw.ts'

const REL = 'asset/diagrams/2026-10-19/架构图.excalidraw'
const URL = 'api/wiki.asset?path=' + encodeURIComponent(REL)

const mount = (props) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(h(ExcalidrawOverlay, props)) })
  return { root, host }
}
const unmount = (r, host) => { act(() => r.unmount()); host.remove() }
const flush = () => new Promise((r) => setTimeout(r, 0))
const click = (btn) => act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })

test('挂载：取场景、按 dark 传主题、onChange 存最新场景', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }], appState: { viewBackgroundColor: '#ffffff' } }) })
  rec.renders.length = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: true, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} })
  await act(async () => { await flush(); await flush() })   // lazy import + fetch 两轮
  assert.ok(document.querySelector('[data-fake-canvas]'), '画布挂载')
  assert.equal(rec.renders.at(-1).theme, 'dark', 'chrome 跟宿主')
  assert.ok(rec.renders.at(-1).initialData.elements.length === 1, '初始场景带 elements')
  unmount(root, host)
})

test('保存：onChange 后的场景进 api.saveExcalidraw、bump 版本、关闭', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [], appState: {} }) })
  rec.renders.length = 0
  const saved = []
  let closed = 0
  const before = assetVersion(REL)
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async (path, scene) => { saved.push({ path, scene }); return { ok: true } } }, onClose: () => { closed++ } })
  await act(async () => { await flush(); await flush() })
  await act(async () => { rec.renders.at(-1).onChange([{ id: 'new' }], { viewBackgroundColor: '#ffffff' }) })
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存')
  assert.ok(btn, '保存按钮在')
  await click(btn)
  await act(async () => { await flush() })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].path, REL)
  assert.equal(saved[0].scene.type, 'excalidraw')
  assert.deepEqual(saved[0].scene.elements, [{ id: 'new' }])
  assert.equal(assetVersion(REL), before + 1, '保存成功 bump 版本')
  assert.equal(closed, 1, '保存后关闭')
  unmount(root, host)
})

test('Esc 关闭、不保存', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [] }) })
  const saved = []
  let closed = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async (...a) => { saved.push(a); return { ok: true } } }, onClose: () => { closed++ } })
  await act(async () => { await flush(); await flush() })
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) })
  assert.equal(closed, 1)
  assert.equal(saved.length, 0)
  unmount(root, host)
})

test('取场景失败：空场景兜底仍可画；加载失败：降级文案不外抛', async () => {
  globalThis.fetch = async () => { throw new Error('net') }
  rec.renders.length = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} })
  await act(async () => { await flush(); await flush() })
  assert.ok(document.querySelector('[data-fake-canvas]'), '取件失败也挂画布（空场景兜底）')
  unmount(root, host)

  const prev = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [] }) })
  const offline = new Error('offline')
  const expectedError = (event) => { if (event.error === offline) event.preventDefault() }
  window.addEventListener('error', expectedError)
  setCanvasLoader(() => Promise.reject(offline))
  const { root: r2, host: h2 } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} })
  await act(async () => { await flush(); await flush() })
  assert.ok((h2.textContent + document.body.textContent).includes('画布加载失败'), '加载失败降级文案')
  unmount(r2, h2)
  window.removeEventListener('error', expectedError)
  setCanvasLoader(fakeCanvas)
  globalThis.fetch = prev
})

// —— 评审修复：C1 场景未就绪不开画布（防既有图被空场景静默覆盖）、I1 保存失败可重试、M2 画布内 Esc 不关层 ——
test('C1：场景取件未决不挂画布；取到后挂载且 initialData 带既有 elements', async () => {
  let release = null
  globalThis.fetch = () => new Promise((r) => { release = r })
  rec.renders.length = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} })
  await act(async () => { await flush(); await flush() })   // lazy 到位，fetch 仍悬
  assert.ok(!document.querySelector('[data-fake-canvas]'), '取件未决：不挂画布（防空场景覆盖既有图）')
  assert.ok((host.textContent + document.body.textContent).includes('载入场景'), '载入场景占位')
  await act(async () => { release({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: '既有' }], appState: { viewBackgroundColor: '#fff' } }) }); await flush(); await flush() })
  await act(async () => { await flush(); await flush() })
  assert.ok(document.querySelector('[data-fake-canvas]'), '取件完成挂画布')
  assert.deepEqual(rec.renders.at(-1).initialData.elements, [{ id: '既有' }], 'initialData 用取到的场景')
  // 打开即居中走挂载后的 api.scrollToContent（fitToViewport），不走 initialData.scrollToContent
  // 布尔位——excalidraw 0.18.1 在 dpr>=2 下该路径把内容滚出画布（探针实证，见组件注释）
  assert.ok(!('scrollToContent' in rec.renders.at(-1).initialData), 'initialData 不带 scrollToContent（dpr2 坑）')
  await new Promise(r => setTimeout(r, 120))   // 组件 effect 的 60ms 定时 + api 交柄
  const apiCalls = rec.scrollCalls.at(-1)
  assert.deepEqual(apiCalls?.els, [{ id: '既有' }], '挂载后 scrollToContent 收到场景 elements')
  assert.deepEqual(apiCalls?.opts, { fitToViewport: true }, 'fitToViewport 适配缩放')
  unmount(root, host)
});

test('C1：取件失败兜底空场景、画布仍可开', async () => {
  globalThis.fetch = async () => { throw new Error('net') }
  rec.renders.length = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} })
  await act(async () => { await flush(); await flush() })
  await act(async () => { await flush() })
  assert.ok(document.querySelector('[data-fake-canvas]'), '失败兜底空场景')
  assert.deepEqual(rec.renders.at(-1).initialData.elements, [], '空 elements')
  unmount(root, host)
});

test('I1：保存失败后可再点保存（不禁死）', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [] }) })
  let calls = 0
  let closed = 0
  const api = { saveExcalidraw: async () => { calls++; if (calls === 1) throw new Error('RPC 抖了'); return { ok: true } } }
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api, onClose: () => { closed++ } })
  await act(async () => { await flush(); await flush() })
  const btn = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
  await click(btn());
  await act(async () => { await flush() })
  assert.equal(closed, 0, '失败不关层')
  assert.ok(host.textContent.includes('RPC 抖了') || document.body.textContent.includes('RPC 抖了'), '错误文案')
  assert.ok(!btn().disabled, '保存按钮不禁死')
  await click(btn());
  await act(async () => { await flush() })
  assert.equal(calls, 2, '可重试')
  assert.equal(closed, 1, '成功后关闭')
  unmount(root, host)
});

test('M2：Esc 落在画布里（如退出文字编辑）不关覆盖层；层外 Esc 才关', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [] }) });
  rec.renders.length = 0
  let closed = 0
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => { closed++ } })
  await act(async () => { await flush(); await flush() })
  await act(async () => { await flush() })
  // 画布内（fake canvas 也可当落点）派 Esc：不关
  const cv = document.querySelector('[data-fake-canvas]');
  await act(async () => { cv.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) });
  assert.equal(closed, 0, '画布内 Esc 不关层');
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) });
  assert.equal(closed, 1, '层外 Esc 关层');
  unmount(root, host);
});

// —— mac desktop 顶栏让位：dsh-app:// 协议下 bar 左侧避开窗口红绿灯（应用操作按钮） ——
test('barLeftPad：desktop 协议让位 84px、web 为 0；覆盖层 bar 应用之', async () => {
  const { barLeftPad, ExcalidrawOverlay } = await import('../src/client/components/ExcalidrawOverlay.tsx');
  assert.equal(barLeftPad('dsh-app:'), 84, 'desktop 协议让位');
  assert.equal(barLeftPad(), 0, 'jsdom http 协议不让位');
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} });
  await act(async () => { await flush(); await flush() });
  const bar = document.body.querySelector('[data-excalidraw-overlay] > div');   // 覆盖层 portal 到 body
  assert.equal(bar.style.paddingLeft, '', 'web 端无左让位');
  unmount(root, host);
});

// —— collaborators 修复：appState.collaborators 内存里是 Map、JSON 存盘变 {}，
//    重开喂回 initialData 时 excalidraw 调 .forEach 即崩（真机 TypeError 根因） ——
test('保存时 appState 剔除 collaborators（运行时字段不落盘）；载入已污染文件时 initialData 同样剔除', async () => {
  const saved = [];
  // 保存侧：onChange 给一个 Map 形态的 collaborators
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async (_p, scene) => { saved.push(scene); return { ok: true } } }, onClose: () => {} });
  await act(async () => { await flush(); await flush() });
  act(() => { rec.renders.at(-1).onChange([{ id: 'e1' }], { viewBackgroundColor: '#fff', collaborators: new Map([['a', 1]]) }) });
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存');
  act(() => { btn.click() });
  await act(async () => { await flush() });
  assert.ok(!('collaborators' in saved[0].appState), '保存的 appState 不含 collaborators');
  assert.equal(saved[0].appState.viewBackgroundColor, '#fff', '其余字段保留');
  unmount(root, host);
  // 载入侧：fetch 返回已被污染的文件（collaborators: {}）
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', version: 2, elements: [{ id: 'e1' }], appState: { viewBackgroundColor: '#fff', collaborators: {} } }) });
  rec.renders.length = 0;
  const r2 = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {} });
  await act(async () => { await flush(); await flush() });
  assert.ok(!('collaborators' in rec.renders.at(-1).initialData.appState), '已污染文件的 collaborators 不进 initialData');
  unmount(r2.root, r2.host);
});

// —— 保存后通知宿主刷新块（bump 版本只是标记，还得 dispatch refreshBlocksEffect 才重建） ——
test('保存成功后调 onSaved（宿主据此刷新图位），关闭/失败不调', async () => {
  const savedCb = [];
  const { root, host } = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => ({ ok: true }) }, onClose: () => {}, onSaved: () => savedCb.push(1) });
  await act(async () => { await flush(); await flush() });
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存');
  act(() => { btn.click() });
  await act(async () => { await flush() });
  assert.equal(savedCb.length, 1, '保存成功调一次 onSaved');
  unmount(root, host);
  // 失败不调
  const savedCb2 = [];
  const r2 = mount({ rel: REL, url: URL, dark: false, api: { saveExcalidraw: async () => { throw new Error('x') } }, onClose: () => {}, onSaved: () => savedCb2.push(1) });
  await act(async () => { await flush(); await flush() });
  act(() => { [...document.querySelectorAll('button')].find((b) => b.textContent === '保存').click() });
  await act(async () => { await flush() });
  assert.equal(savedCb2.length, 0, '保存失败不调 onSaved');
  unmount(r2.root, r2.host);
});
