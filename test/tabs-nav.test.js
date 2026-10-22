// @vitest-environment jsdom
// TabsNavStore：导航位 + 文档 tab。导航页（首页 / 列表页）进导航位、不占 tab；文档从导航位点开每次开新 tab
// （已开就切过去），在文档 tab 里普通点击原地换；修饰键只在 [data-tab-source]（目录树 / 正文）里认。
// 快照引用稳定、不支持前进后退、栈式 store 照旧
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { createNavStore, createTabsNavStore, installClickModifier, isDoc, routeKey, tabKey } from '../src/client/lib/nav.tsx'

const KB = { kind: 'kb' }
const BOOKS = { kind: 'books' }
const R = { kind: 'page', id: '知识/甲.md' }
const R2 = { kind: 'page', id: '知识/乙.md' }
const CH = { kind: 'chapter', book: '《书》', id: '01' }

test('isDoc：页 / 文档 / 章节是文档，其余是导航页', () => {
  for (const r of [R, { kind: 'raw', path: 'raw/a.md' }, CH]) assert.equal(isDoc(r), true, r.kind)
  for (const r of [KB, BOOKS, { kind: 'book', name: 'b' }, { kind: 'documents' }, { kind: 'listens' }, { kind: 'drafts' }, { kind: 'activity' }, { kind: 'graph' }, { kind: 'tag', tag: 't' }, { kind: 'lark', appId: 'a' }]) {
    assert.equal(isDoc(r), false, r.kind)
  }
})

test('起手停在导航位（首页），没有文档 tab；快照引用稳定', () => {
  const st = createTabsNavStore(KB)
  assert.deepEqual([st.get().route, st.get().hub, st.get().tabs, st.get().active], [KB, KB, [], -1])
  assert.ok(st.get() === st.get())
  const b = createNavStore(KB)
  assert.ok(b.get() === b.get())
})

test('go(导航页)：换导航位、停在导航位，文档 tab 原样留着', () => {
  const st = createTabsNavStore(KB)
  st.go(R)
  st.go(BOOKS)
  assert.deepEqual([st.get().route, st.get().hub, st.get().active], [BOOKS, BOOKS, -1])
  assert.deepEqual(st.get().tabs, [R])
})

test('停在导航位 go(文档)：每次开新 tab；已开着就切过去并带上锚点', () => {
  const st = createTabsNavStore(KB)
  st.go(R)
  st.go(KB)
  st.go(R2)
  assert.deepEqual(st.get().tabs, [R, R2], '从导航位点第二篇：又开一个')
  assert.equal(st.get().active, 1)
  st.go(KB)
  st.go({ ...R, anchor: 'x' })
  assert.equal(st.get().tabs.length, 2, '已开着：不重复开')
  assert.deepEqual(st.get().route, { ...R, anchor: 'x' })
})

test('停在文档 tab go(文档)：原地换；别的 tab 已开着同一篇就切过去带参数，当前 tab 不动', () => {
  const st = createTabsNavStore(KB)
  st.go(R)
  st.go(CH)
  assert.deepEqual(st.get().tabs, [CH], '原地换')
  st.openTab(R2)
  st.go({ ...CH, id: '01' })
  assert.equal(st.get().active, 0, '同篇在别的 tab：切过去')
  assert.deepEqual(st.get().tabs, [CH, R2])
  let n = 0
  const off = st.subscribe(() => { n++ })
  st.go(CH)
  off()
  assert.equal(n, 0, '同路由 no-op 不通知')
})

test('openTab：文档开新 tab（去重聚焦）；导航页同 go，进导航位', () => {
  const st = createTabsNavStore(KB)
  st.openTab(R); st.openTab(R2); st.openTab({ ...R, anchor: 'y' })
  assert.deepEqual(st.get().tabs, [{ ...R, anchor: 'y' }, R2])
  assert.equal(st.get().active, 0)
  st.openTab(BOOKS)
  assert.deepEqual([st.get().hub, st.get().active, st.get().tabs.length], [BOOKS, -1, 2])
})

test('关最后一个文档 tab：回导航位（上次的导航页）', () => {
  const st = createTabsNavStore(KB)
  st.go(BOOKS)
  st.go(R)
  st.closeTab(0)
  assert.deepEqual([st.get().route, st.get().active, st.get().tabs], [BOOKS, -1, []])
})

test('tabKey：按「是哪一篇」认——页忽略锚点、文档表忽略筛选、图谱忽略聚焦；别的路由同 routeKey', () => {
  assert.equal(tabKey({ kind: 'page', id: 'a.md', anchor: 'x' }), tabKey({ kind: 'page', id: 'a.md' }))
  assert.notEqual(tabKey({ kind: 'page', id: 'a.md' }), tabKey({ kind: 'page', id: 'b.md' }))
  assert.equal(tabKey({ kind: 'documents', status: '待沉淀' }), tabKey({ kind: 'documents' }))
  assert.equal(tabKey({ kind: 'graph', focus: 'a.md' }), tabKey({ kind: 'graph' }))
  assert.equal(tabKey(CH), routeKey(CH))
})

test('标题按篇存：同一篇换锚点标题不丢；原地替换清旧标题；clearTitles 清整表', () => {
  const st = createTabsNavStore(KB)
  st.go(R)
  st.setTitle(R, '甲')
  st.go({ ...R, anchor: 'x' })
  assert.equal(st.get().titles.get(tabKey(R)), '甲')
  st.go(R2)
  assert.ok(!st.get().titles.has(tabKey(R)))
  st.setTitle(R2, '乙')
  st.clearTitles()
  assert.equal(st.get().titles.size, 0)
})

