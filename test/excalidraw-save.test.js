// test/excalidraw-save.test.js
// 写通道：rpc saveExcalidraw 白名单与落盘、Hub.assetChanged 事件、asset 路由 content-type、
// 客户端 changed 分支的资产抽取
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRpc } from '../src/host/rpc.ts';
import { Hub } from '../src/core/hub.ts';
import { registerRoutes } from '../src/host/routes.ts';
import { assetRefreshRels } from '../src/client/lib/edit.ts';

const SCENE = { type: 'excalidraw', version: 2, source: 'dsh-knowledge-brain', elements: [{ id: 'a' }], appState: { viewBackgroundColor: '#ffffff' } };

function mkVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-exd-'));
  fs.mkdirSync(path.join(dir, 'asset/diagrams/2026-10-19'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'asset/diagrams/2026-10-19/a.excalidraw'), '{"type":"excalidraw","version":2,"elements":[]}', 'utf8');
  fs.mkdirSync(path.join(dir, 'asset/other'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'asset/other/a.excalidraw'), '{}', 'utf8');
  return dir;
}

function rpc(dir, events) {
  let route = null;
  const ctx = { connection: { fetch: { register: (r) => { route = r } } } };
  const hub = { dir: () => dir, engine: { model: null }, model: () => { throw new Error('不该碰库') }, assetChanged: (rel) => events.push(rel) };
  registerRpc(ctx, hub);
  return {
    call: async (method, payload) => (await route.fetch(new Request('http://x/api/wiki.rpc', { method: 'POST', body: JSON.stringify({ method, payload }) }))).json(),
  };
}

test('saveExcalidraw：白名单内落盘、紧凑 JSON、发资产变更事件', async () => {
  const dir = mkVault();
  const events = [];
  const { call } = rpc(dir, events);
  const r = await call('saveExcalidraw', { path: 'asset/diagrams/2026-10-19/a.excalidraw', scene: SCENE });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(fs.readFileSync(path.join(dir, 'asset/diagrams/2026-10-19/a.excalidraw'), 'utf8'), JSON.stringify(SCENE), '紧凑 JSON 落盘');
  assert.deepEqual(events, ['asset/diagrams/2026-10-19/a.excalidraw']);
});

test('saveExcalidraw：四类路径全拒——越界 / 非 diagrams / 非后缀 / 场景不合法', async () => {
  const dir = mkVault();
  const events = [];
  const { call } = rpc(dir, events);
  const rejects = [
    { path: '../outside.excalidraw', scene: SCENE },
    { path: 'asset/other/a.excalidraw', scene: SCENE },
    { path: 'asset/diagrams/2026-10-19/a.md', scene: SCENE },
    { path: 'asset/diagrams/2026-10-19/a.excalidraw', scene: { type: 'markdown' } },
    { path: 'asset/diagrams/2026-10-19/a.excalidraw', scene: { type: 'excalidraw', elements: 'x' } },
  ];
  for (const p of rejects) {
    const r = await call('saveExcalidraw', p);
    assert.equal(r.ok, false, `应拒：${p.path} ${JSON.stringify(p.scene).slice(0, 40)}`);
  }
  assert.deepEqual(events, [], '拒时不发事件');
});

test('Hub.assetChanged：订阅者收到 patch 事件带 rel', () => {
  const dir = mkVault();
  const hub = new Hub(() => dir);
  const seen = [];
  const off = hub.onChanged((ev) => seen.push(ev));
  hub.assetChanged('asset/diagrams/2026-10-19/a.excalidraw');
  off();
  assert.deepEqual(seen, [{ kind: 'patch', ids: ['asset/diagrams/2026-10-19/a.excalidraw'], flags: {} }]);
});

test('asset 路由：.excalidraw 以 application/json 服务', async () => {
  const dir = mkVault();
  let route = null;
  const ctx = {
    connection: { fetch: { register: (r) => { route = r } } },
    inject: (_l, cb) => cb({ effect() {}, webServer: { registerUpgrade() {} } }),
  };
  registerRoutes(ctx, { dir: () => dir, onChanged: () => () => {} });
  const res = await route.fetch(new Request(`http://x/api/wiki.asset?path=${encodeURIComponent('asset/diagrams/2026-10-19/a.excalidraw')}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('assetRefreshRels：patch 事件里抽出 .excalidraw 的 id；别的形态为空', () => {
  assert.deepEqual(assetRefreshRels({ kind: 'patch', ids: ['知识/a.md', 'asset/diagrams/2026-10-19/a.excalidraw'], flags: {} }),
    ['asset/diagrams/2026-10-19/a.excalidraw']);
  assert.deepEqual(assetRefreshRels({ kind: 'patch', ids: ['知识/a.md'], flags: {} }), []);
  assert.deepEqual(assetRefreshRels({ kind: 'structural' }), []);
});
