// test/editor-atomic.test.js
// 原子块选中：near 分叉（选区边界在块内才露源码、跨过保持渲染件）+ 原子区间收集。
// Task 1 只测 buildDeco 层（直接调 buildDeco + atomic 出参）；Task 2-4 的 surface 行为测试追加在后。
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco } from '../src/editor/kernel/deco.ts';
import { registerServerKinds } from '../src/editor/blocks/server.ts';
import { registerViewerKinds } from '../src/editor/blocks/mermaid.ts';
import { registerExcalidraw } from '../src/editor/blocks/excalidraw.ts';
import { registerTableKind } from '../src/editor/blocks/table.ts';

registerServerKinds();
registerViewerKinds();
registerExcalidraw();
registerTableKind();

const st = (doc, sel = 0) => EditorState.create({
  doc,
  selection: typeof sel === 'number' ? { anchor: sel } : sel,
  extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] })],
});
const ctx = { mode: 'edit', dark: false, batch: { get: async () => '<p>x</p>' }, io: {}, degrade: false };
const widgetsAt = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.widget && v.spec.widget.constructor.name === 'BlockWidget') out.push([i.from, i.to]); } return out; };
const codeLinesAt = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { if (i.value.spec.class?.includes('codeLine')) out.push([i.from, i.to]); } return out; };

// 语料：mermaid 围栏 + excalidraw 引用 + 行内图片，位置动态求
const MERMAID = '```mermaid\nflowchart LR\nA-->B\n```';
const EXD = '![](asset/diagrams/a.excalidraw)';
const IMG = '![](asset/pic.png)';
const DOC = `前文一段\n\n${MERMAID}\n\n${EXD}\n\n看图 ${IMG} 之后\n\n后文`;
const mFrom = DOC.indexOf(MERMAID), mTo = mFrom + MERMAID.length;
const eFrom = DOC.indexOf(EXD), eTo = eFrom + EXD.length;
const iFrom = DOC.indexOf(IMG), iTo = iFrom + IMG.length;

test('拖选跨过 mermaid 不闪源码（选区边界都在块外 → 渲染件保留）', () => {
  const d = buildDeco(st(DOC, EditorSelection.range(0, DOC.length)), ctx);
  assert.ok(widgetsAt(d).some(([f, t]) => f === mFrom && t === mTo), '跨选时 mermaid 仍是渲染件');
  assert.ok(!codeLinesAt(d).some(([f]) => f >= mFrom && f <= mTo), '不再闪出 codeLine 源码行');
});

test('选区边界在块内露源码（围栏内空选区 → codeLine）', () => {
  const d = buildDeco(st(DOC, mFrom + 20), ctx);   // 围栏第二行内
  assert.ok(!widgetsAt(d).some(([f]) => f === mFrom), '光标在围栏内不替换');
  assert.ok(codeLinesAt(d).length > 0, '围栏露源码逐行');
});

test('源码态块不进原子集、渲染态进（含尾换行）', () => {
  const inArr = [];
  buildDeco(st(DOC, mFrom + 20), ctx, inArr);   // 光标在围栏内 = 源码态
  assert.ok(!inArr.some(([f]) => f === mFrom), '源码态的 mermaid 不进原子集（否则编辑时被弹飞）');
  const outArr = [];
  buildDeco(st(DOC, 0), ctx, outArr);
  assert.ok(outArr.some(([f, t]) => f === mFrom && t === Math.min(mTo + 1, DOC.length)), '渲染态 mermaid 进原子集、区间含尾换行');
});

test('表格不进原子集、excalidraw 引用进', () => {
  const TBL = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
  const doc2 = `${TBL}\n${EXD}\n`;
  const tf = doc2.indexOf(TBL), ef = doc2.indexOf(EXD);
  const arr = [];
  const d = buildDeco(st(doc2), ctx, arr);
  assert.ok(widgetsAt(d).some(([f]) => f === tf), '表格正常渲染（语料成立的前提）');
  assert.ok(!arr.some(([f]) => f === tf), '表格不进原子集');
  assert.ok(arr.some(([f, t]) => f === ef && t === Math.min(ef + EXD.length + 1, doc2.length)), 'excalidraw 引用进原子集');
});

