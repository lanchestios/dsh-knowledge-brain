import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { larkAppsOf } from '../src/host/config.ts';
import { loadBooks } from '../src/core/books.ts';
import { resolveRef, resolveNameStates } from '../src/core/llm.ts';

// 兼容逻辑已清理：旧键 feishuApps、旧标题「## 已提炼」都不再认；解析不收来源页参数
test('larkAppsOf：只认 larkApps，旧键 feishuApps 不再兜底', () => {
  assert.deepEqual(larkAppsOf({ feishuApps: [{ appId: 'x' }] }), []);
  assert.deepEqual(larkAppsOf({ larkApps: { get: () => [{ appId: 'y' }] } }), [{ appId: 'y' }]);
});

test('书页「## 已提炼」不再当知识沉淀段', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-nocompat-'));
  try {
    const b = path.join(dir, 'raw', 'book', '书');
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, '书.md'), '---\ntitle: 书\n---\n\n## 章节进度\n\n- [x] 1 一\n\n## 已提炼\n\n- 1 一 · 沉淀中\n');
    assert.equal(loadBooks(dir)[0].chapters[0].state, 'read', '没有「## 知识沉淀」段：这一章只是已读');
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
});

test('resolveRef / resolveNameStates 不收来源页参数', () => {
  assert.equal(resolveRef.length, 2);
  assert.equal(resolveNameStates.length, 2);
});
