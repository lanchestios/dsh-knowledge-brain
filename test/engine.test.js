import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { VaultEngine } from '../src/core/vault/engine.ts';
import { buildModel } from '../src/core/model.ts';
import { WIKI_VERSION, readWikiVersion, setWikiVersion } from '../src/core/vault/init.ts';

// VaultEngine 的失败出口：open() 半路抛异常不再炸出去（hub.reopen 只 console），真因落
// error 给设置页；监听运行中出错置 degraded 提示「改动不自动刷新」，错误风暴只通知一次。
// 真实 fs watch 的错误没法确定性触发，构造器第三个参数注入假监听器。

const tmpVault = (build) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-state-'));
  build?.(dir);
  return dir;
};
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

class FakeWatcher extends EventEmitter {
  close() { return Promise.resolve() }
}

const wikiSkeleton = (d) => {
  fs.mkdirSync(path.join(d, '.git'));
  fs.mkdirSync(path.join(d, '.wiki'));
  fs.writeFileSync(path.join(d, '.wiki', 'wiki.json'), '{ "version": ' + WIKI_VERSION + ', "parts": { "knowledge": { "order": 1 } } }');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge/A.md'), '---\ntitle: 甲\ncreated: 2026-09-01\n---\n正文。');
};
// 版本比插件低一级的库：开库带校验时要先 wiki upgrade
const oldVault = (d) => { wikiSkeleton(d); setWikiVersion(d, WIKI_VERSION - 1) };
const fire = (fake, evt, p) => fake.emit('all', evt, p);
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('打开库半路失败 → error 落真因，不抛出、无模型', () => {
  // .wiki 只读：version 判定能过，骨架补建 anchors.conf 时必然 EACCES
  const dir = tmpVault((d) => {
    fs.mkdirSync(path.join(d, '.git'));
    fs.mkdirSync(path.join(d, '.wiki'));
    fs.writeFileSync(path.join(d, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "认知": { "order": 1 } } }');
    fs.chmodSync(path.join(d, '.wiki'), 0o555);
  });
  try {
    const st = new VaultEngine(() => dir, () => {}, undefined, {});
    st.open();
    assert.equal(st.model, null);
    assert.match(st.error, /打开库失败/);
    assert.equal(st.degraded, false);
  } finally { fs.chmodSync(path.join(dir, '.wiki'), 0o755); rm(dir) }
});

test('监听出错 → degraded 置位且只通知一次；重开复位', async () => {
  const dir = tmpVault(wikiSkeleton);
  const fake = new FakeWatcher();
  let notified = 0;
  const st = new VaultEngine(() => dir, () => notified++, () => fake, {});
  try {
    st.open();
    assert.ok(st.model !== null);
    assert.equal(st.degraded, false);
    fake.emit('error', new Error('EMFILE'));
    assert.equal(st.degraded, true);
    assert.equal(notified, 1);
    fake.emit('error', new Error('EMFILE'));
    assert.equal(notified, 1);               // 错误风暴不重复刷 UI
    st.open();                               // 重开库复位
    assert.equal(st.degraded, false);
  } finally { await st.close(); rm(dir) }
});

test('分类路由实弹：md 编辑发 patch 载荷；两个 md 同窗并成一个事件', async () => {
  const dir = tmpVault(wikiSkeleton);
  const fake = new FakeWatcher();
  const got = [];
  const e = new VaultEngine(() => dir, (ev) => got.push(ev), () => fake, { debounceMs: 1 });
  try {
    e.open();
    fire(fake, 'change', path.join(dir, 'knowledge/A.md'));
    fire(fake, 'change', path.join(dir, 'knowledge/A.md'));           // 同路径去重
    await settle();
    assert.equal(got.length, 1);
    assert.equal(got[0].kind, 'patch');
    assert.deepEqual(got[0].ids, ['knowledge/A.md']);
  } finally { await e.close(); rm(dir) }
});

test('wiki.json → 重开并发 structural；tools 目录只发 tools', async () => {
  const dir = tmpVault(wikiSkeleton);
  const fake = new FakeWatcher();
  const got = [];
  const TOOLS = '/app/vault-tools/agents';
  const e = new VaultEngine(() => dir, (ev) => got.push(ev), () => fake, { debounceMs: 1, toolsDir: TOOLS });
  try {
    e.open();
    fire(fake, 'change', path.join(dir, '.wiki', 'wiki.json'));
    await settle();
    assert.equal(got[got.length - 1].kind, 'structural');
    got.length = 0;
    fire(fake, 'change', path.join(TOOLS, 'wiki-x.md'));
    await settle();
    assert.deepEqual(got.map((x) => x.kind), ['tools'], 'tools 不带模型载荷');
  } finally { await e.close(); rm(dir) }
});

