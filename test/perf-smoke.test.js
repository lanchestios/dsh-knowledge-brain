// test/perf-smoke.test.js —— 手动跑：PERF=1 npx vitest run test/perf-smoke.test.js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildModel } from '../src/core/model.ts';
import { DocStore } from '../src/core/vault/docstore.ts';
import { doChange } from '../src/core/vault/ops.ts';
import { EditorState } from '@codemirror/state';
// 本仓 lang-markdown@6.5.2 没有 gfmLanguage 导出（拿到 undefined 会静默退到 CommonMark）——
// 用导出的 markdownLanguage（GFM+），与 editor-deco-inline 测试同配置
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathExt, wikilinkExt } from '../src/editor/kernel/mdext.ts';
import { buildDeco } from '../src/editor/kernel/deco.ts';

const N = 10_000;
const genBig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-perf-'));
  fs.mkdirSync(path.join(dir, '.wiki'));
  fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "knowledge": { "order": 1 } } }');
  const area = path.join(dir, 'knowledge');
  fs.mkdirSync(area);
  for (let i = 0; i < N; i++) {
    const sub = path.join(area, `d${Math.floor(i / 200)}`);
    if (i % 200 === 0) fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `p${i}.md`),
      `---\ntitle: 页${i}\ncreated: 2026-09-01\n---\n看 [[页${(i + 7) % N}]] 与 [[页${(i + 13) % N}]]。正文第 ${i} 页，一段普通文字。\n`);
  }
  return dir;
};

test.skipIf(!process.env.PERF)('万页：patch <50ms；热 structural 与初始构建量级打印', { timeout: 300_000 }, async () => {
  const dir = genBig();
  try {
    const t0 = performance.now();
    const m = buildModel(dir, new DocStore(dir));
    const t1 = performance.now();
    assert.equal(m.g.order.length, N);
    // patch：改一页正文（链接集不变与变各测一次）
    const rel = `knowledge/d3/p${3 * 200 + 5}.md`;
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      fs.writeFileSync(path.join(dir, rel), `---\ntitle: 页${3 * 200 + 5}\ncreated: 2026-09-01\n---\n看 [[页${(3 * 200 + 5 + 7) % N}]] 与 [[页${(3 * 200 + 5 + 13 + k) % N}]]。第 ${k} 改。\n`);
      const s = performance.now();
      doChange(m, rel);
      best = Math.min(best, performance.now() - s);
    }
    const t2 = performance.now();
    buildModel(dir, m.store ?? new DocStore(dir));       // 热缓存全量（structural 兜底路径）
    const t3 = performance.now();
    console.log(`[perf] 初始构建 ${(t1 - t0).toFixed(0)}ms｜patch 最快 ${best.toFixed(1)}ms｜热 structural ${(t3 - t2).toFixed(0)}ms`);
    assert.ok(best < 50, `patch ${best.toFixed(1)}ms 超标（目标 <50ms）`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 2 万行大文档：degrade 护栏自生效（kernel/deco.ts 行内装饰在 lines > 20000 整体让路），
// 行内装饰必须为 0 且整次 buildDeco 限时——这是发布门（spec §五 Review Focus 5）
test.skipIf(!process.env.PERF)('2 万行文档：装饰构建降级且限时', () => {
  const unit = '段落文字若干，含 **标记** 与 [[双链]]。\n\n```js\nlet a = 1\n```\n\n';
  const doc = unit.repeat(4000);                       // ≈ 2.4 万行，跨过 lines > 20000 护栏
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt] })] });
  const t0 = performance.now();
  const d = buildDeco(state, { mode: 'read', dark: false, batch: { get: async () => '' }, io: {}, degrade: false });
  const dt = performance.now() - t0;
  let inline = 0;
  for (let i = d.iter(); i.value; i.next()) { if (i.value.spec.class) inline++ }   // RangeCursor 协议，同 editor-deco-inline
  assert.equal(inline, 0, '行内装饰整体让路（degrade 生效）');
  assert.ok(dt < 800, `装饰构建 ${Math.round(dt)}ms < 800ms`);
});
