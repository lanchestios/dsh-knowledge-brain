import { test } from 'vitest';
import assert from 'node:assert/strict';
import { judgeLanding, startupCorrect } from '../src/client/lib/startup.ts';

// 启动纠偏的判定端：DSH 落点是空白会话且目录不是库目录才纠——有内容的会话是人的东西，绝不碰；
// 已落在库目录（上次纠偏后 DSH 会存住这个选区）也不用再动。「还没观察到落点」不算数。

test('judgeLanding：空白会话落错目录才纠', () => {
  assert.equal(judgeLanding(null, '/vault'), 'wait');
  assert.equal(judgeLanding({ blank: true, cwd: '/elsewhere' }, '/vault'), 'correct');
});

test('judgeLanding：有内容的会话不碰，落点已在库目录不纠', () => {
  assert.equal(judgeLanding({ blank: false, cwd: '/elsewhere' }, '/vault'), 'leave');
  assert.equal(judgeLanding({ blank: true, cwd: '/vault' }, '/vault'), 'leave');
});

// 尾斜杠：配置 vaultDir 常带尾斜杠而会话 cwd 不带（DSH 建会话时规整过）——不抹掉就会把
// 「已在库目录的空白会话」误判成落错，每次启动都白纠一遍
test('judgeLanding：目录比对抹掉尾斜杠', () => {
  assert.equal(judgeLanding({ blank: true, cwd: '/vault' }, '/vault/'), 'leave');
  assert.equal(judgeLanding({ blank: true, cwd: '/vault/' }, '/vault'), 'leave');
  assert.equal(judgeLanding({ blank: true, cwd: '/elsewhere' }, '/vault/'), 'correct'); // 真落错照样纠
});

// 挂载端不许把插件炸挂：客户端 entry 只 inject ['slots']，激活时 sessions 可能还没就绪
// （它要等 connection 链）——这时 c.get('sessions') 是 undefined，直接 .list 就 TypeError，
// 整个 entry 判 failed（web boot: dsh-knowledge-brain: failed）。缺服务时静默不挂（由
// index.tsx 的 c.inject 等服务齐了再挂），绝不抛。
test('startupCorrect：sessions 未就绪时不抛，返回拆除函数', () => {
  const c = { get: () => undefined }; // 任何服务都拿不到
  const dispose = startupCorrect(c, { status: async () => ({ dir: '/vault' }) });
  assert.equal(typeof dispose, 'function');
  dispose();
});