test('near 块尾放宽取消：光标贴在块尾后一格仍见渲染件', () => {
  const d = buildDeco(st(DOC, mTo + 1), ctx);   // 旧规则 head <= to+1 会露源码
  assert.ok(widgetsAt(d).some(([f, t]) => f === mFrom && t === mTo), '贴块尾光标不再把块闪成源码');
});

test('行内图片进原子集（span 区间）、degrade 跳过', () => {
  const arr = [];
  buildDeco(st(DOC, 0), ctx, arr);
  assert.ok(arr.some(([f, t]) => f === iFrom && t === iTo), '图片 span 进原子集');
  const arr2 = [];
  buildDeco(st(DOC, 0), { ...ctx, degrade: true }, arr2);
  assert.ok(!arr2.some(([f]) => f === iFrom), 'degrade 下图片不进原子集（inlineDeco 整体让路的同口径）');
});

// ---- Task 2：surface 点击路由（单击选中 / 双击·Enter 编辑入口 / data-atomic 标记）----
import { vi } from 'vitest';
import { createSurface } from '../src/editor/kernel/surface.ts';

const CODE = '```js\nlet a = 1\n```';
const SDOC = `前文\n\n${MERMAID}\n\n${CODE}\n\n${EXD}\n\n${IMG}\n\n后文`;
const sM = SDOC.indexOf(MERMAID), sC = SDOC.indexOf(CODE), sE = SDOC.indexOf(EXD), sI = SDOC.indexOf(IMG);
const sIo = (calls = []) => ({
  load: async () => ({ text: '', hash: 'h0' }),
  save: async () => ({ ok: true, hash: 'h1' }),
  renderBlocks: async (srcs) => srcs.map(() => ''),
  resolveAsset: (href) => ({ url: 'mock://' + href, title: href }),
  editExcalidraw: (rel) => calls.push(rel),
});
const mount = (text, io) => { const host = document.createElement('div'); document.body.append(host); const sf = createSurface(host, { io: io ?? sIo(), mode: 'edit', dark: false }); sf.setText(text); return { sf, host } };
const down = (el, o = {}) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...o }));
const dbl = (el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));

test('单击 excalidraw 选中整块（不含尾换行）、不开画布', () => {
  const calls = [];
  const { sf, host } = mount(SDOC, sIo(calls));
  down(host.querySelector('[data-excalidraw]'));
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, sE, '选区起点 = 引用行行首');
  assert.equal(sel.to, sE + EXD.length, '选区不含尾换行（含了会把后续空行点亮成 activeLine，光标落在图下方且把内容顶下去）');
  assert.deepEqual(calls, [], '单击不再直接开画布');
  sf.destroy(); host.remove();
});

test('双击 excalidraw 开画布（io.editExcalidraw 带 rel）', () => {
  const calls = [];
  const { sf, host } = mount(SDOC, sIo(calls));
  dbl(host.querySelector('[data-excalidraw]'));
  assert.deepEqual(calls, ['asset/diagrams/a.excalidraw'], '双击进编辑入口');
  const sel = sf.view.state.selection.main;
  assert.ok(sel.empty, '开画布后选区收起——留着覆盖选区，画布没抢到焦点的瞬间打字会把图位引用行替换掉（ego 真机复现）');
  assert.equal(sel.head, sE, '收起到图位行首');
  sf.destroy(); host.remove();
});

test('单击 mermaid 选中、双击进源码（渲染件撤下）', () => {
  const { sf, host } = mount(SDOC);
  const dg = host.querySelector('[data-diagram]');
  down(dg);
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, sM);
  assert.equal(sel.to, sM + MERMAID.length, '选区不含尾换行');
  assert.ok(host.querySelector('[data-diagram]'), '选中态仍是渲染件');
  dbl(dg);
  assert.ok(!host.querySelector('[data-diagram]'), '双击撤下渲染件露源码');
  sf.destroy(); host.remove();
});

