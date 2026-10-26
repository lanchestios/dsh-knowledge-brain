// tab 持久化 v2：{ v: 2, hub, tabs, active }。按库目录分键（尾斜杠同口径）、路由逐个校验、旧版本存档
// 直接清理（不迁移）、只在 store 没动过时恢复、换库恢复新库（没存档回到只有首页）、防抖写、退订补写、
// localStorage 抛错不炸
import { test, vi, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { storageKey, parseRoute, loadTabs, saveTabs, persistTabs } from '../src/client/reader/tabs/persist.ts'
import { createTabsNavStore } from '../src/client/lib/nav.tsx'

const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, m }
}
const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') } }
const P = (id) => ({ kind: 'page', id })
const KB = { kind: 'kb' }
const BOOKS = { kind: 'books' }

beforeEach(() => { vi.useRealTimers() })

test('storageKey：抹尾斜杠，带不带斜杠同一个键', () => {
  assert.equal(storageKey('/v/wiki/'), 'dsh-knowledge-brain:tabs:/v/wiki')
  assert.equal(storageKey('/v/wiki'), storageKey('/v/wiki//'))
})

test('parseRoute：合法路由原样认；缺字段、类型不对、未知 kind 一律 null', () => {
  assert.deepEqual(parseRoute({ kind: 'page', id: 'a.md', anchor: 'x' }), { kind: 'page', id: 'a.md', anchor: 'x' })
  assert.deepEqual(parseRoute(KB), KB)
  assert.deepEqual(parseRoute({ kind: 'documents', status: '已引用' }), { kind: 'documents', status: '已引用' })
  assert.equal(parseRoute({ kind: 'page' }), null)
  assert.equal(parseRoute({ kind: 'documents', status: '乱写' }), null)
  assert.equal(parseRoute({ kind: 'nope' }), null)
  assert.equal(parseRoute(null), null)
})

test('saveTabs / loadTabs v2 往返；不同库互不串', () => {
  const s = mem()
  saveTabs('/v1', BOOKS, [P('a'), P('b')], 1, s)
  assert.deepEqual(JSON.parse(s.getItem(storageKey('/v1'))), { v: 2, hub: BOOKS, tabs: [P('a'), P('b')], active: 1 })
  assert.deepEqual(loadTabs('/v1/', s), { hub: BOOKS, tabs: [P('a'), P('b')], active: 1 })
  assert.equal(loadTabs('/v2', s), null)
  saveTabs('/v3', KB, [P('a')], -1, s)
  assert.deepEqual(loadTabs('/v3', s), { hub: KB, tabs: [P('a')], active: -1 }, '停在导航位也存得住')
})

test('旧版本存档不迁移：v1 / 其他版本当没有，并把键删掉（Review Focus 1）', () => {
  const s = mem()
  const k = storageKey('/v')
  s.setItem(k, JSON.stringify({ v: 1, tabs: [KB, BOOKS, P('a')], active: 2 }))
  assert.equal(loadTabs('/v', s), null)
  assert.equal(s.getItem(k), null, 'v1 存档被删')
  s.setItem(k, JSON.stringify({ v: 9, hub: KB, tabs: [], active: -1 }))
  assert.equal(loadTabs('/v', s), null)
  assert.equal(s.getItem(k), null)
})

test('loadTabs：坏数据当没有；坏路由逐个丢；导航位不是导航页 / 坏掉退首页；tab 里混进导航页丢掉；active 对齐', () => {
  const s = mem()
  const k = storageKey('/v')
  s.setItem(k, '{bad'); assert.equal(loadTabs('/v', s), null)
  s.setItem(k, JSON.stringify({ v: 2, hub: KB, tabs: 'x', active: 0 })); assert.equal(loadTabs('/v', s), null)
  s.setItem(k, JSON.stringify({ v: 2, hub: { kind: 'nope' }, tabs: [P('a'), { kind: 'nope' }, BOOKS, P('b')], active: 3 }))
  assert.deepEqual(loadTabs('/v', s), { hub: KB, tabs: [P('a'), P('b')], active: 1 })
  s.setItem(k, JSON.stringify({ v: 2, hub: P('x'), tabs: [], active: -1 }))
  assert.deepEqual(loadTabs('/v', s), { hub: KB, tabs: [], active: -1 }, '文档不能当导航位')
  s.setItem(k, JSON.stringify({ v: 2, hub: BOOKS, tabs: [P('a')], active: -1 }))
  assert.equal(loadTabs('/v', s).active, -1)
})

