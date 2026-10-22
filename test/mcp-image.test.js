import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { makeVault, PNG } from './mcp-fixture.js'
import { allowedImages, readImage } from '../src/mcp/image.ts'

const v = makeVault()
afterAll(() => v.cleanup())
const NO = /读不到图片/

test('白名单：范围内页引用的 asset/ 与 raw/ 图；扩展名不合规的不进', () => {
  assert.deepEqual([...allowedImages(v.m, 'knowledge/ML')].sort(),
    ['asset/ml/a.png', 'asset/ml/big.png', 'asset/ml/link.png', 'raw/document/书/img/r.png'])
  assert.deepEqual([...allowedImages(v.m, 'knowledge/X')], ['asset/x/s.png'])
})

test('readImage：白名单内的 png 读成 base64 + mimeType', () => {
  assert.deepEqual(readImage(v.m, 'knowledge/ML', 'asset/ml/a.png'), { data: PNG.toString('base64'), mimeType: 'image/png' })
  assert.equal(readImage(v.m, 'knowledge/ML', 'raw/document/书/img/r.png').mimeType, 'image/png')
})

test('readImage：范围外页的图、没人引用的图、svg、超 5MB、越界软链、路径穿越，一律同一句', () => {
  for (const p of ['asset/x/s.png', 'asset/ml/other.png', 'asset/ml/v.svg', 'asset/ml/big.png', 'asset/ml/link.png', 'asset/ml/../x/s.png', '/etc/hosts']) {
    assert.throws(() => readImage(v.m, 'knowledge/ML', p), NO, p)
  }
})

test('白名单每次现算：内容编辑就地改 embedOf 后立即生效', () => {
  const before = v.m.embedOf.get('knowledge/ML/梯度.md')
  v.m.embedOf.set('knowledge/ML/梯度.md', ['asset/ml/other.png'])
  try {
    assert.equal(readImage(v.m, 'knowledge/ML', 'asset/ml/other.png').mimeType, 'image/png')
  } finally { v.m.embedOf.set('knowledge/ML/梯度.md', before) }
  assert.throws(() => readImage(v.m, 'knowledge/ML', 'asset/ml/other.png'), NO)
})
