// 目录拖动的落点表（spec「落点」一节每一格）、不合法与原位落点为 null、乐观显示的树变换
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { dragRows, spanEnd, canDrag, dropAt, applyDrop } from '../src/client/lib/treeDrag.ts'

const R = (key, depth, dir, open, rel) => ({ key, node: { name: key, rel, dir, path: null, desc: '', count: 0, children: [] }, depth, open })
const rows = dragRows([
  R('知识', 0, true, true, '知识'),                    // 0
  R('术语', 1, false, false, '知识/术语.md'),           // 1
  R('清结算', 1, true, true, '知识/清结算'),             // 2
  R('T1', 2, false, false, '知识/清结算/T1.md'),        // 3
  R('分账', 2, false, false, '知识/清结算/分账.md'),     // 4
  R('风控', 1, true, false, '知识/风控'),               // 5
  R('退款', 1, false, false, '知识/退款.md'),           // 6
  R('工作', 0, true, false, '工作'),                    // 7
])
const y = (row, fr) => row * 32 + fr * 32

test('dragRows / spanEnd / canDrag', () => {
  assert.deepEqual(rows.map((r) => r.parent), [-1, 0, 0, 2, 2, 0, 0, -1])
  assert.deepEqual([spanEnd(rows, 0), spanEnd(rows, 1), spanEnd(rows, 2), spanEnd(rows, 7)], [7, 2, 5, 8])
  assert.deepEqual(rows.map((_, i) => canDrag(rows, i)), [false, true, true, true, true, true, true, false], '区根不可拖')
})

test('文件行：上半插前、下半插后', () => {
  assert.deepEqual(dropAt(rows, 1, y(6, 0.8)), { folder: 0, place: { after: '知识/退款.md' }, line: { y: 224, depth: 1 }, into: null })
  assert.deepEqual(dropAt(rows, 6, y(1, 0.2)), { folder: 0, place: { before: '知识/术语.md' }, line: { y: 32, depth: 1 }, into: null })
})

test('文件夹行：上部插前；中部放进（排最后，高亮整行）；下部关着插到整块之后、开着放进排第一', () => {
  assert.deepEqual(dropAt(rows, 6, y(5, 0.1)), { folder: 0, place: { before: '知识/风控' }, line: { y: 160, depth: 1 }, into: null })
  assert.deepEqual(dropAt(rows, 1, y(2, 0.5)), { folder: 2, place: {}, line: null, into: 2 })
  assert.deepEqual(dropAt(rows, 1, y(5, 0.5)), { folder: 5, place: {}, line: null, into: 5 })
  assert.deepEqual(dropAt(rows, 1, y(5, 0.9)), { folder: 0, place: { after: '知识/风控' }, line: { y: 192, depth: 1 }, into: null })
  assert.deepEqual(dropAt(rows, 1, y(2, 0.9)), { folder: 2, place: { first: true }, line: { y: 96, depth: 2 }, into: null })
  assert.deepEqual(dropAt(rows, 1, y(7, 0.5)), { folder: 7, place: {}, line: null, into: 7 }, '放进另一个区的根')
})

test('不合法：落进自己或子孙、与四区并列的顶层', () => {
  assert.equal(dropAt(rows, 2, y(2, 0.5)), null)
  assert.equal(dropAt(rows, 2, y(3, 0.5)), null)
  assert.equal(dropAt(rows, 1, y(0, 0.1)), null)
  assert.equal(dropAt(rows, 1, y(7, 0.9)), null)
  assert.equal(dropAt(rows, 1, 9999), null, '超出列表：夹到最后一行，仍是顶层')
})

test('原位：插到下一个兄弟前、上一个兄弟后、已是第一还放第一、已是最后还放最后 → null', () => {
  assert.equal(dropAt(rows, 1, y(2, 0.1)), null)
  assert.equal(dropAt(rows, 6, y(5, 0.9)), null)
  assert.equal(dropAt(rows, 3, y(2, 0.9)), null)
  assert.equal(dropAt(rows, 4, y(2, 0.5)), null)
  assert.deepEqual(dropAt(rows, 3, y(4, 0.9)).place, { after: '知识/清结算/分账.md' }, '同父但不是原位：照常')
})

const N = (name, rel, dir, children = []) => ({ name, rel, dir, path: dir ? null : rel, desc: '', count: 0, children })
const tree = () => ({ children: [N('知识', '知识', true, [
  N('术语', '知识/术语.md', false),
  N('清结算', '知识/清结算', true, [N('T1', '知识/清结算/T1.md', false), N('分账', '知识/清结算/分账.md', false)]),
  N('退款', '知识/退款.md', false),
])] })
const names = (ns) => ns.map((n) => n.name)

test('applyDrop：前 / 后 / 第一 / 最后；不改入参；找不到节点原样返回', () => {
  const t = tree()
  const a = applyDrop(t, '知识/术语.md', '知识/清结算', { after: '知识/清结算/T1.md' })
  assert.deepEqual(names(a.children[0].children), ['清结算', '退款'])
  assert.deepEqual(names(a.children[0].children[0].children), ['T1', '术语', '分账'])
  assert.deepEqual(names(t.children[0].children), ['术语', '清结算', '退款'], '入参不变')
  assert.deepEqual(names(applyDrop(t, '知识/退款.md', '知识', { before: '知识/术语.md' }).children[0].children), ['退款', '术语', '清结算'])
  assert.deepEqual(names(applyDrop(t, '知识/术语.md', '知识/清结算', { first: true }).children[0].children[0].children), ['术语', 'T1', '分账'])
  assert.deepEqual(names(applyDrop(t, '知识/术语.md', '知识/清结算', {}).children[0].children[0].children), ['T1', '分账', '术语'])
  assert.equal(applyDrop(t, '知识/无.md', '知识', {}), t)
})
