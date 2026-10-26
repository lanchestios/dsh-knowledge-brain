// test/editor-excalidraw.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parser, GFM } from '@lezer/markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { blocksOf } from '../src/editor/kernel/blocks.ts';
import { registerExcalidraw, setExcalidrawRenderer, bumpAssetVersion } from '../src/editor/blocks/excalidraw.ts';
import { blockWidget } from '../src/editor/blocks/registry.ts';

const dom = new JSDOM('<div id=host></div>');
dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.document = dom.window.document;

const p = () => parser.configure([GFM, mathExt, wikilinkExt]);
const kinds = (doc) => blocksOf(doc, p().parse(doc)).map((b) => b.kind);

const REF = '![](asset/diagrams/2026-10-19/架构图.excalidraw)';

test('分类：顶层 excalidraw 引用成块，列表/非 asset 路径不认', () => {
  assert.deepEqual(kinds(REF), ['excalidraw']);
  assert.deepEqual(kinds('- ' + REF), []);          // 列表内的引用不识别（块管线只认顶层段落）
  assert.deepEqual(kinds('![](asset/x/y.excalidraw?w=99)'), []);   // 只认 ?h= 参数
});

// —— 块渲染行为：renderer 注入假货，fetch 打桩 ——
const mkIo = (url) => ({ resolveAsset: (href) => (url === null ? null : { url, title: href }) });
const build = (io, src = REF) => {
  registerExcalidraw();
  const w = blockWidget('excalidraw', src, '', { dark: false, mode: 'read', batch: null, io });
  assert.ok(w, 'excalidraw 块已注册');
  const el = w.toDOM();
  return { w, el };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test('渲染成功：svg 嵌入、开灯箱、挂 rel 与版本', async () => {
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) });
  const { el } = build(mkIo('mock://a.excalidraw'));
  await flush();
  assert.ok(el.querySelector('svg'), 'svg 嵌入块');
  assert.equal(el.dataset.lightbox, '', '成功渲染开放灯箱');
  assert.equal(el.dataset.excalidraw, 'asset/diagrams/2026-10-19/架构图.excalidraw');
  assert.equal(el.dataset.v, '0');
});

test('空场景：未画占位、不开灯箱', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [] }) });
  const { el } = build(mkIo('mock://a.excalidraw'));
  await flush();
  assert.ok(el.textContent.includes('未画'), '未画占位');
  assert.notEqual(el.dataset.lightbox, '');
});

test('场景 JSON 损坏：占位报错不炸', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const { el } = build(mkIo('mock://a.excalidraw'));
  await flush();
  assert.ok(el.textContent.includes('场景文件损坏'), '损坏占位');
  assert.notEqual(el.dataset.lightbox, '');
});

test('elements 非数组也判损坏', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: 'x' }) });
  const { el } = build(mkIo('mock://a.excalidraw'));
  await flush();
  assert.ok(el.textContent.includes('场景文件损坏'));
});

test('图文件不存在（404）：占位提示', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const { el } = build(mkIo('mock://a.excalidraw'));
  await flush();
  assert.ok(el.textContent.includes('图文件不存在'), '404 占位');
});

test('resolveAsset 拿不到 url：占位提示', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => { throw new Error('不该 fetch'); };
  const { el } = build(mkIo(null));
  await flush();
  assert.ok(el.textContent.includes('不在 asset/'), '非 asset 引用占位');
});

test('版本 bump 后同 src 块判陈旧（重建），未 bump 时保 DOM', async () => {
  setExcalidrawRenderer(async () => '<svg/>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) });
  const io = mkIo('mock://a.excalidraw');
  const a = blockWidget('excalidraw', REF, '', { dark: false, mode: 'read', batch: null, io });
  const el = a.toDOM();
  a.dom = el;
  await flush();
  const b = blockWidget('excalidraw', REF, '', { dark: false, mode: 'read', batch: null, io });
  b.dom = el;
  assert.equal(b.eq(a), true, '未 bump：同 src 保 DOM');
  bumpAssetVersion('asset/diagrams/2026-10-19/架构图.excalidraw');
  const c = blockWidget('excalidraw', REF, '', { dark: false, mode: 'read', batch: null, io });
  c.dom = el;
  assert.equal(c.eq(a), false, 'bump 后：判陈旧重建');
});

// —— surface 点击路由：编辑态开画布回调、阅读态灯箱 ——
import { createSurface } from '../src/editor/kernel/surface.ts';

const stubScene = async () => {
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) });
};

