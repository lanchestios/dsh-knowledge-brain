// test/editor-deco-inline.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco, nameStates, setNameStates } from '../src/editor/kernel/deco.ts';
import { createSurface } from '../src/editor/kernel/surface.ts';

const st = (doc, sel = 0) => EditorState.create({
  doc, selection: { anchor: sel },
  // 本仓 lang-markdown@6.5.2 没有 gfmLanguage 导出（拿到 undefined 会静默退到 CommonMark、
  // TaskMarker 永不解析）——用导出的 markdownLanguage（GFM+）。
  // nameStates 须注册进 state，setNameStates effect 才会落（死链用例依赖）
  extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] }), nameStates],
});
const ctx = { mode: 'edit', dark: false, batch: { get: async () => '<p><span class="katex">K</span></p>' }, io: {}, degrade: false };

// CM6 RangeSet.iter() 不收回调（返回 RangeCursor：value/from/to + next()），与 deco-blocks 测试同协议；
// 第三元拼上 attributes JSON，双链 target / dead / data-href 断言才有得查
const of = (d, cls) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value.spec; if (v.class?.includes(cls) || v.attributes?.['data-target']) out.push([i.from, i.to, (v.class ?? '') + ' ' + JSON.stringify(v.attributes ?? {})]); } return out; };
const widgets = (d, C) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.widget?.constructor.name === C) out.push([i.from, i.to]); } return out; };

test('光标远离：标记隐藏、图片/公式成 widget、双链带 target、任务框成勾选框', () => {
  const doc = '**粗** *斜* `码` [字](u) ![图](asset/x.png) $x^2$ [[目标|别名]]\n- [ ] 任务\n';
  const d2 = buildDeco(st(doc, doc.length), ctx);   // 光标放文档末尾：全部标记隐藏/替换
  assert.ok(of(d2, 'hidden').length >= 5, '标记字符隐藏');           // ** * ` 等至少五处
  assert.deepEqual(widgets(d2, 'ImageWidget'), [[21, 38]]);
  assert.deepEqual(widgets(d2, 'MathWidget'), [[39, 44]]);
  assert.deepEqual(widgets(d2, 'TaskWidget').length, 1);
  const wl = of(d2, 'wikilink');
  assert.equal(wl.length, 1);
  assert.ok(String(wl[0][2]).includes('目标'));
});

test('光标进入：标记露出（.meta 不隐藏）、图片/公式回源码', () => {
  const doc = '前文 ![图](asset/x.png) 后文';
  const d = buildDeco(st(doc, 5), ctx);   // 5 落在 ![...] 区间内
  assert.equal(widgets(d, 'ImageWidget').length, 0);
  const d2 = buildDeco(st(doc, 0), ctx);
  assert.equal(widgets(d2, 'ImageWidget').length, 1);
});

test('分隔线整行替换', () => {
  const d = buildDeco(st('a\n\n---\n\nb'), ctx);
  assert.deepEqual(widgets(d, 'HrWidget'), [[3, 6]]);
});

test('有序列表编号不隐藏（常显），无序圆点隐藏', () => {
  const doc = '1. 第一\n2. 第二\n- 无序\n';
  const d = buildDeco(st(doc, doc.length), ctx);
  assert.ok(of(d, 'hidden').length >= 1, '「- 」的 ListMark 隐藏');
  assert.equal(of(d, 'num').length, 2, '「1. 」「2. 」常显');
});

test('死链态：resolveNames 结果经 StateField 落到装饰（dead 类 + title 原因）', () => {
  const doc = '见 [[不存在]] 与 [[存在]]\n';
  // 光标放 0：放 doc 末尾时尾 wiki 的 to+1 兜住光标（near 语义），第二个双链会回源码无装饰
  const state = st(doc, 0).update({ effects: setNameStates.of({ 不存在: { id: null, dead: '库里也不存在' }, 存在: { id: 'a/b' } }) }).state;
  const d = buildDeco(state, ctx);
  const wl = of(d, 'wikilink');
  assert.equal(wl.length, 2);
  assert.ok(String(wl[0][2]).includes('dead'), '死链标红划线');
});