test('C1：同窗同路径删了又建 → last-event-wins 只送 add，补丁后模型与重建一致', async () => {
  const dir = tmpVault((d) => { wikiSkeleton(d);
    fs.writeFileSync(path.join(d, 'knowledge/B.md'), '---\ntitle: 乙\ncreated: 2026-09-03\n---\n看 [[A]]。');
  });
  const fake = new FakeWatcher();
  const got = [];
  const e = new VaultEngine(() => dir, (ev) => got.push(ev), () => fake, { debounceMs: 1 });
  try {
    e.open();
    fs.unlinkSync(path.join(dir, 'knowledge/B.md'));
    fs.writeFileSync(path.join(dir, 'knowledge/B.md'), '---\ntitle: 乙\ncreated: 2026-09-03\n---\n回看 [[A]]。');
    fire(fake, 'unlink', path.join(dir, 'knowledge/B.md'));
    fire(fake, 'add', path.join(dir, 'knowledge/B.md'));
    await settle();
    assert.ok(got.some((x) => x.kind === 'patch'), '走补丁不重建');
    const f = buildModel(dir);
    assert.deepEqual([...e.model.byId.keys()].sort(), [...f.byId.keys()].sort(), 'byId 键集');
    const mp = (g) => JSON.stringify([...g.map].map(([k, x]) => [k, x.count, x.docs.map((d) => d._id)]).sort());
    assert.equal(mp(e.model.g), mp(f.g), '名字映射（count=1、无重复 docs）');
    const dd = (x) => JSON.stringify([...x.dead].map(([t, y]) => [t, y.reason, y.count]).sort());
    assert.equal(dd(e.model), dd(f), 'dead');
    assert.ok(e.model.g.backlinks.get('knowledge/A.md')?.some((b) => b.doc._id === 'knowledge/B.md'), '重建页的反链在');
  } finally { await e.close(); rm(dir) }
});

test('自愈：补丁抛异常 → 该批走全量重建、发 structural、模型正确、进程不炸', async () => {
  const dir = tmpVault(wikiSkeleton);
  const fake = new FakeWatcher();
  const got = [];
  const e = new VaultEngine(() => dir, (ev) => got.push(ev), () => fake, {
    debounceMs: 1,
    apply: () => { throw new Error('boom') },                        // 注入缝：补丁路径炸
  });
  try {
    e.open();
    fs.writeFileSync(path.join(dir, 'knowledge/A.md'), '---\ntitle: 甲改\ncreated: 2026-09-01\n---\n新正文。');
    fire(fake, 'change', path.join(dir, 'knowledge/A.md'));
    await settle();
    assert.ok(got.some((x) => x.kind === 'structural'), '自愈载荷');
    assert.equal(e.model.byId.get('knowledge/A.md').title, '甲改', '全量重建后模型是对的');
    assert.deepEqual(e.model.g.order.map((x) => x._id), buildModel(dir).g.order.map((x) => x._id));
  } finally { await e.close(); rm(dir) }
});

const deferred = () => { let res; const p = new Promise((r) => { res = r }); return { p, res } };

test('没有 .wiki 的目录 → 拒绝打开、指去新建，一个文件都不建', () => {
  const dir = tmpVault((d) => { fs.mkdirSync(path.join(d, '.git')) });
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {});
  try {
    st.open();
    assert.equal(st.model, null);
    assert.match(st.error, /这不是知识库/);
    assert.match(st.error, /新建/);
    assert.equal(fs.existsSync(path.join(dir, '.wiki')), false);
  } finally { rm(dir) }
});

test('开库补建 git 带不过去的：.wiki/tmp 与固定目录', async () => {
  const dir = tmpVault(wikiSkeleton);
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {});
  try {
    st.open();
    for (const p of ['.wiki/tmp', 'asset', 'raw']) assert.ok(fs.existsSync(path.join(dir, p)), p);
  } finally { await st.close(); rm(dir) }
});

test('validate：校验中不建模型；通过才建并通知 structural', async () => {
  const dir = tmpVault(wikiSkeleton);
  const gate = deferred();
  const got = [];
  const st = new VaultEngine(() => dir, (ev) => got.push(ev), () => new FakeWatcher(), { check: () => gate.p });
  try {
    st.open({ validate: true });
    assert.equal(st.validating, true);
    assert.equal(st.model, null);
    assert.equal(st.error, null);
    gate.res({ ok: true, output: '✓ 校验通过' });
    await settle();
    assert.equal(st.validating, false);
    assert.ok(st.model !== null);
    assert.deepEqual(got.at(-1), { kind: 'structural' });
  } finally { await st.close(); rm(dir) }
});

test('validate：没通过 → 拒绝打开，checkOutput 带原文', async () => {
  const dir = tmpVault(wikiSkeleton);
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(),
    { check: async () => ({ ok: false, output: '✗ 顶层：多余条目 —— drafts\n\n共 1 处问题' }) });
  try {
    st.open({ validate: true });
    await settle();
    assert.equal(st.model, null);
    assert.match(st.error, /没通过校验/);
    assert.match(st.checkOutput, /多余条目 —— drafts/);
    assert.equal(st.validating, false);
  } finally { rm(dir) }
});

test('validate：校验没跑起来（没有 python3 / 进程崩了）→ 如实报错，不卡在校验中', async () => {
  const dir = tmpVault(wikiSkeleton);
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(),
    { check: async () => { throw new Error('spawn python3 ENOENT') } });
  try {
    st.open({ validate: true });
    await settle();
    assert.equal(st.validating, false);
    assert.match(st.error, /校验没跑起来.*python3/);
  } finally { rm(dir) }
});

