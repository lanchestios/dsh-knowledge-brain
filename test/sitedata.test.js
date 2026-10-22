import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as wg from '../src/core/vault/graph.ts';
import * as sd from '../src/core/vault/sitedata.ts';
import { sample } from './fixture.js';

const g = wg.buildGraphFrom(sample());
const href = (d) => d._id;

test('treeJson：根下是四个区（显示名），每个文档恰好一个带 path 的节点', () => {
  const t = sd.treeJson(g, href);
  assert.deepEqual(t.children.map((n) => n.name), ['认知', '学习', '所知', '所为']);
  const withPath = [];
  (function walk(ns) { ns.forEach((n) => { if (n.path) withPath.push(n.path); walk(n.children); }); })(t.children);
  assert.equal(withPath.length, g.order.length);
  assert.ok(withPath.includes('knowledge/X/Acme 客服系统.md'));
  const ml = t.children[2].children.find((n) => n.name === 'ML');
  assert.equal(ml.dir, true);
  assert.equal(ml.count, 4);
  assert.deepEqual(ml.children.map((n) => n.name), ['A', 'B', 'C', 'D']);
  const files = []
  ;(function walk(ns) { ns.forEach((n) => { if (!n.dir) files.push(n); walk(n.children) }) })(t.children)
  assert.ok(files.length && files.every((n) => n.rel === n.path), '文件节点 rel = 库内路径（= 页 id）')
  assert.equal(ml.rel, 'knowledge/ML')
});

test('graphJson：引用边与反链一一对应，层级边从父层 index 指向子页，节点按导览序', () => {
  const j = sd.graphJson(g, href);
  assert.deepEqual(j.nodes.map((n) => n.id), g.order.map(href));
  const refs = j.edges.filter((e) => e.type === 'ref');
  const blCount = [...g.backlinks.values()].reduce((n, l) => n + l.length, 0);
  assert.equal(refs.length, blCount);
  const a = j.nodes.find((n) => n.id === 'knowledge/ML/A.md');
  assert.equal(a.indeg, 2);
  assert.equal(a.crumb, '所知 › ML');
  assert.equal(a.area, 'knowledge');
  assert.ok(j.edges.some((e) => e.type === 'tree' && e.s === 'knowledge/ML/ML.md' && e.t === 'knowledge/ML/A.md'));
  assert.equal(j.edges.some((e) => e.type === 'tree' && e.t === 'knowledge/knowledge.md'), false);
});
