import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SeenEvents } from '../src/lark/state.ts';

// SeenEvents：Lark会因网络抖动重推同一 event_id，见过即丢（问答已改走真实 DSH 会话，
// 去重是防「一条消息答两遍」的唯一闸门）。

test('SeenEvents：同一个 event_id 第二次报重复；淘汰最老的之后旧号又能记（有界内存）', () => {
  const s = new SeenEvents(3);
  for (const id of ['a', 'b', 'c']) assert.equal(s.dup(id), false);
  assert.equal(s.dup('b'), true);   // 重推：丢
  assert.equal(s.dup('d'), false);  // 容量 3，a 被顶掉
  assert.equal(s.dup('a'), false);  // a 已出窗：再见到不算重复（3 条以外的重推概率极低，接受）
})

test('SeenEvents：空 event_id 不算重复（没有事件号的消息照常处理）', () => {
  const s = new SeenEvents(3);
  assert.equal(s.dup(''), false);
  assert.equal(s.dup(''), false);
})
