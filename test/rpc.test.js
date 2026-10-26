import { test } from 'vitest';
import assert from 'node:assert/strict';
import { registerRpc } from '../src/host/rpc.ts';

function rpc() {
  let route = null;
  const ctx = { connection: { fetch: { register: (r) => { route = r } } } };
  const hub = { dir: () => '/tmp/vault', engine: { model: null }, model: () => { throw new Error('不该碰库') } };
  registerRpc(ctx, hub);
  return {
    call: async (method, payload) => {
      const res = await route.fetch(new Request('http://x/api/wiki.rpc', { method: 'POST', body: JSON.stringify({ method, payload }) }));
      return res.json();
    },
  };
}

test('文档会话绑定 RPC 已移除', async () => {
  const { call } = rpc();
  for (const method of ['sessionFor', 'bindSession']) {
    const result = await call(method, { key: 'vault:home', id: 'sid-1' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'not-found');
  }
});

// —— Lark问答的只读方法 + 凭证验证：status 不含 secret，verify 的实现注入 ——
function rpcLark(view, verify) {
  let route = null;
  const ctx = { connection: { fetch: { register: (r) => { route = r } } } };
  const hub = { dir: () => '/tmp/vault', engine: { model: null }, model: () => { throw new Error('不该碰库') } };
  registerRpc(ctx, hub, view, verify);
  return {
    call: async (method, payload) => (await route.fetch(new Request('http://x/api/wiki.rpc', { method: 'POST', body: JSON.stringify({ method, payload }) }))).json(),
  };
}

test('larkStatus：透传状态且不含 secret；会话列表接口已移除', async () => {
  const { call } = rpcLark({
    status: () => ({ connected: true, serving: 1, apps: [{ appId: 'cli_x', folder: '知识/L', model: '', name: '小助手', connected: true, botReady: true, folderExists: true }] }),
  });
  const st = await call('larkStatus', {});
  assert.equal(st.ok, true);
  assert.equal(st.value.connected, true);
  assert.equal(JSON.stringify(st).includes('secret'), false);
  assert.equal((await call('larkChats', {})).error.code, 'not-found');
})

test('没传 lark 视图时状态方法 404，其余方法不受影响', async () => {
  const { call } = rpcLark(undefined);
  assert.equal((await call('larkStatus', {})).ok, false);
  assert.equal((await call('status', {})).ok, true);
})

// larkVerify：设置卡「验证」按钮的通道——草稿凭证（未保存也要能验）透传给注入的
// verify，结果原样回；secret 只进请求不进结果。verify 注入，测试不碰网络。
test('larkVerify：草稿 appId/secret 透传、结果返回、secret 不回显', async () => {
  let seen = null;
  const { call } = rpcLark({}, (appId, appSecret) => { seen = { appId, appSecret }; return Promise.resolve({ ok: true, botName: '小助手' }) });
  const r = await call('larkVerify', { appId: 'cli_draft', appSecret: 'SECRET_rpc' });
  assert.deepEqual(seen, { appId: 'cli_draft', appSecret: 'SECRET_rpc' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { ok: true, botName: '小助手' });
  assert.ok(!JSON.stringify(r).includes('SECRET_rpc'));
})

test('larkVerify 没传 lark 视图时同样 404', async () => {
  const { call } = rpcLark(undefined);
  assert.equal((await call('larkVerify', { appId: 'a', appSecret: 'b' })).ok, false);
})

// 一页的块数（表格每格各算一条 src）可以超过块缓存上限 32：同一批请求里先写入的会被后写入的
// 挤出缓存。返回值必须取自本次请求自己持有的 promise，不能写完缓存再回读——回读拿到 undefined，
// 前端就把第一个块（常是页首嵌入件）留成源码。
test('renderBlocks：一批超过缓存上限的 src 每条都有 html', async () => {
  let route = null;
  const ctx = { connection: { fetch: { register: (r) => { route = r } } }, logger: { warn: () => {} } };
  const m = { dir: '/tmp/vault', g: { map: new Map() }, dead: new Map(), blockHtml: new Map() };
  const hub = { dir: () => '/tmp/vault', engine: { model: m }, model: () => m };
  registerRpc(ctx, hub);
  const srcs = Array.from({ length: 47 }, (_, i) => `格子 ${i}`);
  const res = await route.fetch(new Request('http://x/api/wiki.rpc', { method: 'POST', body: JSON.stringify({ method: 'renderBlocks', payload: { path: 'a.md', srcs } }) }));
  const r = await res.json();
  assert.equal(r.ok, true);
  assert.equal(r.value.htmls.length, 47);
  r.value.htmls.forEach((h, i) => assert.ok(h && h.includes(`格子 ${i}`), `第 ${i} 条为空：${JSON.stringify(h)}`));
});

test('larkReconnect：只透传 app_id 给 lark.reconnect，不收 secret', async () => {
  let seen = null;
  const { call } = rpcLark({ reconnect: async (appId, ...rest) => { seen = { appId, rest }; return { saved: true, connected: true } } });
  const r = await call('larkReconnect', { appId: 'cli_x', appSecret: 'SHOULD_NOT_PASS' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { saved: true, connected: true });
  assert.deepEqual(seen, { appId: 'cli_x', rest: [] });
});
