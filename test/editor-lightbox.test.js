// test/editor-lightbox.test.js
// @vitest-environment jsdom
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { openLightbox } from '../src/editor/viewer/lightbox.ts';

// 每个用例收尾清掉浮层：一个用例断言失败没关上，别把下一个用例的 querySelector 带偏
afterEach(() => { document.querySelectorAll('.lightbox').forEach((n) => n.remove()); });

const key = (k) => new KeyboardEvent('keydown', { key: k, bubbles: true });
const scaleOf = (inner) => Number(inner.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
const btn = (label) => document.querySelector(`.lbBar button[aria-label="${label}"]`);
const pct = () => document.querySelector('.lbBar [data-zoom]').textContent;

// jsdom 不做布局：给舞台一个 1000×600 的视口
const sized = (fn) => {
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('lbStage') ? 1000 : 0 } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList?.contains('lbStage') ? 600 : 0 } });
  try { fn() } finally {
    if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
    if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
  }
};

// mermaid 的 svg：viewBox 给自然尺寸，内联 max-width 把它钉成小图
const mermaidSvg = () => {
  const box = document.createElement('div');
  box.innerHTML = '<svg viewBox="0 0 200 100" style="max-width: 200px;" width="100%"><rect width="200" height="100"/></svg>';
  return box;
};

test('打开时复制内容；Esc 与点背景关闭；点内容不关', () => {
  const img = document.createElement('img');
  openLightbox(img);
  assert.ok(document.querySelector('.lightbox'), '浮层挂载');
  const inner = document.querySelector('.lbInner');
  assert.equal(img.parentElement, null, '原图不被移出正文');
  assert.notEqual(inner.firstChild, img, '灯箱使用独立副本');
  // 真鼠标事件都带 view（d3 拖拽读 event.view.document）；构造参数在本环境认不出 window，直接挂上
  const down = new MouseEvent('mousedown', { bubbles: true });
  Object.defineProperty(down, 'view', { value: window });
  inner.firstChild.dispatchEvent(down);
  assert.ok(document.querySelector('.lightbox'), '点内容是拖动，不关');
  window.dispatchEvent(key('Escape'));
  assert.equal(document.querySelector('.lightbox'), null, 'Esc 关闭');

  openLightbox(img.cloneNode());
  document.querySelector('.lightbox').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  assert.equal(document.querySelector('.lightbox'), null, '点背景关闭');
});

// excalidraw ?h= 块：外层 div 带内联定高 + flex（placeSvg 的定高分支）——不清高度，
// 克隆 svg 钉回自然尺寸后竖向溢出容器、顶部被裁（真机：内容偏上偏左、纸底矮一截）
const exdBlock = () => {
  const box = document.createElement('div');
  box.style.height = '564px';
  box.style.display = 'flex';
  box.innerHTML = '<svg viewBox="0 0 1430 1025.5" width="2860" height="2051" style="max-width: 100%; max-height: 100%;"><rect width="1430" height="1025.5"/></svg>';
  return box;
};

test('excalidraw 定高块：清外层内联高度，容器包住钉回自然尺寸的 svg', () => sized(() => {
  openLightbox(exdBlock());
  const inner = document.querySelector('.lbInner');
  const wrap = inner.firstElementChild;
  const svg = inner.querySelector('svg');
  assert.equal(wrap.style.height, '', '外层内联定高清掉（防 svg 溢出裁顶）');
  assert.equal(svg.getAttribute('width'), '1430', 'svg 钉回 viewBox 宽');
  assert.equal(svg.getAttribute('height'), '1025.5', 'svg 钉回 viewBox 高');
  assert.equal(svg.style.maxWidth, '', '内联 max-width 去掉');
  window.dispatchEvent(key('Escape'));
}));

test('mermaid 小图：去掉内联 max-width，按自然尺寸摆好并适应窗口（铺到视口约 90%）', () => sized(() => {
  openLightbox(mermaidSvg());
  const inner = document.querySelector('.lbInner');
  const svg = inner.querySelector('svg');
  assert.equal(svg.style.maxWidth, '', '内联 max-width 去掉，不再钉成小图');
  assert.equal(svg.getAttribute('width'), '200');
  assert.equal(svg.getAttribute('height'), '100');
  // 适应：min(1000*.9/200, 600*.9/100) = min(4.5, 5.4) = 4.5
  assert.ok(Math.abs(scaleOf(inner) - 4.5) < 1e-6, `适应倍率应为 4.5，实际 ${scaleOf(inner)}`);
  assert.equal(pct(), '450%');
  window.dispatchEvent(key('Escape'));
}));