test('md 链接：URL/括号隐藏，绝对地址挂 data-href（⌘点击用）', () => {
  const doc = '看 [文档](https://a.b/c) 完\n';
  const d = buildDeco(st(doc, doc.length), ctx);
  assert.ok(of(d, 'hidden').length >= 2, '( ) 与 URL 隐藏');
  const link = of(d, 'wikilink').find(([, , c]) => String(c).includes('data-href'));
  assert.ok(link, '文本区间挂 data-href');
  assert.ok(String(link[2]).includes('https://a.b/c'));
});

// [[页#节]]：# 先于 | 拆（对齐服务端 render.ts rewriteAnchor）——resolveNames/染色拿裸页名，
// 锚点单独随装饰下发（⌘点击 EditRef 用）。空锚（[[页#]]）与纯名视同无锚
test('双链锚点：[[页#节]] 按裸名解析不误染死链；锚点经 data-anchor 下发；纯名/空锚不带锚', () => {
  const doc = '见 [[目标页#小节]] 与 [[目标页]] 与 [[目标页#]]\n';
  const state = st(doc, 0).update({ effects: setNameStates.of({ 目标页: { id: 'a/b' } }) }).state;
  const d = buildDeco(state, ctx);
  const wl = of(d, 'wikilink');
  assert.equal(wl.length, 3);
  for (const w of wl) assert.ok(!String(w[2]).includes('dead'), '按裸名解析到 → 活链着色');
  assert.ok(String(wl[0][2]).includes('"data-target":"目标页"'), 'data-target 是裸页名（不含 #锚）');
  assert.ok(String(wl[0][2]).includes('"data-anchor":"小节"'), '锚点随装饰下发');
  assert.ok(!String(wl[1][2]).includes('data-anchor'), '纯名不带锚');
  assert.ok(!String(wl[2][2]).includes('data-anchor'), '空锚 [[页#]] 视同无锚');
});

test('双链锚点带别名：[[页#节|别名]] 同拆（# 先于 |，别名不进锚）', () => {
  const doc = '见 [[目标页#小节|显示名]]\n';
  const state = st(doc, 0).update({ effects: setNameStates.of({ 目标页: { id: 'a/b' } }) }).state;
  const d = buildDeco(state, ctx);
  const wl = of(d, 'wikilink');
  assert.equal(wl.length, 1);
  assert.ok(!String(wl[0][2]).includes('dead'), '别名写法同样按裸名活链');
  assert.ok(String(wl[0][2]).includes('"data-target":"目标页"'));
  assert.ok(String(wl[0][2]).includes('"data-anchor":"小节"'), '锚点取 | 前一段');
});

// 回归钉：fm 守卫曾用 node.from < fm.to 在 Document 根节点直接 false，整棵树行内装饰被吞
// （线上所有带 frontmatter 的页面双链/隐藏标记/图片公式全部失效）。
// 正确语义是「完全落座于 fm 内才跳过」——Document/正文段落 from<to 跨界必须继续进入
test('frontmatter 文档：行内装饰不被 fm 守卫整树吞掉，属性默认隐藏', () => {
  const doc = '---\ntitle: 甲\n---\n\n见 [[目标页]] 与 **粗**。\n';
  const d = buildDeco(st(doc, doc.length), ctx);
  assert.equal(of(d, 'wikilink').length, 1, 'fm 之后的双链照常染色挂 target');
  assert.ok(of(d, 'hidden').length >= 1, '** 标记照常隐藏');
  assert.equal(widgets(d, 'FrontmatterWidget').length, 0, '不再在正文内渲染属性折叠条');
  assert.ok(widgets(d, 'HrWidget').length === 0, 'fm 内部 HR 不另渲染分隔线');
});

