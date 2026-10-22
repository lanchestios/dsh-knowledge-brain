// test/editor-table.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseTable, splitCells, cellSpans, escCell, unescCell, overGuard } from '../src/editor/blocks/table.ts';

const SRC = '| 甲 | 乙 |\n| --- | :--: |\n| a | b |\n| c |   |\n';

test('parseTable：形状由 delimiter 定义，对齐三态，行文本已反转义已 trim', () => {
  const t = parseTable(SRC);
  assert.deepEqual(t, { cols: 2, aligns: ['l', 'c'], rows: [['甲', '乙'], ['a', 'b'], ['c', '']] });
});

test('parseTable：非表（缺 delimiter / delimiter 不合法）返回 null', () => {
  assert.equal(parseTable('| a | b |\n| x y |\n| c | d |'), null, 'delimiter 格不是 :?-+:? 形态');
  assert.equal(parseTable('| a | b |\n'), null, '只有一行');
});

test('parseTable：列不齐——缺格补空、多格截断都不影响 cols（cols 只看 delimiter）', () => {
  const t = parseTable('| h |\n| --- | :--: | --- |\n| a | b | c | d |\n| x |\n');
  assert.equal(t.cols, 3);
  assert.deepEqual(t.aligns, ['l', 'c', 'l']);
  assert.deepEqual(t.rows[1], ['a', 'b', 'c', 'd'], '源码行原样解析（截断只在渲染层做）');
  assert.deepEqual(t.rows[2], ['x']);
});

test('splitCells / cellSpans：行首行尾管不产空格；无行首/行尾管的行也能数对', () => {
  assert.deepEqual(splitCells('| a | b |'), ['a', 'b']);
  assert.deepEqual(splitCells('a | b'), ['a', 'b']);
  assert.deepEqual(splitCells('| a |'), ['a']);
  assert.deepEqual(splitCells('| |'), ['']);
  assert.deepEqual(cellSpans('| a | b |'), [[1, 4], [5, 8]]);
  assert.deepEqual(cellSpans('a | b'), [[0, 2], [3, 5]], '无行首管：首格从 0 起');
});

test('转义：读 \\| → |，写 | → \\|，双向 roundtrip', () => {
  assert.deepEqual(splitCells('| a\\|b | c |'), ['a|b', 'c']);
  assert.equal(unescCell('a\\|b'), 'a|b');
  assert.equal(escCell('a|b'), 'a\\|b');
  assert.equal(unescCell(escCell('x|y')), 'x|y');
  // 极端序列：源码里字面反斜杠+管（\\|）读回变 \|——接受并文档化（spec §五）
  assert.equal(unescCell('a\\\\|b'), 'a\\|b');
});

test('overGuard：行 > 300 或 列 > 20 或 格总数 > 2000', () => {
  const mk = (rows, cols) => ({ cols, aligns: Array(cols).fill('l'), rows: Array.from({ length: rows }, () => Array(cols).fill('x')) });
  assert.equal(overGuard(mk(300, 2)), false, '边界值不超限（> 300 才超）');
  assert.equal(overGuard(mk(301, 2)), true);
  assert.equal(overGuard(mk(2, 21)), true);
  assert.equal(overGuard(mk(200, 11)), true, '200×11=2200 > 2000');
  assert.equal(overGuard(mk(200, 10)), false, '2000 不超（> 2000 才超）');
});

import { replaceCell, insertRow, deleteRow, insertCol, deleteCol, setAlign, padRow } from '../src/editor/blocks/table.ts';

test('replaceCell：span 手术只动目标格，行内其余字符（含手写空格风格）原样保留', () => {
  const src = '| 甲 | 乙 |\n| --- | --- |\n| a   | b |\n';
  const out = replaceCell(src, 1, 0, 'X')   // '| a   | b |' 是网格行 1（源码行 2）
  assert.equal(out, '| 甲 | 乙 |\n| --- | --- |\n| X | b |\n', '只有 (1,0) 段被换成规范形态，(1,1) 的手写空格不动')
  assert.equal(replaceCell(src, 0, 1, '丙')?.split('\n')[0], '| 甲 | 丙 |')
})

test('replaceCell：目标格在本行缺位时先 padRow 补位再写（缺格补空的写路径）', () => {
  const src = '| a | b |\n| --- | --- | --- |\n| x |\n'
  assert.equal(replaceCell(src, 1, 2, 'Z')?.split('\n')[2], '| x | | Z |')
  assert.equal(padRow('| x |', 3), '| x | | |')
  assert.equal(padRow('| x | |', 3), '| x | | |', '已够位不动')
})

test('replaceCell：写入文本 esc + trim；空文本写空格占位；换行拍平（粘贴防线）', () => {
  const src = '| a | b |\n| --- | --- |\n| c | d |\n'
  assert.equal(replaceCell(src, 1, 0, ' p|q ')?.split('\n')[2], '| p\\|q | d |')
  assert.equal(replaceCell(src, 1, 0, '')?.split('\n')[2], '|  | d |'.replace('  ', ' '), '空文本=单空格占位')
  assert.equal(replaceCell(src, 1, 0, 'x\ny')?.split('\n')[2], '| x y | d |')
  assert.equal(replaceCell(src, 5, 0, 'x'), null, '行越界 null')
})

test('insertRow：在网格行 r 上方插空行；header 之上拒绝；空模板 = cols 格', () => {
  const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  assert.equal(insertRow(src, 1)?.split('\n')[2], '|  |  |', 'body 首行上方插空行（2 格空模板）')
  assert.equal(insertRow(src, 1), '| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n', '整表形态')
  assert.equal(insertRow(src, 0), null, 'header 之上 null')
  assert.equal(insertRow('| a |\n| --- |\n', 1), '| a |\n| --- |\n|  |\n', '表尾追加（body 0 行，r=rows.length）')
})