test('localStorage 读写抛错：load 当没有、save 静默，persistTabs 照常可用', () => {
  assert.equal(loadTabs('/v', broken), null)
  assert.doesNotThrow(() => saveTabs('/v', KB, [P('a')], 0, broken))
  const st = createTabsNavStore(KB)
  const off = persistTabs(st, '/v', { storage: broken, delayMs: 0 })
  assert.doesNotThrow(() => { st.go(P('a')); off() })
})

test('persistTabs：store 没动过才恢复；已经点开别的页就不覆盖', () => {
  const s = mem()
  saveTabs('/v', BOOKS, [P('a'), P('b')], 1, s)
  const st = createTabsNavStore(KB)
  const off = persistTabs(st, '/v', { storage: s })
  assert.deepEqual([st.get().hub, st.get().tabs, st.get().active], [BOOKS, [P('a'), P('b')], 1])
  off()
  const busy = createTabsNavStore(KB)
  busy.go(P('z'))
  const off2 = persistTabs(busy, '/v', { storage: s })
  assert.deepEqual(busy.get().tabs, [P('z')])
  off2()
})

test('换库（switched）：换成新库的存档；新库没存档就回到只有首页的导航位', () => {
  const s = mem()
  saveTabs('/B', KB, [P('b1')], 0, s)
  const st = createTabsNavStore(KB)
  st.go(P('a1')); st.go(BOOKS)
  const off = persistTabs(st, '/B', { storage: s, switched: true })
  assert.deepEqual([st.get().hub, st.get().tabs, st.get().active], [KB, [P('b1')], 0])
  off()
  const c = createTabsNavStore(KB)
  c.go(BOOKS); c.go(P('a1'))
  const off2 = persistTabs(c, '/C-没存过', { storage: s, switched: true })
  assert.deepEqual([c.get().hub, c.get().tabs, c.get().active], [KB, [], -1])
  off2()
})

test('persistTabs：变化后防抖写（delayMs 内连改只写一次）；退订时把没落盘的那次补写', () => {
  vi.useFakeTimers()
  const s = mem()
  const writes = []
  const spy = { ...s, setItem: (k, v) => { writes.push(JSON.parse(v)); s.setItem(k, v) } }
  const st = createTabsNavStore(KB)
  const off = persistTabs(st, '/v', { storage: spy, delayMs: 300 })
  st.go(P('a')); st.go(BOOKS)
  assert.equal(writes.length, 0)
  vi.advanceTimersByTime(300)
  assert.deepEqual(writes, [{ v: 2, hub: BOOKS, tabs: [P('a')], active: -1 }])
  st.switchTab(0)
  off()
  assert.equal(writes.length, 2, '退订补写')
  assert.equal(writes[1].active, 0)
  st.go(KB)
  vi.advanceTimersByTime(1000)
  assert.equal(writes.length, 2, '退订后不再写')
})

test('parseRoute：章节带回打开处的章名（重启后非活动 tab 没挂 pane，标题靠它占位，不能退成章号）', () => {
  assert.deepEqual(parseRoute({ kind: 'chapter', book: '《书》', id: '01', title: '序' }), { kind: 'chapter', book: '《书》', id: '01', title: '序' })
  assert.deepEqual(parseRoute({ kind: 'chapter', book: '《书》', id: '01' }), { kind: 'chapter', book: '《书》', id: '01' })
  assert.equal(parseRoute({ kind: 'chapter', book: '《书》', id: '01', title: 3 }), null)
})
