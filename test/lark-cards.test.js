import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildAskCard, buildSettledCard, applyCardAction } from '../src/lark/cards.ts';

// 追问卡片的纯件：渲染形状（按钮 value 编码）与点按映射。SDK 不进这里。

const Q1 = {
  id: 'q1', question: '答哪部分？', header: '范围',
  options: [{ label: '定义', description: '概念与内涵' }, { label: '出处' }],
}

test('单选卡：每选项一个按钮、value 带 {q,o}；题面带序号与说明/释义', () => {
  const card = buildAskCard([Q1])
  const json = JSON.stringify(card)
  assert.ok(json.includes('"value":{"q":"q1","o":"定义"}'), '按钮 value 编码问题 id 与选项')
  assert.ok(json.includes('"value":{"q":"q1","o":"出处"}'), '每个选项一个按钮')
  assert.ok(json.includes('1. 范围：答哪部分？'), '题面带序号，header 前置')
  assert.ok(json.includes('定义：概念与内涵'), '选项释义进 note')
  assert.ok(!json.includes('提交'), '单选没有提交按钮')
  assert.ok(json.includes('直接回复文字'), '提示可文字作答')
})

test('多选卡：勾选后刷新带 ✓ 高亮，末尾「提交」按钮 value 带 s', () => {
  const q = { id: 'q2', question: '带哪些？', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] }
  const plain = JSON.stringify(buildAskCard([q]))
  assert.ok(plain.includes('"value":{"q":"q2","s":"1"}'), '提交按钮带 s 标记')
  const tick = applyCardAction([q], {}, { q: 'q2', o: 'a' })
  assert.ok(tick)
  const refreshed = JSON.stringify(buildAskCard([q], tick.picked))
  assert.ok(refreshed.includes('✓ a'), '勾选项带 ✓')
  assert.ok(!refreshed.includes('✓ b'), '未勾选不带')
})

test('多题混合：单选点后刷新要高亮所选（否则用户看着像没点上）；纯文字题标明要回文字、答过显示正文', () => {
  const qs = [{ id: 't', question: '找什么入口？' }, Q1]
  const before = JSON.stringify(buildAskCard(qs))
  assert.ok(before.includes('请直接回复文字作答'), '无选项的题在题下写明要回文字')
  const r = applyCardAction(qs, {}, { q: 'q1', o: '出处' })
  assert.ok(r)
  const after = JSON.stringify(buildAskCard(qs, r.picked))
  assert.notEqual(after, before, '点了之后卡片必须有可见变化')
  assert.ok(after.includes('✓ 出处'), '单选所选项带 ✓')
  assert.ok(!after.includes('✓ 定义'))
  assert.ok(after.includes('"value":{"q":"q1","o":"定义"}'), '没收卡前仍可改选')
  const typed = JSON.stringify(buildAskCard(qs, r.picked, { t: '请假' }))
  assert.ok(typed.includes('已回复：请假'), '文字作答过的题显示正文')
})

test('applyCardAction：单选点按即定稿；多选勾选切换不定稿、提交定稿（空集也算交卷）', () => {
  const single = applyCardAction([Q1], {}, { q: 'q1', o: '出处' })
  assert.ok(single)
  assert.deepEqual(single.settled, { q1: ['出处'] })
  const q = { id: 'q2', question: 'x', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] }
  const s1 = applyCardAction([q], {}, { q: 'q2', o: 'a' })
  assert.ok(s1)
  assert.deepEqual(s1.settled, {}, '勾选不定稿')
  const s2 = applyCardAction([q], s1.picked, { q: 'q2', o: 'a' })
  assert.ok(s2)
  assert.deepEqual(s2.picked, { q2: [] }, '再点一次取消勾选')
  const s3 = applyCardAction([q], s1.picked, { q: 'q2', s: '1' })
  assert.ok(s3)
  assert.deepEqual(s3.settled, { q2: ['a'] }, '提交定稿当前勾选')
  const empty = applyCardAction([q], {}, { q: 'q2', s: '1' })
  assert.ok(empty)
  assert.deepEqual(empty.settled, { q2: [] }, '一个没勾也算交卷（AI 自己看着办）')
})

test('applyCardAction：问题 id 或选项对不上、value 非对象 → 一律丢弃', () => {
  assert.equal(applyCardAction([Q1], {}, { q: 'nope', o: '定义' }), null)
  assert.equal(applyCardAction([Q1], {}, { q: 'q1', o: '不存在的选项' }), null)
  assert.equal(applyCardAction([Q1], {}, 'text'), null)
  assert.equal(applyCardAction([Q1], {}, null), null)
})

test('收场卡：selected/customs/未作答 三态各有文案，按钮撤光', () => {
  const qs = [Q1, { id: 'q2', question: '多长？' }, { id: 'q3', question: '何时？' }]
  const json = JSON.stringify(buildSettledCard(qs, { q1: ['定义'], q2: [] }, { q2: '半页' }, '已作答'))
  assert.ok(json.includes('已作答'))
  assert.ok(json.includes('定义'), '选项作答列出所选')
  assert.ok(json.includes('文字作答：半页'), '文字作答带正文')
  assert.ok(json.includes('未作答'), '没答的题如实标注')
  assert.ok(!json.includes('"tag":"action"'), '收场不带按钮')
  assert.ok(!json.includes('appSecret'), '卡片里当然不该有 secret')
})