test('编辑态点 excalidraw 图：调 io.editExcalidraw(rel)、不进换源码分支、不开灯箱', async () => {
  await stubScene();
  const calls = [];
  const host = document.createElement('div');
  document.body.append(host);
  const io = {
    load: async () => ({ text: '', hash: 'h0' }),
    save: async () => ({ ok: true, hash: 'h1' }),
    renderBlocks: async (srcs) => srcs.map(() => ''),
    resolveAsset: (href) => ({ url: 'mock://' + href, title: href }),
    editExcalidraw: (rel) => calls.push(rel),
  };
  const sf = createSurface(host, { io, mode: 'edit', dark: false });
  sf.setText('\n' + REF + '\n');
  await flush();
  const block = host.querySelector('[data-excalidraw]');
  assert.ok(block, 'excalidraw 块已渲染');
  block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  block.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [], '单击只选中整块、不开画布');
  const text = '\n' + REF + '\n';
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, text.indexOf(REF), '选区起点 = 引用行行首');
  assert.equal(sel.to, text.indexOf(REF) + REF.length, '选区不含尾换行（含了会点亮块后空行）');
  block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
  assert.deepEqual(calls, ['asset/diagrams/2026-10-19/架构图.excalidraw'], '双击进编辑入口且只回调一次带 rel');
  assert.ok(!document.querySelector('.lightbox'), '编辑态不开灯箱');
  sf.destroy(); host.remove();
});

test('阅读态点 excalidraw 图：进灯箱', async () => {
  await stubScene();
  const host = document.createElement('div');
  document.body.append(host);
  const io = {
    load: async () => ({ text: '', hash: 'h0' }),
    save: async () => ({ ok: true, hash: 'h1' }),
    renderBlocks: async (srcs) => srcs.map(() => ''),
    resolveAsset: (href) => ({ url: 'mock://' + href, title: href }),
  };
  const sf = createSurface(host, { io, mode: 'read', dark: false });
  sf.setText('\n' + REF + '\n');
  await flush();
  const block = host.querySelector('[data-lightbox]');
  assert.ok(block, '渲染成功带灯箱标记');
  block.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(document.querySelector('.lightbox'), '阅读态打开灯箱');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  sf.destroy(); host.remove();
});

// —— refreshBlocks：资产重写后强制装饰重建（src 没变也换新图） ——
import { refreshBlocksEffect } from '../src/editor/kernel/deco.ts';

test('refreshBlocks 效果：dispatch 后 excalidraw 块重建重取场景', async () => {
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) } };
  bumpAssetVersion('asset/diagrams/2026-10-19/架构图.excalidraw');
  const host = document.createElement('div');
  document.body.append(host);
  const io = {
    load: async () => ({ text: '', hash: 'h0' }),
    save: async () => ({ ok: true, hash: 'h1' }),
    renderBlocks: async (srcs) => srcs.map(() => ''),
    resolveAsset: (href) => ({ url: 'mock://' + href, title: href }),
  };
  const sf = createSurface(host, { io, mode: 'read', dark: false });
  sf.setText('\n' + REF + '\n');
  await flush();
  const n = fetched;
  assert.ok(n >= 1, '初次取件');
  bumpAssetVersion('asset/diagrams/2026-10-19/架构图.excalidraw');
  sf.view.dispatch({ effects: refreshBlocksEffect.of(null) });
  await flush();
  assert.ok(fetched > n, 'dispatch 后重建重取');
  sf.destroy(); host.remove();
});

