// test/excalidraw-css-load.test.js
// 覆盖层画布 UI 样式表装载：loadExcalidrawLib 注入 iife 件时必须同时注入 <link> 样式表——
// excalidraw 的 UI CSS 不在 JS 产物里，漏了就是裸 DOM（真机「编辑态打开样式乱」的根因）。
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadExcalidrawLib } from '../src/editor/blocks/excalidraw.ts';

test('loadExcalidrawLib 注入 script 同时注入样式表 link', async () => {
  window.WikiExcalidraw = { Excalidraw: {}, exportToSvg: async () => ({ outerHTML: '<svg/>' }) };
  const made = [];
  const orig = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = orig(tag);
    if (tag === 'script' || tag === 'link') made.push({ tag, el });
    return el;
  };
  const p = loadExcalidrawLib();   // 默认地址：jsdom 不拉外部子资源，onload 手动触发
  made.filter((m) => m.tag === 'script').forEach((m) => m.el.onload?.());
  await p;
  const link = made.find((m) => m.tag === 'link');
  assert.ok(link, '注入了 link 元素');
  assert.equal(link.el.getAttribute('rel'), 'stylesheet');
  assert.equal(link.el.getAttribute('href'), '/api/wiki.exfonts/excalidraw.iife.css');
});