test('deleteRow：header 拒绝；删 body 行；删到 0 行合法', () => {
  const src = '| a |\n| --- |\n| 1 |\n| 2 |\n'
  assert.equal(deleteRow(src, 0), null)
  assert.equal(deleteRow(src, 2), '| a |\n| --- |\n| 1 |\n', 'r=2 = 第二 body 行（| 2 |），header/delimiter 占源码行 0/1')
  assert.equal(deleteRow('| a |\n| --- |\n| 1 |\n', 1), '| a |\n| --- |\n')
})

test('insertCol / deleteCol：全表含 delimiter 同步；缺格行先补齐；单列禁删', () => {
  const src = '| a | b |\n| :--: | --: |\n| 1 |\n| x | y | z |\n'
  const ins = insertCol(src, 1)
  assert.equal(ins, '| a | | b |\n| :--: | --- | --: |\n| 1 | | |\n| x | | y | z |\n', '列 1 左侧插空列，delimiter 插 ---，短行 pad 后插')
  const two = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  assert.equal(deleteCol(two, 0), '| b |\n| --- |\n| 2 |\n')
  assert.equal(deleteCol(two, 1), '| a |\n| --- |\n| 1 |\n')
  assert.equal(deleteCol('| a |\n| --- |\n| 1 |\n', 0), null, 'cols=1 禁删')
  // 长行（格数超过 cols）删列后掉一格自然回落（截断只在渲染层）
  assert.equal(deleteCol(src, 1)?.split('\n')[3], '| x | z |', '长行中格被删、其余保留')
})

test('setAlign：只重写被改列的 delimiter 段，其余 delimiter 原文不动', () => {
  const src = '| a | b | c |\n| --- | :--: | --: |\n| 1 | 2 | 3 |\n'
  assert.equal(setAlign(src, 1, 'r'), '| a | b | c |\n| --- | --: | --: |\n| 1 | 2 | 3 |\n')
  assert.equal(setAlign(src, 0, 'c')?.split('\n')[1], '| :--: | :--: | --: |')
  assert.equal(setAlign(src, 9, 'c'), null, '列越界 null')
})

import { nextCell } from '../src/editor/blocks/table.ts';

const T = { cols: 2, aligns: ['l', 'l'], rows: [['h1', 'h2'], ['a', 'b'], ['c', 'd']] }   // 3 网格行 × 2 列

test('Tab：右移 → 行尾换行首；末格 = 表尾追行进新行首格', () => {
  assert.deepEqual(nextCell(T, 1, 0, 'tab'), { k: 'move', r: 1, c: 1, at: 'start' })
  assert.deepEqual(nextCell(T, 1, 1, 'tab'), { k: 'move', r: 2, c: 0, at: 'start' })
  assert.deepEqual(nextCell(T, 2, 1, 'tab'), { k: 'grow', r: 3, c: 0 })
})

test('Shift-Tab：左移回行首；header 首格再往前 = 出表（before）', () => {
  assert.deepEqual(nextCell(T, 1, 1, 'stab'), { k: 'move', r: 1, c: 0, at: 'end' })
  assert.deepEqual(nextCell(T, 1, 0, 'stab'), { k: 'move', r: 0, c: 1, at: 'end' })
  assert.deepEqual(nextCell(T, 0, 0, 'stab'), { k: 'exit', side: 'before' })
})

test('Enter：同列下移；底行 = 追加一行进同列新格', () => {
  assert.deepEqual(nextCell(T, 0, 1, 'enter'), { k: 'move', r: 1, c: 1, at: 'start' })
  assert.deepEqual(nextCell(T, 2, 0, 'enter'), { k: 'grow', r: 3, c: 0 })
})

test('↑↓：同列移动；顶行↑ / 底行↓ 出表（↓ 不追行——追行只归 Enter/Tab）', () => {
  assert.deepEqual(nextCell(T, 1, 1, 'up'), { k: 'move', r: 0, c: 1, at: 'start' })
  assert.deepEqual(nextCell(T, 0, 1, 'up'), { k: 'exit', side: 'before' })
  assert.deepEqual(nextCell(T, 1, 0, 'down'), { k: 'move', r: 2, c: 0, at: 'start' })
  assert.deepEqual(nextCell(T, 2, 0, 'down'), { k: 'exit', side: 'after' })
})

test('←→：对端落位；首格行首← / 末格行尾→ 出表', () => {
  assert.deepEqual(nextCell(T, 1, 1, 'left'), { k: 'move', r: 1, c: 0, at: 'end' })
  assert.deepEqual(nextCell(T, 1, 0, 'left'), { k: 'exit', side: 'before' })
  assert.deepEqual(nextCell(T, 1, 0, 'right'), { k: 'move', r: 1, c: 1, at: 'start' })
  assert.deepEqual(nextCell(T, 1, 1, 'right'), { k: 'exit', side: 'after' })
})

test('Review Focus 5——删到 0 body 行（只剩 header）的矩阵不越界', () => {
  const solo = { cols: 2, aligns: ['l', 'l'], rows: [['h1', 'h2']] }
  assert.deepEqual(nextCell(solo, 0, 1, 'tab'), { k: 'grow', r: 1, c: 0 }, '末格 Tab 仍可追行')
  assert.deepEqual(nextCell(solo, 0, 0, 'enter'), { k: 'grow', r: 1, c: 0 })
  assert.deepEqual(nextCell(solo, 0, 0, 'down'), { k: 'exit', side: 'after' })
  assert.deepEqual(nextCell(solo, 0, 0, 'up'), { k: 'exit', side: 'before' })
  assert.deepEqual(nextCell(T, 9, 9, 'tab'), { k: 'none' }, '非法坐标 → none（调用方放行默认）')
})

