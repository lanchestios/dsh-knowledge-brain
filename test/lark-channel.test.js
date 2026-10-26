import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

// SDK 全部假掉（channel.ts 是唯一碰 SDK 的文件，真机联调另算）。钉死：
// 1) start 挂在 connect 半路时 stop，不许把连接建成「无人引用、无人能停」的幽灵；
// 2) 归一消息 → Incoming（event_id 从 raw 顶层取）、cardAction → onCardAction、botAdded → onChatNew；
// 3) reply/sendCard/updateCard 打到 inner 通道的对应方法。
vi.mock('@larksuiteoapi/node-sdk', () => {
  let lastInner = null;
  const makeInner = () => {
    const inner = {
      handlers: null, botIdentity: { openId: 'ou_bot', name: '小助' }, connected: false,
      rawClient: {
        request: async (o) => { inner.requests.push(o); return inner.respond ? inner.respond(o) : { bot: { open_id: 'ou_bot', bot_name: '小助' } } },
        im: { v1: {
          message: { reply: async (o) => { inner.replyCalls.push(o); return o.data.msg_type === 'interactive' ? { code: 0, data: { message_id: 'om_reply_card' } } : {} } },
          image: { create: async (o) => { inner.imageCalls.push(o); if (inner.imageFail) throw inner.imageFail; return { image_key: 'img_up' } } },
        } },
      },
      replyCalls: [], requests: [], respond: null, imageCalls: [], imageFail: null,
      sent: [], patched: [],
      connect() { return inner.connectPromise ??= new Promise((res) => { inner._res = res }) },
      async disconnect() { inner.disconnected = true },
      on(map) { inner.handlers = map; return () => {} },
      async send(to, input, opts) { const messageId = `om_${inner.sent.length + 1}`; inner.sent.push({ to, input, messageId, ...(opts ? { opts } : {}) }); return { messageId } },
      async updateCard(messageId, card) { inner.patched.push({ messageId, card }) },
    };
    return inner;
  };
  return {
    Client: class { async request() { return { bot: { open_id: 'ou_bot' } } } },
    createLarkChannel: () => { lastInner = makeInner(); return lastInner },
    AppType: { SelfBuild: 0 },
    LoggerLevel: { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 },
    __inner: () => lastInner,
  };
});

import { LarkChannel } from '../src/lark/channel.ts';
import { __inner } from '@larksuiteoapi/node-sdk';

test('start 挂在 connect 时 stop：连接不许建成幽灵（不宣布已建立，连接要断）', async () => {
  const infos = [];
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: (m) => infos.push(m) });
  const p = ch.start();
  await new Promise((r) => setTimeout(r, 0));   // inner 已建、connect 挂起
  const inner = __inner();
  assert.ok(inner, '高层通道应已创建');
  ch.stop();                                    // 半路叫停
  inner._res();                                 // connect 这时才完成
  await p;
  assert.equal(inner.disconnected, true, '连接要被断掉');
  assert.equal(infos.length, 0, '不许宣布「Lark长连接已建立」');
})

test('连上后取到机器人身份：botOpenId/botName 供群聊判定与设置卡显示', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start();
  __inner()._res();
  await p;
  assert.equal(ch.botOpenId, 'ou_bot');
  assert.equal(ch.botName, '小助');
})

// 归一消息折成 Incoming：event_id 在 raw 顶层（SDK 把事件体摊平）；mentions 拆 key/openId
test('message → Incoming：event_id/文本/mention 都折进来', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const got = [];
  ch.onMessage((m) => got.push(m));
  const p = ch.start();
  __inner()._res();
  await p;
  await __inner().handlers.message({
    messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: '什么是格物致知',
    rawContentType: 'text', senderId: 'ou_s',
    mentions: [{ key: '@_user_1', openId: 'ou_u' }],
    raw: { event_id: 'e_9' },
  });
  assert.deepEqual(got, [{
    eventId: 'e_9', chatId: 'oc_1', chatType: 'p2p', messageId: 'om_1', senderId: 'ou_s', messageType: 'text',
    text: '什么是格物致知', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_u'],
  }]);
})

test('cardAction → onCardAction（value 原样带回）；botAdded → onChatNew', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const cards = [], news = [];
  ch.onCardAction((a) => cards.push(a));
  ch.onChatNew((e) => news.push(e));
  const p = ch.start();
  __inner()._res();
  await p;
  await __inner().handlers.cardAction({ messageId: 'om_9', chatId: 'oc_1', action: { value: { q: 'q1', o: '是' } } });
  __inner().handlers.botAdded({ chatId: 'oc_g' });
  assert.deepEqual(cards, [{ messageId: 'om_9', chatId: 'oc_1', value: { q: 'q1', o: '是' } }]);
  assert.deepEqual(news, [{ chatId: 'oc_g', chatType: 'group' }]);
})

