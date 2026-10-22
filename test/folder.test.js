import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ROOT_FOLDER, normFolder, isVaultRoot, folderLabel, folderText } from '../src/core/folder.ts'

test('只由 / 组成（可带空白）→ 知识库', () => {
  for (const v of ['/', '//', ' / ', '///', '\t/\n']) assert.equal(normFolder(v), ROOT_FOLDER, JSON.stringify(v))
})

test('空、只有空白、非字符串 → null（绝不当成整库）', () => {
  for (const v of ['', '   ', undefined, null, 3, {}]) assert.equal(normFolder(v), null, JSON.stringify(v))
})

test('普通路径去首尾斜杠与空白', () => {
  assert.equal(normFolder('/知识/机器学习/'), '知识/机器学习')
  assert.equal(normFolder(' 认知 '), '认知')
  assert.equal(normFolder('知识'), '知识')
})

test('空段、. 段、.. 段 → null', () => {
  for (const v of ['a/../b', '../a', 'a/..', './a', 'a/./b', 'a//b']) assert.equal(normFolder(v), null, v)
})

test('isVaultRoot / folderLabel', () => {
  assert.equal(isVaultRoot('/'), true)
  assert.equal(isVaultRoot('知识'), false)
  assert.equal(folderLabel('/'), '知识库')
  assert.equal(folderLabel('知识/机器学习'), '知识/机器学习')
})

test('folderText：字符串原样、有限数字转字符串，其余一律空', () => {
  assert.equal(folderText('知识'), '知识')
  assert.equal(folderText(2026), '2026')
  for (const v of [['/'], {}, true, null, undefined, NaN]) assert.equal(folderText(v), '', String(v))
})