// Typora 式双链显示形态：[[ ]] 与「目标|」前缀隐藏，只显显示名标蓝（点击语义挂显示名区间）
test('双链显示形态：括号/别名前缀隐藏，显示区间只含显示名；无别名时显示页名', () => {
  const doc = '见 [[目标页|别名]] 与 [[目标页]]\n';
  const state = st(doc, 0).update({ effects: setNameStates.of({ 目标页: { id: 'a/b' } }) }).state;
  const d = buildDeco(state, ctx);
  const wl = of(d, 'wikilink');
  assert.equal(wl.length, 2);
  assert.equal(doc.slice(wl[0][0], wl[0][1]), '别名', '带别名：显示区间是别名');
  assert.equal(doc.slice(wl[1][0], wl[1][1]), '目标页', '无别名：显示区间是页名');
  const hid = of(d, 'hidden').map(([f, t]) => doc.slice(f, t));
  assert.ok(hid.includes('[[目标页|'), '「[[」+ 目标名 +「|」整段隐藏');
  assert.ok(hid.includes(']]'), '「]]」隐藏');
});

test('frontmatter 由标题按钮状态控制：默认隐藏，展开时显示全部属性行', () => {
  const doc = '---\ntitle: 甲\n---\n\n正文\n';
  assert.equal(of(buildDeco(st(doc, doc.length), ctx), 'fmLine').length, 0, '默认收起');
  const expanded = buildDeco(st(doc, doc.length), { ...ctx, frontmatterVisible: true });
  assert.equal(of(expanded, 'fmLine').length, 3, '展开后显示围栏和属性内容');
});

// CM6 把标题渲染成 div.cm-line，article 的元素选择器够不着——标题层级必须走行级 class
// data-h 是块间距 CSS 的稳定标记（标题上方空行压零高靠 :has(+ [data-h])，class 名哈希进不了选择器）
test('标题行级 class：h1–h4 各就位，h5/h6 收敛到 h4（视觉降级约定）；行挂 data-h', () => {
  const doc = '# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n';
  const d = buildDeco(st(doc, 0), ctx);
  for (let i = 1; i <= 3; i++) assert.equal(of(d, 'h' + i).length, 1, `h${i} 恰一处`);
  assert.equal(of(d, 'h4').length, 2, '#### 一处 + ##### 收敛为 h4');
  assert.equal(of(d, 'h5').length, 0, '不存在 h5 class');
  const hs = of(d, 'h2');
  assert.ok(String(hs[0][2]).includes('"data-h"'), '标题行下发 data-h（空行折叠选择器用）');
});

test('ATX 标题展示态把 # 后分隔空格一并隐藏，正文从行首对齐', () => {
  const doc = '## 标题\n正文\n';
  const d = buildDeco(st(doc, doc.length), ctx);
  const hidden = of(d, 'hidden').map(([from, to]) => doc.slice(from, to));
  assert.ok(hidden.includes('## '), '标题开头的井号与分隔空格属于同一隐藏区间');
});

// 内容强调常显（Typora 式：光标进了也保持加粗/斜体，只有标记符露出/隐藏）
test('内容强调 class：strong/em/del/code 挂在标记符之间的正文区间', () => {
  const doc = '**粗** *斜* ~~删~~ `码`\n';
  const d = buildDeco(st(doc, 0), ctx);   // 光标在行首也应有内容 class（常显，不随 near 变）
  for (const cls of ['strong', 'em', 'del', 'code']) assert.equal(of(d, cls).length, 1, cls);
  const sg = of(d, 'strong')[0];
  assert.equal(doc.slice(sg[0], sg[1]), '粗', 'strong 区间是正文不含 **');
});

test('无序列表行级 bullet class：标记隐藏时行头补圆点；光标进标记则裸源码不补', () => {
  const doc = '- 甲\n- 乙\n';
  assert.equal(of(buildDeco(st(doc, doc.length), ctx), 'bullet').length, 2, '远端光标：两行都补 bullet');
  // 光标在项文字首（= ListMark 的 to）：near 放宽一格取消后的新语义——标记仍隐藏、bullet 照补
  assert.equal(of(buildDeco(st(doc, 2), ctx), 'bullet').length, 2, '光标在项文字首：bullet 照补（+1 放宽已取消）');
  assert.equal(of(buildDeco(st(doc, 1), ctx), 'bullet').length, 1, '光标在标记内：裸源码不补，次项照补');
});

