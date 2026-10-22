import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as pm from '../src/core/vault/pagemeta.ts';
import * as wg from '../src/core/vault/graph.ts';
import { sample } from './fixture.js';

const fm = (body) => '---\n' + body + '\n---\n正文';

test('sourceCount：行内列表、块列表、单值、空', () => {
  assert.equal(pm.sourceCount(fm('title: a\nsource: []\nstatus: stable')), 0);
  assert.equal(pm.sourceCount(fm('source: [raw/a.pdf, raw/b.pdf]')), 2);
  assert.equal(pm.sourceCount(fm('source:\n  - raw/a.pdf\n  - raw/b.pdf\nstatus: stable')), 2);
  assert.equal(pm.sourceCount(fm('source: raw/a.pdf')), 1);
  assert.equal(pm.sourceCount(fm('title: a')), 0);
  assert.equal(pm.sourceCount('没有 frontmatter'), 0);
});

test('isHumanVerified：verified 里有一条 by 以 human: 开头', () => {
  assert.equal(pm.isHumanVerified(fm('verified:\n  - {by: human:lanchestios, at: 2026-09-06T17:40:00Z}')), true);
  assert.equal(pm.isHumanVerified(fm('verified:\n  - {by: claude, at: 2026-09-06T17:40:00Z}\ncreated: 2026-09-06')), false);
  assert.equal(pm.isHumanVerified(fm('verified: []')), false);
  assert.equal(pm.isHumanVerified(fm('generated: {by: human:x, at: 1}')), false);
});

test('bodyChars 去掉围栏代码与空白', () => {
  assert.equal(pm.bodyChars('一二三\n\n```js\nconst x = 1;\n```\n四 五'), 5);
  assert.equal(pm.bodyChars('~~~\n代码\n~~~'), 0);
});

const CONF = [
  '# 注释',
  '[work/报表平台]',
  'qyxn-oceanus  ~/x/qyxn-oceanus  ff7f1c66',
  '',
  '[anatomy/Pi]',
  'pi  ~/.oceanus-wiki/raw/projects/pi  71dca871bc80b6bc97be37f0ca3189399d651fff',
].join('\n');

test('parseAnchors 与 baselinesFor：只看 anatomy 段，按路径边界匹配', () => {
  const a = pm.parseAnchors(CONF);
  assert.deepEqual(a.map((s) => s.prefix), ['work/报表平台', 'anatomy/Pi']);
  assert.deepEqual(pm.baselinesFor(a, 'anatomy/Pi/pi-ai.md'), [{ name: 'pi', sha: '71dca87' }]);
  assert.deepEqual(pm.baselinesFor(a, 'anatomy/Pix/x.md'), []);
  assert.deepEqual(pm.baselinesFor(a, 'work/报表平台/x.md'), []);
});

test('statusOf 汇总状态行字段', () => {
  const s = sample();
  const b = s.posts.find((d) => d._id === 'knowledge/ML/B.md');
  b.raw = fm('source:\n  - raw/a.pdf\n  - raw/b.pdf\nverified: []');
  b.updated = '2026-09-14';
  b.status = 'draft';
  const g = wg.buildGraphFrom(s);
  assert.deepEqual(pm.statusOf(g, b, []), {
    human: false,
    draft: true,
    updated: '2026-09-14',
    sources: 2,
    pos: { i: 2, n: 4, parentName: 'ML' },
    baselines: [],
  });
});