test('Enter 命令按选中块分发（excalidraw 开画布 / mermaid 进源码 / 图片与普通选区不拦）', () => {
  const calls = [];
  const { sf, host } = mount(SDOC, sIo(calls));
  sf.view.dispatch({ selection: EditorSelection.range(sE, Math.min(sE + EXD.length + 1, SDOC.length)) });
  assert.ok(sf.atomicEnter(sf.view));
  assert.deepEqual(calls, ['asset/diagrams/a.excalidraw']);
  sf.view.dispatch({ selection: EditorSelection.range(sM, sM + MERMAID.length + 1) });
  assert.ok(sf.atomicEnter(sf.view));
  assert.ok(!host.querySelector('[data-diagram]'), 'Enter 进源码');
  sf.view.dispatch({ selection: EditorSelection.range(sI, sI + IMG.length) });
  assert.equal(sf.atomicEnter(sf.view), false, '图片选中 Enter 不拦（默认替换选区）');
  sf.view.dispatch({ selection: EditorSelection.range(0, 3) });
  assert.equal(sf.atomicEnter(sf.view), false, '普通选区不拦');
  sf.destroy(); host.remove();
});

test('覆盖选区删除带走整行（引用行与行尾换行）', () => {
  const { sf, host } = mount(SDOC);
  sf.view.dispatch({ selection: EditorSelection.range(sE, sE + EXD.length + 1) });
  const s = sf.view.state.selection.main;
  sf.view.dispatch({ changes: { from: s.from, to: s.to } });
  const d = sf.view.state.doc.toString();
  assert.ok(!d.includes(EXD), '引用行删除');
  assert.ok(d.includes('后文'), '后续内容完好');
  sf.destroy(); host.remove();
});

test('文末块 clamp：最后一行无尾换行，选中不越界', () => {
  const docEnd = `前文\n\n${EXD}`;
  const e = docEnd.indexOf(EXD);
  const { sf, host } = mount(docEnd);
  down(host.querySelector('[data-excalidraw]'));
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, e);
  assert.equal(sel.to, docEnd.length, '文末 clamp 到 doc.length');
  sf.destroy(); host.remove();
});

test('删除行内图片后光标不落进后续 excalidraw 块内、块保持渲染件', () => {
  const doc2 = `前文\n\n${IMG}\n\n${EXD}`;
  const i2 = doc2.indexOf(IMG), e2 = doc2.indexOf(EXD);
  const { sf, host } = mount(doc2);
  sf.view.dispatch({ changes: { from: i2, to: i2 + IMG.length }, selection: { anchor: i2 } });
  const head = sf.view.state.selection.main.head;
  assert.ok(head <= e2, '删除后光标不在 exd 块内部');
  assert.ok(host.querySelector('[data-excalidraw]'), 'exd 块不闪源码');
  sf.destroy(); host.remove();
});

