import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as wg from '../src/core/vault/graph.ts';
import { linksWithLines, refinalize } from '../src/core/vault/graph.ts';
import { sample, doc } from './fixture.js';

const g = wg.buildGraphFrom(sample());
const node = (p) => g.nodeOf.get(p);
const names = (n) => n.items.map((c) => c.name);

test('根层顺序由 areas 决定，不看字母序', () => {
  assert.deepEqual(names(g.root), ['thought', 'anatomy', 'knowledge', 'work']);
});

test('有导览专节时按专节的点名序，没点名的按 created 殿后', () => {
  assert.deepEqual(names(node('knowledge/ML/ML.md')), ['A', 'B', 'C', 'D']);
});

test('全站导览序是先序遍历：先文件夹的 index，再逐个子节点', () => {
  const ids = g.order.map((d) => d._id);
  assert.deepEqual(ids.slice(0, 9), [
    'thought/thought.md',
    'anatomy/anatomy.md',
    'knowledge/knowledge.md',
    'knowledge/ML/ML.md',
    'knowledge/ML/A.md',
    'knowledge/ML/B.md',
    'knowledge/ML/C/C.md',
    'knowledge/ML/D.md',
    'knowledge/X/X.md',
  ]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, sample().posts.length);
});

test('prevNext 沿全站导览序取邻居，首尾为 null', () => {
  const a = g.order.find((d) => d._id === 'knowledge/ML/A.md');
  const { prev, next } = wg.prevNext(g, a);
  assert.equal(prev._id, 'knowledge/ML/ML.md');
  assert.equal(next._id, 'knowledge/ML/B.md');
  assert.equal(wg.prevNext(g, g.order[0]).prev, null);
  assert.equal(wg.prevNext(g, g.order[g.order.length - 1]).next, null);
});

test('posOf 给层内序号、层内总数与父层显示名；区 index 的父层是首页', () => {
  const b = g.order.find((d) => d._id === 'knowledge/ML/B.md');
  assert.deepEqual(wg.posOf(g, b), { i: 2, n: 4, parentName: 'ML' });
  const k = g.order.find((d) => d._id === 'knowledge/knowledge.md');
  assert.deepEqual(wg.posOf(g, k), { i: 3, n: 4, parentName: '首页' });
});

test('displayName：区节点取 index 的 title，其余取目录名或文件名', () => {
  assert.equal(wg.displayName(g.root), '首页');
  assert.equal(wg.displayName(node('knowledge/knowledge.md')), '所知');
  assert.equal(wg.displayName(node('knowledge/ML/ML.md')), 'ML');
  assert.equal(wg.crumbOf(node('knowledge/ML/B.md')), '所知 › ML');
});

test('反链不列父层 index，围栏与行内代码里的双链不算', () => {
  const froms = (id) => (g.backlinks.get(id) || []).map((b) => b.doc._id).sort();
  assert.deepEqual(froms('knowledge/ML/A.md'), ['knowledge/ML/B.md', 'knowledge/X/Acme 客服系统.md']);
  assert.deepEqual(froms('knowledge/ML/B.md'), ['knowledge/ML/A.md']);
});

test('areaOf 与 vaultPathOf', () => {
  const b = g.order.find((d) => d._id === 'knowledge/ML/B.md');
  assert.equal(wg.areaOf(b), 'knowledge');
  assert.equal(wg.vaultPathOf(b), 'knowledge/ML/B.md');
});

test('rewriteWikilinks 不碰围栏与行内代码', () => {
  const md = '见 [[A|甲]]。\n```\n[[B]]\n```\n`[[C]]` 与 [[D#x]]';
  assert.equal(wg.rewriteWikilinks(md), '见 [甲](wikilink:A)。\n```\n[[B]]\n```\n`[[C]]` 与 [D](wikilink:D#x)');
});

test('子树页数：叶子计 1，子文件夹计自身 index 加其子树，不含自己', () => {
  assert.equal(node('knowledge/ML/ML.md').count, 4);
  assert.equal(node('knowledge/ML/C/C.md').count, 0);
  const knowledgePosts = sample().posts.filter((d) => d._id.startsWith('knowledge/'));
  const expectedCount = knowledgePosts.length - 1;
  assert.equal(node('knowledge/knowledge.md').count, expectedCount);
});

test('死链：同名歧义给出全部候选，库外目标记 missing，处数逐次累计', () => {
  const byT = new Map(g.dead.map((e) => [e.target, e]));
  const amb = byT.get('项目');
  assert.equal(amb.reason, 'ambiguous');
  assert.deepEqual(amb.candidates.map((d) => d._id).sort(), ['work/p1/项目/项目.md', 'work/p2/项目/项目.md']);
  const book = byT.get('书');
  assert.equal(book.reason, 'missing');
  assert.equal(book.count, 2);
  assert.deepEqual(book.from.map((f) => [f.doc._id, f.count]), [['knowledge/X/X.md', 2]]);
  assert.equal(byT.has('围栏里不算'), false);
  assert.equal(byT.has('也不算'), false);
  assert.equal(g.dead[0].target, '书');
});

