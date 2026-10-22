import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { makeVault, PNG } from './mcp-fixture.js'
import { createFolderHandler } from '../src/mcp/server.ts'

const v = makeVault()
afterAll(() => v.cleanup())

async function connect(getModel, folder, negotiation = { mode: 'auto' }, title) {
  const h = createFolderHandler(getModel, folder, title)
  const client = new Client({ name: 'test', version: '1' }, { capabilities: {}, versionNegotiation: negotiation })
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1/mcp/t'), { fetch: (u, i) => h.fetch(new Request(u, i)) }))
  return { client, close: async () => { await client.close(); await h.close() } }
}
const text = (r) => r.content.map((c) => c.text).join('')

test('协商到 2026-07-28；恰好 6 个只读工具，没有 wiki_raw', async () => {
  const { client, close } = await connect(() => v.m, 'knowledge/ML')
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28')
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), ['wiki_backlinks', 'wiki_image', 'wiki_read_page', 'wiki_search', 'wiki_tags', 'wiki_tree'])
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true))
  } finally { await close() }
})

test('title：handler 带上显示名称，客户端在 serverInfo.title 里看到；不带则没有 title', async () => {
  const a = await connect(() => v.m, 'knowledge/ML', undefined, '机器学习笔记')
  try {
    assert.equal(a.client.getServerVersion()?.title, '机器学习笔记')
    assert.equal(a.client.getServerVersion()?.name, 'dsh-knowledge-brain')
  } finally { await a.close() }
  const b = await connect(() => v.m, 'knowledge/ML')
  try { assert.equal(b.client.getServerVersion()?.title, undefined) } finally { await b.close() }
})

test('wiki_search / wiki_read_page 走 scope：结果只含该文件夹', async () => {
  const { client, close } = await connect(() => v.m, 'knowledge/ML')
  try {
    const hits = JSON.parse(text(await client.callTool({ name: 'wiki_search', arguments: { query: '梯度' } })))
    assert.deepEqual(hits.map((h) => h.id).sort(), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md'])
    const page = JSON.parse(text(await client.callTool({ name: 'wiki_read_page', arguments: { id: '梯度' } })))
    assert.equal(page.id, 'knowledge/ML/梯度.md')
    assert.equal(page.next, null)
  } finally { await close() }
})

test('wiki_image：回 image 内容块；不许读的回 isError', async () => {
  const { client, close } = await connect(() => v.m, 'knowledge/ML')
  try {
    const ok = await client.callTool({ name: 'wiki_image', arguments: { path: 'asset/ml/a.png' } })
    assert.deepEqual(ok.content, [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }])
    const no = await client.callTool({ name: 'wiki_image', arguments: { path: 'asset/x/s.png' } })
    assert.equal(no.isError, true)
    assert.match(text(no), /读不到图片/)
  } finally { await close() }
})

test('库未打开 / 正在校验 / 文件夹没了：isError 带原话，不是协议错误', async () => {
  for (const [getModel, folder, re] of [
    [() => { throw new Error('正在校验知识库，稍等再试') }, 'knowledge/ML', /正在校验知识库/],
    [() => { throw new Error('库未打开：/x') }, 'knowledge/ML', /库未打开/],
    [() => v.m, 'knowledge/Gone', /文件夹不存在或没有页/],
  ]) {
    const { client, close } = await connect(getModel, folder)
    try {
      const r = await client.callTool({ name: 'wiki_tags', arguments: {} })
      assert.equal(r.isError, true)
      assert.match(text(r), re)
    } finally { await close() }
  }
})

test('旧客户端（不协商新版本）照样能用', async () => {
  const { client, close } = await connect(() => v.m, 'knowledge/ML', { mode: 'legacy' })
  try {
    assert.notEqual(client.getNegotiatedProtocolVersion(), '2026-07-28')
    const r = await client.callTool({ name: 'wiki_tags', arguments: {} })
    assert.ok(JSON.parse(text(r)).some((t) => t.tag === 'ml'))
  } finally { await close() }
})

test('scope「/」：搜得到所有区的页、读得到任一区页面引用的图；描述写「知识库」', async () => {
  const { client, close } = await connect(() => v.m, '/')
  try {
    const hits = JSON.parse(text(await client.callTool({ name: 'wiki_search', arguments: { query: '梯度', limit: 20 } })))
    assert.ok(hits.some((h) => h.id.startsWith('knowledge/X/')), '范围外的 X 区也在')
    assert.ok(hits.some((h) => h.id.startsWith('knowledge/ML/')))
    const img = await client.callTool({ name: 'wiki_image', arguments: { path: 'asset/x/s.png' } })
    assert.deepEqual(img.content, [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }])
    const { tools } = await client.listTools()
    assert.ok(tools.every((t) => !t.description.includes('「/」')), '不出现「/」')
    assert.ok(tools.find((t) => t.name === 'wiki_search').description.includes('知识库'))
  } finally { await close() }
})
