// .folder.json / .wiki/wiki.json 的读取（loadFolders / loadParts）：按 order 排、读得宽——
// 写坏的层照默认规则（只记日志）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFolders, loadParts } from '../src/core/vault/vault.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'folder-conf-'));
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
};
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn() } finally { console.warn = w } };

test('loadFolders：index 与按 order 排好的 children；写坏的层跳过', () => {
  const dir = tmp();
  try {
    put(dir, '知识/ML/.folder.json', { index: '概览', children: {
      b: { type: 'file', ext: 'md', order: 2 }, c: { type: 'folder', ext: 'folder', order: 10 }, a: { type: 'file', ext: 'md', order: 1 } } });
    put(dir, '知识/坏/.folder.json', '{"index": "坏",}');
    put(dir, '知识/.folder.json', { index: '知识', children: {} });
    const f = quiet(() => loadFolders(dir, ['知识']));
    assert.deepEqual(f.get('知识/ML'), { index: '概览', order: ['a', 'b', 'c'] });
    assert.deepEqual(f.get('知识'), { index: '知识', order: [] });
    assert.equal(f.has('知识/坏'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
});

test('loadParts：wiki.json 的 parts 按 order；没有或写坏 → fallback', () => {
  const dir = tmp();
  try {
    assert.deepEqual(loadParts(dir, ['默认']), ['默认']);
    put(dir, '.wiki/wiki.json', { version: 3, parts: { 工作: { order: 2 }, 知识: { order: 1 } } });
    assert.deepEqual(loadParts(dir, ['默认']), ['知识', '工作']);
    put(dir, '.wiki/wiki.json', '{坏');
    assert.deepEqual(quiet(() => loadParts(dir, ['默认'])), ['默认']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
});
