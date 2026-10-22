// test/editor-css-blank.test.js
// 契约：标题与正文之间那行 Markdown 空行不承担任何可命中高度（line-height 0），
// 段后距由标题自身的 padding-bottom 补偿——否则鼠标点缝隙最左会命中空行，
// 原生 caret 刃（字号 strut 高）骑在零点几倍行高的空行上，视觉悬浮在缝中间。
// 纯 CSS 契约，jsdom 量不出渲染高度，按规则文本钉住。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/editor/editor.module.css'), 'utf8');
// 该文件无嵌套花括号：定位选择器首次出现处，取到下一个 }
const ruleOf = (sel) => {
  const i = css.indexOf(sel);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

test('标题后的空行压零高：缝隙完全由标题 padding 承担，鼠标命中跳过空行', () => {
  const rule = ruleOf('.docView [data-h] + :global(.cm-line):has(> br:only-child):not(:global(.cm-activeLine))');
  assert.ok(rule, '规则存在');
  assert.match(rule, /line-height:\s*0/);
});

test('标题 padding-bottom 含空行让出的补偿量（+6px）', () => {
  for (const h of ['h1', 'h2', 'h3', 'h4']) {
    const rule = ruleOf(`.docView :global(.cm-line).${h} `);
    assert.ok(rule, `${h} 规则存在`);
    assert.match(rule, /padding-bottom:\s*calc\([^)]*\+\s*6px\)/, `${h} padding-bottom 应为 calc(原值 + 6px)`);
  }
});