import { registerBlock, blockWidget } from '../src/editor/blocks/registry.ts';
import { serverBlock } from '../src/editor/blocks/server.ts';

test('registry 扩展：interactive 放行事件；eq 钩子在 src 变化时被征询并可用 dom 查状态', () => {
  const seen = []
  registerBlock('t-test', {
    build: (src) => { const d = document.createElement('div'); d.textContent = src; d.dataset.x = src; return d },
    eq: (prev, next, dom) => { seen.push([prev, next, dom.dataset.x]); return dom.dataset.x === prev },
    interactive: true,
  })
  const ctx = { dark: false, mode: 'edit', batch: { get: async () => '' } }
  const w1 = blockWidget('t-test', 'a', '', ctx)
  const d1 = w1.toDOM()                       // 挂载（toDOM 返回根，widget.dom 已记录）
  assert.ok(w1.eq(w1), 'src 相等直接 true（不进钩子）')
  const w2 = blockWidget('t-test', 'b', '', ctx)
  assert.equal(w1.eq(w2), true, '存量侧发起对比：prev=a next=b，钩子 true → 保 DOM')
  assert.deepEqual(seen, [['a', 'b', 'a']])
  assert.equal(w2.dom, d1, '保 DOM 成立时 dom 引用传递给对侧')
  registerBlock('t-plain', { build: (src) => { const d = document.createElement('div'); d.textContent = src; return d } })
  assert.equal(blockWidget('t-plain', 'a', '', ctx)?.ignoreEvent(), true, '无 interactive 的 kind 默认仍吞事件')
  assert.equal(w2.ignoreEvent(), false, 'interactive 放行')
  assert.equal(w1.eq(blockWidget('t-test', 'a', '', { ...ctx, dark: true })), false, 'dark 不同直接 false')
})

test('Final C1 纵深——kind 的 eq 抛错按 false 处置（不炸调用方 dispatch）', () => {
  registerBlock('t-throw', { build: (src) => { const d = document.createElement('div'); return d }, eq: () => { throw new Error('eq 炸了') } })
  const ctx2 = { dark: false, mode: 'edit', batch: { get: async () => '' } }
  const w1 = blockWidget('t-throw', 'a', '', ctx2)
  w1.toDOM()
  const w2 = blockWidget('t-throw', 'b', '', ctx2)
  assert.equal(w1.eq(w2), false, 'eq 内部异常 → 按 false（重建），不逃逸')
})

test('serverBlock 已导出（表格降级路径复用）', () => {
  assert.equal(typeof serverBlock.build, 'function')
})

import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco } from '../src/editor/kernel/deco.ts';
import { registerTableKind } from '../src/editor/blocks/table.ts';

registerTableKind();
const st = (doc, sel = 0) => EditorState.create({
  doc,
  selection: { anchor: sel },
  extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] })],
});
const dctx = { mode: 'edit', dark: false, batch: { get: async (src) => `<em>${src}</em>` }, io: {}, degrade: false };
const widgetsAt = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.widget) out.push([i.from, i.to, v.spec.widget]); } return out };
const W1 = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

test('网格渲染：thead + th/td + 对齐 + data 坐标 + 激活格 batch 行内渲染', async () => {
  const w = widgetsAt(buildDeco(st(W1), dctx))[0][2]
  const root = w.toDOM()
  document.body.append(root)   // toDOM 返回游离根；isConnected 守卫要求挂载（生产路径 CM6 先挂载后 batch 回）
  assert.ok(root.matches('[data-tbl]'))
  assert.equal(root.querySelectorAll('thead th').length, 2)
  assert.equal(root.querySelectorAll('tbody td').length, 2)
  assert.equal(root.querySelector('[data-r="1"][data-c="0"]').textContent, '1', '首帧先显示纯文本，不留空壳')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(root.querySelector('[data-r="1"][data-c="0"]').innerHTML, '<em>1</em>', '格文本走 BatchStore 行内渲染')
  assert.equal(root.querySelectorAll('.cm-editor').length, 0, '未激活零 mini 实例（惰性）')
})

test('表格行内代码：单/双反引号同步预览，服务端未解析时不退回源码', async () => {
  const src = '| 内容 |\n| --- |\n| 前 `alpha` 后 |\n| ``a`b`` |\n'
  const rawCtx = { ...dctx, batch: { get: async (text) => `<p>${text}</p>` } }
  const root = widgetsAt(buildDeco(st(src), rawCtx))[0][2].toDOM()
  document.body.append(root)
  const cells = root.querySelectorAll('tbody [data-r]')
  assert.equal(cells[0].textContent, '前 alpha 后')
  assert.equal(cells[0].querySelector('code')?.textContent, 'alpha', '单反引号渲染为 code')
  assert.equal(cells[1].textContent, 'a`b')
  assert.equal(cells[1].querySelector('code')?.textContent, 'a`b', '双反引号可包住内容里的反引号')
  await Promise.resolve()
  assert.equal(root.querySelectorAll('tbody code').length, 2, '未解析的异步结果不覆盖本地代码预览')
  root.remove()
})

test('网格渲染：对齐三态映射 text-align；畸形数据行缺格补空、多格截断', () => {
  const src = '| a | b | c |\n| :-- | :--: | --: |\n| 1 |\n| x | y | z | w |\n'
  const root = widgetsAt(buildDeco(st(src), dctx))[0][2].toDOM()
  const cells = [...root.querySelectorAll('tbody td')]
  assert.equal(cells.length, 6, '2 数据行 × cols=3（缺格补空、多格截断）')
  assert.deepEqual(cells.map((c) => c.style.textAlign), ['left', 'center', 'right', 'left', 'center', 'right'])
  assert.equal(cells[1].textContent, '', '短行 | 1 | 的第 2/3 格补空')               // 缺格补空（显示层）
  assert.equal([...root.querySelectorAll('tbody tr')][1].querySelectorAll('[data-c]').length, 3)   // w 截断
})

