// test/classify.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyEvents } from '../src/core/vault/engine.ts';

const DIR = '/tmp/vault';
const TOOLS = '/app/vault-tools/skills';
const ctx = { dir: DIR, areas: ['knowledge', 'work'], toolsDir: TOOLS };
const ev = (evt, rel) => ({ evt, path: path.join(DIR, rel) });

test('路由表：md 三态 / asset / raw / anchors / coverage / folder.json / addDir / wiki.json', () => {
  assert.deepEqual(classifyEvents([ev('change', 'knowledge/A.md')], ctx).docOps, [{ op: 'change', rel: 'knowledge/A.md' }]);
  assert.deepEqual(classifyEvents([ev('add', 'knowledge/A.md')], ctx).docOps, [{ op: 'create', rel: 'knowledge/A.md' }]);
  assert.deepEqual(classifyEvents([ev('unlink', 'knowledge/A.md')], ctx).docOps, [{ op: 'unlink', rel: 'knowledge/A.md' }]);
  assert.deepEqual(classifyEvents([ev('change', 'asset/x/a.html')], ctx).assets, ['asset/x/a.html']);
  assert.deepEqual(classifyEvents([ev('add', 'raw/素材.md')], ctx).raws, ['raw/素材.md']);
  assert.equal(classifyEvents([ev('change', '.wiki/anchors.conf')], ctx).anchors, true);
  assert.equal(classifyEvents([ev('change', '.wiki/coverage.conf')], ctx).coverage, true);
  assert.equal(classifyEvents([ev('change', 'knowledge/ML/.folder.json')], ctx).kind, 'structural');
  assert.equal(classifyEvents([ev('addDir', 'knowledge/新')], ctx).kind, 'structural');
  assert.equal(classifyEvents([ev('change', '.wiki/wiki.json')], ctx).kind, 'reopen');
  assert.equal(classifyEvents([ev('change', 'knowledge/A.md'), ev('change', '.wiki/wiki.json')], ctx).kind, 'reopen', '重开压过一切');
  assert.equal(classifyEvents([ev('change', 'knowledge/A.md'), ev('addDir', 'x')], ctx).kind, 'structural', 'structural 压过 patch');
  assert.equal(classifyEvents([{ evt: 'change', path: path.join(TOOLS, 'wiki-x.md') }], ctx).tools, true, 'tools 目录与 patch 并存');
  assert.equal(classifyEvents([{ evt: 'change', path: path.join(TOOLS, 'wiki-x.md') }], ctx).kind, 'none');
});

test('净零与改名：同窗建了又删跳过；改名是 unlink+add 两条', () => {
  const p = classifyEvents([ev('add', 'knowledge/A.md'), ev('unlink', 'knowledge/A.md')], ctx);
  assert.equal(p.kind, 'none', '建了又删，净零');
  const p2 = classifyEvents([ev('add', 'knowledge/A.md'), ev('change', 'knowledge/A.md'), ev('unlink', 'knowledge/A.md')], ctx);
  assert.deepEqual(p2.docOps, [{ op: 'unlink', rel: 'knowledge/A.md' }], '中途还改过 → 按删处理');
  const rn = classifyEvents([ev('unlink', 'knowledge/B.md'), ev('add', 'knowledge/乙二.md')], ctx);
  assert.deepEqual(rn.docOps, [{ op: 'unlink', rel: 'knowledge/B.md' }, { op: 'create', rel: 'knowledge/乙二.md' }]);
});

test('区外 md（如根目录散文件、raw/project 围栏内）不进 docOps；乱路径落 structural', () => {
  assert.deepEqual(classifyEvents([ev('change', '散.md')], ctx).docOps, []);
  assert.equal(classifyEvents([ev('change', '散.md')], ctx).kind, 'none', '监听面上本不该有，真有了也不炸');
  assert.equal(classifyEvents([{ evt: 'change', path: '/别的目录/x' }], ctx).kind, 'structural', '认不出的绝对路径兜底');
});
