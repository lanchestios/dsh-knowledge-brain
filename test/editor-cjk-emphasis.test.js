// test/editor-cjk-emphasis.test.js
// 编辑器 lezer 解析与服务端 remark-cjk-friendly 对齐：闭符紧贴全角标点、后接汉字时仍成强调
// （CommonMark 原规则判不成右侧定界，「- **术语：**说明」整段露出星号）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { mathExt, wikilinkExt, cjkEmphasisExt } from '../src/editor/kernel/mdext.ts';

const nodes = (doc) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt, cjkEmphasisExt] })] });
  const out = [];
  ensureSyntaxTree(s, doc.length, 1000).iterate({ enter: (n) => { if (n.name === 'StrongEmphasis' || n.name === 'Emphasis') out.push([n.name, doc.slice(n.from, n.to)]) } });
  return out;
};

test('全角标点贴闭符、后接汉字：成粗体（列表 / 段落 / 有序）', () => {
  assert.deepEqual(nodes('- **术语：**说明\n'), [['StrongEmphasis', '**术语：**']]);
  assert.deepEqual(nodes('段落**组合支付是三种子单组总单。**普通支付单\n'), [['StrongEmphasis', '**组合支付是三种子单组总单。**']]);
  assert.deepEqual(nodes('1. 「**结论。**」后文\n'), [['StrongEmphasis', '**结论。**']]);
  assert.deepEqual(nodes('前文*斜体，*后文\n'), [['Emphasis', '*斜体，*']]);
});

test('开符前是汉字、后接全角标点：成粗体', () => {
  assert.deepEqual(nodes('见**「引号」**里\n'), [['StrongEmphasis', '**「引号」**']]);
});

test('原有 CommonMark 行为不变', () => {
  assert.deepEqual(nodes('- **粗** 尾\n'), [['StrongEmphasis', '**粗**']]);
  assert.deepEqual(nodes('a **b** c *d*\n'), [['StrongEmphasis', '**b**'], ['Emphasis', '*d*']]);
  assert.deepEqual(nodes('a ** b **\n'), []);
  assert.deepEqual(nodes('snake_case_name\n'), []);
  assert.deepEqual(nodes('**a**b\n'), [['StrongEmphasis', '**a**']]);
});
