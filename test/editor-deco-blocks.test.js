// test/editor-deco-blocks.test.js
// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco } from '../src/editor/kernel/deco.ts';
import { registerServerKinds } from '../src/editor/blocks/server.ts';
import { registerViewerKinds } from '../src/editor/blocks/mermaid.ts';

registerServerKinds();
registerViewerKinds();
const st = (doc, sel = 0) => EditorState.create({
  doc,
  selection: { anchor: sel },
  // lang-markdown@6.5.2 无 gfmLanguage 导出（undefined 会静默退 CommonMark）——用导出的 markdownLanguage，与 deco-inline 测试同配置
  extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] })],
});
const ctx = { mode: 'edit', dark: false, batch: { get: async () => '<p>x</p>' }, io: {}, degrade: false };
// CM6 RangeSet.iter() 不收回调（返回迭代器），断言语义与计划一致：按序收集区间/类名
const widgetsAt = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.widget) out.push([i.from, i.to, v.spec.widget.constructor.name]); } return out; };
const bareBlocksAt = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.block && !v.spec.widget) out.push([i.from, i.to]); } return out; };
const lineIds = (d) => { const out = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value; if (v.spec.attributes?.id) out.push([i.from, v.spec.attributes.id]); } return out; };

test('编辑态：frontmatter 默认隐藏 + 代码块整块替换为 widget', () => {
  const doc = '---\ntitle: 甲\n---\n\n# 标题\n\n```js\nlet a = 1\n```\n';
  const d = buildDeco(st(doc, 0), ctx);          // 光标在文档头，代码块不在 near 范围
  const ws = widgetsAt(d);
  assert.deepEqual(bareBlocksAt(d), [[0, 17]], '默认用无内容块隐藏属性');
  assert.deepEqual(ws, [[24, 43, 'BlockWidget']]);
});

test('阅读态对齐 renderPage：frontmatter 与首个 h1 整行隐藏，slug 计数仍消费', () => {
  const doc = '---\ntitle: 甲\n---\n\n# 主标题\n\n## 主标题\n';
  const d = buildDeco(st(doc, doc.length), { ...ctx, mode: 'read' });
  const ws = widgetsAt(d);
  assert.deepEqual(bareBlocksAt(d), [[0, 17]], 'frontmatter 阅读态默认隐藏');
  assert.deepEqual(ws.filter((x) => x[2] === 'HideWidget').map((x) => [x[0], x[1]]), [[18, 24]], '首个 h1 连行尾换行一起隐藏（h1Done 对齐）');
  assert.deepEqual(lineIds(d), [[18, '主标题'], [25, '主标题-1']], '隐藏行仍占 slug，重复计数与服务端一致');
});

test('编辑态光标所在块不替换（留源码可编辑）', () => {
  const doc = '```js\nlet a = 1\n```\n';
  const inside = buildDeco(st(doc, 8), ctx);
  assert.equal(widgetsAt(inside).length, 0);
  const outside = buildDeco(st(doc, 0), ctx);
  assert.equal(widgetsAt(outside).length, 1);
});

test('长文档首屏解析边界后的 Mermaid 仍生成块组件', () => {
  const prefix = ('普通正文用于越过初始解析窗口。\n\n').repeat(180);
  const fence = '```mermaid\nflowchart LR\nA --> B\n```';
  const doc = prefix + fence + '\n\n尾段';
  const state = st(doc, doc.length);
  assert.ok(syntaxTree(state).length < doc.length, '语料确实超出 CodeMirror 初始语法树');

  const ws = widgetsAt(buildDeco(state, { ...ctx, mode: 'read' }));
  assert.ok(ws.some(([from, to]) => from === prefix.length && to === prefix.length + fence.length), '后半段 Mermaid 被块组件接管');
});

test('标题行挂锚点 id（github-slugger 同规则）', () => {
  const d = buildDeco(st('## 你好 世界\n\n正文'), { ...ctx, mode: 'read' });
  assert.deepEqual(lineIds(d), [[0, '你好-世界']]);
  const closing = buildDeco(st('## 你好 ##\n\n正文'), { ...ctx, mode: 'read' });
  assert.deepEqual(lineIds(closing), [[0, '你好']], 'ATX 闭合序列剥掉，与服务端 remark 同 slug');
  const setext = buildDeco(st('标题 #\n===\n\n正文'), { ...ctx, mode: 'read' });
  assert.deepEqual(lineIds(setext), [[0, '标题-']], 'Setext 正文里尾 # 是字面内容不剥（服务端 slug 同为「标题-」）');
});

test('frontmatter 缺闭合不吞正文', () => {
  const doc = '---\ntitle: 甲\n没有闭合\n\n# T';
  // 缺闭合时不应产生 frontmatter 隐藏块。
  const edit = widgetsAt(buildDeco(st(doc), ctx));
  assert.deepEqual(edit.filter(([, , c]) => c === 'FrontmatterWidget'), [], '缺闭合 → 不产出 frontmatter widget');
  // read 态：# T 本身是首个 h1，合法地有一个 HideWidget [19,22]（对齐 renderPage）。
  // T5 行内 live preview 起行内装饰后，缺闭合时首行 --- 在 lezer 眼里是 HorizontalRule、
  // 服务端（DocStore 只剥闭合 fm）也渲染 <hr>——HrWidget [0,3] 是与服务端一致的正确显示，
  // 不算 fm 吞正文（吞了会出现盖住 [0,19) 的块替换，HideWidget [19,22] 不复存在）
  const read = widgetsAt(buildDeco(st(doc, doc.length), { ...ctx, mode: 'read' }));
  assert.deepEqual(read, [[0, 3, 'HrWidget'], [19, 22, 'HideWidget']], '缺闭合 --- 按服务端 <hr> 显示 + 首 h1 隐藏；fm 未吞正文');
});

// 光标进围栏露源码时，源码行仍要像代码块：逐行挂 codeLine，首末行标 data-code-edge 收圆角
test('编辑态围栏露源码：每行挂代码块行样式，首末行标边', () => {
  const doc = '前文\n\n```mermaid\nflowchart BT\nL1 --> L2\n```\n\n后文\n';
  const d = buildDeco(st(doc, doc.indexOf('flowchart')), ctx);
  const lines = []; for (let i = d.iter(); i.value; i.next()) { const v = i.value.spec; if (v.class?.includes('codeLine')) lines.push([doc.slice(i.from, doc.indexOf('\n', i.from)), v.attributes?.['data-code-edge']]); }
  assert.deepEqual(lines, [['```mermaid', 'start'], ['flowchart BT', 'middle'], ['L1 --> L2', 'middle'], ['```', 'end']]);
  const far = buildDeco(st(doc, 0), ctx);
  let n = 0; for (let i = far.iter(); i.value; i.next()) if (i.value.spec.class?.includes('codeLine')) n++;
  assert.equal(n, 0, '光标在块外渲染件照旧，不挂源码行样式');
});
