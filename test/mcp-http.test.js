import { test, beforeAll, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { makeVault } from './mcp-fixture.js'
import { createMcpRoute } from '../src/mcp/http.ts'
import { buildModel } from '../src/core/model.ts'

const v = makeVault()
const T = 'k'.repeat(43)
let entries = [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T }]
const route = createMcpRoute({ entries: () => entries, getModel: () => v.m })
let srv, base
beforeAll(async () => {
  srv = http.createServer((req, res) => { void route.handle(req, res) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${srv.address().port}`
})
afterAll(async () => { await new Promise((r) => srv.close(r)); await route.close(); v.cleanup() })

const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '1' } } })
const post = (path, headers = {}, body = INIT) => fetch(base + path, {
  method: 'POST', body,
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
})

test('官方 client（auto 协商）经真 HTTP 连上，协商到 2026-07-28，只看到本文件夹', async () => {
  const client = new Client({ name: 't', version: '1' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/ml'), { requestInit: { headers: { Authorization: `Bearer ${T}` } } }))
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28')
    const r = await client.callTool({ name: 'wiki_search', arguments: { query: '梯度' } })
    assert.deepEqual(JSON.parse(r.content[0].text).map((h) => h.id).sort(), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md'])
  } finally { await client.close() }
})

test('鉴权：缺头 / 错 token / 别的条目的 token / 没这个端点 / 拿显示名称当路径 → 一律 401 同一文案', async () => {
  entries = [...entries, { endpoint: 'x', name: 'xname', folder: 'knowledge/X', token: 'z'.repeat(43) }]
  try {
    for (const [path, h] of [
      ['/mcp/ml', {}],
      ['/mcp/ml', { authorization: 'Bearer ' + 'w'.repeat(43) }],
      ['/mcp/ml', { authorization: 'Bearer ' + 'z'.repeat(43) }],
      ['/mcp/nope', { authorization: `Bearer ${T}` }],
      ['/mcp/xname', { authorization: 'Bearer ' + 'z'.repeat(43) }],
      ['/mcp/' + encodeURIComponent('机器学习'), { authorization: `Bearer ${T}` }],
      ['/mcp', { authorization: `Bearer ${T}` }],
      ['/mcp/ml/extra', { authorization: `Bearer ${T}` }],
    ]) {
      const r = await post(path, h)
      assert.equal(r.status, 401, path + JSON.stringify(h))
      assert.equal(await r.text(), 'unauthorized')
    }
  } finally { entries = entries.slice(0, 1) }
})

test('scheme 不区分大小写、token 两端空白去掉', async () => {
  const r = await post('/mcp/ml', { authorization: `  bearer   ${T}  ` })
  assert.equal(r.status, 200)
})

test('坏的百分号编码 / 编码斜杠 → 401，不抛', async () => {
  for (const p of ['/mcp/%E0%A4%A', '/mcp/ml%2Fx', '/mcp/%6Dl']) {
    const r = await post(p, { authorization: `Bearer ${T}` })
    assert.equal(r.status, 401, p)
  }
})

test('带 Origin → 403（先于鉴权）', async () => {
  const r = await post('/mcp/ml', { authorization: `Bearer ${T}`, origin: 'http://evil.example' })
  assert.equal(r.status, 403)
})

test('鉴权通过后 GET / DELETE → 405', async () => {
  for (const method of ['GET', 'DELETE']) {
    const r = await fetch(base + '/mcp/ml', { method, headers: { authorization: `Bearer ${T}` } })
    assert.equal(r.status, 405, method)
  }
})

test('请求体超过 1 MiB → 413', async () => {
  const r = await post('/mcp/ml', { authorization: `Bearer ${T}` }, 'x'.repeat(1024 * 1024 + 1))
  assert.equal(r.status, 413)
})

test('旧握手经 HTTP 也通；serverInfo 带显示名称当 title', async () => {
  const r = await post('/mcp/ml', { authorization: `Bearer ${T}` })
  assert.equal(r.status, 200)
  const body = await r.text()
  assert.match(body, /"protocolVersion":"2025-06-18"/)
  assert.match(body, /"title":"机器学习"/)
})

test('改显示名称即生效：handler 按 endpoint+folder+name 缓存，title 跟着换', async () => {
  entries = [{ endpoint: 'ml', name: '改过的名字', folder: 'knowledge/ML', token: T }]
  try {
    const client = new Client({ name: 't', version: '1' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/ml'), { requestInit: { headers: { Authorization: `Bearer ${T}` } } }))
    try { assert.equal(client.getServerVersion()?.title, '改过的名字') } finally { await client.close() }
  } finally { entries = [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T }] }
})

test('改配置即生效：换 folder 后同一端点看到新文件夹', async () => {
  entries = [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/X', token: T }]
  try {
    const client = new Client({ name: 't', version: '1' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/ml'), { requestInit: { headers: { Authorization: `Bearer ${T}` } } }))
    try {
      const r = await client.callTool({ name: 'wiki_tags', arguments: {} })
      assert.ok(JSON.parse(r.content[0].text).some((t) => t.tag === '私'))
    } finally { await client.close() }
  } finally { entries = [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T }] }
})

const listen = async (route) => {
  const s = http.createServer((req, res) => { void route.handle(req, res) })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  return s
}
const CALL_IMG = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wiki_image', arguments: { path: 'asset/ml/huge.png' } } })
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }
/** 发请求，收到第一块响应体就掐断 socket */
const abortAfterFirstChunk = (port, body, headers) => new Promise((resolve, reject) => {
  const q = http.request({ host: '127.0.0.1', port, path: '/mcp/ml', method: 'POST', headers }, (res) => {
    res.once('data', () => { q.destroy(); resolve(res.statusCode) })
  })
  q.on('error', () => {})
  setTimeout(() => reject(new Error('没收到响应体')), 5000).unref()
  q.end(body)
})

test('客户端中途断开（真 handler、5MB 级响应）：不出 uncaught，之后的请求照常 200', async () => {
  const w = makeVault()
  fs.writeFileSync(path.join(w.dir, 'asset/ml/huge.png'), Buffer.alloc(4 * 1024 * 1024, 7))
  fs.writeFileSync(path.join(w.dir, 'knowledge/ML/大图.md'), '---\ntitle: 大图\n---\n![h](../../asset/ml/huge.png)')
  const m = buildModel(w.dir)
  const r2 = createMcpRoute({ entries: () => [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T }], getModel: () => m })
  const s2 = await listen(r2)
  const errs = []
  const onErr = (e) => errs.push(e)
  process.on('uncaughtException', onErr); process.on('unhandledRejection', onErr)
  try {
    for (let i = 0; i < 3; i++) assert.equal(await abortAfterFirstChunk(s2.address().port, CALL_IMG, { ...H, authorization: `Bearer ${T}` }), 200)
    await new Promise((r) => setTimeout(r, 200))
    const ok = await fetch(`http://127.0.0.1:${s2.address().port}/mcp/ml`, { method: 'POST', body: INIT, headers: { ...H, authorization: `Bearer ${T}` } })
    assert.equal(ok.status, 200)
    assert.match(await ok.text(), /"protocolVersion"/)
    assert.deepEqual(errs.map(String), [])
  } finally {
    process.off('uncaughtException', onErr); process.off('unhandledRejection', onErr)
    await new Promise((r) => s2.close(r)); await r2.close(); w.cleanup()
  }
})

test('客户端中途断开：上游 Web body 被 cancel（不留着挂起的 reader）；转发给 SDK 的头里没有 authorization', async () => {
  let cancelled
  const gotCancel = new Promise((r) => { cancelled = r })
  let seen
  vi.resetModules()
  vi.doMock('../src/mcp/server.ts', () => ({
    createFolderHandler: () => ({
      fetch: async (req) => {
        seen = [...req.headers.keys()]
        return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024)) }, cancel() { cancelled(true) } }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } })
      },
      close: async () => {},
    }),
  }))
  try {
    const { createMcpRoute: mk } = await import('../src/mcp/http.ts')
    const r3 = mk({ entries: () => [{ endpoint: 'ml', name: '机器学习', folder: 'knowledge/ML', token: T }], getModel: () => v.m })
    const s3 = await listen(r3)
    try {
      assert.equal(await abortAfterFirstChunk(s3.address().port, INIT, { ...H, authorization: `Bearer ${T}` }), 200)
      const res = await Promise.race([gotCancel, new Promise((r) => setTimeout(() => r(false), 2000))])
      assert.equal(res, true, '客户端断开后上游 body 没被 cancel')
      assert.ok(seen.includes('content-type'))
      assert.ok(!seen.includes('authorization'), JSON.stringify(seen))
    } finally { await new Promise((r) => { s3.closeAllConnections(); s3.close(r) }); await r3.close() }
  } finally { vi.doUnmock('../src/mcp/server.ts'); vi.resetModules() }
})
