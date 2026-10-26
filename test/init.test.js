import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideInit, ensureGit, ensureToolchain, readWikiVersion, setWikiVersion, NOT_A_VAULT } from '../src/core/vault/init.ts';

// 临时目录里搭真实文件系统跑 fs 侧助手，不用 mock
const tmpVault = (build) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-init-'));
  build(dir);
  return dir;
};
const tmpTools = () => tmpVault((d) => {
  fs.mkdirSync(path.join(d, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(d, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(d, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bin', 'wiki'), '#!/usr/bin/env python3\n');
  fs.writeFileSync(path.join(d, 'hooks', 'pre-commit'), '#!/bin/sh\n');
});
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// decideInit(条目名列表, 是否有 .wiki 目录, wiki.json 的 version（读不出为 null), 插件当前版本)
// → { action: 'migrate' | 'open' | 'refuse', reason?: string }
// 没有 .wiki 一律拒绝：建库只走「新建」（wiki init），开库不再自建。

test('没有 .wiki → 拒绝，指去「新建」（空目录、只剩 .git、四区齐全都一样）', () => {
  for (const names of [[], ['.DS_Store'], ['.git'], ['README.md', 'src'], ['认知', '学习', '知识', '工作']]) {
    const r = decideInit(names, false, null, 1)
    assert.equal(r.action, 'refuse', JSON.stringify(names))
    assert.equal(r.reason, NOT_A_VAULT)
  }
});

test('有 .wiki 但 version 缺失 → 拒绝（读不出结构版本，不再猜）', () => {
  const r = decideInit(['认知'], true, null, 1);
  assert.equal(r.action, 'refuse');
  assert.match(r.reason, /version/);
});

test('version 等于当前 → 正常打开', () => {
  assert.deepEqual(decideInit(['认知'], true, 1, 1), { action: 'open' });
});

test('version 比插件新 → 拒绝并说明先升级插件（场景三b）', () => {
  const r = decideInit(['认知'], true, 2, 1);
  assert.equal(r.action, 'refuse');
  assert.match(r.reason, /先升级/);
});

test('version 比插件旧 → 走迁移（给以后版本演进留的槽位）', () => {
  assert.deepEqual(decideInit(['认知'], true, 1, 2), { action: 'migrate' });
});

test('ensureGit：无 .git 时 init 并写起步 .gitignore；已有 .git 则什么都不动', () => {
  const d = tmpVault(() => {});
  try {
    assert.equal(ensureGit(d), null);
    assert.ok(fs.statSync(path.join(d, '.git'), { throwIfNoEntry: false })?.isDirectory());
    assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), '.wiki/bin\nraw/project/\n');
    // 已有 .git（且已有自己的 .gitignore）→ 不 init、不覆盖
    const e = tmpVault((x) => { fs.mkdirSync(path.join(x, '.git')); fs.writeFileSync(path.join(x, '.gitignore'), 'node_modules\n'); });
    try {
      assert.equal(ensureGit(e), null);
      assert.equal(fs.readFileSync(path.join(e, '.gitignore'), 'utf8'), 'node_modules\n');
    } finally { rm(e); }
  } finally { rm(d); }
});

test('ensureToolchain：建 .wiki/bin、skills 与 pre-commit 软链；再跑不动什么；断链重建；真实文件不碰', () => {
  const tools = tmpTools();
  const d = tmpVault((x) => fs.mkdirSync(path.join(x, '.git', 'hooks'), { recursive: true }));
  try {
    const first = ensureToolchain(d, tools);
    assert.deepEqual(first.made.sort(), ['.git/hooks/pre-commit', '.wiki/bin', '.wiki/skills']);
    assert.equal(fs.readlinkSync(path.join(d, '.wiki', 'bin')), path.join(tools, 'bin'));
    const again = ensureToolchain(d, tools);
    assert.deepEqual(again.made, []);
    assert.deepEqual(again.skipped.sort(), ['.git/hooks/pre-commit', '.wiki/bin', '.wiki/skills']);
    // 断链（原目标挪走）→ 指向新工具链重建
    fs.rmSync(tools, { recursive: true });
    const tools2 = tmpTools();
    try {
      const r = ensureToolchain(d, tools2);
      assert.deepEqual(r.made.sort(), ['.git/hooks/pre-commit', '.wiki/bin', '.wiki/skills']);
      // 真实文件占位 → 不碰，只报告
      fs.rmSync(path.join(d, '.wiki', 'bin'));
      fs.writeFileSync(path.join(d, '.wiki', 'bin'), '#!/bin/sh\necho mine\n');
      const r2 = ensureToolchain(d, tools2);
      assert.deepEqual(r2.made, []);
      assert.deepEqual(r2.skipped, ['.wiki/bin', '.wiki/skills', '.git/hooks/pre-commit']);
      assert.equal(fs.readFileSync(path.join(d, '.wiki', 'bin'), 'utf8'), '#!/bin/sh\necho mine\n');
    } finally { rm(tools2); }
  } finally { rm(d); }
});

test('ensureToolchain：软链指向别的插件安装且还活着 → 重指到当前工具链；指对了就安静跳过', () => {
  const oldTools = tmpTools();
  const tools = tmpTools();
  const d = tmpVault((x) => fs.mkdirSync(path.join(x, '.git', 'hooks'), { recursive: true }));
  try {
    // 旧插件先连上，之后插件更新（安装路径变了）再开库：软链仍指向旧目录、且旧目录还活着
    ensureToolchain(d, oldTools);
    const r = ensureToolchain(d, tools);
    assert.deepEqual(r.repointed.sort(), ['.git/hooks/pre-commit', '.wiki/bin', '.wiki/skills']);
    assert.equal(fs.readlinkSync(path.join(d, '.wiki', 'bin')), path.join(tools, 'bin'));
    assert.equal(fs.readlinkSync(path.join(d, '.git', 'hooks', 'pre-commit')), path.join(tools, 'hooks', 'pre-commit'));
    // 指向已一致 → 不动不报
    const again = ensureToolchain(d, tools);
    assert.deepEqual(again.repointed, []);
    assert.deepEqual(again.skipped.sort(), ['.git/hooks/pre-commit', '.wiki/bin', '.wiki/skills']);
  } finally { rm(oldTools); rm(tools); rm(d); }
});

test('readWikiVersion / setWikiVersion：只改 version，其余字段原样；读不出 → null', () => {
  const d = tmpVault((x) => {
    fs.mkdirSync(path.join(x, '.wiki'));
    fs.writeFileSync(path.join(x, '.wiki', 'wiki.json'), JSON.stringify({ version: 3, parts: { 认知: { order: 1 } } }));
  });
  try {
    assert.equal(readWikiVersion(d), 3);
    setWikiVersion(d, 4);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, '.wiki', 'wiki.json'), 'utf8')), { version: 4, parts: { 认知: { order: 1 } } });
    assert.equal(readWikiVersion(d), 4);
    for (const bad of ['{"version": "3"}', '{"version": 3.5}', '{"parts": {}}', '{坏']) {
      fs.writeFileSync(path.join(d, '.wiki', 'wiki.json'), bad);
      assert.equal(readWikiVersion(d), null, bad);
    }
  } finally { rm(d); }
});

