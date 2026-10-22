// test/editor-blocks.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parser, GFM } from '@lezer/markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { blocksOf } from '../src/editor/kernel/blocks.ts';
import { frontmatterRange } from '../src/editor/kernel/frontmatter.ts';

const p = () => parser.configure([GFM, mathExt, wikilinkExt]);
const kinds = (doc) => blocksOf(doc, p().parse(doc)).map((b) => b.kind);

test('非文本块分类：代码/表格/公式块/嵌入/HTML', () => {
  assert.deepEqual(kinds('```js\nlet a=1\n```'), ['code']);
  assert.deepEqual(kinds('| a | b |\n| --- | --- |\n| 1 | 2 |'), ['table']);
  assert.deepEqual(kinds('$$\nE=mc^2\n$$'), ['mathblock']);
  assert.deepEqual(kinds('![](asset/foo.html?h=560)'), ['embed']);   // ?h= 修复点
  assert.deepEqual(kinds('![](asset/foo.html)'), ['embed']);
  assert.deepEqual(kinds('![](asset/foo.HTML)'), ['embed']);
  assert.deepEqual(kinds('<div>\nx\n</div>'), ['html']);
});

test('文本块不进列表：段落/标题/引用/列表/分隔线', () => {
  assert.deepEqual(kinds('# 标题\n\n段落文字\n\n> 引用\n\n- 列表\n\n---'), []);
});

test('未闭合单行围栏（正在敲 ```js）不判 code', () => {
  assert.deepEqual(kinds('```js'), []);
});

test('mermaid / infographic 按围栏语言分派', () => {
  const b = blocksOf('```mermaid\ngraph TD\nA-->B\n```', p().parse('```mermaid\ngraph TD\nA-->B\n```'));
  assert.equal(b[0].kind, 'mermaid');
  assert.deepEqual(kinds('```infographic\n少即是多\n```'), ['infographic']);
});

test('frontmatter：闭合区间含末换行；缺闭合返回 null', () => {
  assert.deepEqual(frontmatterRange('---\ntitle: 甲\n---\n正文'), { from: 0, to: 17 });   // 3+1+8+1+3=16，闭合行行尾换行 +1
  assert.equal(frontmatterRange('---\ntitle: 甲\n没有闭合'), null);
  assert.equal(frontmatterRange('--- 开头不是纯围栏\n---\nx'), null);
});