test('降级：非表 src / 超限表 / ctx.degrade → 委托 serverBlock；read 态常规表直接出网格', () => {
  // 坏 delimiter 的 src 走不到 deco 层（lezer 不产 Table 节点），直接经 blockWidget 验 tableSpec 兜底
  const w = (src, c = dctx) => blockWidget('table', src, '', c)?.toDOM()
  assert.ok(!w('| a | b |\n| x |\n| c | d |\n')?.hasAttribute('data-tbl'), 'parseTable null 退 server')
  const big = '| a | b |\n| --- | --- |\n' + Array.from({ length: 301 }, (_, i) => `| ${i} | x |`).join('\n') + '\n'
  assert.ok(!w(big)?.hasAttribute('data-tbl'), '行 301 > 300 退 server')
  const read = w(W1, { ...dctx, mode: 'read' })
  assert.ok(read?.hasAttribute('data-tbl'), 'read 态同步建立网格，不先渲染多行源码 fallback')
  assert.equal(read.querySelector('.blockFallback'), null)
  assert.equal(read.querySelector('[data-r="1"][data-c="0"]').textContent, '1', 'RPC 回来前已有纯文本内容')
  assert.equal(read.querySelector('[data-tblbar]'), null, 'read 态没有编辑工具栏')
  assert.ok(!w(W1, { ...dctx, degrade: true })?.hasAttribute('data-tbl'), 'degrade 退 server')
})

test('deco 分叉钉：edit 态光标进表不抬源码（其他块 near 抬起）；read 态照常', () => {
  assert.equal(widgetsAt(buildDeco(st(W1, 12), dctx)).length, 1, '光标在表格块内仍出 widget')
  assert.equal(widgetsAt(buildDeco(st('```js\nlet a = 1\n```\n', 8), dctx)).length, 0, '对照：代码块 near 抬起（既有行为不回归）')
  assert.equal(widgetsAt(buildDeco(st(W1), { ...dctx, mode: 'read' })).length, 1)
})

import { createSurface } from '../src/editor/kernel/surface.ts';
import { EditorView } from '@codemirror/view';

const mkIo = () => ({ load: async () => ({ text: '', hash: 'h0' }), save: async () => ({ ok: true, hash: 'h1' }), renderBlocks: async (srcs) => srcs.map((x) => `<p>${x}</p>`) });
const mount = (text) => { const host = document.createElement('div'); document.body.append(host); const sf = createSurface(host, { io: mkIo(), mode: 'edit', dark: false }); sf.setText(text); return sf };
const rootOf = (sf) => sf.view.dom.querySelector('[data-tbl]');
const clickCell = (root, r, c) => root.querySelector(`[data-r="${r}"][data-c="${c}"]`)
  .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
const editCell = (root, r, c) => root.querySelector(`[data-r="${r}"][data-c="${c}"]`)
  .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const miniOf = (root) => { const el = root.querySelector('.tblCell .cm-editor'); return el ? EditorView.findFromDOM(el) : null };

test('单击只选格，双击才创建惰性 mini；编辑态沿用格子唯一外框', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  clickCell(root, 1, 0)
  assert.equal(miniOf(root), null, '单击不进入编辑')
  assert.equal(root.querySelectorAll('.tblCellSelected').length, 1, '单击仅选中一个格子')
  assert.equal(root.querySelector('[data-r="1"][data-c="0"]').classList.contains('tblCellSelected'), true)
  editCell(root, 1, 0)
  const mini = miniOf(root)
  assert.ok(mini, '双击后挂 mini')
  assert.equal(root.querySelectorAll('.cm-editor').length, 1, '仅一格有实例（惰性 O(1)）')
  assert.equal(root.querySelector('[data-r="1"][data-c="0"]').textContent, '1', '激活时先清阅读态文本，不重复显示两份内容')
  assert.equal(mini.state.doc.toString(), '1')
  assert.equal(root.querySelectorAll('.tblCellSelected').length, 1, '编辑器不创建第二层选框')
  assert.equal(root.querySelector('.tblCellActive'), null, '不再使用独立编辑外框')
  editCell(root, 1, 1)
  assert.equal(root.querySelectorAll('.cm-editor').length, 1, '切格仍只一格')
  assert.equal(miniOf(root).state.doc.toString(), '2')
  miniOf(root).dispatch({ changes: { from: 0, insert: 'X' } })
  assert.ok(!sf.view.state.doc.toString().includes('X2'), '未到冲刷时机不写主文档')
  sf.destroy()
})

test('切格冲刷：前格编辑经 flushCell 落进主文档；同格重复点击不重建实例', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  const m = miniOf(root)
  m.dispatch({ changes: { from: 0, to: 1, insert: 'Z' } })
  editCell(root, 1, 1)                        // 双击另一格 → deactivate 冲刷
  assert.ok(sf.view.state.doc.toString().includes('| Z | 2 |'))
  editCell(root, 1, 1)
  assert.equal(miniOf(root), EditorView.findFromDOM(root.querySelector('[data-r="1"][data-c="1"] .cm-editor')), '同格仍持实例')
  sf.destroy()
})