test('Shift+点图位放行：我们的分支不接管（选区不被设成块区间）', () => {
  const { sf, host } = mount(SDOC);
  sf.view.dispatch({ selection: { anchor: 0 } });
  host.querySelector('[data-excalidraw]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
  const sel = sf.view.state.selection.main;
  const eEnd = Math.min(sE + EXD.length + 1, SDOC.length);
  assert.ok(!(sel.from === sE && sel.to === eEnd), '选中分支未运行（defaultPrevented 可能来自 CM 原生 MouseSelection，不作断言）');
  sf.destroy(); host.remove();
});

test('四类原子块根都挂 data-atomic', () => {
  const { sf, host } = mount(SDOC);
  assert.equal(host.querySelector('[data-excalidraw]').dataset.atomic, 'excalidraw');
  assert.equal(host.querySelector('[data-diagram]').dataset.atomic, 'mermaid');
  assert.ok(host.querySelector('[data-atomic="code"]'), '服务端块（code）挂标记');
  assert.equal(host.querySelector('span[data-atomic="image"]')?.dataset.atomic, 'image', '行内图片 span 挂标记');
  sf.destroy(); host.remove();
});

// ---- Task 3：选中态样式（data-selected）+ Esc 收选区 ----
test('选区覆盖原子块挂 data-selected、移走消失', () => {
  const { sf, host } = mount(SDOC);
  const block = host.querySelector('[data-excalidraw]');
  sf.view.dispatch({ selection: EditorSelection.range(sE, Math.min(sE + EXD.length + 1, SDOC.length)) });
  assert.equal(block.dataset.selected, '', '覆盖选区挂选中标记');
  sf.view.dispatch({ selection: { anchor: 0 } });
  assert.ok(!block.dataset.selected, '选区移走标记消失');
  sf.destroy(); host.remove();
});

test('跨选包含原子块（边界在块外）也挂选中标记', () => {
  const { sf, host } = mount(SDOC);
  const block = host.querySelector('[data-excalidraw]');
  sf.view.dispatch({ selection: EditorSelection.range(0, SDOC.length) });
  assert.equal(block.dataset.selected, '', '跨全篇选区：块视觉在选区内');
  sf.destroy(); host.remove();
});

test('Esc 命令收选区到块首、选中标记消失', () => {
  const { sf, host } = mount(SDOC);
  const block = host.querySelector('[data-excalidraw]');
  sf.view.dispatch({ selection: EditorSelection.range(sE, Math.min(sE + EXD.length + 1, SDOC.length)) });
  assert.ok(sf.atomicEsc(sf.view));
  assert.equal(sf.view.state.selection.main.head, sE, '选区 collapse 到块首');
  assert.ok(!block.dataset.selected);
  assert.equal(sf.atomicEsc(sf.view), false, '无覆盖选区时不拦');
  sf.destroy(); host.remove();
});

test('阅读态无选中标记', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: sIo(), mode: 'read', dark: false });
  sf.setText(SDOC);
  sf.view.dispatch({ selection: EditorSelection.range(0, SDOC.length) });
  assert.ok(!host.querySelector('[data-selected]'), '阅读态不挂选中标记');
  sf.destroy(); host.remove();
});

