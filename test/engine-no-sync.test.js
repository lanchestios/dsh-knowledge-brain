import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// 拦下引擎里所有 execFile：沉淀区增删不该再起任何子进程（监听补齐已删）
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({ ...(await importOriginal()), execFile }));

const { VaultEngine } = await import('../src/core/vault/engine.ts');
const { WIKI_VERSION } = await import('../src/core/vault/init.ts');

class FakeWatcher extends EventEmitter { close() { return Promise.resolve() } }

test('监听：沉淀区增删文件、增删文件夹 → 不起任何子进程，照常发补丁 / structural', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-nosync-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, '.wiki'));
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": ' + WIKI_VERSION + ', "parts": { "知识": { "order": 1 } } }');
  fs.mkdirSync(path.join(dir, '知识'));
  fs.writeFileSync(path.join(dir, '知识/甲.md'), '---\ntitle: 甲\n---\n正文。');
  const fake = new FakeWatcher();
  const got = [];
  const e = new VaultEngine(() => dir, (ev) => got.push(ev), () => fake, { debounceMs: 1 });
  try {
    e.open();
    fs.writeFileSync(path.join(dir, '知识/乙.md'), '---\ntitle: 乙\n---\n正文。');
    fake.emit('all', 'add', path.join(dir, '知识/乙.md'));
    fs.mkdirSync(path.join(dir, '知识/丙'));
    fake.emit('all', 'addDir', path.join(dir, '知识/丙'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(execFile.mock.calls.length, 0, JSON.stringify(execFile.mock.calls.map((c) => c[1])));
    assert.ok(got.length > 0, '照常通知');
  } finally { await e.close(); fs.rmSync(dir, { recursive: true, force: true }) }
});