test('引用行级 quote class：> 隐藏时整行挂 quote', () => {
  const doc = '> 引句\n后文\n';
  assert.equal(of(buildDeco(st(doc, doc.length), ctx), 'quote').length, 1);
});

test('⌘点击与阅读态裸点击 [[页#节]]：EditRef 拿裸名 + anchor（surface mousedown/click → io.open）', () => {
  const opened = [];
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: { renderBlocks: async (s) => s.map(() => ''), open: (r) => opened.push(r) }, mode: 'read', dark: false });
  sf.setText('见 [[目标页#小节]] 与 [[目标页#小节|别名]]\n');
  const els = host.querySelectorAll('[data-target]');
  assert.equal(els.length, 2, '两个双链都挂 data-target（且只挂在显示名区间上）');
  for (const el of els) el.dispatchEvent(new MouseEvent('mousedown', { metaKey: true, bubbles: true }));
  els[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 阅读态：裸点击即进，不再要 ⌘
  assert.deepEqual(opened, [
    { kind: 'wikilink', name: '目标页', anchor: '小节' },
    { kind: 'wikilink', name: '目标页', anchor: '小节' },
    { kind: 'wikilink', name: '目标页', anchor: '小节' },
  ], 'EditRef 携带锚点（宿主 open 已按 slug(anchor) 消费）');
  sf.destroy();
  host.remove();
});

test('阅读态内部选区落进双链仍保持展示态，随后 click 可跳转', () => {
  const opened = [];
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, {
    io: { renderBlocks: async (s) => s.map(() => ''), open: (r) => opened.push(r) },
    mode: 'read', dark: false,
  });
  sf.setText('前 [[目标页]] 后\n');
  sf.view.dispatch({ selection: { anchor: 5 } });
  const link = host.querySelector('[data-target="目标页"]');
  assert.ok(link, '阅读态选区进入双链后 data-target 仍在');
  assert.equal(link.textContent, '目标页', '展示名节点保持可点');
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, [{ kind: 'wikilink', name: '目标页', anchor: undefined }]);
  sf.destroy();
  host.remove();
});

test('阅读态链接不受页面残留选区影响；服务端块 data-wiki-id 也走页跳转', async () => {
  const opened = [];
  const outside = document.createElement('div'); outside.textContent = '宿主里的残留选区'; document.body.append(outside);
  const range = document.createRange(); range.selectNodeContents(outside); document.getSelection().removeAllRanges(); document.getSelection().addRange(range);
  const host = document.createElement('div'); document.body.append(host);
  const sf = createSurface(host, {
    io: {
      renderBlocks: async (srcs) => srcs.map((src) => src === '[[块内页]]' ? '<p><a href="#" data-wiki-id="resolved/page" data-anchor="section">块内页</a></p>' : `<p>${src}</p>`),
      open: (ref) => opened.push(ref),
    },
    mode: 'read', dark: false,
  });
  sf.setText('[[正文页]]\n\n| 链接 |\n| --- |\n| [[块内页]] |\n');
  host.querySelector('[data-target]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  host.querySelector('[data-wiki-id]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, [
    { kind: 'wikilink', name: '正文页', anchor: undefined },
    { kind: 'page', id: 'resolved/page', anchor: 'section' },
  ]);
  sf.destroy(); host.remove(); outside.remove(); document.getSelection().removeAllRanges();
});

