// test/editor-surface.test.js
// @vitest-environment jsdom
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createSurface } from '../src/editor/kernel/surface.ts';
import { toggleBold, makeLink } from '../src/editor/kernel/keys.ts';

const mkIo = (saved) => ({
  load: async () => ({ text: '', hash: 'h0' }),
  save: async (t) => { saved.push(t); return { ok: true, hash: 'h1' } },
  renderBlocks: async (srcs) => srcs.map(() => ''),
});

test('⌘B 包裹/去包裹、⌘K 链接化（Command 直调）', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: mkIo([]), mode: 'edit', dark: false });
  sf.setText('ab');
  sf.view.dispatch({ selection: EditorSelection.range(0, 2) });
  assert.ok(toggleBold(sf.view));
  assert.equal(sf.view.state.doc.toString(), '**ab**');
  // toggleBold 落下的选区在标记内侧 (2,4)；移植的 wrap 只在「标记在选区两侧」时去包裹
  //（brief 原稿写 range(0, 6) 会连标记一起选中 → 按旧 keys.ts 语义是再包一层，非去包裹）
  sf.view.dispatch({ selection: EditorSelection.range(2, 4) });
  assert.ok(toggleBold(sf.view));
  assert.equal(sf.view.state.doc.toString(), 'ab');
  sf.view.dispatch({ selection: EditorSelection.range(0, 2) });
  assert.ok(makeLink(sf.view));
  assert.equal(sf.view.state.doc.toString(), '[ab]()');
  sf.destroy();
});

test('docChanged 走 saver；经 eolIo 包装后保存还原 CRLF（Review Focus 1）', async () => {
  vi.useFakeTimers();
  const saved = [];
  const io = mkIo(saved);
  const eol = '\r\n';
  const eolIo = { ...io, save: (t, b) => io.save(t.replace(/\n/g, eol), b) };
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: eolIo, mode: 'edit', dark: false });
  sf.setText('a\nb');
  sf.saver.reset('a\nb', 'h0');
  sf.view.dispatch({ changes: { from: 3, insert: 'c' } });   // a\nbc
  await vi.runAllTimersAsync();                              // 1s 防抖到期 → flush → io.save
  await vi.runAllTimersAsync();
  assert.deepEqual(saved, ['a\r\nbc']);
  sf.destroy();
  vi.useRealTimers();
});

test('setMode 翻转只读与可编辑属性；dark 触发装饰重建不换实例', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: mkIo([]), mode: 'read', dark: false });
  assert.equal(sf.view.contentDOM.getAttribute('contenteditable'), 'false');
  const v1 = sf.view;
  sf.setMode('edit');
  assert.equal(sf.view, v1, '同一实例');
  assert.equal(sf.view.contentDOM.getAttribute('contenteditable'), 'true');
  sf.setDark(true);
  assert.equal(sf.view, v1);
  sf.destroy();
});

test('宿主夜间声明 darkTheme（CM &dark 基类 → caret 白）；setDark 随翻', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: mkIo([]), mode: 'edit', dark: false });
  assert.equal(sf.view.state.facet(EditorView.darkTheme), false, '白天是 &light（caret 黑）');
  sf.setDark(true);
  assert.equal(sf.view.state.facet(EditorView.darkTheme), true, '夜间翻 &dark（caret 白）');
  sf.setDark(false);
  assert.equal(sf.view.state.facet(EditorView.darkTheme), false, '翻回白天');
  sf.destroy();
  const host2 = document.createElement('div');
  document.body.append(host2);
  const sf2 = createSurface(host2, { io: mkIo([]), mode: 'edit', dark: true });
  assert.equal(sf2.view.state.facet(EditorView.darkTheme), true, '夜间起手就是 &dark');
  sf2.destroy();
  host2.remove();
});