// ---- Task 4：右键菜单（编辑 / 删除 / 复制）----
test('右键 mermaid 块出菜单（编辑/删除引用）；右键图片 span 出（复制引用/删除引用）', () => {
  const { sf, host } = mount(SDOC);
  host.querySelector('[data-diagram]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  let menu = document.querySelector('[data-blockmenu]');
  assert.ok(menu, '块菜单已开');
  assert.deepEqual([...menu.querySelectorAll('button')].map((b) => b.textContent), ['编辑', '删除引用']);
  menu.querySelector('button').click();
  assert.ok(!document.querySelector('[data-blockmenu]'), '动作后菜单关');
  host.querySelector('span[data-atomic="image"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  menu = document.querySelector('[data-blockmenu]');
  assert.deepEqual([...menu.querySelectorAll('button')].map((b) => b.textContent), ['复制引用', '删除引用']);
  sf.destroy(); host.remove();
});

test('菜单删除引用：整行带走、undo 恢复且 data-atomic 元素回归', async () => {
  const { sf, host } = mount(SDOC);
  host.querySelector('[data-excalidraw]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  document.querySelector('[data-blockmenu] button[data-danger]').click();
  assert.ok(!sf.view.state.doc.toString().includes(EXD), '引用行删除');
  assert.equal(sf.view.state.selection.main.head, sE, '光标落在删除点');
  const { undo } = await import('@codemirror/commands');
  assert.ok(undo(sf.view));
  assert.ok(sf.view.state.doc.toString().includes(EXD), '撤销恢复引用行');
  assert.ok(host.querySelector('[data-excalidraw]'), 'widget 重新渲染（不是残留源码）');
  sf.destroy(); host.remove();
});

test('复制引用走 clipboard.writeText、收到 markdown 原文', async () => {
  const wrote = [];
  const clip = { writeText: async (t) => { wrote.push(t) } };
  const old = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
  try {
    const { sf, host } = mount(SDOC);
    host.querySelector('span[data-atomic="image"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    document.querySelector('[data-blockmenu] button').click();   // 首项 = 复制引用
    await Promise.resolve();
    assert.deepEqual(wrote, [IMG]);
    sf.destroy(); host.remove();
  } finally {
    Object.defineProperty(navigator, 'clipboard', { value: old, configurable: true });
  }
});

test('菜单点外部关闭、document 监听开关配平', () => {
  const { sf, host } = mount(SDOC);
  const addSpy = vi.spyOn(document, 'addEventListener');   // 透传：真监听要挂上，close 才真发生
  const remSpy = vi.spyOn(document, 'removeEventListener');
  try {
    host.querySelector('[data-excalidraw]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    assert.ok(document.querySelector('[data-blockmenu]'));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.ok(!document.querySelector('[data-blockmenu]'), '点外部关闭');
    host.querySelector('[data-excalidraw]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const menuAdds = addSpy.mock.calls.map((a) => a[0]).filter((t) => t === 'mousedown' || t === 'keydown');
    const menuRems = remSpy.mock.calls.map((a) => a[0]).filter((t) => t === 'mousedown' || t === 'keydown');
    assert.deepEqual(menuAdds, menuRems, '两次开关监听数配平');
  } finally {
    addSpy.mockRestore(); remSpy.mockRestore();
  }
  sf.destroy(); host.remove();
});

test('块内链接右键仍走 io.menu（链接分支优先）', async () => {
  const menus = [];
  const io = sIo();
  io.menu = (ref, at) => { menus.push(ref); return true };
  const doc3 = '[[页甲]]\n\n' + CODE;
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io, mode: 'edit', dark: false });
  sf.setText(doc3);
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  host.querySelector('[data-target]').dispatchEvent(ev);
  assert.equal(menus.length, 1, '链接菜单被调用');
  assert.equal(menus[0].name, '页甲');
  assert.ok(!document.querySelector('[data-blockmenu]'), '不进块菜单');
  sf.destroy(); host.remove();
});

test('阅读态右键不进块菜单', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: sIo(), mode: 'read', dark: false });
  sf.setText(SDOC);
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  host.querySelector('[data-excalidraw]').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.ok(!document.querySelector('[data-blockmenu]'));
  sf.destroy(); host.remove();
});

// ---- 评审修复：F1 菜单过期位置 / F2 相邻块选中态溢出 / F3 编辑态点图灯箱 / F4 clipboard 异步 ----
import { openBlockMenu } from '../src/editor/kernel/blockmenu.ts';

test('F1 文档变更即收菜单；过期块对象上点删除不抛不误删', () => {
  const { sf, host } = mount(SDOC);
  host.querySelector('[data-excalidraw]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  assert.ok(document.querySelector('[data-blockmenu]'));
  sf.view.dispatch({ changes: { from: 0, insert: 'x' } });   // 菜单开着时文档变了
  assert.ok(!document.querySelector('[data-blockmenu]'), '文档变更即收菜单（位置不再可能过期）');
  const before = sf.view.state.doc.toString();
  // 兜底：绕过收菜单直接用过期块对象开菜单点删除（RangeError 不得逃出编辑器包）
  const stale = { kind: 'excalidraw', from: 5, to: 9999, src: EXD };
  openBlockMenu(sf.view, stale, { x: 1, y: 1 });
  document.querySelector('[data-blockmenu] button[data-danger]').click();
  assert.equal(sf.view.state.doc.toString(), before, '校验不过不误删');
  sf.destroy(); host.remove();
});

test('F2 相邻块（无空行）选中态不溢出到下一块', () => {
  const ADJ = `前文\n\n${EXD}\n\`\`\`mermaid\nA-->B\n\`\`\``;
  const af = ADJ.indexOf(EXD);
  const { sf, host } = mount(ADJ);
  const exd = host.querySelector('[data-excalidraw]');
  const dg = host.querySelector('[data-diagram]');
  assert.ok(dg, '语料成立：相邻块都渲染');
  sf.view.dispatch({ selection: EditorSelection.range(af, af + EXD.length + 1) });
  assert.equal(exd.dataset.selected, '', '被选块挂标记');
  assert.ok(!dg.dataset.selected, '相邻块不溢出');
  sf.destroy(); host.remove();
});

test('F3 编辑态点图不进灯箱（单击=选中）', () => {
  const { sf, host } = mount(SDOC);
  const img = host.querySelector('span[data-atomic="image"] img');
  img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(!document.querySelector('.lightbox'), '编辑态不开灯箱');
  sf.destroy(); host.remove();
});

test('F4 clipboard 异步拒绝被吞（不产生 unhandled rejection）', async () => {
  const old = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  try {
    const { sf, host } = mount(SDOC);
    host.querySelector('span[data-atomic="image"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    document.querySelector('[data-blockmenu] button').click();
    await new Promise((r) => setTimeout(r, 10));   // 给微任务+宏任务落地的窗口
    assert.ok(true, '未抛未拒（vitest 会把 unhandled rejection 计为 Errors）');
    sf.destroy(); host.remove();
  } finally {
    Object.defineProperty(navigator, 'clipboard', { value: old, configurable: true });
  }
});

// ---- 方向键跨空行：落进空白行跳到下一个非空行（空行只承担块距，不是落点） ----
import { skipBlankDown, skipBlankUp } from '../src/editor/kernel/keys.ts';

test('↓ 从标题直接进正文，不踩中间的隐形空行', () => {
  const doc4 = '# 标题\n\n正文一行\n\n尾文';
  const { sf } = mount(doc4);
  sf.view.dispatch({ selection: { anchor: 4 } });   // 标题行尾
  assert.ok(skipBlankDown(sf.view));
  assert.equal(sf.view.state.doc.lineAt(sf.view.state.selection.main.head).text, '正文一行', '直接落到正文行');
  sf.destroy();
});

test('↑ 从正文直接回标题，不踩中间空行；连续空行也一次跨过', () => {
  const doc4 = '# 标题\n\n\n\n正文一行';
  const { sf } = mount(doc4);
  sf.view.dispatch({ selection: { anchor: doc4.length } });   // 正文行尾
  assert.ok(skipBlankUp(sf.view));
  assert.equal(sf.view.state.doc.lineAt(sf.view.state.selection.main.head).text, '# 标题', '跨过连续空行回到标题');
  sf.destroy();
});

test('↓ 在文档尾/无空行场景不拦（返回 false 交默认）', () => {
  const doc4 = '只有一行';
  const { sf } = mount(doc4);
  sf.view.dispatch({ selection: { anchor: 2 } });
  assert.equal(skipBlankDown(sf.view), false, '末行无路可走');
  sf.destroy();
});

// ---- 图位右侧空白 = 图后方的光标落点（点图身仍是选中） ----
test('块边框盒外的行内空白：光标落下一行行首；边框盒内（含定高居中空白）算图身选中', () => {
  const { sf, host } = mount(SDOC);
  const block = host.querySelector('[data-excalidraw]');
  // 槽位判定用块的边框盒：?h= 定高的块 svg 等比居中、块内左右有空白——那是图身不是槽位
  block.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON() {} });
  down(block, { clientX: 320 });   // 边框盒外右侧
  const sel = sf.view.state.selection.main;
  assert.ok(sel.empty, '空选区（光标）');
  assert.equal(sel.head, sE + EXD.length + 1, '光标在图位下一行行首');
  assert.ok(!block.dataset.selected, '不进选中态');
  down(block, { clientX: 280 });   // 边框盒内（哪怕内容居中留白）
  assert.equal(sf.view.state.selection.main.from, sE, '边框盒内仍是选中');
  sf.destroy(); host.remove();
});

test('jsdom 零尺寸矩形（无几何信息）不开启右侧落点，保持选中语义', () => {
  const { sf, host } = mount(SDOC);
  const block = host.querySelector('[data-excalidraw]');
  down(block, { clientX: 320 });   // jsdom rect.right === 0 → 视为无槽位
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, sE, '零几何时退回选中');
  sf.destroy(); host.remove();
});