test('reply/sendCard/updateCard 打到 inner 的对应方法；不再提供表情回复', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start();
  __inner()._res();
  await p;
  await ch.reply('om_1', '**答案**');
  const sent = await ch.sendCard('oc_1', { header: {} });
  await ch.updateCard(sent.messageId, { header: {}, locked: true });
  const inner = __inner();
  assert.equal(inner.replyCalls[0].data.msg_type, 'post');
  assert.deepEqual(JSON.parse(inner.replyCalls[0].data.content), {
    zh_cn: { title: '', content: [[{ tag: 'text', text: '答案', style: ['bold'] }]] },
  });
  assert.equal(ch.acknowledge, undefined);
  assert.equal(inner.sent[0].to, 'oc_1');
  assert.equal(sent.messageId, 'om_1');
  assert.deepEqual(inner.patched, [{ messageId: 'om_1', card: { header: {}, locked: true } }]);
})


test('话题：threadId/rootId 折进 Incoming；reply 带 reply_in_thread；卡片按根消息回进话题', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const got = [];
  ch.onMessage((m) => got.push(m));
  const p = ch.start();
  __inner()._res();
  await p;
  await __inner().handlers.message({
    messageId: 'om_2', chatId: 'oc_g', chatType: 'group', content: '那差旅呢', rawContentType: 'text',
    mentions: [], threadId: 'omt_1', rootId: 'om_root', raw: { event_id: 'e_10' },
  });
  assert.equal(got[0].threadId, 'omt_1');
  assert.equal(got[0].rootId, 'om_root');
  await ch.reply('om_2', '答', true);
  await ch.reply('om_3', '答');
  const calls = __inner().replyCalls.slice(-2);
  assert.equal(calls[0].data.reply_in_thread, true, '话题里回进话题');
  assert.ok(!('reply_in_thread' in calls[1].data), '话题外不带');
  await ch.sendCard('oc_g', { x: 1 }, 'om_root');
  await ch.sendCard('oc_g', { x: 2 });
  const sent = __inner().sent.slice(-2);
  assert.deepEqual(sent[0].opts, { replyTo: 'om_root', replyInThread: true });
  assert.equal(sent[1].opts, undefined);
})

test('来源查询：群信息 / 通讯录名字；code≠0 抛错（解析器负责降级）；不再翻群成员', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start();
  __inner()._res();
  await p;
  const inner = __inner();
  inner.respond = ({ url }) => {
    if (url === '/open-apis/im/v1/chats/oc_1') return { code: 0, data: { name: '产品群', chat_mode: 'topic' } }
    if (url.startsWith('/open-apis/contact/v3/users/')) return { code: 99991672, msg: 'no permission' }
    return {}
  };
  assert.deepEqual(await ch.chatInfo('oc_1'), { name: '产品群', mode: 'topic' });
  await assert.rejects(ch.userName('ou_x'), /99991672/);
  assert.equal(ch.memberName, undefined, '不再提供群成员查询');
  const users = inner.requests.find((r) => r.url.startsWith('/open-apis/contact/v3/users/'));
  assert.deepEqual(users.params, { user_id_type: 'open_id' });
})

test('replyCard：interactive 回复提问消息，话题里带 reply_in_thread，回卡片消息 id', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start();
  __inner()._res();
  await p;
  const id = await ch.replyCard('om_q', { elements: [] }, true);
  assert.equal(id, 'om_reply_card');
  const c = __inner().replyCalls.at(-1);
  assert.deepEqual(c.path, { message_id: 'om_q' });
  assert.equal(c.data.msg_type, 'interactive');
  assert.equal(c.data.reply_in_thread, true);
  assert.deepEqual(JSON.parse(c.data.content), { elements: [] });
})

test('uploadImage：image_type=message 上传，回 image_key；SDK 抛的飞书错误码挂到 err.code', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start(); __inner()._res(); await p;
  const buf = Buffer.from('png');
  assert.equal(await ch.uploadImage(buf), 'img_up');
  assert.equal(__inner().imageCalls[0].data.image_type, 'message');
  assert.equal(__inner().imageCalls[0].data.image, buf);
  __inner().imageFail = Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { code: 99991672, msg: 'Access denied' } },
  });
  await assert.rejects(ch.uploadImage(buf), (e) => e.code === 99991672 && /Access denied/.test(e.message));
})

test('reply 带 keys：post 里有 key 的图出 img 标签', async () => {
  const ch = new LarkChannel({ appId: 'a', appSecret: 's', warn: () => {}, info: () => {} });
  const p = ch.start(); __inner()._res(); await p;
  await ch.reply('om_1', '![图](asset/a.png)', false, new Map([['asset/a.png', 'img_a']]));
  assert.deepEqual(JSON.parse(__inner().replyCalls[0].data.content).zh_cn.content, [[{ tag: 'img', image_key: 'img_a' }]]);
})
