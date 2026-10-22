// tab 让位的纯计算：被拖 tab 的位移夹在首尾之间；目标 = 越过了谁的中心；夹在中间的 tab 让一个身位
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { clampDx, slideTarget, shiftOf } from '../src/client/reader/tabDrag.ts'

const S = [0, 1, 2, 3].map((i) => ({ left: i * 100, width: 100 }))

test('clampDx：最左到第一个、最右到最后一个', () => {
  assert.equal(clampDx(S, 1, -500), -100)
  assert.equal(clampDx(S, 1, 500), 200)
  assert.equal(clampDx(S, 1, 30), 30)
})

test('slideTarget：越过邻居中心才换位；夹到头就是首尾', () => {
  assert.equal(slideTarget(S, 0, 90), 0, '中心还没到邻居中心')
  assert.equal(slideTarget(S, 0, 110), 1)
  assert.equal(slideTarget(S, 0, 210), 2)
  assert.equal(slideTarget(S, 0, 999), 3)
  assert.equal(slideTarget(S, 3, -90), 3)
  assert.equal(slideTarget(S, 3, -110), 2)
  assert.equal(slideTarget(S, 3, -999), 0)
  assert.equal(slideTarget(S, 2, 0), 2)
})

test('shiftOf：往右拖，经过的 tab 左移一个身位；往左拖反之；其余不动', () => {
  assert.deepEqual([0, 1, 2, 3].map((k) => shiftOf(0, 2, k, 103)), [0, -103, -103, 0])
  assert.deepEqual([0, 1, 2, 3].map((k) => shiftOf(3, 1, k, 103)), [0, 103, 103, 0])
  assert.deepEqual([0, 1, 2, 3].map((k) => shiftOf(1, 1, k, 103)), [0, 0, 0, 0])
})
