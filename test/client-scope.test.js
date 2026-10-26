// test/client-scope.test.js —— 客户端作用域失效的纯函数面（不挂 DOM）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseChange } from '../src/client/api.ts';
import { applyChange, tickOf } from '../src/client/lib/nav.tsx';
import { touches } from '../src/client/lib/edit.ts';

test('parseChange：JSON 载荷 / 旧裸文本 / 坏帧兜底', () => {
  assert.deepEqual(parseChange('changed'), { kind: 'structural' }, '旧宿主裸文本按 structural');
  assert.deepEqual(parseChange('{"kind":"structural"}'), { kind: 'structural' });
  assert.deepEqual(parseChange('{"kind":"patch","ids":["a"],"flags":{"tree":true}}'), { kind: 'patch', ids: ['a'], flags: { tree: true } });
  assert.equal(parseChange('not json'), null, '坏帧丢弃（上层按没收到处理）');
  assert.equal(parseChange('{"kind":"patch"}'), null, '形状不对不给 patch');
});

test('applyChange/tickOf：structural 全自增；patch 按 flags 与 ids', () => {
  const t = { all: 0, tree: 0, stats: 0, graph: 0, documents: 0, pages: new Map() };
  applyChange(t, { kind: 'patch', ids: ['a'], flags: { stats: true } });
  assert.equal(tickOf(t, 'stats'), 1);
  assert.equal(tickOf(t, 'tree'), 0, 'stats-only 不刷树');
  assert.equal(tickOf(t, { page: 'a' }), 1);
  assert.equal(tickOf(t, { page: 'b' }), 0, '别的页不刷');
  applyChange(t, { kind: 'structural' });
  assert.equal(tickOf(t, 'tree'), 1);
  assert.equal(tickOf(t, { page: 'b' }), 1e9, 'structural 页作用域也翻（all 兜底）');
});

test('touches：structural 全摸；patch 按 ids；documents 只摸 raw/ 路径', () => {
  assert.equal(touches('knowledge/A.md', { kind: 'structural' }), true);
  const p = { kind: 'patch', ids: ['knowledge/A.md'], flags: {} };
  assert.equal(touches('knowledge/A.md', p), true);
  assert.equal(touches('knowledge/B.md', p), false);
  const documents = { kind: 'patch', ids: [], flags: { documents: true } };
  assert.equal(touches('raw/某文档.md', documents), true);
  assert.equal(touches('knowledge/A.md', documents), false, 'documents 面只关 raw 路径的编辑对象');
});
