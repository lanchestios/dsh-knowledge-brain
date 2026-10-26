// 后台保活：活动的必挂、正在编辑的必挂，其余按最近使用取满上限；最近使用顺序随切换更新、
// 关掉的 tab 从里面清走。滚动记忆：记 / 取（取完即删）/ 忘
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { aliveKeys, touchRecent, ALIVE_MAX } from '../src/client/reader/tabs/alive.ts'
import { scrollMemo } from '../src/client/reader/tabs/scrollMemo.ts'

const keys = (n) => Array.from({ length: n }, (_, i) => `k${i}`)

test('ALIVE_MAX 是 8', () => { assert.equal(ALIVE_MAX, 8) })

test('touchRecent：挪到最前、去重、去掉已关掉的', () => {
  assert.deepEqual(touchRecent(['a', 'b', 'c'], 'c', ['a', 'b', 'c']), ['c', 'a', 'b'])
  assert.deepEqual(touchRecent(['a', 'b', 'c'], 'a', ['a', 'c']), ['a', 'c'], 'b 已关')
  assert.deepEqual(touchRecent([], 'x', ['x']), ['x'])
})

test('aliveKeys：tab 不超上限时全挂', () => {
  const ks = keys(5)
  assert.deepEqual([...aliveKeys({ keys: ks, recent: ks, active: 'k0', pinned: new Set() })].sort(), [...ks].sort())
})

test('aliveKeys：超上限按最近使用取满 8；活动的一定在', () => {
  const ks = keys(10)
  const recent = ['k9', 'k8', 'k7', 'k6', 'k5', 'k4', 'k3', 'k2', 'k1', 'k0']
  const a = aliveKeys({ keys: ks, recent, active: 'k0', pinned: new Set() })
  assert.equal(a.size, 8)
  assert.ok(a.has('k0'), '活动的必挂（哪怕最久没用）')
  assert.ok(a.has('k9') && a.has('k3'))
  assert.equal(a.has('k2'), false, '最近使用排第 8 之后的让位')
})

test('aliveKeys：正在编辑的必挂，不占「最近使用」名额之外还要保住（Review Focus 4）', () => {
  const ks = keys(12)
  const recent = [...ks].reverse()   // k11 最近、k0 最久
  const a = aliveKeys({ keys: ks, recent, active: 'k11', pinned: new Set(['k0']) })
  assert.ok(a.has('k0'), '正在编辑的最久没用也不卸')
  assert.ok(a.has('k11'))
  assert.equal(a.size, 8)
})

test('aliveKeys：恢复后只有活动的在最近使用里 → 只挂活动的', () => {
  const a = aliveKeys({ keys: keys(6), recent: ['k3'], active: 'k3', pinned: new Set() })
  assert.deepEqual([...a], ['k3'])
})

test('scrollMemo：记了能取、取完即删、0 不记、forget 清掉', () => {
  scrollMemo.remember('p', 320)
  assert.equal(scrollMemo.take('p'), 320)
  assert.equal(scrollMemo.take('p'), undefined)
  scrollMemo.remember('q', 0)
  assert.equal(scrollMemo.take('q'), undefined)
  scrollMemo.remember('r', 10); scrollMemo.forget('r')
  assert.equal(scrollMemo.take('r'), undefined)
})