test('工具栏：放大 / 缩小 / 适应窗口 / 原始大小 / 关闭；百分比跟着变；点工具栏不关浮层', () => sized(() => {
  openLightbox(mermaidSvg());
  const inner = document.querySelector('.lbInner');
  const fit = scaleOf(inner);
  btn('放大').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  btn('放大').click();
  assert.ok(document.querySelector('.lightbox'), '按工具栏不关浮层');
  assert.ok(scaleOf(inner) > fit, '放大');
  const up = scaleOf(inner);
  btn('缩小').click();
  btn('缩小').click();
  assert.ok(scaleOf(inner) < up, '缩小');
  btn('原始大小').click();
  assert.equal(scaleOf(inner), 1);
  assert.equal(pct(), '100%');
  btn('适应窗口').click();
  assert.ok(Math.abs(scaleOf(inner) - fit) < 1e-6, '回到适应');
  btn('关闭').click();
  assert.equal(document.querySelector('.lightbox'), null);
}));

test('快捷键：+ / = 放大，- 缩小，0 适应窗口', () => sized(() => {
  openLightbox(mermaidSvg());
  const inner = document.querySelector('.lbInner');
  const fit = scaleOf(inner);
  window.dispatchEvent(key('+'));
  assert.ok(scaleOf(inner) > fit);
  window.dispatchEvent(key('='));
  const two = scaleOf(inner);
  window.dispatchEvent(key('-'));
  assert.ok(scaleOf(inner) < two);
  window.dispatchEvent(key('0'));
  assert.ok(Math.abs(scaleOf(inner) - fit) < 1e-6);
  window.dispatchEvent(key('Escape'));
}));

test('滚轮缩放保留；双指捏合与双击复位去掉；canvas 副本同步尺寸与像素', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let copiedFrom = null;
  HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage(source) { copiedFrom = source; } };
  };
  try {
    const chart = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    chart.append(canvas);
    openLightbox(chart);
    const stage = document.querySelector('.lbStage');
    const inner = document.querySelector('.lbInner');
    const copy = inner.querySelector('canvas');
    assert.equal(copy.width, 640);
    assert.equal(copy.height, 360);
    assert.equal(copiedFrom, canvas, 'cloneNode 丢失的 canvas 位图被补画');
    const before = scaleOf(inner);
    const zoomIn = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    stage.dispatchEvent(zoomIn);
    const enlarged = scaleOf(inner);
    assert.ok(enlarged > before, `向上滚动应放大，实际 ${before} → ${enlarged}`);
    assert.equal(zoomIn.defaultPrevented, true, '全屏缩放时阻止页面滚动');
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }));
    const reduced = scaleOf(inner);
    assert.ok(reduced < enlarged, '向下滚动应缩小');

    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    const pinch = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.defineProperty(pinch, 'scale', { value: 2 });
    stage.dispatchEvent(start);
    stage.dispatchEvent(pinch);
    assert.equal(scaleOf(inner), reduced, '双指捏合不再缩放');
    assert.equal(pinch.defaultPrevented, true, '但仍拦下，免得整页被系统缩放');
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert.equal(scaleOf(inner), reduced, '双击不再复位');
    window.dispatchEvent(key('Escape'));
  } finally {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  }
});

test('图（svg / canvas）垫一层主题底色（data-paper），照片不垫', () => {
  openLightbox(mermaidSvg());
  assert.ok('paper' in document.querySelector('.lbInner').dataset, 'mermaid 垫底：线条按主题底色画的');
  window.dispatchEvent(key('Escape'));
  const chart = document.createElement('div');
  chart.append(document.createElement('canvas'));
  openLightbox(chart);
  assert.ok('paper' in document.querySelector('.lbInner').dataset, '信息图同样垫底');
  window.dispatchEvent(key('Escape'));
  openLightbox(document.createElement('img'));
  assert.equal('paper' in document.querySelector('.lbInner').dataset, false, '照片自带底色，不加白框');
  window.dispatchEvent(key('Escape'));
});