test('Review Focus 1——双份相同表格：激活第二份写回只改第二份（posAtDOM 定位不串）', () => {
  const sf = mount('前文\n\n' + W1 + '\n\n' + W1 + '\n\n后文\n')   // 两表之间必须空行，否则 lezer 并成一个 Table 节点
  const roots = sf.view.dom.querySelectorAll('[data-tbl]')
  assert.equal(roots.length, 2)
  editCell(roots[1], 1, 0)
  miniOf(roots[1]).dispatch({ changes: { from: 0, to: 1, insert: 'Q' } })
  editCell(roots[1], 1, 1)                   // 冲刷
  const lines = sf.view.state.doc.toString().split('\n')
  const zLines = lines.filter((l) => l.includes('| Q |'))
  assert.equal(zLines.length, 1, '只有一份表被改')
  assert.equal(lines.filter((l) => l === '| 1 | 2 |').length, 1, '第一份原样')
  assert.ok(lines.indexOf('| Q | 2 |') > lines.indexOf('| 1 | 2 |'), '改的是后一份')
  sf.destroy()
})

test('⌘点击：裸点非链元素不激活不开链；点格内 [[…]] 源码段开链', () => {
  const opened = []
  const io = { ...mkIo(), open: (ref) => opened.push(ref) }
  const host = document.createElement('div'); document.body.append(host)
  const sf = createSurface(host, { io, mode: 'edit', dark: false })
  sf.setText('| a |\n| --- |\n| [[页x]] |\n')
  const root = rootOf(sf)
  root.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, metaKey: true }))
  assert.equal(opened.length, 0, '非链元素 ⌘点不开链也不激活')
  assert.ok(!miniOf(root))
  editCell(root, 1, 0)   // 激活：wikiRanges 给 [[页x]] 源码段挂 data-target
  const span = root.querySelector('[data-r="1"][data-c="0"] [data-target]')
  assert.ok(span, 'mini 内双链源码段挂 data-target')
  span.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, metaKey: true }))
  assert.deepEqual(opened.map((r) => r.kind), ['wikilink'], '⌘点源码双链 → 开链')
  assert.ok(miniOf(root), '开链不拆激活')
  sf.destroy()
})

test('表格展示格内双链经块渲染解析，普通点击按 page id 跳转', async () => {
  const opened = []
  const io = {
    ...mkIo(),
    renderBlocks: async (srcs) => srcs.map((src) => src === '[[页x#章节]]'
      ? '<p><a href="#" data-wiki-id="knowledge/x.md" data-anchor="section">页x</a></p>'
      : `<p>${src}</p>`),
    open: (ref) => opened.push(ref),
  }
  const host = document.createElement('div'); document.body.append(host)
  const sf = createSurface(host, { io, mode: 'edit', dark: false })
  sf.setText('| 链接 |\n| --- |\n| [[页x#章节]] |\n')
  const root = rootOf(sf)
  const preview = root.querySelector('[data-r="1"][data-c="0"] [data-table-wiki]')
  assert.ok(preview, 'RPC 返回前已同步解析双链预览')
  assert.equal(preview.textContent, '页x')
  assert.equal(root.querySelector('[data-r="1"][data-c="0"]').textContent.includes('[['), false, '展示格不闪现双链源码')
  preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  assert.deepEqual(opened, [{ kind: 'wikilink', name: '页x', anchor: '章节' }], '预览链接按名字与锚点跳转')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const link = root.querySelector('[data-r="1"][data-c="0"] [data-wiki-id]')
  assert.ok(link, '双链显示为已解析链接而非 [[源码]]')
  link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  assert.deepEqual(opened, [
    { kind: 'wikilink', name: '页x', anchor: '章节' },
    { kind: 'page', id: 'knowledge/x.md', anchor: 'section' },
  ])
  assert.equal(miniOf(root), null, '点链接不进入单元格编辑')
  sf.destroy(); host.remove()
})

test('块渲染未解析双链时保留本地链接预览，不退回方括号源码', async () => {
  const opened = []
  const io = {
    ...mkIo(),
    renderBlocks: async (srcs) => srcs.map((src) => `<p>${src}</p>`),
    open: (ref) => opened.push(ref),
  }
  const host = document.createElement('div'); document.body.append(host)
  const sf = createSurface(host, { io, mode: 'read', dark: false })
  sf.setText('| 链接 |\n| --- |\n| 前 [[页x\\|别名]] 后 |\n')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const root = rootOf(sf)
  const box = root.querySelector('[data-r="1"][data-c="0"]')
  const link = box.querySelector('[data-table-wiki]')
  assert.equal(box.textContent, '前 别名 后')
  assert.ok(link, '服务端返回原文后仍保留本地双链节点')
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.deepEqual(opened, [{ kind: 'wikilink', name: '页x', anchor: undefined }])
  sf.destroy(); host.remove()
})

import { vi } from 'vitest';
import { flushCell, exitTable } from '../src/editor/blocks/table.ts';

test('防抖写回：打字 300ms 空闲后落主文档；窗口内续打重置计时', async () => {
  vi.useFakeTimers()
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  const mini = miniOf(root)
  mini.dispatch({ changes: { from: 0, insert: 'X' } })
  await vi.advanceTimersByTimeAsync(200)
  mini.dispatch({ changes: { from: 1, insert: 'Y' } })
  await vi.advanceTimersByTimeAsync(200)
  assert.ok(!sf.view.state.doc.toString().includes('XY'), '续打重置：400ms < 300+200 仍未冲刷')
  await vi.advanceTimersByTimeAsync(150)
  assert.ok(sf.view.state.doc.toString().includes('| XY1 | 2 |'), '空闲 300ms 到期冲刷')
  assert.ok(miniOf(root), '防抖块 ≈ 一个历史事件，冲刷不拆 mini（eq 保 DOM）')
  sf.destroy(); vi.useRealTimers()
})

