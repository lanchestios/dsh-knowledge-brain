// test/editor-mermaid.test.js
// @vitest-environment jsdom
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MermaidQueue, mermaidQueue, registerViewerKinds } from '../src/editor/blocks/mermaid.ts';
import { blockWidget, registerBlock } from '../src/editor/blocks/registry.ts';
import { createSurface } from '../src/editor/kernel/surface.ts';

const dom = new JSDOM('<div id=host></div>');
dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.document = dom.window.document;   // jsdom 环境下 document 已在，双保险可去

test('一张图语法错不炸队列、不阻塞后续，错处显示源码与报错', async () => {
  const order = [];
  let inFlight = 0;
  let overlapped = false;                    // 渲染窗口重叠 = 队列没串行
  const q = new MermaidQueue(async (el, id, code) => {
    if (inFlight > 0) overlapped = true;
    inFlight++;
    await Promise.resolve();                 // 微任务延迟制造并发窗口：串行链被拆，第二张必撞上
    inFlight--;
    order.push(id);
    if (code.includes('BAD')) throw new Error('Syntax error in graph');
    el.innerHTML = `<svg data-id="${id}">${code}</svg>`;
  });
  // 两个 host：同一元素被后续 draw 成功渲染会整块替换内容（与旧 article.ts 同语义），
  // 错误显示要落在自己的元素上才能断言「原位」
  const badHost = document.createElement('div');
  const okHost = document.createElement('div');
  const p1 = q.draw(badHost, 'BAD', false);
  const p2 = q.draw(okHost, 'graph TD; A-->B', false);
  await Promise.all([p1, p2]);
  assert.equal(order.length, 2);                       // 第二张没被第一张的错吃掉
  assert.equal(overlapped, false, '两张不得并发——串行链被拆即红这里');   // 钉死串行性
  assert.ok(badHost.textContent.includes('mermaid 语法错误'), '原位报错');
  assert.ok(badHost.textContent.includes('BAD'), '源码显示');
  assert.equal(badHost.hasAttribute('data-lightbox'), false, '错误图不开放灯箱');
  assert.ok(okHost.textContent.includes('graph TD; A-->B'), '第二张正常画出');
  assert.equal(okHost.hasAttribute('data-lightbox'), true, '成功渲染后开放点击全屏');
});

test('Mermaid 块点击事件穿过 CodeMirror 并打开灯箱', () => {
  registerViewerKinds();
  const draw = vi.spyOn(mermaidQueue, 'draw').mockImplementation((el) => {
    el.innerHTML = '<svg><rect width="10" height="10"/></svg>';
    el.dataset.lightbox = '';
    return Promise.resolve();
  });
  const host = document.createElement('div');
  document.body.append(host);
  const io = {
    load: async () => ({ text: '', hash: 'h0' }),
    save: async () => ({ ok: true, hash: 'h1' }),
    renderBlocks: async (srcs) => srcs.map(() => ''),
  };
  const sf = createSurface(host, { io, mode: 'read', dark: false });
  sf.setText('# 报表平台\n\n## 四层生长线\n\n```mermaid\nflowchart BT\nL1 --> L2\n```\n');
  const svg = host.querySelector('[data-lightbox] svg');
  assert.ok(svg, '成功渲染的 Mermaid 带灯箱标记');
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(document.querySelector('.lightbox'), '普通点击打开全屏灯箱');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  sf.destroy(); host.remove(); draw.mockRestore();
});

test('编辑态点击 Mermaid 图：不开灯箱，光标落进围栏、换回源码', () => {
  registerViewerKinds();
  const draw = vi.spyOn(mermaidQueue, 'draw').mockImplementation((el) => {
    el.innerHTML = '<svg><rect width="10" height="10"/></svg>';
    el.dataset.lightbox = '';
    return Promise.resolve();
  });
  const host = document.createElement('div');
  document.body.append(host);
  const io = {
    load: async () => ({ text: '', hash: 'h0' }),
    save: async () => ({ ok: true, hash: 'h1' }),
    renderBlocks: async (srcs) => srcs.map(() => ''),
  };
  const sf = createSurface(host, { io, mode: 'edit', dark: false });
  const text = '前文\n\n```mermaid\nflowchart BT\nL1 --> L2\n```\n\n后文\n';
  sf.setText(text);
  const svg = host.querySelector('[data-lightbox] svg');
  assert.ok(svg, '光标在块外时显示渲染图');
  assert.equal(svg.parentElement.dataset.mode, 'edit', '编辑态图块标 data-mode=edit（CSS 据此不给放大镜光标）');
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(down, 'view', { value: window });
  svg.dispatchEvent(down);
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(document.querySelector('.lightbox'), null, '编辑态不开全屏');
  // 原子块：单击选中整块（渲染件保留），双击才进源码
  const sel = sf.view.state.selection.main;
  assert.equal(sel.from, text.indexOf('```mermaid'), '单击选区起点 = 围栏行首');
  assert.equal(sel.to, text.indexOf('```mermaid') + '```mermaid\nflowchart BT\nL1 --> L2\n```'.length, '选区不含尾换行（含了会点亮块后空行）');
  assert.ok(host.querySelector('[data-lightbox]'), '选中态仍是渲染件');
  svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(sf.view.state.selection.main.head, text.indexOf('flowchart'), '双击光标落在围栏内首行');
  assert.equal(host.querySelector('[data-lightbox]'), null, '渲染件撤下，露出源码');
  document.querySelectorAll('.lightbox').forEach((n) => n.remove());
  sf.destroy(); host.remove(); draw.mockRestore();
});

