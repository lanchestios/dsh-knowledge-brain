import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel } from '../src/core/model.ts';
import { resolveNameStates } from '../src/core/llm.ts';

test('resolveNameStates：唯一命中给 id；死链给原因（missing）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-rn-'));
  try {
    mkdirSync(join(dir, '认知'), { recursive: true });
    writeFileSync(join(dir, '认知', '甲.md'), '---\ntitle: 甲\n---\n\nx\n', 'utf8');
    const m = buildModel(dir);
    const r = resolveNameStates(m, ['甲', '不存在']);
    assert.equal(r['甲'].id, '认知/甲.md');
    assert.equal(r['不存在'].id, null);
    assert.ok(typeof r['不存在'].dead === 'string' && r['不存在'].dead.length > 0, '死链带原因');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});

// 真实场景钉：四个系统文件夹下都有「用户故事」——裸名不再就近，一律歧义死链；写路径即命中
test('resolveNameStates：重名裸名歧义死链带候选路径；路径形式命中', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-rn2-'));
  try {
    for (const p of ['系统/订单系统/需求', '系统/订单系统/用户故事', '系统/库存系统/用户故事']) mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, '系统/订单系统/需求/页.md'), '---\ntitle: 页\n---\n见 [[用户故事]]。\n', 'utf8');
    writeFileSync(join(dir, '系统/订单系统/用户故事/用户故事.md'), '---\ntitle: 用户故事\n---\nx\n', 'utf8');
    writeFileSync(join(dir, '系统/库存系统/用户故事/用户故事.md'), '---\ntitle: 用户故事\n---\nx\n', 'utf8');
    const m = buildModel(dir);
    const r = resolveNameStates(m, ['用户故事', '系统/订单系统/用户故事'], '系统/订单系统/需求/页.md');
    assert.equal(r['用户故事'].id, null);
    assert.equal(r['用户故事'].dead, '同名歧义：系统/订单系统/用户故事、系统/库存系统/用户故事——写成路径形式');
    assert.equal(r['系统/订单系统/用户故事'].id, '系统/订单系统/用户故事/用户故事.md');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