test('escape 出表：冲刷 + 拆 mini + 主编辑器聚焦、光标落表格块之后', () => {
  const sf = mount('前\n\n' + W1 + '\n\n后\n')
  const root = rootOf(sf)
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 0, insert: 'K' } })
  exitTable(root, 'after')
  assert.ok(!miniOf(root), 'mini 已拆')
  assert.ok(sf.view.state.doc.toString().includes('| K1 | 2 |'), '出表先冲刷')
  assert.ok(sf.view.hasFocus, '主编辑器聚焦')   // jsdom 下 focus() 生效
  sf.destroy()
})

test('Review Focus 3——激活中 setText 全量换文：destroy 清计时器，推进零异常零僵尸 dispatch', async () => {
  vi.useFakeTimers()
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 0, insert: 'X' } })   // 计时器挂着
  sf.setText('# 换文\n')                                          // state 重建 → widget destroy → 计时器必须被清
  await vi.advanceTimersByTimeAsync(1000)
  assert.equal(sf.view.state.doc.toString(), '# 换文\n', '无僵尸 dispatch 改写新文档')
  sf.destroy(); vi.useRealTimers()
})

test('Review Focus 4——防抖窗口内 flushCell 先于结构重算（打字不丢）', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 1, insert: 'XY' } })   // 防抖未到期
  flushCell(root)                                                  // 结构操作的第一步（T9 runOp 同款）
  const doc = sf.view.state.doc.toString()
  assert.ok(doc.includes('| 1XY | 2 |'), '冲刷落文档')
  const next = insertRow(doc.trim(), 2)                            // 文档里只有这张表：现算 src 再插行
  assert.ok(next && next.split('\n').length === doc.trim().split('\n').length + 1, '结构重算基于冲刷后的文档（插行成功）')
  sf.destroy()
})

const press = (mini, key, opts = {}) => {
  // CM6 keymap 走真实 DOM 事件路径；jsdom 下直接构造 KeyboardEvent 派发到 mini.contentDOM
  mini.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
};

test('Tab 右移 / 行尾换行首 / 末格追行进新行首格', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  let mini = miniOf(root)
  press(mini, 'Tab')
  mini = miniOf(root)
  assert.equal(mini.state.doc.toString(), '2', 'Tab → (1,1)')
  press(mini, 'Tab')
  assert.ok(miniOf(root) === null || miniOf(root) !== mini, '末格 Tab 触发追行重建激活')
  const doc = sf.view.state.doc.toString()
  assert.ok(doc.split('\n').some((l) => /^\|\s*\|\s*\|\s*$/.test(l)), '表尾追了空行')
  const mini2 = miniOf(rootOf(sf))   // 追行=结构变化 → eq false → 整表重建换根：须现查 live root
  assert.ok(mini2, '新行首格已激活')
  assert.equal(mini2.state.doc.toString(), '', '新格是空格')
  sf.destroy()
})

const W2 = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';   // 两个 body 行（↑↓/Enter 移动用例需要）

test('Enter 同列下移；底行 Enter 追行进同列', () => {
  const sf = mount(W2)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  press(miniOf(root), 'Enter')
  assert.equal(miniOf(root).state.doc.toString(), '3', '(1,0) → (2,0)')
  press(miniOf(root), 'Enter')
  assert.equal(miniOf(rootOf(sf)).state.doc.toString(), '', '底行 Enter 追行进新同列格')
  sf.destroy()
})

test('↑↓ 同列移动、顶底出表；出表光标落块前/后', () => {
  const sf = mount('前\n\n' + W2 + '\n\n后\n')
  const root = rootOf(sf)
  const tFrom = sf.view.state.doc.toString().indexOf('| a |')
  editCell(root, 2, 0)
  press(miniOf(root), 'ArrowUp')
  assert.equal(miniOf(root).state.doc.toString(), '1', '↑ 到上一行同列')
  press(miniOf(root), 'ArrowUp')
  assert.equal(miniOf(root).state.doc.toString(), 'a', '↑ 到 header 同列')
  press(miniOf(root), 'ArrowUp')
  assert.ok(!miniOf(root), '顶行 ↑ 出表')
  assert.equal(sf.view.state.selection.main.head, tFrom, '落块前')
  editCell(root, 1, 0)
  press(miniOf(root), 'ArrowDown')
  press(miniOf(root), 'ArrowDown')
  assert.ok(!miniOf(root), '底行 ↓ 出表')
  assert.equal(sf.view.state.selection.main.head, tFrom + W2.trim().length, '落块后')
  sf.destroy()
})

test('←→ 中间放行默认；行首/行尾才移格', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  const mini = miniOf(root)
  mini.dispatch({ selection: { anchor: 1 } })          // '1' 的后面
  press(mini, 'ArrowLeft')
  assert.equal(miniOf(root), mini, '非行首：放行不移格')
  mini.dispatch({ selection: { anchor: 0 } })
  press(mini, 'ArrowLeft')
  assert.ok(!miniOf(root), '首格行首 ← 出表')
  sf.destroy()
})

test('Escape 出表；Mod-z 转发主视图（格内编辑 + 结构操作一并撤销）', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 0, insert: 'Z' } })
  press(miniOf(root), 'Escape')
  assert.ok(!miniOf(root))
  assert.ok(sf.view.state.doc.toString().includes('| Z1 |'), 'Escape 前冲刷')
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 0, insert: 'Y' } })
  press(miniOf(root), 'z', { ctrlKey: true })           // Mod-z → 冲刷 + 主视图 undo（jsdom 平台非 Mac，Mod=Ctrl）
  assert.ok(!miniOf(root), '撤销后表重建、激活丢失（spec 接受）')
  assert.ok(!sf.view.state.doc.toString().includes('| YZ1 |'), '撤销生效')
  sf.destroy()
})