test('registerViewerKinds 幂等 = 覆写保护：不吞掉宿主自定义 spec', () => {
  registerViewerKinds();                     // 确保默认 viewer 已注册（本测试无论文件内顺序先到这都成立）
  const ctx = { dark: false, mode: 'read', batch: {} };
  assert.equal(blockWidget('mermaid', '```mermaid\ngraph TD\n```', 'mermaid', ctx).ignoreEvent(), false, 'Mermaid 点击事件放行给灯箱');
  assert.equal(blockWidget('infographic', '```infographic\n少即是多\n```', 'infographic', ctx).ignoreEvent(), false, '信息图点击事件放行给灯箱');
  const customSpec = {
    build(src) {
      const d = document.createElement('div');
      d.dataset.custom = 'mermaid';
      return d;
    },
  };
  registerBlock('mermaid', customSpec);      // 宿主注入自定义渲染器
  registerViewerKinds();                     // 幂等：guard 在 → no-op，不得覆写 custom
  const w = blockWidget('mermaid', 'graph TD', 'mermaid', ctx);
  assert.ok(w, 'mermaid 已注册');
  assert.equal(w.toDOM().dataset.custom, 'mermaid', 'guard 防住覆写，产物仍是 custom spec 的');   // guard 被删 → 默认 spec 覆写 → 红
  assert.ok(blockWidget('infographic', '```infographic\n少即是多\n```', 'infographic', ctx), 'infographic 已注册');
});

test('BlockWidget.destroy 转调 spec.destroy（CM6 移除 widget 时挂钩）', () => {
  let destroyed = null;
  registerBlock('destroy-probe', {
    build() { return document.createElement('div') },
    destroy(dom) { destroyed = dom },
  });
  const ctx = { dark: false, mode: 'read', batch: {} };
  const w = blockWidget('destroy-probe', 'x', '', ctx);
  const domEl = w.toDOM();
  w.destroy(domEl);
  assert.equal(destroyed, domEl, 'destroy 收到 widget 外层 DOM');
});

// mermaid.render 不给容器时把量尺寸用的临时 div 直接挂 body 末尾（实测 153px 高）：渲染那一两帧
// 页面长出滚动条，整个应用窄 5px，编辑/查看切换（重建所有图）时顶栏左右抖。临时件必须进一个
// 不参与文档流、不撑页面的容器
test('mermaid 量尺寸的临时件挂在不撑页面的容器里，渲染完收走', async () => {
  const mermaid = (await import('mermaid')).default;
  let seen = null;
  const render = vi.spyOn(mermaid, 'render').mockImplementation(async (id, _code, container) => {
    seen = container ? { attached: document.body.contains(container), position: container.style.position, height: container.style.height, overflow: container.style.overflow, visibility: container.style.visibility } : null;
    return { svg: `<svg id="${id}"></svg>` };
  });
  vi.spyOn(mermaid, 'initialize').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  await mermaidQueue.draw(host, 'graph TD; A-->B', false);
  render.mockRestore();
  assert.ok(seen, 'render 必须拿到显式容器（不传就落 body 撑出滚动条）');
  assert.equal(seen.attached, true, '容器挂在文档里（getBBox 量字宽要求已挂载）');
  assert.equal(seen.position, 'fixed', '脱离文档流');
  assert.equal(seen.height, '0px');
  assert.equal(seen.overflow, 'hidden');
  assert.equal(seen.visibility, 'hidden');
  assert.ok(host.querySelector('svg'), '图照常画进块里');
  host.remove();
});
