// test/editor-docview.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import GithubSlugger from 'github-slugger';
import { DocView } from '../src/editor/viewer/DocView.tsx';

const mk = (over = {}) => ({
  load: async () => ({ text: '第一行\n\n```js\nx\n```', hash: 'h0' }),
  save: async () => ({ ok: true, hash: 'h1' }),
  renderBlocks: async (s) => s.map(() => ''),
  exit: (changed) => { exits.push(changed); },
  ...over,
});
let exits = [];

test('载入渲染为 CM6 编辑面；mode 翻转同实例；卸载走 exit', async () => {
  exits = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const io = mk();
  await act(async () => { root.render(createElement(DocView, { io, mode: 'read', dark: false })) });
  const cm = host.querySelector('.cm-content');
  assert.ok(cm, 'CM6 挂载');
  assert.equal(cm.getAttribute('contenteditable'), 'false');
  const view1 = host.querySelector('.cm-editor');
  await act(async () => { root.render(createElement(DocView, { io, mode: 'edit', dark: false })) });
  assert.equal(host.querySelector('.cm-editor'), view1, 'mode 翻转不换实例');
  assert.equal(host.querySelector('.cm-content').getAttribute('contenteditable'), 'true');
  await act(async () => { root.unmount() });
  assert.deepEqual(exits, [false], '干净卸载 exit(false)');
});

test('onStatus 透传：装载 → saved，正文改动 → dirty', async () => {
  exits = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const seen = [];
  const io = mk();
  await act(async () => { root.render(createElement(DocView, { io, mode: 'edit', dark: false, onStatus: (s) => seen.push(s) })) });
  assert.ok(seen.includes('saved'), '装载后 saver.reset 上报 saved');
  const view = EditorView.findFromDOM(host.querySelector('.cm-content'));
  assert.ok(view, '从 DOM 找到 CM6 view');
  await act(async () => { view.dispatch({ changes: { from: 0, insert: '改' } }) });
  assert.equal(seen.at(-1), 'dirty', '正文改动经 onStatus 上报 dirty');
  await act(async () => { root.unmount() });
});

// 跨页锚点与异步装载赛跑：锚点元素要等 io.load 往返、setText 后的下一帧才进 DOM——
// anchor prop 下传，装载完成后按 scrollTo 同款查一次；无 anchor 不滚
test('anchor prop：装载完成后下一帧滚到锚点；无 anchor 不滚', async () => {
  exits = [];
  const anchor = new GithubSlugger().slug('标题甲');
  const io = mk({ load: async () => ({ text: '# 顶\n\n## 标题甲\n\n正文', hash: 'h0' }) });
  const calls = [];
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () { calls.push(this.id); };
  try {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(DocView, { io, mode: 'read', dark: false, anchor })) });
    await new Promise((r) => setTimeout(r, 30));          // 等一帧（rAF）后定位
    assert.deepEqual(calls, [anchor], '装载下一帧滚到锚点（元素 id 已进 DOM）');
    await act(async () => { root.unmount() });
    const host2 = document.createElement('div');
    document.body.append(host2);
    const root2 = createRoot(host2);
    await act(async () => { root2.render(createElement(DocView, { io, mode: 'read', dark: false })) });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls.length, 1, '无 anchor prop 不滚');
    await act(async () => { root2.unmount() });
    host.remove(); host2.remove();
  } finally {
    Element.prototype.scrollIntoView = orig;
  }
});
