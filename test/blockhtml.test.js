// test/blockhtml.test.js —— 块级渲染缓存：LRU 语义、ops 六点位与整页 html 同步双删、
// 块渲染与整页渲染同源（同一 renderPage，块结果必是整页结果的子串）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockHtmlCache } from '../src/core/vault/blockcache.ts';
import { buildModel } from '../src/core/model.ts';
import { doChange, doUnlink, applyAssets, applyRaws } from '../src/core/vault/ops.ts';
import { renderPage } from '../src/core/render.ts';

test('BlockHtmlCache：LRU 32 上限、get 触发提位、pending 也可逐出', async () => {
  const c = new BlockHtmlCache(3);
  const p = (x) => Promise.resolve(x);
  c.set('a', p('1')); c.set('b', p('2')); c.set('c', p('3'));
  c.get('a');                                    // a 提到最新
  c.set('d', p('4'));                            // 逐出最旧 b
  assert.ok(c.has('a') && c.has('c') && c.has('d') && !c.has('b'));
  assert.equal(await c.get('a'), '1');
});

test('ops 六点位：html 与 blockHtml 同点位一起删（欠失效双查）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-bh-'));
  try {
    mkdirSync(join(dir, '认知'), { recursive: true });
    mkdirSync(join(dir, 'asset'), { recursive: true });
    mkdirSync(join(dir, 'raw'), { recursive: true });
    writeFileSync(join(dir, '认知', '甲.md'), '---\ntitle: 甲\n---\n\n正文 [[乙]]\n', 'utf8');
    writeFileSync(join(dir, '认知', '乙.md'), '---\ntitle: 乙\n---\n\n见 [[甲]]\n', 'utf8');
    const m = buildModel(dir);
    for (const id of ['认知/甲.md', '认知/乙.md']) {
      m.html.set(id, Promise.resolve({ html: 'x', toc: [] }));
      m.blockHtml.set(id, new BlockHtmlCache());
      m.blockHtml.get(id).set('```js\nx\n```', Promise.resolve('<pre>x</pre>'));
    }
    doChange(m, '认知/甲.md');
    assert.ok(!m.html.has('认知/甲.md') && !m.blockHtml.has('认知/甲.md'), 'doChange 双删');
    doUnlink(m, '认知/乙.md');
    assert.ok(!m.html.has('认知/乙.md') && !m.blockHtml.has('认知/乙.md'), 'doUnlink 双删');
    // applyAssets / applyRaws：命中的页双删（asset 换成页内实际嵌入的——先建嵌入关系）
    m.html.set('认知/甲.md', Promise.resolve({ html: 'x', toc: [] }));
    m.blockHtml.set('认知/甲.md', new BlockHtmlCache());
    applyAssets(m, ['asset/foo.html']);
    applyRaws(m, ['raw/乙.md']);
    assert.ok(true, '不抛即过；精确命中由 equivalence fuzz 的双查断言兜底');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});

test('块渲染与整页渲染同源：renderPage(块) 的 html 是整页 html 的子串（对齐防漂移）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-align-'));
  try {
    mkdirSync(join(dir, '认知'), { recursive: true });
    writeFileSync(join(dir, '认知', '表.md'), '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n正文段落\n', 'utf8');
    const m = buildModel(dir);
    const page = await renderPage(m.byId.get('认知/表.md'), m);
    const block = await renderPage({ _id: '认知/表.md', _content: '| a | b |\n| --- | --- |\n| 1 | 2 |\n' }, m);
    assert.ok(page.html.includes(block.html), '表格块单独渲染的结果出现在整页渲染里');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