// 同名不再按位置猜：裸名重名即歧义（不论从哪页看）；路径形式按树精确命中，展示只取最后一段
test('重名裸名一律歧义；路径形式精确命中；展示取最后一段', () => {
  const s = sample();
  s.posts.push(doc('work/p1/需求.md', '见 [[项目]] 与 [[work/p1/项目|计划]] 与 [[work/p2/项目]]。'));
  const g2 = wg.buildGraphFrom(s);
  const byT = new Map(g2.dead.map((e) => [e.target, e]));
  assert.equal(byT.get('项目').reason, 'ambiguous', '同目录下也不就近');
  assert.equal(wg.resolveName(g2, '项目'), null);
  assert.equal(wg.resolveName(g2, 'work/p1/项目')?._id, 'work/p1/项目/项目.md');
  assert.equal(wg.resolveName(g2, 'work/p2/项目')?._id, 'work/p2/项目/项目.md');
  assert.equal(wg.resolveName(g2, 'work/p3/项目'), null);
  assert.ok(g2.backlinks.get('work/p1/项目/项目.md')?.some((b) => b.doc._id === 'work/p1/需求.md'), '路径链进反链');
  assert.ok(g2.backlinks.get('work/p2/项目/项目.md')?.some((b) => b.doc._id === 'work/p1/需求.md'));
  const snip = g2.backlinks.get('work/p2/项目/项目.md').find((b) => b.doc._id === 'work/p1/需求.md').snippet;
  assert.match(snip, /<mark>项目<\/mark>/, '反链上下文句里路径链只显最后一段');
  assert.equal(wg.lastSeg('work/p2/项目'), '项目');
  assert.match(wg.rewriteWikilinks('[[work/p2/项目]] [[work/p1/项目|计划]]'), /^\[项目\]\(wikilink:.*\) \[计划\]\(wikilink:/);
});

test('顺序兜底：有专节时专节没点名的算，没专节时正文没点名的算，根层不记', () => {
  const byNode = new Map(g.fallback.map((f) => [f.node.doc && f.node.doc._id, f.children.map((c) => c.name)]));
  assert.deepEqual(byNode.get('knowledge/ML/ML.md'), ['D']);
  assert.deepEqual(byNode.get('knowledge/knowledge.md'), ['ML', 'X']);
  assert.deepEqual(byNode.get('knowledge/X/X.md'), ['Acme 客服系统']);
  assert.equal(g.fallback.some((f) => f.node === g.root), false);
});

test('.folder.json 的 order 最先：列出的按列表序，没列的照导览文殿后；全部有着落时不算兜底', () => {
  const g2 = wg.buildGraphFrom({ ...sample(), folders: new Map([['knowledge/ML', { index: null, order: ['D', 'C', '不存在'] }]]) });
  const ml = g2.nodeOf.get('knowledge/ML/ML.md');
  assert.deepEqual(ml.items.map((c) => c.name), ['D', 'C', 'A', 'B']);
  assert.equal(g2.fallback.some((f) => f.node === ml), false);
  const ids = g2.order.map((d) => d._id);
  assert.equal(ids[ids.indexOf('knowledge/ML/ML.md') + 1], 'knowledge/ML/D.md');
  // 没有配置的层不受影响
  assert.deepEqual(g2.nodeOf.get('knowledge/knowledge.md').items.map((c) => c.name), ['ML', 'X']);
});

test('.folder.json 的 index 改指文件夹页：[[文件夹名]] 解析到它，它不算子节点', () => {
  const s = sample();
  s.posts.push(doc('knowledge/K/概览.md', '见 [[A]]'), doc('knowledge/K/子.md', ''));
  const g3 = wg.buildGraphFrom({ ...s, folders: new Map([['knowledge/K', { index: '概览', order: [] }]]) });
  const k = g3.nodeOf.get('knowledge/K/概览.md');
  assert.equal(k.dir, true);
  assert.equal(k.name, 'K');
  assert.deepEqual(k.items.map((c) => c.name), ['子']);
  assert.equal(wg.resolveName(g3, 'K')._id, 'knowledge/K/概览.md');
  assert.equal(wg.resolveName(g3, 'knowledge/K')._id, 'knowledge/K/概览.md');
});

test('linksWithLines：行文本与行号齐全，围栏/行内代码不算', () => {
  const md = '先 [[A]]。\n```\n[[围栏]]\n```\n行内 `[[也不算]]` 后 [[B#锚|标签]]。';
  const ls = linksWithLines(md);
  assert.deepEqual(ls.map((l) => l.target), ['A', 'B']);
  assert.equal(ls[0].lineNo, 0); assert.equal(ls[0].line, '先 [[A]]。');
  assert.equal(ls[1].label, '标签'); assert.equal(ls[1].anchor, '#锚');
});

test('refinalize：对已建好的图重跑，order/fallback/目录 count 逐字段不变', () => {
  const g = wg.buildGraphFrom(sample());
  const collect = (root) => {
    const counts = [];
    (function walk(n) { if (n.dir) counts.push([n.rel, n.count]); (n.items ?? []).forEach(walk) })(root);
    return counts;
  };
  const before = JSON.stringify({ order: g.order.map((d) => d._id), fallback: g.fallback.map((f) => f.node.name), counts: collect(g.root) });
  refinalize(g);
  const after = JSON.stringify({ order: g.order.map((d) => d._id), fallback: g.fallback.map((f) => f.node.name), counts: collect(g.root) });
  assert.equal(after, before, '公共收尾对成品图是恒等变换');
});

test('dead 的 from 与 candidates 按导览序（indexOf）排，不再按扫描序', () => {
  const g = wg.buildGraphFrom(sample());
  for (const e of g.dead) {
    const idx = g.indexOf;
    for (let i = 1; i < e.from.length; i++) assert.ok(idx.get(e.from[i - 1].doc._id) <= idx.get(e.from[i].doc._id));
    for (let i = 1; i < e.candidates.length; i++) assert.ok(idx.get(e.candidates[i - 1]._id) <= idx.get(e.candidates[i]._id));
  }
});