const menuOf = (root) => root.querySelector('[data-tblmenu]');
const barOf = (root) => root.querySelector('[data-tblbar]');
const op = (root, id) => root.querySelector(`[data-op="${id}"]`);

test('轻量浮栏仅在选中后出现，并承载对齐与删除操作护栏', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  assert.ok(barOf(root), '编辑表格提供轻量浮栏')
  assert.equal(barOf(root).hidden, true, '未选中单元格时不显示')
  clickCell(root, 0, 0)                                   // header 行，仅选中
  assert.equal(miniOf(root), null)
  assert.equal(barOf(root).hidden, false, '选中后显示')
  assert.equal(barOf(root).querySelectorAll('button').length, 6, '三种对齐 + 删除行/列/表')
  assert.deepEqual(
    [...barOf(root).querySelectorAll('button')].map((button) => button.dataset.tooltip),
    ['左对齐', '居中对齐', '右对齐', '删除所在行', '删除所在列', '删除整个表格'],
    '每个浮栏图标都有 hover/focus tooltip 文案',
  )
  assert.equal(barOf(root).querySelectorAll('svg[data-icon-source="univer"][viewBox="0 0 16 16"]').length, 6, '浮栏使用 Univer 对应功能图标')
  assert.equal(op(root, 'rowDel').disabled, true, 'header 删行禁用')
  assert.equal(op(root, 'rowAbove').disabled, true, 'header ↑行禁用')
  assert.equal(op(root, 'rowBelow').disabled, false)
  assert.ok(root.querySelector('.tblCellSelected'), '选中格有明确轮廓状态')
  assert.equal(op(root, 'alL').getAttribute('aria-pressed'), 'true', '当前列对齐按钮有选中态')
  sf.destroy()
  const sf1 = mount('| a |\n| --- |\n| x |\n')             // 单列
  const r1 = rootOf(sf1)
  clickCell(r1, 1, 0)
  assert.equal(op(r1, 'colDel').disabled, true, 'cols=1 删列禁用')
  sf1.destroy()
})

test('点击表格不会因浮栏 SVG 图标进入全屏灯箱', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  const box = root.querySelector('[data-r="1"][data-c="0"]')
  box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.equal(document.querySelector('.lightbox'), null)
  assert.equal(box.classList.contains('tblCellSelected'), true, '普通点击仍只选中单元格')
  sf.destroy()
})

test('右键菜单按行列边界精简插入项：首尾双向，中间仅向后', () => {
  const sf = mount('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n')
  const root = rootOf(sf)
  const visible = (id) => !op(root, id).hidden

  clickCell(root, 1, 0)
  assert.deepEqual([visible('rowAbove'), visible('rowBelow'), visible('colLeft'), visible('colRight')], [true, true, true, true], '首行首列显示双向插入')

  clickCell(root, 2, 1)
  assert.deepEqual([visible('rowAbove'), visible('rowBelow'), visible('colLeft'), visible('colRight')], [false, true, false, true], '中间行列只显示向下/向右')
  assert.deepEqual(
    [getComputedStyle(op(root, 'rowAbove')).display, getComputedStyle(op(root, 'colLeft')).display],
    ['none', 'none'],
    'hidden 插入项在实际菜单布局中不可见',
  )

  clickCell(root, 3, 2)
  assert.deepEqual([visible('rowAbove'), visible('rowBelow'), visible('colLeft'), visible('colRight')], [true, true, true, true], '末行末列显示双向插入')
  sf.destroy()
})

test('右键菜单：只保留插入项；动作复用 runOp；点外关闭', () => {
  const sf = mount(W2)
  const root = rootOf(sf)
  const box = root.querySelector('[data-r="2"][data-c="1"]')
  box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 80, clientY: 60 }))
  assert.equal(menuOf(root).hidden, false, '右键菜单打开')
  assert.equal(miniOf(root), null, '右键不进入编辑')
  assert.equal(box.classList.contains('tblCellSelected'), true, '右键格成为选中格')
  assert.equal(menuOf(root).querySelectorAll('[role="menuitem"]').length, 4, '只含上下插行、左右插列')
  assert.equal(menuOf(root).querySelector('[data-op="rowDel"], [data-op="colDel"], [data-op="tblDel"], [data-op^="al"]'), null, '对齐和删除已移入浮栏')
  menuOf(root).querySelector('[data-op="rowAbove"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  assert.ok(sf.view.state.doc.toString().includes('\n|  |  |\n| 3 | 4 |'), '菜单动作走同一结构事务')
  assert.equal(miniOf(rootOf(sf)), null, '仅选中模式执行结构操作后仍不进入编辑')
  assert.equal(rootOf(sf).querySelectorAll('.tblCellSelected').length, 1, '结构操作后保持单格选中')

  const root2 = rootOf(sf)
  root2.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  assert.equal(menuOf(root2).hidden, false)
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  assert.equal(menuOf(root2).hidden, true, '点表格外关闭菜单')
  sf.destroy()
})

test('右键菜单键盘路径：Shift+F10 打开并聚焦，方向键移动，Escape 返回单元格', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  clickCell(root, 1, 0)
  const box = root.querySelector('[data-r="1"][data-c="0"]')
  assert.equal(box.classList.contains('tblCellSelected'), true)
  const menuEvent = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
  box.dispatchEvent(menuEvent)
  assert.equal(menuEvent.defaultPrevented, true, '表格键盘监听器接收快捷键')
  const menu = menuOf(root)
  assert.equal(menu.hidden, false)
  const first = document.activeElement
  assert.equal(first?.getAttribute('role'), 'menuitem', '首个可用项获焦')
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  assert.notEqual(document.activeElement, first, '方向键移动菜单焦点')
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(menu.hidden, true)
  assert.equal(document.activeElement, box, 'Escape 回到选中格')
  assert.equal(miniOf(root), null)
  sf.destroy()
})

