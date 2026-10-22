// test/editor-eol.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { detectEol, toLf, applyEol } from '../src/editor/eol.ts';

test('探测与往返：CRLF/RN/LF 三态探测，LF→原 EOL 还原逐字节一致', () => {
  const crlf = '---\r\ntitle: 甲\r\n---\r\n正文\r\n';
  assert.equal(detectEol(crlf), '\r\n');
  const lf = toLf(crlf);
  assert.equal(lf, '---\ntitle: 甲\n---\n正文\n');
  assert.equal(applyEol(lf, '\r\n'), crlf);
  assert.equal(detectEol('a\nb'), '\n');
  assert.equal(detectEol('a\rb'), '\r');
  assert.equal(applyEol('a\nb', '\r'), 'a\rb');
});

test('无 CR 文本直通（不新建字符串路径也要对）', () => {
  const t = '纯 LF 文本\n第二行';
  assert.equal(toLf(t), t);
  assert.equal(applyEol(t, '\n'), t);
});