test('surface 属性显隐受控：默认收起，展开可编辑，再次收起移出属性选区', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const sf = createSurface(host, { io: { renderBlocks: async (s) => s.map(() => '') }, mode: 'edit', dark: false });
  sf.setText('---\ntitle: 甲\n---\n\n正文\n');
  assert.ok(!host.textContent.includes('title: 甲'), '默认不显示属性源码');
  sf.setFrontmatterVisible(true);
  assert.ok(host.textContent.includes('title: 甲'), '展开后显示属性源码');
  sf.view.dispatch({ selection: { anchor: sf.view.state.doc.line(2).to } });
  sf.setFrontmatterVisible(false);
  assert.ok(!host.textContent.includes('title: 甲'), '再次收起属性源码');
  assert.ok(sf.view.state.selection.main.head > 17, '收起时光标移出被隐藏区间');
  sf.destroy();
  host.remove();
});

test('右键双链 / 块内页链 → io.menu(ref, 坐标)，返回 true 才拦浏览器菜单；外链与普通文字不调', async () => {
  const calls = [];
  let take = true;
  const host = document.createElement('div'); document.body.append(host);
  const sf = createSurface(host, {
    io: {
      renderBlocks: async (srcs) => srcs.map((src) => src === '[[块内页]]' ? '<p><a href="#" data-wiki-id="resolved/page">块内页</a></p>' : `<p>${src}</p>`),
      menu: (ref, at) => { calls.push({ ref, at }); return take },
    },
    mode: 'read', dark: false,
  });
  sf.setText('见 [[目标页#小节]] 与 https://example.com 普通字\n\n| 链接 |\n| --- |\n| [[块内页]] |\n');
  const rc = (el) => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 7, clientY: 9 }); el.dispatchEvent(ev); return ev };
  const ev1 = rc(host.querySelector('[data-target]'));
  assert.equal(ev1.defaultPrevented, true);
  assert.deepEqual(calls[0], { ref: { kind: 'wikilink', name: '目标页', anchor: '小节' }, at: { x: 7, y: 9 } });
  await new Promise((r) => setTimeout(r, 40));
  rc(host.querySelector('[data-wiki-id]'));
  assert.deepEqual(calls[1].ref, { kind: 'page', id: 'resolved/page', anchor: undefined });
  const plain = rc(host.querySelector('.cm-line'));
  assert.equal(plain.defaultPrevented, false, '普通文字不拦');
  assert.equal(calls.length, 2);
  take = false;
  const ev3 = rc(host.querySelector('[data-target]'));
  assert.equal(ev3.defaultPrevented, false, '宿主不接管就保留浏览器菜单');
  sf.destroy(); host.remove();
});

test('编辑态右键双链同样回调 io.menu（右键前光标没把双链展开）', () => {
  const calls = [];
  const host = document.createElement('div'); document.body.append(host);
  const sf = createSurface(host, { io: { renderBlocks: async (s) => s.map(() => ''), menu: (ref) => { calls.push(ref); return true } }, mode: 'edit', dark: false });
  sf.setText('前文\n\n见 [[目标页]]\n');
  sf.view.dispatch({ selection: { anchor: 0 } });   // 光标在别处：双链处于展示态
  const link = host.querySelector('[data-target]');
  assert.ok(link, '展示态有 data-target');
  link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [{ kind: 'wikilink', name: '目标页', anchor: undefined }]);
  sf.destroy(); host.remove();
});

test('双链路径形式：无别名时只显最后一段，有别名显别名；data-target 是整条路径', () => {
  const doc = '见 [[工作/订单/项目树]] 与 [[工作/订单/项目树#里程碑]] 与 [[工作/订单/项目树|计划]]\n';
  const d = buildDeco(st(doc, 0), ctx);   // 光标放行首：末尾紧挨最后一条链会按「光标进链」露源码
  const wl = of(d, 'wikilink');
  assert.equal(wl.length, 3);
  assert.equal(doc.slice(wl[0][0], wl[0][1]), '项目树');
  assert.equal(doc.slice(wl[1][0], wl[1][1]), '项目树#里程碑');
  assert.equal(doc.slice(wl[2][0], wl[2][1]), '计划');
  assert.ok(String(wl[0][2]).includes('"data-target":"工作/订单/项目树"'));
});
