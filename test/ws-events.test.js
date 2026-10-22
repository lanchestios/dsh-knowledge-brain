// WS 事件通道：wiki 变更的 upgrade 注册、ready 首帧、事件转发、
// 断开退订、卸载清场、admit 拒绝。升级服务塞假货，只测自家接线；帧协议是 ws 库的事
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { registerRoutes } from '../src/host/routes.ts'

// 假升级服务：handleUpgrade 直接给一个可控的假 ws，记录每次握手
const fakeServer = () => {
  const handshakes = []
  return {
    handshakes,
    handleUpgrade(req, socket, head, cb) {
      const ws = {
        readyState: 1, sent: [], terminated: false, handlers: {},
        send(d) { this.sent.push(String(d)) },
        terminate() { this.terminated = true; this.readyState = 3; this.handlers.close?.() },
        // 对端断开：readyState 先离 OPEN 再派发 close（同真 ws 库时序）
        drop() { this.readyState = 3; this.handlers.close?.() },
        on(evt, fn) { this.handlers[evt] = fn },
      }
      handshakes.push({ req, socket, head, ws })
      cb(ws)
    },
    close() {},
  }
}

// 假 ctx：fetch 路由记录、webServer upgrade 记录、effect 立即执行并把卸载器记下（同真 cordis 语义）
const fakeCtx = (admit = () => ({ peer: {} })) => {
  const fetchRoutes = [], upgrades = [], disposers = []
  const scope = {
    connection: { fetch: { register: (r) => fetchRoutes.push(r) }, admit },
    effect: (f) => { const d = f(); disposers.push(d); return () => { void d } },
    webServer: { registerUpgrade: (r) => { upgrades.push(r); return () => {} } },
  }
  const ctx = { ...scope, inject: (names, fn) => fn(scope) }
  return { ctx, fetchRoutes, upgrades, disposers }
}

const fakeHub = () => {
  const subs = []
  return {
    subs,
    dir: () => '/tmp/vault',
    onChanged: (cb) => { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1) } },
  }
}

test('wiki 事件：连接先收 ready，库变更发 JSON 载荷（tools 不上 WS），断开即退订', () => {
  const srv = fakeServer()
  const hub = fakeHub()
  const { ctx, upgrades } = fakeCtx();
  registerRoutes(ctx, hub, () => srv);
  upgrades.find((r) => r.path === '/api/wiki.events').handler({}, {}, []);
  const { ws } = srv.handshakes[0];
  assert.deepEqual(ws.sent, ['ready']);
  hub.subs[0]({ kind: 'patch', ids: ['knowledge/A.md'], flags: { graph: true } });
  assert.equal(ws.sent[1], '{"kind":"patch","ids":["knowledge/A.md"],"flags":{"graph":true}}');
  hub.subs[0]({ kind: 'structural' });
  assert.equal(ws.sent[2], '{"kind":"structural"}');
  hub.subs[0]({ kind: 'tools' });
  assert.equal(ws.sent.length, 3, 'tools 不上 WS');
  ws.drop();
  assert.equal(hub.subs.length, 0, '断开即退订');
  for (const cb of [...hub.subs]) cb({ kind: 'structural' });
  assert.equal(ws.sent.length, 3, '断开后库再变不发');
})

test('admit 拒绝：401/403 写回 HTTP 响应并不动用升级服务', () => {
  const srv = fakeServer()
  let verdict = { rejection: 401 }
  const { ctx, upgrades } = fakeCtx(() => verdict)
  registerRoutes(ctx, fakeHub(), () => srv)
  const written = []
  const route = upgrades.find((r) => r.path === '/api/wiki.events')
  assert.ok(route, '升级路由必须挂上')
  route.handler({}, { end: (chunk) => written.push(chunk) }, [])
  assert.match(written[0], /^HTTP\/1\.1 401 Unauthorized/)
  assert.match(written[0], /unauthorized$/)
  verdict = { rejection: 403 }
  const written2 = []
  route.handler({}, { end: (chunk) => written2.push(chunk) }, [])
  assert.match(written2[0], /^HTTP\/1\.1 403 Forbidden/)
  assert.equal(srv.handshakes.length, 0, '拒绝时不握手')
})

test('插件卸载：开着的连接 terminate、订阅清空', () => {
  const srv = fakeServer()
  const h = fakeHub()
  const { ctx, upgrades, disposers } = fakeCtx()
  registerRoutes(ctx, h, () => srv)
  upgrades.find((r) => r.path === '/api/wiki.events').handler({}, {}, [])
  assert.equal(h.subs.length, 1)
  for (const d of disposers) d()
  assert.ok(srv.handshakes[0].ws.terminated, '连接被终止')
  assert.equal(h.subs.length, 0, '订阅被退订')
})
