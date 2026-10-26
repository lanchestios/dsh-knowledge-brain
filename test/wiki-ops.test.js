import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { makeVault } from './mcp-fixture.js'
import { createWikiOps } from '../src/host/wiki-ops.ts'

// 抽共享层后，不带 scope 的输出必须与原 src/host/tools.ts 的 execute 一致（DSH 内部工具零变化）
const v = makeVault()
afterAll(() => v.cleanup())
const ops = createWikiOps(() => v.m)

test('search：全库命中、摘要去 <mark>', () => {
  const hits = ops.search('梯度', 10)
  assert.deepEqual(hits.map((h) => h.id).sort(), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md', 'knowledge/ML2/近似.md', 'knowledge/X/梯度.md', 'knowledge/X/秘密.md'].sort())
  assert.ok(hits.every((h) => !h.snippet.includes('<mark>')))
  assert.deepEqual(Object.keys(hits[0]).sort(), ['crumb', 'id', 'name', 'snippet'])
})

test('readPage：前后页与反链跨文件夹照给；同名给候选', () => {
  const p = ops.readPage('knowledge/ML/梯度.md')
  assert.equal(p.id, 'knowledge/ML/梯度.md')
  assert.equal(p.prev.id, 'knowledge/ML/ML.md')
  assert.equal(p.next.id, 'knowledge/ML2/近似.md')
  assert.deepEqual(p.backlinks.map((b) => b.id).sort(), ['knowledge/ML2/近似.md', 'knowledge/X/秘密.md'])
  const amb = ops.readPage('梯度')
  assert.equal(amb.found, false)
  assert.equal(amb.candidates.length, 2)
})

test('backlinks：带上下文', () => {
  const bl = ops.backlinks('knowledge/ML/梯度.md')
  assert.deepEqual(bl.map((b) => b.id).sort(), ['knowledge/ML2/近似.md', 'knowledge/X/秘密.md'])
  assert.ok(bl.every((b) => typeof b.context === 'string'))
})

test('tree：根与指定文件夹页；未知文件夹页抛错', () => {
  assert.deepEqual(ops.tree(undefined, 1).map((n) => n.id), ['knowledge/knowledge.md'])
  assert.deepEqual(ops.tree('knowledge/ML/ML.md', 1).map((n) => n.id), ['knowledge/ML/梯度.md'])
  assert.throws(() => ops.tree('nope.md'), /没有这个文件夹页/)
})

test('tags：全量计数与按标签列页', () => {
  assert.deepEqual(ops.tags().find((t) => t.tag === 'ml'), { tag: 'ml', count: 3 })
  assert.deepEqual(ops.tags('ml').map((t) => t.id), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md', 'knowledge/ML2/近似.md'])
})