test('插行/删行：源码正确 + 激活格坐标跟随', () => {
  const sf = mount(W1)
  const root = rootOf(sf)
  editCell(root, 1, 0)
  op(root, 'rowBelow').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const doc = sf.view.state.doc.toString()
  assert.equal(doc.split('\n').length, 5, '多了一行')
  assert.equal(miniOf(rootOf(sf)).state.doc.toString(), '', '下插行 → 进新行同列空格')
  sf.destroy()

  const sf2 = mount('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n')
  const r2 = rootOf(sf2)
  editCell(r2, 2, 1)
  miniOf(r2).dispatch({ changes: { from: 0, to: 1, insert: '九' } })
  op(r2, 'rowAbove').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const d2 = sf2.view.state.doc.toString()
  assert.ok(d2.includes('| 3 | 九 |'), '结构操作前冲刷保文本')   // 点的是 (2,1)='4'：九落在列 1
  assert.ok(d2.includes('\n|  |  |\n'), '原行上方插了空行（2 列空模板）')
  const mini = miniOf(rootOf(sf2))
  assert.equal(mini.state.doc.toString(), '九', '上插行 → 原格跟随到 (r+1,c)')
  sf2.destroy()
})

test('删行删到 0 body 行：表格健在（header+delimiter）、无编辑或选中态', () => {
  const sf = mount('| a |\n| --- |\n| 1 |\n')
  const root = rootOf(sf)
  editCell(root, 1, 0)
  op(root, 'rowDel').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  assert.equal(sf.view.state.doc.toString(), '| a |\n| --- |\n', '只剩 header+delimiter')
  const root2 = rootOf(sf)
  assert.ok(!miniOf(root2), '无激活')
  assert.equal(root2.querySelector('.tblCellSelected'), null, '被删的末行不留下选中态')
  assert.equal(barOf(root2).hidden, true, '重建后的浮栏回到隐藏态')
  sf.destroy()
})

test('对齐只动一列 delimiter；删列钳位；删表整块清掉', () => {
  const sf = mount('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n')
  const root = rootOf(sf)
  editCell(root, 1, 1)
  op(root, 'alC').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  assert.equal(sf.view.state.doc.toString().split('\n')[1], '| --- | :--: | --- |', '只改第 2 列 delimiter')
  const root2 = rootOf(sf)
  assert.equal(miniOf(root2).state.doc.toString(), '2', 'setAlign 后重激活同格')
  op(root2, 'colDel').dispatchEvent(new MouseEvent('click', { bubbles: true }))   // 删列 1
  assert.ok(sf.view.state.doc.toString().includes('| a | c |\n| --- | --- |\n| 1 | 3 |'), '整列同步删（含 delimiter）')
  op(rootOf(sf), 'tblDel').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  assert.equal(sf.view.state.doc.toString(), '', '删表整块（含尾换行）清掉')
  sf.destroy()
})

// ---- Final review 修复轮（C1/I1/I2），每条先 RED 后 GREEN ----

test('Final C1——尾部零格行（lone |）src 变化不炸 eq：行数不等直接重建', () => {
  const sf = mount('| a | b |\n| --- | --- |\n| 1 | 2 |\n|\n')   // 表下手工续行的第一个字符就是此形态
  const root = rootOf(sf)
  editCell(root, 1, 0)                                          // 激活（mini 挂上，eq 门敞开）
  const doc = sf.view.state.doc.toString()
  assert.equal(doc.endsWith('\n|\n'), true, 'fixture：lone | 行在档')
  // 主编辑器对 lone | 按一次 Backspace（删该字符）：prev src 含 lone| 行、next 不含——行数不等
  sf.view.dispatch({ changes: { from: doc.length - 2, to: doc.length - 1, insert: '' } })
  assert.ok(sf.view.state.doc.toString().endsWith('| 1 | 2 |\n\n'), '删字符成功（未捕获异常会直接炸在这里）')
  sf.destroy()
})

test('Final I1——出表前有未冲刷编辑：光标落【新】块尾（冲刷移位后现算）', () => {
  const sf = mount('前\n\n' + W1 + '\n\n后\n')
  const root = rootOf(sf)
  editCell(root, 1, 0)
  miniOf(root).dispatch({ changes: { from: 0, to: 1, insert: '长文字六个字' } })   // 格变长：块尾右移
  exitTable(root, 'after')
  const doc = sf.view.state.doc.toString()
  const start = doc.indexOf('| a |')
  const src = '| a | b |\n| --- | --- |\n| 长文字六个字 | 2 |'
  assert.equal(sf.view.state.selection.main.head, start + src.length, '落在新块尾（不是冲刷前的旧块尾）')
  sf.destroy()
})

test('Final I2——焦点离开表格（点主编辑器正文）：拆 mini 并清除选中态', () => {
  const sf = mount('前\n\n' + W1 + '\n\n后\n')
  const root = rootOf(sf)
  editCell(root, 1, 0)
  assert.ok(miniOf(root))
  // 点击主编辑器正文：mini 失焦、焦点落 root 之外的 contentDOM → focusout 冒泡到 root
  miniOf(root).contentDOM.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: sf.view.contentDOM }))
  assert.ok(!miniOf(root), '拆 mini')
  assert.equal(root.querySelector('.tblCellSelected'), null, '清除选中框')
  assert.ok(sf.view.state.doc.toString().includes('| 1 | 2 |'), '无编辑不写文档')
  sf.destroy()
})
