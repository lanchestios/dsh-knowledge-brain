import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { watchIgnored } from '../src/core/vault/watch.ts';

// watchIgnored(库根) → 给 chokidar 的 ignored 谓词：.DS_Store 与 raw/project 不监听。
// raw/project 是外部克隆树（CLI 的 SCOPE_EXCLUDE 本就不管它），监听它会把几千个目录
// 塞进 FSEvents，实证触发 EMFILE（监听出错、刷屏）。纯函数，不需要真目录。

const root = '/tmp/some-vault';
const ignored = watchIgnored(root);

test('.DS_Store 任意位置忽略', () => {
  assert.equal(ignored(path.join(root, '认知', '.DS_Store')), true);
  assert.equal(ignored(path.join(root, 'raw', 'document', '2026-09-30', '.DS_Store')), true);
});

test('raw 根与 document / book 照常监听', () => {
  assert.equal(ignored(path.join(root, 'raw')), false);
  assert.equal(ignored(path.join(root, 'raw', 'document', '2026-09-30', '纪要.pdf')), false);
  assert.equal(ignored(path.join(root, 'raw', 'book', '《X》', 'ch01.md')), false);
});

test('raw/project 整棵不监听（本体与深层）', () => {
  assert.equal(ignored(path.join(root, 'raw', 'project')), true);
  assert.equal(ignored(path.join(root, 'raw', 'project', 'univer')), true);
  assert.equal(ignored(path.join(root, 'raw', 'project', 'univer', 'src', 'a.ts')), true);
  assert.equal(ignored(path.join(root, 'raw', 'project', 'pytorch-learn', '.git', 'objects', 'ab')), true);
});

test('锚定库根：别处同名子串不误伤', () => {
  assert.equal(ignored(path.join(root, '认知', '学习', 'raw', 'project.md')), false);
  assert.equal(ignored(path.join(root, '认知', '见解', 'x.md')), false);
});
