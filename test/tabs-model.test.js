// TabsModel：导航位（hub）+ 文档 tab。用字符串当 tab，`#` 后面当「同一篇里的位置」——key 只看 `#` 前面，
// same 看整串。active = -1 表示停在导航位。钉死：导航位换页、去重聚焦并换参、关闭邻接（关最后一个回导航位、
// 停在导航位关 tab 不动）、关其他 / 右侧、移动活动跟随、恢复（带 hub、-1）、附加信息随 tab 走、无变化同引用
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createTabsModel } from '../src/client/reader/tabs/model.ts'

const M = createTabsModel({ key: (t) => t.split('#')[0], same: (a, b) => a === b })
const st = (...tabs) => M.restore(M.init('home'), 'home', tabs, 0)

test('init：停在导航位、没有文档 tab', () => {
  assert.deepEqual(M.init('home'), { hub: 'home', tabs: [], active: -1, meta: new Map() })
})

test('showHub：换导航页并停在导航位；同一页且已停在导航位返回同一引用', () => {
  const s0 = M.init('home')
  assert.equal(M.showHub(s0, 'home'), s0)
  const s1 = M.showHub(st('a', 'b'), 'books')
  assert.deepEqual([s1.hub, s1.tabs, s1.active], ['books', ['a', 'b'], -1], '文档 tab 原样留着')
  const s2 = M.showHub(M.focus(s1, 0), 'books')
  assert.equal(s2.active, -1, '从文档回到同一个导航页：也是换回导航位')
})

test('open：新的追加并聚焦；同 key 已开则聚焦并换参；停在导航位也一样', () => {
  let s = M.init('home')
  s = M.open(s, 'a')
  assert.deepEqual([s.tabs, s.active], [['a'], 0])
  s = M.showHub(s, 'home')
  s = M.open(s, 'a#x')
  assert.deepEqual([s.tabs, s.active], [['a#x'], 0], '导航位上点开已开的那篇：切过去、带参数')
  assert.equal(M.open(s, 'a#x'), s, '无变化同引用')
})

test('focus：越界 / -1 / 已是它返回同一引用；给了 t 就换成 t', () => {
  const s = st('a', 'b')
  assert.equal(M.focus(s, 0), s)
  assert.equal(M.focus(s, 5), s)
  assert.equal(M.focus(s, -1), s)
  const t = M.focus(s, 1, 'b#y')
  assert.deepEqual([t.tabs, t.active], [['a', 'b#y'], 1])
})

test('replace：原地换活动 tab；停在导航位时返回同一引用（导航层不会这样调）', () => {
  let s = M.setMeta(st('a', 'b'), 'a', { title: '甲' })
  s = M.replace(s, 'c')
  assert.deepEqual([s.tabs, s.active], [['c', 'b'], 0])
  assert.equal(s.meta.has('a'), false)
  const h = M.showHub(s, 'home')
  assert.equal(M.replace(h, 'z'), h)
})

test('close：关左侧左移、关自己接右侧、关末尾回左侧；关最后一个回导航位（停在上次的导航页）', () => {
  let s = M.focus(M.showHub(st('a', 'b', 'c'), 'books'), 1)
  s = M.close(s, 0)
  assert.deepEqual([s.tabs, s.active], [['b', 'c'], 0])
  s = M.close(s, 0)
  assert.deepEqual([s.tabs, s.active], [['c'], 0])
  s = M.close(s, 0)
  assert.deepEqual([s.hub, s.tabs, s.active], ['books', [], -1], '回书架，不是首页（Review Focus 2）')
})

test('close：停在导航位时关文档 tab，仍停在导航位', () => {
  const s = M.close(M.showHub(st('a', 'b'), 'home'), 0)
  assert.deepEqual([s.tabs, s.active], [['b'], -1])
})

test('closeOthers / closeRight：只作用于文档；停在导航位时 active 仍为 -1', () => {
  const a = M.closeOthers(st('a', 'b', 'c'), 1)
  assert.deepEqual([a.tabs, a.active], [['b'], 0])
  assert.equal(M.closeOthers(a, 0), a)
  const b = M.closeRight(M.focus(st('a', 'b', 'c', 'd'), 3), 1)
  assert.deepEqual([b.tabs, b.active], [['a', 'b'], 1])
  const c = M.closeRight(M.showHub(st('a', 'b', 'c'), 'home'), 0)
  assert.deepEqual([c.tabs, c.active], [['a'], -1])
})

test('move：活动跟着那一篇走；停在导航位时仍为 -1；放回原位 / 越界同引用', () => {
  const s = M.focus(st('a', 'b', 'c'), 0)
  const m = M.move(s, 0, 2)
  assert.deepEqual([m.tabs, m.active], [['b', 'c', 'a'], 2])
  const h = M.move(M.showHub(s, 'home'), 0, 2)
  assert.deepEqual([h.tabs, h.active], [['b', 'c', 'a'], -1])
  assert.equal(M.move(s, 1, 1), s)
  assert.equal(M.move(s, 0, 9), s)
})

test('restore：带 hub；按 key 去重；active 允许 -1；越界取 0；没有 tab 时为 -1', () => {
  const s0 = M.init('home')
  const a = M.restore(s0, 'books', ['a', 'b', 'a#x'], 1)
  assert.deepEqual([a.hub, a.tabs, a.active], ['books', ['a', 'b'], 1])
  assert.equal(M.restore(s0, 'home', ['a'], -1).active, -1)
  assert.equal(M.restore(s0, 'home', ['a', 'b'], 7).active, 0)
  const e = M.restore(st('a'), 'home', [], 0)
  assert.deepEqual([e.hub, e.tabs, e.active], ['home', [], -1])
})

test('setMeta / clearMeta：按 key 合并；不在 tab 里（含导航页）不存；关 tab 清对应项', () => {
  let s = st('a', 'b')
  s = M.setMeta(s, 'a#x', { title: '甲' })
  assert.deepEqual(s.meta.get('a'), { title: '甲' })
  assert.equal(M.setMeta(s, 'a', { title: '甲' }), s)
  assert.equal(M.setMeta(s, 'home', { title: '首页' }), s, '导航页不存附加信息')
  s = M.setMeta(s, 'a', { path: 'p/a.md' })
  const c = M.clearMeta(s, 'title')
  assert.deepEqual(c.meta.get('a'), { path: 'p/a.md' })
  assert.equal(M.clearMeta(c, 'title'), c)
  assert.equal(M.close(s, 0).meta.has('a'), false)
})
