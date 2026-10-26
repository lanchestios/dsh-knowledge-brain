import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawNames } from '../src/core/vault/vault.ts';
import { buildModel } from '../src/core/model.ts';
import { rawTree, readRaw } from '../src/core/raw.ts';

// raw/project 是外部克隆（CLI 的 SCOPE_EXCLUDE 不管它）：名字不算素材名（死链判定），
// 也不进知识探索的素材树。真实库里这一棵 5000+ 目录，全量扫一遍 400ms+ 卡住事件循环，
// 树 JSON 几 MB 还要 React 整树重渲染。

const tmpVault = (build) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-raw-')); build(dir); return dir; };
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

const buildRaw = (d) => {
  fs.mkdirSync(path.join(d, 'raw', 'document', '2026-09-30'), { recursive: true });
  fs.writeFileSync(path.join(d, 'raw', 'document', '2026-09-30', '纪要.md'), 'x');
  fs.mkdirSync(path.join(d, 'raw', 'book', '《书》'), { recursive: true });
  fs.writeFileSync(path.join(d, 'raw', 'book', '《书》', '第一章.md'), 'x');
  fs.mkdirSync(path.join(d, 'raw', 'project', 'univer', 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'raw', 'project', 'univer', 'README.md'), 'x');
  fs.writeFileSync(path.join(d, 'raw', 'project', 'univer', 'src', 'a.ts'), 'x');
};

test('rawNames：document / book 的名字进集合，raw/project 整棵不扫不算', () => {
  const dir = tmpVault(buildRaw);
  try {
    const names = rawNames(dir);
    assert.ok(names.has('纪要'));
    assert.ok(names.has('《书》'));
    assert.ok(!names.has('univer'));
    assert.ok(!names.has('README'));
    assert.ok(!names.has('src'));
  } finally { rm(dir) }
});

test('rawTree：素材树列 book / document，project 不进树；listen 残留不进树', () => {
  const dir = tmpVault(buildRaw);
  try {
    const tops = rawTree(dir).children;
    assert.deepEqual(tops.map((n) => n.name).sort(), ['book', 'document']);
    // listen 根已随耳闻撤除：即使磁盘上残留 raw/listen 目录也不进树
    fs.mkdirSync(path.join(dir, 'raw', 'listen', '2026-10-04'), { recursive: true });
    assert.ok(!rawTree(dir).children.map((n) => n.name).includes('listen'));
  } finally { rm(dir) }
});

test('readRaw：material_status 面已随耳闻撤除——一律不返回；名字一律是文件名，不读 frontmatter title', async () => {
  const dir = tmpVault((d) => {
    fs.mkdirSync(path.join(d, 'raw', 'document', '2026-10-06'), { recursive: true });
    fs.writeFileSync(path.join(d, 'raw', 'document', '2026-10-06', '文档.md'), '---\ntitle: 文档\nmaterial_status: done\n---\n\n# 文档\n\n正文');
  });
  try {
    const model = buildModel(dir);
    const document = await readRaw(model, 'raw/document/2026-10-06/文档.md');
    assert.equal(document.ok && document.raw.name, '文档');
    assert.equal(document.ok && document.raw.materialStatus, undefined, 'material_status 不再读出');
  } finally { rm(dir) }
});

test('素材树：书目录的同名 md 归位成目录自己；日期目录里的同名 md 不归位', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-rawtree-'));
  try {
    fs.mkdirSync(path.join(d, 'raw', 'book', '《书》', '章节'), { recursive: true });
    fs.writeFileSync(path.join(d, 'raw', 'book', '《书》', '《书》.md'), '# 书');
    fs.writeFileSync(path.join(d, 'raw', 'book', '《书》', '章节', 'ch01.md'), 'x');
    fs.mkdirSync(path.join(d, 'raw', 'document', '2026-10-01'), { recursive: true });
    fs.writeFileSync(path.join(d, 'raw', 'document', '2026-10-01', '2026-10-01.md'), 'x');
    const t = rawTree(d);
    const book = t.children.find((n) => n.name === 'book').children.find((n) => n.name === '《书》');
    assert.equal(book.path, 'raw/book/《书》/《书》.md');
    assert.ok(!book.children.some((k) => k.path === 'raw/book/《书》/《书》.md'), '书页不再作为子项列出');
    const day = t.children.find((n) => n.name === 'document').children.find((n) => n.name === '2026-10-01');
    assert.equal(day.path, null);
    assert.ok(day.children.some((k) => k.path === 'raw/document/2026-10-01/2026-10-01.md'));
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
});

test('素材树：文章文件夹的同名 md 归位成文件夹自己，images 不列', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-rawtree-'));
  try {
    fs.mkdirSync(path.join(d, 'raw', 'document', '2026-10-24', '文章甲', 'images'), { recursive: true });
    fs.writeFileSync(path.join(d, 'raw', 'document', '2026-10-24', '文章甲', '文章甲.md'), '# 文章甲\n\n![](images/01.png)');
    fs.writeFileSync(path.join(d, 'raw', 'document', '2026-10-24', '文章甲', 'images', '01.png'), 'png');
    const t = rawTree(d);
    const folder = t.children.find((n) => n.name === 'document')
      .children.find((n) => n.name === '2026-10-24')
      .children.find((n) => n.name === '文章甲');
    assert.equal(folder.path, 'raw/document/2026-10-24/文章甲/文章甲.md');
    assert.deepEqual(folder.children, [], '归位后 md 不再作为子项，图片本来就不列');
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
});