// —— 评审 M5：同页多张图、只 bump 其中一张 → 只有那张判陈旧重建（Review Focus 钉测） ——
test('选区碰过块后保存刷新仍重建（桌面「保存不刷新」回归钉：选区 dispatch 产出中间 widget 实例，eq 相等时不转移 dom 会让 stale 链断掉）', async () => {
  const fetches = [];
  globalThis.fetch = async (u) => { fetches.push(String(u)); return { ok: true, json: async () => ({ type: 'excalidraw', version: 2, elements: [{ id: 'a' }] }) } };
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const { createSurface } = await import('../src/editor/kernel/surface.ts');
  const { refreshBlocksEffect } = await import('../src/editor/kernel/deco.ts');
  const { EditorSelection } = await import('@codemirror/state');
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: { load: async () => ({ text: '', hash: 'h0' }), save: async () => ({ ok: true, hash: 'h1' }), renderBlocks: async (x) => x.map(() => ''), resolveAsset: (h) => ({ url: '/a?path=' + encodeURIComponent(h), title: h }) }, mode: 'edit', dark: false });
  const REF2 = '![](asset/diagrams/r.excalidraw)';
  const doc = `前文\n\n${REF2}\n\n后文`;
  sf.setText(doc);
  await flush(); await flush();
  const f = doc.indexOf(REF2);
  // 用户序列：单击选中（覆盖）→ 双击开画布（收起到行首）→ 保存 bump → refreshBlocks
  sf.view.dispatch({ selection: EditorSelection.range(f, f + REF2.length) });
  sf.view.dispatch({ selection: { anchor: f } });
  bumpAssetVersion('asset/diagrams/r.excalidraw');
  sf.view.dispatch({ effects: refreshBlocksEffect.of(null) });
  await flush(); await flush();
  const block = host.querySelector('[data-excalidraw]');
  assert.equal(block?.dataset.v, '1', '版本上屏');
  assert.equal(fetches.length, 2, '重建后重新取件');
  sf.destroy(); host.remove();
});

test('同页两张图：bump 一张只重建那张', async () => {
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 10 10"/>');
  const mk = (rel) => '![](' + rel + ')';
  const A = 'asset/diagrams/2026-10-19/a.excalidraw';
  const B = 'asset/diagrams/2026-10-19/b.excalidraw';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) });
  registerExcalidraw();
  const io = { resolveAsset: (href) => ({ url: 'mock://' + href, title: href }) };
  const mkWidget = (rel) => { const w = blockWidget('excalidraw', mk(rel), '', { dark: false, mode: 'read', batch: null, io }); const el = w.toDOM(); w.dom = el; return w };
  const wa = mkWidget(A), wb = mkWidget(B);
  await flush();
  bumpAssetVersion(A);
  const wa2 = blockWidget('excalidraw', mk(A), '', { dark: false, mode: 'read', batch: null, io });
  wa2.dom = wa.dom;
  const wb2 = blockWidget('excalidraw', mk(B), '', { dark: false, mode: 'read', batch: null, io });
  wb2.dom = wb.dom;
  assert.equal(wa2.eq(wa), false, 'bump 的那张判陈旧');
  assert.equal(wb2.eq(wb), true, '没 bump 的那张保 DOM');
});

// —— ?h= 可配高度（同 html 嵌入件纪律）：默认等比压栏宽，带 h 定高 contain ——
test('分类：?h=560 认，别的参数不认', () => {
  assert.deepEqual(kinds('![](asset/diagrams/2026-10-19/架构图.excalidraw?h=560)'), ['excalidraw']);
  assert.deepEqual(kinds('![](asset/diagrams/2026-10-19/架构图.excalidraw?w=99)'), []);
});

const stubSvg = async () => {
  setExcalidrawRenderer(async () => '<svg viewBox="0 0 1706 1114" width="1766" height="1174"><rect width="10" height="10"/></svg>');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'excalidraw', elements: [{ id: 'a' }] }) });
};

test('默认：svg 压栏宽等比（width 100%、height auto），不再按固有尺寸撑破正文', async () => {
  await stubSvg();
  const { el } = build(mkIo('mock://a.excalidraw'), '![](asset/diagrams/2026-10-19/架构图.excalidraw)');
  await flush();
  const svg = el.querySelector('svg');
  assert.ok(svg, 'svg 在');
  assert.equal(svg.style.width, '100%', '宽度压满栏');
  assert.equal(svg.style.height, 'auto', '高度等比');
  assert.equal(svg.style.maxHeight, '75vh', '超高自动封顶（75vh）');
  assert.equal(svg.style.objectFit, 'contain', '封顶后内容等比居中不压扁');
  assert.equal(el.style.height, '', '默认不定块高');
});

test('?h=560：块定高 560，svg contain（max 100% 居中）', async () => {
  await stubSvg();
  const { el } = build(mkIo('mock://a.excalidraw'), '![](asset/diagrams/2026-10-19/架构图.excalidraw?h=560)');
  await flush();
  const svg = el.querySelector('svg');
  assert.equal(el.style.height, '560px', '块定高');
  assert.equal(svg.style.maxWidth, '100%', 'contain 宽');
  assert.equal(svg.style.maxHeight, '100%', 'contain 高');
});
