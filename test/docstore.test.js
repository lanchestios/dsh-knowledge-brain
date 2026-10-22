// test/docstore.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DocStore, embedsOfDoc } from '../src/core/vault/docstore.ts';

const tmpVault = (build) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-store-')); build?.(dir); return dir; };
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('get：缓存命中零读盘，mtime/size 变了自动失效', () => {
  const dir = tmpVault((d) => {
    fs.mkdirSync(path.join(d, 'knowledge'));
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\n---\n见 [[B]]。');
  });
  try {
    const st = new DocStore(dir);
    const u1 = st.get('knowledge/A.md');
    assert.equal(u1.doc.title, '甲');
    assert.deepEqual(u1.links.map((l) => l.target), ['B']);
    assert.deepEqual(u1.embeds, []);
    assert.equal(st.get('knowledge/A.md'), u1);                    // 同引用 = 缓存命中
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: 乙\n---\n见 [[C]]。');
    const u2 = st.get('knowledge/A.md');
    assert.notEqual(u2, u1); assert.equal(u2.doc.title, '乙');
    assert.equal(st.get('不存在.md'), null);                        // 读失败给 null 不抛
  } finally { rm(dir); }
});

test('bulk：清掉消失页的缓存，留下的共享引用；offline 占位不抽链接', () => {
  const dir = tmpVault((d) => {
    fs.mkdirSync(path.join(d, 'knowledge', 'X'), { recursive: true });
    fs.writeFileSync(path.join(d, 'knowledge/X/A.md'), '正文');
    fs.writeFileSync(path.join(d, 'knowledge/X/B.md'), '正文');
  });
  try {
    const st = new DocStore(dir);
    st.get('knowledge/X/B.md');
    fs.unlinkSync(path.join(dir, 'knowledge/X/B.md'));
    const docs = st.bulk(['knowledge']);
    assert.deepEqual(docs.map((x) => x._id), ['knowledge/X/A.md']);
    assert.equal(st.get('knowledge/X/A.md').doc, docs[0]);          // 共享引用
    assert.equal(st.get('knowledge/X/B.md'), null);                 // 消失页缓存已清
  } finally { rm(dir); }
});

test('embedsOfDoc：asset/raw 引用（根写法与相对写法）都列上，允许过失效', () => {
  const md = '图 ![](asset/img/a.png) 与 [附件](raw/document/x.md)，相对 ![](images/b.png) 与 [外](https://x.y/z)。';
  assert.deepEqual(embedsOfDoc('knowledge/ML/A.md', md).sort(),
    ['asset/img/a.png', 'knowledge/ML/images/b.png', 'raw/document/x.md'].sort());
});

import { buildModel } from '../src/core/model.ts';

test('buildModel 吃解析仓：byId 与 store 共享引用，图字段与无 store 版一致', () => {
  const dir = tmpVault((d) => {
    fs.mkdirSync(path.join(d, '.wiki'));
    fs.writeFileSync(path.join(d, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "knowledge": { "order": 1 } } }');
    fs.mkdirSync(path.join(d, 'knowledge'));
    fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n见 [[B]]。');
    fs.writeFileSync(path.join(d, 'knowledge/B.md'), '回 [[甲]]。');
  });
  try {
    const st = new DocStore(dir);
    st.get('knowledge/A.md'); st.get('knowledge/B.md');           // 预热
    const m = buildModel(dir, st);
    assert.equal(m.byId.get('knowledge/A.md'), st.get('knowledge/A.md').doc);   // 共享引用
    assert.ok(m.embedOf.get('knowledge/A.md') instanceof Array);
    const plain = buildModel(dir);
    assert.deepEqual(plain.g.order.map((x) => x._id), m.g.order.map((x) => x._id));
    assert.deepEqual([...plain.dead.keys()], [...m.dead.keys()]);
    assert.equal(m.store, st);
  } finally { rm(dir); }
});
