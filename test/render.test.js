import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderPage } from '../src/core/render.ts';

// 嵌入件 iframe：?h=560 定死高度（不挂 data-autosize）；不滚动（scrolling=no，
// 内部滚动会和文章滚动抢滚轮，塞不下只会被裁，改 ?h= 调高）；
// src 挂上文件的 mtime 版本号——asset 改了之后页面 html 必变，React 才会换 iframe、
// 改动不用手动刷新。不写 ?h= 的老写法降级回自适应。
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'render-embed-'));
  const file = path.join(dir, 'asset/explorables/x.html');
  mkdirSync(path.join(dir, 'asset/explorables'), { recursive: true });
  writeFileSync(file, '<p>试</p>');
  utimesSync(file, new Date(1_750_000_000_000), new Date(1_750_000_000_000));   // 钉死 mtime，断言可比对
  const m = { dir, g: { map: new Map() }, dead: new Map() };
  const render = (md) => renderPage({ _id: '知识/甲.md', _content: md }, m);
  return { dir, mtimeMs: String(Math.round(statSync(file).mtimeMs)), render };
};

test('嵌入件带 ?h= ：定高 iframe，不挂 data-autosize，src 带 mtime 版本号', async () => {
  const { mtimeMs, render } = setup();
  const { html } = await render('![](asset/explorables/x.html?h=560)');
  const iframe = html.match(/<iframe[^>]*>/)[0];
  assert.match(iframe, /height:560px/);
  assert.doesNotMatch(iframe, /data-autosize/);
  assert.match(iframe, /scrolling="no"/);
  assert.match(iframe, new RegExp(`api/wiki\\.asset\\?path=asset%2Fexplorables%2Fx\\.html&#x26;v=${mtimeMs}`));
});

test('嵌入件不写参数：老写法降级回自适应', async () => {
  const { render } = setup();
  const { html } = await render('![](asset/explorables/x.html)');
  const iframe = html.match(/<iframe[^>]*>/)[0];
  assert.match(iframe, /height:480px/);
  assert.match(iframe, /data-autosize/);
  assert.match(iframe, /scrolling="no"/);
});

test('目标文件不在：版本号裸缺，不影响嵌入本身', async () => {
  const { render } = setup();
  const { html } = await render('![](asset/explorables/没有.html?h=560)');
  const iframe = html.match(/<iframe[^>]*>/)[0];
  assert.match(iframe, /height:560px/);
  assert.doesNotMatch(iframe, /&#x26;v=/);
});

// excalidraw 图位：服务端渲染（章节原文/Lark 只读面）不产破图——img 换中性占位块
test('excalidraw 引用渲染成占位块，不产出 img', async () => {
  const { render } = setup();
  const { html } = await render('![](asset/diagrams/2026-10-19/架构图.excalidraw)');
  assert.ok(!/<img/.test(html), '不产 img（破图）');
  assert.ok(html.includes('Excalidraw 图'), '中性占位文案');
  assert.ok(html.includes('wiki-excalidraw'), '占位类名');
});