test('retreat：图谱回退——从文档 tab 进图谱切回该 tab；从导航页进图谱换回导航页；图谱内换聚焦不算', () => {
  const st = createTabsNavStore(KB)
  assert.equal(st.get().canRetreat, false, '起手不可回退')
  // 从文档 tab 进图谱（go 导航页 → 开文档 → 进图谱）：retreat 切回文档 tab
  st.go(R)
  st.go({ kind: 'graph' })
  assert.equal(st.get().canRetreat, true, '进图谱后可回退')
  assert.equal(st.get().active, -1, '图谱在导航位')
  st.retreat()
  assert.deepEqual([st.get().route, st.get().active], [R, 0], '回退切回原文档 tab')
  // 从导航页（首页）进图谱：retreat 换回导航页
  st.go(KB)
  st.go({ kind: 'graph' })
  st.retreat()
  assert.deepEqual([st.get().route, st.get().active], [KB, -1], '回退换回导航页')
  // 图谱内换聚焦：不覆盖回退目标，回退仍回上一页
  st.go({ kind: 'graph', focus: '知识/甲.md' })
  assert.equal(st.get().canRetreat, true)
  st.go({ kind: 'graph', focus: '知识/乙.md' })
  st.retreat()
  assert.deepEqual(st.get().route, KB, 'graph→graph 不算移动，回退目标仍是进图谱前那页')
  // 起手就在图谱（restore）：canRetreat=false，retreat 不动
  const fresh = createTabsNavStore({ kind: 'graph' })
  assert.equal(fresh.get().canRetreat, false, '起手图谱不可回退')
  fresh.retreat()
  assert.equal(fresh.get().route.kind, 'graph', '无可回退时不动作')
})

test('tab 式不支持前进后退：store 与快照上都没有这几个成员', () => {
  const st = createTabsNavStore(KB)
  st.go(R)
  assert.equal('back' in st, false)
  assert.equal('forward' in st, false)
  assert.equal('canBack' in st.get(), false)
  assert.equal('canForward' in st.get(), false)
})

test('栈式照旧：go 压栈、back/forward 真走、快照带 canBack', () => {
  const st = createNavStore(KB)
  st.go(R)
  assert.equal(st.get().canBack, true)
  st.back()
  assert.deepEqual(st.get().route, KB)
  st.forward()
  assert.deepEqual(st.get().route, R)
})

test('moveTab / closeOthers / closeRight / restore 转给模型', () => {
  const st = createTabsNavStore(KB)
  st.openTab(R); st.openTab(R2); st.openTab(CH)       // [R, R2, CH]，活动 CH
  st.moveTab(2, 0)
  assert.deepEqual(st.get().tabs, [CH, R, R2])
  assert.equal(st.get().active, 0)
  st.closeRight(1)
  assert.deepEqual(st.get().tabs, [CH, R])
  st.closeOthers(1)
  assert.deepEqual(st.get().tabs, [R])
  st.restore(BOOKS, [R2, CH], -1)
  assert.deepEqual([st.get().hub, st.get().tabs, st.get().active], [BOOKS, [R2, CH], -1])
})

test('pristine：没动过为真；标题 / 路径上报不算动；换导航页、go、restore 之后为假', () => {
  const st = createTabsNavStore(KB)
  assert.equal(st.pristine(), true)
  st.go(BOOKS)
  assert.equal(st.pristine(), false, '换导航页也算动过')
  const b = createTabsNavStore(KB)
  b.restore(KB, [R], 0)
  assert.equal(b.pristine(), false)
  const c = createTabsNavStore(KB)
  c.setTitle(KB, '首页')
  assert.equal(c.pristine(), true)
})

test('setPath：按篇存进 paths 表；关 tab 清掉', () => {
  const st = createTabsNavStore(KB)
  st.openTab(CH)
  st.setPath(CH, 'raw/book/书/章节/01.md')
  assert.equal(st.get().paths.get(tabKey(CH)), 'raw/book/书/章节/01.md')
  st.closeTab(0)
  assert.equal(st.get().paths.size, 0)
})

test('修饰键只在 [data-tab-source] 里认：目录树 / 正文 Cmd+点开新 tab；列表里的 Cmd+点同普通点击（Review Focus 3）', () => {
  const st = createTabsNavStore(KB)
  document.body.innerHTML = '<div data-tab-source><button id="in"></button></div><button id="out"></button>'
  let target = R
  for (const id of ['in', 'out']) document.getElementById(id).addEventListener('click', () => st.go(target))
  const off = installClickModifier()
  st.go(R)                                                // 先停在文档 tab 上：普通点击会原地换
  target = R2
  document.getElementById('in').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
  assert.deepEqual(st.get().tabs, [R, R2], '目录树里 Cmd+点：开新 tab')
  target = CH
  document.getElementById('out').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
  assert.deepEqual(st.get().tabs, [R, CH], '区域外 Cmd+点：原地换，不开新 tab')
  off()
})

test('修饰键也认 mousedown（编辑器 ⌘+点击在 mousedown 上就打开）；100ms 外的程序化 go 不吃残留', () => {
  vi.useFakeTimers()
  try {
    const st = createTabsNavStore(KB)
    document.body.innerHTML = '<div data-tab-source><span id="link"></span></div>'
    const link = document.getElementById('link')
    link.addEventListener('mousedown', () => st.go(R2))
    const off = installClickModifier()
    st.go(R)
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, metaKey: true }))
    assert.deepEqual(st.get().tabs, [R, R2], 'mousedown 上的 ⌘ 也认')
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    vi.setSystemTime(Date.now() + 1000)
    st.go(CH)
    assert.equal(st.get().tabs.length, 2, '过期标志不吃，原地换')
    off()
  } finally { vi.useRealTimers() }
})
