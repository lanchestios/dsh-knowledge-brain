import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import http from 'node:http'
import { makeVault } from './mcp-fixture.js'
import { mountMcp } from '../src/mcp/mount.ts'

const v = makeVault()
afterAll(() => v.cleanup())
const T = 'k'.repeat(43)

// 假 ctx：inject 立即把 webServer 作用域交给回调；effect 立即执行并记下卸载器（同 test/ws-events 的写法）
const fakeCtx = (port = 19387) => {
  const routes = [], disposers = []
  const webServer = { register: (r) => { routes.push(r); return () => { routes.splice(routes.indexOf(r), 1) } } }
  if (port !== null) Object.defineProperty(webServer, 'port', { get: () => port })
  const scope = {
    effect: (f) => { const d = f(); disposers.push(d); return () => {} },
    webServer,
  }
  return { ctx: { ...scope, inject: (names, fn) => { assert.deepEqual(names, ['webServer']); fn(scope) } }, routes, disposers }
}
const hubOf = (model, { dir = v.dir, validating = false } = {}) => ({
  dir: () => dir,
  engine: { model, validating },
  model: () => { if (!model) throw new Error('库未打开：/x'); return model },
})

test('挂 /mcp 前缀路由；卸载时摘掉', () => {
  const { ctx, routes, disposers } = fakeCtx()
  mountMcp(ctx, hubOf(v.m), { servers: () => [] })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/mcp')
  for (const d of disposers) if (typeof d === 'function') d()
  assert.equal(routes.length, 0)
})

test('status：库开着时按页判断文件夹在不在；不含 token；非法条目不出现；带 endpointBase', () => {
  const { ctx } = fakeCtx()
  const h = mountMcp(ctx, hubOf(v.m), { servers: () => [
    { endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T },
    { endpoint: 'gone', name: '没了', folder: 'knowledge/Gone', token: T },
    { endpoint: 'bad name', name: 'x', folder: 'knowledge/ML', token: T },
  ] })
  const s = h.status()
  assert.deepEqual(s, { phase: 'ok', endpointBase: 'http://127.0.0.1:19387', servers: [
    { endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', folderExists: true },
    { endpoint: 'gone', name: '没了', folder: 'knowledge/Gone', folderExists: false },
  ] })
  assert.ok(!JSON.stringify(s).includes(T))
})

test('status：endpointBase 取宿主 webServer 实际监听端口；没端口为 null', () => {
  assert.equal(mountMcp(fakeCtx(3080).ctx, hubOf(v.m), { servers: () => [] }).status().endpointBase, 'http://127.0.0.1:3080')
  assert.equal(mountMcp(fakeCtx(null).ctx, hubOf(v.m), { servers: () => [] }).status().endpointBase, null)
  assert.equal(mountMcp(fakeCtx(0).ctx, hubOf(v.m), { servers: () => [] }).status().endpointBase, null)
})

test('status：库没开时 phase=failed、folderExists 全 false', () => {
  const { ctx } = fakeCtx()
  const h = mountMcp(ctx, hubOf(null), { servers: () => [{ endpoint: 'ml', name: 'n', folder: 'knowledge/ML', token: T }] })
  assert.deepEqual(h.status(), { phase: 'failed', endpointBase: 'http://127.0.0.1:19387', servers: [{ endpoint: 'ml', name: 'n', folder: 'knowledge/ML', folderExists: false }] })
})

test('status.phase：没配库 none、校验中 validating', () => {
  const srv = { servers: () => [{ endpoint: 'ml', name: 'n', folder: 'knowledge/ML', token: T }] }
  const none = mountMcp(fakeCtx().ctx, hubOf(null, { dir: '' }), srv).status()
  assert.equal(none.phase, 'none')
  assert.ok(!('vaultOpen' in none))
  const val = mountMcp(fakeCtx().ctx, hubOf(null, { validating: true }), srv).status()
  assert.equal(val.phase, 'validating')
  assert.equal(val.servers[0].folderExists, false)
})

test('路由 handler 每请求现读配置：后加的条目立刻可用', async () => {
  const { ctx, routes } = fakeCtx()
  let servers = []
  mountMcp(ctx, hubOf(v.m), { servers: () => servers })
  const srv = http.createServer((req, res) => { void routes[0].handler(req, res) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}/mcp/ml`
  const init = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${T}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'o', version: '1' } } }) }
  try {
    assert.equal((await fetch(url, init)).status, 401)
    servers = [{ endpoint: 'ml', name: 'n', folder: 'knowledge/ML', token: T }]
    assert.equal((await fetch(url, init)).status, 200)
  } finally { await new Promise((r) => srv.close(r)) }
})

test('status：folder「/」库开着且有页即存在；库没开为 false', () => {
  const on = mountMcp(fakeCtx().ctx, hubOf(v.m), { servers: () => [{ endpoint: 'all', name: '全库', folder: '/', token: T }] })
  assert.deepEqual(on.status().servers, [{ endpoint: 'all', name: '全库', folder: '/', folderExists: true }])
  const off = mountMcp(fakeCtx().ctx, hubOf(null), { servers: () => [{ endpoint: 'all', name: '全库', folder: '/', token: T }] })
  assert.deepEqual(off.status().servers, [{ endpoint: 'all', name: '全库', folder: '/', folderExists: false }])
})
