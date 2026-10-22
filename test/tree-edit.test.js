// 目录拖动的 Host 侧：节点 / 目标文件夹白名单（只认沉淀四区、区根不算节点、raw 与 .. 一律拒）；
// moveImpact 数「库里别处有几页链进被移节点」，子树内部互链不算
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildModel } from '../src/core/model.ts'
import { nodeRel, folderRel, moveImpact } from '../src/core/tree-edit.ts'

function vault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-tedit-'))
  fs.mkdirSync(path.join(dir, '.git'))
  fs.mkdirSync(path.join(dir, '.wiki'))
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "知识": { "order": 1 }, "工作": { "order": 2 } } }')
  const put = (rel, body = '') => { const a = path.join(dir, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, `---\ntitle: ${path.basename(rel, '.md')}\n---\n${body}`) }
  put('知识/知识.md'); put('工作/工作.md')
  put('知识/K/K.md', '[[a]]')
  put('知识/K/a.md', '[[K]]')
  put('知识/外.md', '[[a]] 和 [[a]]')
  put('工作/另.md', '[[K]]')
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true }); fs.writeFileSync(path.join(dir, 'raw', 'x.md'), 'x')
  return dir
}

test('nodeRel：页与文件夹放行；区根、区页、raw、..、隐藏段、不存在一律拒', () => {
  const dir = vault()
  try {
    const m = buildModel(dir)
    assert.equal(nodeRel(m, '知识/K/a.md'), '知识/K/a.md')
    assert.equal(nodeRel(m, '知识/K'), '知识/K')
    for (const bad of ['知识', '知识/知识.md', 'raw/x.md', 'raw', '知识/../raw/x.md', '知识/.git', '知识/无.md', '知识/无', '', '/etc'])
      assert.throws(() => nodeRel(m, bad), undefined, bad)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('folderRel：区根与区内文件夹放行；文件、raw、不存在拒', () => {
  const dir = vault()
  try {
    const m = buildModel(dir)
    assert.equal(folderRel(m, '知识'), '知识')
    assert.equal(folderRel(m, '知识/K'), '知识/K')
    for (const bad of ['知识/外.md', 'raw', '知识/无', '../x', ''])
      assert.throws(() => folderRel(m, bad), undefined, bad)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('moveImpact：按来源页去重；子树内部互链不算', () => {
  const dir = vault()
  try {
    const m = buildModel(dir)
    assert.deepEqual(moveImpact(m, '知识/K/a.md'), { pages: 2 }, '外（两处算一页）+ K 的页')
    assert.deepEqual(moveImpact(m, '知识/K'), { pages: 2 }, '外 + 工作/另；K↔a 是子树内部')
    assert.deepEqual(moveImpact(m, '知识/外.md'), { pages: 0 })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
