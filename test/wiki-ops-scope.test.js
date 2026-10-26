import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { makeVault } from './mcp-fixture.js'
import { createWikiOps, scopeFilter, folderHasPages } from '../src/host/wiki-ops.ts'

const v = makeVault()
afterAll(() => v.cleanup())
const ops = createWikiOps(() => v.m, 'knowledge/ML')
const ids = (xs) => xs.map((x) => x.id).sort()

test('scopeFilter：前缀相近的文件夹不算；首尾斜杠归一', () => {
  const k = scopeFilter('/knowledge/ML/')
  assert.equal(k('knowledge/ML/梯度.md'), true)
  assert.equal(k('knowledge/ML/ML.md'), true)
  assert.equal(k('knowledge/ML2/近似.md'), false)
  assert.equal(k('knowledge/MLx.md'), false)
})

test('search：只回范围内；limit 在过滤之后截', () => {
  assert.deepEqual(ids(ops.search('梯度', 10)), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md'])
  const one = ops.search('梯度', 1)
  assert.equal(one.length, 1)
  assert.ok(one[0].id.startsWith('knowledge/ML/'))
  // 「秘密内容」AND 只命中范围外的 X/秘密.md；退到 OR 后只回范围内（梯度.md 正文有双链名「秘密」），绝不带出 X
  assert.deepEqual(ids(ops.search('秘密内容', 10)), ['knowledge/ML/梯度.md'])
  assert.deepEqual(ops.search('内容', 10), [])   // 只在范围外出现的词：AND、OR 都空
})

test('search：AND 只在范围外命中时，退到 OR 拿范围内的页', () => {
  // 「梯度 内容」全库 AND 只命中 knowledge/X/秘密.md；OR 下「梯度」命中 ML 里的两页
  const all = createWikiOps(() => v.m)
  assert.deepEqual(ids(all.search('梯度 内容', 10)), ['knowledge/X/秘密.md'])
  assert.deepEqual(ids(ops.search('梯度 内容', 10)), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md'])
})

test('readPage：同名页在范围内唯一即命中；范围外当作找不到', () => {
  assert.equal(ops.readPage('梯度').id, 'knowledge/ML/梯度.md')
  const out = ops.readPage('knowledge/X/秘密.md')
  assert.equal(out.found, false)
  assert.ok(out.candidates.every((c) => c.id.startsWith('knowledge/ML/')))
  assert.equal(ops.readPage('秘密').found, false)
  assert.equal(ops.readPage('../X/秘密.md').found, false)
})

test('readPage：跨出范围的 prev/next 置 null，反链只留范围内', () => {
  const p = ops.readPage('knowledge/ML/梯度.md')
  assert.equal(p.prev.id, 'knowledge/ML/ML.md')
  assert.equal(p.next, null)
  assert.deepEqual(p.backlinks, [])
})

test('backlinks：来源只留范围内；目标在范围外当作找不到', () => {
  assert.deepEqual(ops.backlinks('knowledge/ML/梯度.md'), [])
  assert.equal(ops.backlinks('knowledge/X/秘密.md').found, false)
})

test('tree：根是该文件夹；path 只能指向它下面', () => {
  assert.deepEqual(ops.tree().map((n) => n.id), ['knowledge/ML/梯度.md'])
  assert.throws(() => ops.tree('knowledge/knowledge.md'), /没有这个文件夹页/)
  assert.throws(() => ops.tree('knowledge/ML/ML.md'), /没有这个文件夹页/)
  // 没有索引页的文件夹也能当 scope
  assert.deepEqual(createWikiOps(() => v.m, 'knowledge/ML2').tree().map((n) => n.id), ['knowledge/ML2/近似.md'])
})

test('tags：只统计范围内', () => {
  const all = ops.tags()
  assert.deepEqual(all.find((t) => t.tag === 'ml'), { tag: 'ml', count: 2 })
  assert.equal(all.find((t) => t.tag === '私'), undefined)
  assert.deepEqual(ops.tags('私'), [])
  assert.deepEqual(ops.tags('ml').map((t) => t.id), ['knowledge/ML/ML.md', 'knowledge/ML/梯度.md'])
})

test('文件夹不存在 / 改名后：每个方法都抛同一句', () => {
  assert.equal(folderHasPages(v.m, 'knowledge/ML'), true)
  assert.equal(folderHasPages(v.m, 'knowledge/Gone'), false)
  const gone = createWikiOps(() => v.m, 'knowledge/Gone')
  for (const call of [() => gone.search('梯度'), () => gone.readPage('梯度'), () => gone.backlinks('梯度'), () => gone.tree(), () => gone.tags()]) {
    assert.throws(call, /文件夹不存在或没有页：knowledge\/Gone/)
  }
})

test('crumb：scope 下不带出范围外的区索引标题', () => {
  const area = /所知区/
  // 对照：不加 scope 时区标题确实在 crumb 里（否则下面的断言测不出东西）
  assert.match(JSON.stringify(createWikiOps(() => v.m).search('梯度', 10)), area)
  assert.equal(ops.search('梯度', 10).find((h) => h.id === 'knowledge/ML/梯度.md').crumb, 'ML')
  assert.equal(ops.readPage('knowledge/ML/ML.md').crumb, '')
  const outs = [
    ops.search('梯度', 10), ops.search('总览', 10),
    ops.readPage('knowledge/ML/梯度.md'), ops.readPage('knowledge/ML/ML.md'),
    ops.readPage('梯度下降'), ops.readPage('knowledge/X/秘密.md'), ops.readPage('不存在的页'),
    ops.backlinks('knowledge/ML/梯度.md'), ops.backlinks('knowledge/X/秘密.md'),
    ops.tree(), ops.tree(undefined, 5), ops.tags(), ops.tags('ml'), ops.tags('优化'),
  ]
  for (const o of outs) assert.doesNotMatch(JSON.stringify(o), area)
})

test('scope「/」= 整库：五个方法与不带 scope 逐字相同', () => {
  const all = createWikiOps(() => v.m)
  const root = createWikiOps(() => v.m, '/')
  assert.deepEqual(root.search('梯度', 20), all.search('梯度', 20))
  assert.deepEqual(root.readPage('knowledge/ML/梯度.md'), all.readPage('knowledge/ML/梯度.md'))
  assert.deepEqual(root.readPage('梯度'), all.readPage('梯度'))
  assert.deepEqual(root.backlinks('knowledge/ML/梯度.md'), all.backlinks('knowledge/ML/梯度.md'))
  assert.deepEqual(root.tree(undefined, 3), all.tree(undefined, 3))
  assert.deepEqual(root.tags(), all.tags())
  assert.deepEqual(root.tags('ml'), all.tags('ml'))
})

test('scopeFilter / folderHasPages 认「/」', () => {
  const k = scopeFilter('/')
  for (const id of ['knowledge/X/秘密.md', 'knowledge/knowledge.md', 'anything.md']) assert.equal(k(id), true)
  assert.equal(folderHasPages(v.m, '/'), true)
})

test('空白 / 畸形 scope 一律关死：不当成整库，也不放行任何页', () => {
  for (const bad of ['', '   ', 'a//b', 'knowledge/../knowledge/ML']) assert.equal(scopeFilter(bad)('knowledge/ML/梯度.md'), false, JSON.stringify(bad))
  assert.equal(folderHasPages(v.m, ''), false)
  assert.equal(folderHasPages(v.m, '   '), false)
  assert.throws(() => createWikiOps(() => v.m, '').search('梯度'), /文件夹不存在或没有页/)
  assert.throws(() => createWikiOps(() => v.m, '   ').tags(), /文件夹不存在或没有页/)
  assert.throws(() => createWikiOps(() => v.m, 'a//b').search('梯度'), /文件夹不存在或没有页/)
})
