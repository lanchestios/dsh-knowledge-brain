// test/editor-batch.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BatchStore } from '../src/editor/blocks/server.ts';

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('同窗去重：N 个 get 只发一次批量请求，顺序对应', async () => {
  const calls = [];
  const b = new BatchStore(async (srcs) => { calls.push(srcs); return srcs.map((s) => `<p>${s}</p>`); }, 10);
  const p1 = b.get('a'); const p2 = b.get('b'); const p3 = b.get('a');
  assert.deepEqual([await p1, await p2, await p3], ['<p>a</p>', '<p>b</p>', '<p>a</p>']);
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['a', 'b']);
  // 命中缓存：不再发请求
  assert.equal(await b.get('a'), '<p>a</p>');
  await tick();
  assert.equal(calls.length, 1);
});

test('fetch 失败兜底为空串（不炸宿主、不悬挂 promise）', async () => {
  const b = new BatchStore(async () => { throw new Error('rpc 挂了'); }, 10);
  assert.equal(await b.get('x'), '');
});

test('fetcher 同步抛异常同样兜底为空串（不裸逃出 setTimeout 回调）', async () => {
  const b = new BatchStore(() => { throw new Error('sync throw'); }, 10);
  assert.equal(await b.get('x'), '');
});