test('validate：结果回来前又开了一次 → 旧结果作废', async () => {
  const dir = tmpVault(wikiSkeleton);
  const gate = deferred();
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), { check: () => gate.p });
  try {
    st.open({ validate: true });
    st.open();                                     // 会话内重开：不校验，直接建
    assert.ok(st.model !== null);
    gate.res({ ok: false, output: '✗ 旧结果' });
    await settle();
    assert.ok(st.model !== null, '旧的失败结果不该把模型抹掉');
    assert.equal(st.error, null);
  } finally { await st.close(); rm(dir) }
});

test('validate：版本等于当前 → 不跑升级，只跑 check', async () => {
  const dir = tmpVault(wikiSkeleton);
  const order = [];
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async () => { order.push('upgrade'); return { ok: true, output: '' } },
    check: async () => { order.push('check'); return { ok: true, output: '' } },
  });
  try {
    st.open({ validate: true });
    await settle();
    assert.deepEqual(order, ['check']);
    assert.ok(st.model !== null);
  } finally { await st.close(); rm(dir) }
});

test('validate：版本低 → 先 upgrade 再 check，通过开库；版本号只由 upgrade 写', async () => {
  const dir = tmpVault(oldVault);
  const order = [];
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async (d) => { order.push(['upgrade', d]); return { ok: true, output: '✓ 已升到 v2' } },
    check: async () => { order.push(['check']); return { ok: true, output: '' } },
  });
  try {
    st.open({ validate: true });
    assert.equal(readWikiVersion(dir), WIKI_VERSION - 1, '引擎自己不改版本号');
    await settle();
    assert.deepEqual(order, [['upgrade', dir], ['check']]);
    assert.ok(st.model !== null);
    assert.equal(st.error, null);
  } finally { await st.close(); rm(dir) }
});

test('validate：升级没成功 → 不开库、不跑 check，error 与 checkOutput 带升级原文', async () => {
  const dir = tmpVault(oldVault);
  let checked = false;
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async () => ({ ok: false, output: '✗ 文件夹配置：知识/A/ 有同名的 —— x.md、x.py\n✗ 升级停在 v1' }),
    check: async () => { checked = true; return { ok: true, output: '' } },
  });
  try {
    st.open({ validate: true });
    await settle();
    assert.equal(st.model, null);
    assert.equal(checked, false);
    assert.equal(st.error, '升级没成功，知识库未打开');
    assert.match(st.checkOutput, /升级停在 v1/);
    assert.equal(st.validating, false);
  } finally { rm(dir) }
});

test('validate：升级没跑起来（没有 python3）→ 如实报错，不卡在校验中、不跑 check', async () => {
  const dir = tmpVault(oldVault);
  let checked = false;
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async () => { throw new Error('spawn python3 ENOENT') },
    check: async () => { checked = true; return { ok: true, output: '' } },
  });
  try {
    st.open({ validate: true });
    await settle();
    assert.equal(st.validating, false);
    assert.equal(checked, false);
    assert.match(st.error, /^升级没跑起来：.*python3/);
  } finally { rm(dir) }
});

test('validate：升级过了、校验没过 → 报校验没过（带 check 原文），不说升级失败', async () => {
  const dir = tmpVault(oldVault);
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async () => ({ ok: true, output: '✓ 已升到 v2' }),
    check: async () => ({ ok: false, output: '✗ 引用：断链 —— [[乙]]' }),
  });
  try {
    st.open({ validate: true });
    await settle();
    assert.equal(st.model, null);
    assert.match(st.error, /没通过校验/);
    assert.match(st.checkOutput, /断链/);
  } finally { rm(dir) }
});

test('validate：升级中又开了一次 → 旧升级结果作废，不接着跑 check', async () => {
  const dir = tmpVault(oldVault);
  const gate = deferred();
  let checked = 0;
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: () => gate.p,
    check: async () => { checked++; return { ok: false, output: '✗ 不该跑到这' } },
  });
  try {
    st.open({ validate: true });
    st.open();                                     // 会话内重开：不校验、不升级，直接建
    assert.ok(st.model !== null);
    gate.res({ ok: true, output: '' });
    await settle();
    assert.equal(checked, 0);
    assert.ok(st.model !== null);
    assert.equal(st.error, null);
  } finally { await st.close(); rm(dir) }
});

test('不带 validate 的重开遇到低版本：不升级、不改 version，照旧建模型', async () => {
  const dir = tmpVault(oldVault);
  let upgraded = false;
  const st = new VaultEngine(() => dir, () => {}, () => new FakeWatcher(), {
    upgrade: async () => { upgraded = true; return { ok: true, output: '' } },
  });
  try {
    st.open();
    await settle();
    assert.ok(st.model !== null);
    assert.equal(upgraded, false);
    assert.equal(readWikiVersion(dir), WIKI_VERSION - 1);
  } finally { await st.close(); rm(dir) }
});

