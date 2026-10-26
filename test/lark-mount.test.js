import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mountLark } from '../src/lark/mount.ts';
import { ChatSessions } from '../src/lark/chats.ts';
import { makeVault } from './mcp-fixture.js';

// mountLark 的真实会话桥（通道工厂注入，不碰真 SDK；sessionController/agents/sessions 全假，
// chat→会话映射用真 ChatSessions 内存路由）。钉死：
// 1) 一机器人一通道；改配置（同长度换 secret 也算）整体拆旧建新；单个连接失败只摘自己；
// 2) 消息全链：确定性会话懒建（create 带 cwd、rename 带标题、配了 model 才 selectModel）→
//    followup 首条带约束指令（source.kind=lark）→ 宿主回合事件喂进来 → 回 Lark；
// 3) 新会话事件只轮换该 chat；删机器人清映射但绝不动 DSH 会话本体；
// 4) status 任何分支都不外露 app_secret。

const APP = (appId, appSecret = 'aaaaaaaaaa', folder = 'knowledge/ML', model = '') => ({ appId, appSecret, folder, model })

// 轮到谓词为真（有界自旋：挂死了给个痛快话而不是干等测试超时）
const until = async (fn, what = '条件') => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!fn()) throw new Error(`等不到：${what}`);
}

// 假会话：事件只记下来，供两项权限服务折叠
const fakeAgent = (id) => ({ id, followups: [], sent: [], send(m, target, wakeup) { this.sent.push({ m, target, wakeup }) }, followup(m) { this.followups.push(m) }, session: { id, events: [], append(type, data) { this.events.push({ type, data }) } } })
const lastOf = (session, type, key) => session.events.filter((e) => e.type === type).at(-1)?.data[key]
// 宿主权限预设服务（dsh-base 的内置表）：current 按两项旋钮折叠、匹配不上即 custom；
// set 记预设身份、只改不同的那项（照宿主 PermissionPresetService.apply）
const PRESETS = { 'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } }
const knobs = (s) => ({ sandbox: lastOf(s, 'sandbox/mode', 'mode') ?? 'workspace-write', approval: lastOf(s, 'approval/policy', 'policy') ?? 'ask' })
const fakePresets = () => ({
  current(s) { const k = knobs(s); return Object.entries(PRESETS).find(([, v]) => v.sandbox === k.sandbox && v.approval === k.approval)?.[0] ?? 'custom' },
  set(s, name) {
    const spec = PRESETS[name]; if (!spec) throw new Error(`permission: unknown preset "${name}"`)
    const k = knobs(s)
    if (this.current(s) !== name) s.append('permission/preset', { preset: name })
    if (spec.sandbox !== k.sandbox) s.append('sandbox/mode', { mode: spec.sandbox })
    if (spec.approval !== k.approval) s.append('approval/policy', { policy: spec.approval })
  },
})

const setup = (apps, opts = {}) => {
  const groupDir = opts.groupDir ?? '/tmp/lark-group-test';
  const cfgVars = { apps };
  const chats = new ChatSessions(undefined, 'test');
  const cfg = { apps: () => cfgVars.apps, chats, groupDir: () => groupDir, ...(opts.liveCards ? { liveOpts: { delayMs: 20, throttleMs: 5, heartbeatMs: 1_000 } } : {}) };
  const made = [];
  const replies = [];
  const makeChannel = (c) => {
    const ch = {
      cfg: c, botOpenId: 'ou_bot', botName: opts.botName ?? '小助', handler: null, chatNew: null, cardHandler: null,
      reply: async (messageId, text, inThread) => { replies.push({ messageId, text, ...(inThread ? { inThread } : {}) }) },
      sentCards: [], patchedCards: [],
      async sendCard(chatId, card, threadRoot) { const messageId = `om_card_${this.sentCards.length + 1}`; this.sentCards.push({ chatId, card, messageId, ...(threadRoot ? { threadRoot } : {}) }); return { messageId } },
      async updateCard(messageId, card) { this.patchedCards.push({ messageId, card }) },
      onMessage(h) { ch.handler = h }, onChatNew(h) { ch.chatNew = h }, onCardAction(h) { ch.cardHandler = h },
      repliedCards: [],
      ...(opts.liveCards ? { async replyCard(messageId, card, inThread) { const id = `om_live_${this.repliedCards.length + 1}`; this.repliedCards.push({ messageId, id, card, ...(inThread ? { inThread } : {}) }); return id } } : {}),
      lookups: [],
      async chatInfo(id) { this.lookups.push(['chat', id]); return { name: '产品群', mode: opts.chatMode ?? 'group' } },
      async userName(id) { this.lookups.push(['user', id]); return id === 'ou_zs' ? '张三' : '' },
      stopCalls: 0, startResolver: null,
      start() { return new Promise((res, rej) => { ch.startResolver = { res, rej } }) },
      stop() { this.stopCalls += 1; return Promise.resolve() },
    };
    made.push(ch);
    return ch;
  };
  const logs = { warn: [], info: [], error: [] };
  const handlers = {};   // mount 挂的宿主事件监听：session/event、agent/status、agent/error
  const calls = { create: [], rename: [], selectModel: [], cancel: [], flush: 0, withoutInitiator: 0 };
  const agentsBag = {};
  const ctx = {
    logger: { warn: (m) => logs.warn.push(m), info: (m) => logs.info.push(m), error: (m) => logs.error.push(m) },
    effect: (f) => { const d = f(); return () => { void d } },
    inject: (_list, cb) => cb(ctx),
    on: (ev, h) => { handlers[ev] = h; return () => {} },
    sessionController: {
      create: async (a) => { calls.create.push(a); const fail = opts.createFail?.(a); if (fail) throw fail },
      rename: async (a) => { calls.rename.push(a) },
      selectModel: async (a) => { calls.selectModel.push(a) },
      cancel: async (a) => { calls.cancel.push(a) },
      resolveAgent: async (sessionId) => ({ agent: agentsBag[sessionId] ??= fakeAgent(sessionId) }),
    },
    sessions: { flush: async () => { calls.flush += 1 } },
    agents: { withoutInitiator: async (fn) => { calls.withoutInitiator += 1; await fn() } },
    permissionPresets: fakePresets(),
  };
  if (opts.noPermissions) delete ctx.permissionPresets
  if (!opts.noWorkspace) ctx.workspaceRegistry = { create: async (p) => ({ id: 'ws-1', path: p, title: '知识问答' }) };
  const hub = opts.hub ?? { dir: () => '/tmp/vault', engine: { model: null, validating: false } };
  const handle = mountLark(ctx, hub, cfg, makeChannel);
  return { handle, made, cfgVars, chats, logs, handlers, calls, replies, agentsBag };
}

// 一条 p2p 文本消息从通道进来，走 mount 接好的完整链（service → askSession → 假宿主）
const poke = (made, text, o = {}) => {
  made[0].handler({ eventId: o.eventId ?? 'e1', chatId: o.chatId ?? 'oc_1', chatType: o.chatType ?? 'p2p', messageId: o.messageId ?? 'm1', senderId: o.senderId ?? 'ou_zs', messageType: 'text', text, mentionKeys: [], mentionOpenIds: o.mentionOpenIds ?? [], threadId: o.threadId, rootId: o.rootId });
}

// 喂宿主回合事件把一轮问答收场：running → assistant 文本 → 离开 running
const finishTurn = (handlers, sessionId, text) => {
  handlers['agent/status']({ agent: { id: sessionId }, status: 'running' });
  handlers['session/event'](sessionId, { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: [text] }] } });
  handlers['agent/status']({ agent: { id: sessionId }, status: 'idle' });
}
// 追问场景回合已开跑（running=true），收场只差文本＋空闲
const finishTurn2 = (handlers, sessionId, text) => {
  handlers['session/event'](sessionId, { type: 'assistant/message', data: { stream: [{ type: 'text-chunks', texts: [text] }] } });
  handlers['agent/status']({ agent: { id: sessionId }, status: 'idle' });
}

test('一个机器人一条通道；两个机器人各一条（互不共用）', async () => {
  const { handle, made } = setup([APP('cli_a')]);
  assert.equal(made.length, 1);
  made[0].startResolver.res();
  let st = handle.status();
  assert.equal(st.connected, true);
  assert.equal(st.serving, 1);
  assert.equal(st.apps[0].appId, 'cli_a');
  assert.equal(st.apps[0].folder, 'knowledge/ML');
  assert.equal(st.apps[0].name, '小助', '连上后带机器人名字（设置卡卡头用）');

  const h2 = setup([APP('cli_a'), APP('cli_b', 'bbbbbbbbbb', '工作')]);
  assert.equal(h2.made.length, 2, '两个机器人两条连接');
  assert.equal(h2.made[0].cfg.appId, 'cli_a');
  assert.equal(h2.made[1].cfg.appId, 'cli_b');
  h2.made.forEach((ch) => ch.startResolver.res());
  st = h2.handle.status();
  assert.equal(st.connected, true);
  assert.equal(st.apps.length, 2);
})

test('同长度换 app_secret（重置密钥）也要重启：旧通道停、新通道建', async () => {
  const { handle, made, cfgVars } = setup([APP('cli_a')]);
  made[0].startResolver.res();                 // 第一代连上
  cfgVars.apps = [APP('cli_a', 'bbbbbbbbbb')]; // 定长换值
  handle.restart();
  assert.equal(made.length, 2, '签名变了该建新通道');
  assert.equal(made[0].stopCalls, 1, '旧通道要停');
  made[1].startResolver.res();
})

test('某个机器人连接失败只摘自己：其余照常，总体 connected=false 但逐个可见', async () => {
  const { handle, made } = setup([APP('cli_a'), APP('cli_b')]);
  made[0].startResolver.rej(new Error('凭证不对'));   // cli_a 连不上
  made[1].startResolver.res();                        // cli_b 正常
  await new Promise((r) => setTimeout(r, 0));
  const st = handle.status();
  assert.equal(st.connected, false, '有一个没连上，总体不算已连接');
  assert.equal(st.apps[0].appId, 'cli_a');
  assert.equal(st.apps[0].connected, false);
  assert.equal(st.apps[1].connected, true);
})

test('零机器人：不建通道，status 未连接', () => {
  const { handle, made, logs } = setup([]);
  assert.equal(made.length, 0);
  const st = handle.status();
  assert.equal(st.connected, false);
  assert.deepEqual(st.apps, []);
  assert.ok(logs.info.some((m) => /没有配置机器人/.test(m)));
})

test('消息全链：懒建会话、派发、收事件并回 Lark（不加表情回复）', async () => {
  const { made, handlers, calls, replies, chats } = setup([APP('cli_a', 'aaaaaaaaaa', '知识/晨思', 'deepseek/reasoner')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';

  poke(made, '什么是格物致知？');
  await until(() => calls.flush === 1, 'followup 落盘');
  // 懒建三件套：确定性 id + 会话组；标题可读；模型取自机器人配置
  assert.deepEqual(calls.create, [{ sessionId: sid, workspaceId: 'ws-1' }]);
  assert.deepEqual(calls.rename.map((r) => r.sessionId), [sid]);
  assert.equal(calls.rename[0].title, '单聊 · 张三 #1', '标题按来源：单聊 · 提问人');
  assert.deepEqual(calls.selectModel, [{ sessionId: sid, provider: 'deepseek', model: 'reasoner' }], '配了 model 才选，拆 provider/model');

  // 首条 followup 的消息形状在下一个测试里单测；这里先把这一轮收场
  finishTurn(handlers, sid, '出自「晨思」的答案');
  await until(() => replies.length === 1, '回复送达');
  assert.equal(replies[0].messageId, 'm1');
  assert.equal(replies[0].text, '出自「晨思」的答案');
  // 回复后映射在册（touch 生效）
  assert.equal(chats.list('cli_a')[0].current, sid);

  // 第二条消息：续用当前会话（不再 create/选模型），只发裸问题
  poke(made, '再展开讲讲', { eventId: 'e2', messageId: 'm2' });
  await until(() => calls.flush === 2, '第二轮 followup');
  assert.equal(calls.create.length, 1, '当前会话续用，不重建');
  assert.equal(calls.selectModel.length, 1);
  finishTurn(handlers, sid, '第二轮的答案');
  await until(() => replies.length === 2, '第二条回复');
  assert.equal(replies[1].text, '第二轮的答案');
})

// pre-step 瀑布：喂一步的 messages，模拟宿主其余监听原样放行
const preStep = (handlers, sid, messages, step = 1) =>
  handlers['agent/pre-step']({ agent: { id: sid }, messages, turn: 1, step }, async () => ({ kind: 'enter', messages }))

test('首轮人设：不单独排一轮；问题 source=user 开回合，第一步进场时人设插到问题前面，只插一次', async () => {
  const { made, calls, agentsBag, chats, handlers } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  poke(made, '你好');
  await until(() => calls.flush === 1, 'followup 落盘');
  const sid = 'lark-cli-a-oc-1-test-0';
  const agent = agentsBag[sid];
  assert.equal(agent.sent.length, 0, '人设不再排进下一回合（那样会自成一轮）');
  assert.equal(agent.followups.length, 1);
  const q = agent.followups[0];
  assert.equal(q.source.kind, 'user', '问题是用户发言（宿主显示成用户气泡）');
  assert.deepEqual(q.content, [{ type: 'text', text: '你好' }], '问题原样，不拼人设');

  const d = await preStep(handlers, sid, [q]);
  assert.equal(d.kind, 'enter');
  assert.equal(d.messages.length, 2, '人设与问题同一步进场');
  const [persona, question] = d.messages;
  assert.equal(persona.source.kind, 'lark', '人设是 lark 注入的上下文（宿主折叠显示）');
  const text = String(persona.content?.[0]?.text ?? '');
  assert.ok(text.includes('「knowledge/ML」文件夹里的页面'), '带文件夹约束指令');
  assert.ok(text.includes('我是「小助」'), '人设名取通道的 botName');
  assert.equal(question, q, '问题原样跟在人设后');

  const d2 = await preStep(handlers, sid, [], 2);
  assert.deepEqual(d2.messages, [], '同一回合后续步骤不再插（已在历史里）');
  assert.equal(chats.list('cli_a').length, 1, 'ensureSession 已 bind');
})

test('首轮人设：续轮不插；非问答会话、拒绝的步骤原样放行', async () => {
  const { made, calls, agentsBag, handlers } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  poke(made, '第一问');
  await until(() => calls.flush === 1, '首轮');
  await preStep(handlers, sid, [agentsBag[sid].followups[0]]);
  finishTurn(handlers, sid, '答一');
  await new Promise((r) => setTimeout(r, 10));

  poke(made, '第二问', { eventId: 'e2', messageId: 'm2' });
  await until(() => calls.flush === 2, '续轮');
  const q2 = agentsBag[sid].followups[1];
  const d = await preStep(handlers, sid, [q2]);
  assert.deepEqual(d.messages, [q2], '续轮只有问题');

  const other = { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] };
  assert.deepEqual((await preStep(handlers, 'someone-else', [other])).messages, [other], '别的会话不动');
  const rej = await handlers['agent/pre-step']({ agent: { id: sid }, messages: [], turn: 1, step: 1 }, async () => ({ kind: 'reject' }));
  assert.deepEqual(rej, { kind: 'reject' }, '拒绝原样放行');
  finishTurn(handlers, sid, '答二');
})

test('群聊：标题「群 · 群名 · 提问人」，问题带提问人前缀；查不到名字退 open_id 短码', async () => {
  const { made, calls, agentsBag, handlers } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  poke(made, '报销怎么走', { chatId: 'oc_g', chatType: 'group', mentionOpenIds: ['ou_bot'], senderId: 'ou_abcdef123456' });
  await until(() => calls.flush === 1, 'followup 落盘');
  assert.equal(calls.rename[0].title, '群 · 产品群 · 用户123456 #1');
  const sid = calls.create[0].sessionId;
  assert.deepEqual(agentsBag[sid].followups[0].content, [{ type: 'text', text: '用户123456：报销怎么走' }]);
  assert.ok(made[0].lookups.some(([k, id]) => k === 'user' && id === 'ou_abcdef123456'), '名字只查通讯录');
  finishTurn(handlers, sid, 'ok');
})

test('话题群：标题「话题群 · 群名 · 话题首句」', async () => {
  const { made, calls, handlers } = setup([APP('cli_a')], { chatMode: 'topic' });
  made[0].startResolver.res();
  poke(made, '发版窗口怎么定', { chatId: 'oc_t', chatType: 'group', threadId: 'omt_1', messageId: 'om_root' });
  await until(() => calls.flush === 1, 'followup 落盘');
  assert.equal(calls.rename[0].title, '话题群 · 产品群 · 发版窗口怎么定 #1');
  finishTurn(handlers, calls.create[0].sessionId, 'ok');
})

test('新会话事件只轮换该 chat：旧会话进 past，下条消息开新会话', async () => {
  const { made, handlers, calls, chats, replies } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  poke(made, '第一问');
  await until(() => calls.flush === 1, '首轮 followup');
  finishTurn(handlers, sid, '答一');
  // 等第一回合整个收尾（回复送达 + 锁释放），再轮换——否则第二问会撞上忙路
  await until(() => replies.length === 1, '第一答回复');
  await new Promise((r) => setTimeout(r, 0));

  made[0].chatNew({ chatId: 'oc_1', chatType: 'p2p' });   // 用户在 Lark 里开了新会话
  const rec = chats.list('cli_a')[0];
  assert.equal(rec.current, '', '轮换后当前会话置空（懒建）');
  assert.deepEqual(rec.past, [{ id: sid, title: '单聊 · 张三 #1' }], '旧会话带标题归档');

  poke(made, '新会话的第一问', { eventId: 'e2', messageId: 'm2' });
  await until(() => calls.create.length === 2, '重建会话');
  const sid2 = calls.create[1].sessionId;
  assert.equal(sid2, 'lark-cli-a-oc-1-test-1', '序号避开已归档的 -0');
  await until(() => calls.flush === 2, '第二轮 followup（waiter 已挂再收场）');
  finishTurn(handlers, sid2, '答二');
  await until(() => chats.list('cli_a')[0].current === sid2, 'bind 新会话');
  await until(() => replies.length === 2, '第二答回复');
})

test('删机器人：映射清掉，但绝不触碰 DSH 会话本体（无删除调用，create 记录原样）', async () => {
  const { handle, made, cfgVars, chats, calls } = setup([APP('cli_a'), APP('cli_b')]);
  made.forEach((ch) => ch.startResolver.res());
  // cli_a 有在册映射
  chats.bind('cli_a', 'oc_1', 'lark-cli-a-oc-1-test-0', 'Lark 问答 · 小助 #1', 'p2p');
  chats.bind('cli_b', 'oc_9', 'lark-cli-b-oc-9-test-0', 'Lark 问答 · 小助 #1', 'group');

  cfgVars.apps = [APP('cli_b')];   // cli_a 从配置里删掉
  handle.restart();
  assert.equal(chats.list('cli_a').length, 0, '删掉的机器人映射清空');
  assert.equal(chats.list('cli_b').length, 1, '留下的机器人不受影响');
  assert.equal(made[0].stopCalls, 1);
  assert.equal(made[1].stopCalls, 1, '留下的机器人也整体重建（拆旧建新，不是增量保留）');
  assert.equal(made.length, 3, '两条旧通道 + cli_b 的一条新通道');
  assert.equal(made[2].cfg.appId, 'cli_b');
  // DSH 会话本体不动：宿主侧只有 create/rename/selectModel/cancel 这些调用记录，没有删除
  assert.equal(calls.cancel.length, 0, '不该去取消/删除宿主会话');
})

test('status 任何分支都不外露 app_secret（含未注入的兜底分支）', () => {
  const { handle } = setup([APP('cli_a', 'SECRET_VALUE')]);
  assert.ok(!JSON.stringify(handle.status()).includes('SECRET_VALUE'), 'secret 不得出现在 RPC 响应里');
  // agents/sessions/sessionController 没注入时走外层委托的兜底分支——最容易顺手摊整个 entry 的地方
  const cfg = { apps: () => [APP('cli_x', 'SECRET_FALLBACK')], chats: new ChatSessions() };
  const ctx = { logger: { warn() {}, info() {}, error() {} }, effect() {}, inject() {} };
  const handle2 = mountLark(ctx, { dir: () => '/tmp/v', engine: { model: null } }, cfg, () => { throw new Error('没注入就不该建通道') });
  assert.ok(!JSON.stringify(handle2.status()).includes('SECRET_FALLBACK'));
  assert.ok(!JSON.stringify(handle2.status()).includes('appSecret'));
})

test('followup 派发失败：回错误话术、detail 进日志，会话映射照常建册', async () => {
  const { made, replies, logs, agentsBag } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  agentsBag['lark-cli-a-oc-1-test-0'] = { ...fakeAgent('lark-cli-a-oc-1-test-0'), followup() { throw new Error('会话已归档') } };
  poke(made, '你好');
  await until(() => replies.length === 1, '错误回复送达');
  assert.equal(replies[0].text, '当前问答会话已归档，请发送「新会话」后再提问');
  assert.ok(logs.warn.some((m) => /派发失败：会话已归档/.test(m)), 'detail 要进日志（桌面端不落盘，这是唯一现场）');
})

test('归档会话的 blocked 回合：回复发送「新会话」提示', async () => {
  const { made, handlers, calls, replies } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  poke(made, '继续问');
  await until(() => calls.flush === 1, 'followup 落盘');
  handlers['session/event'](sid, { type: 'turn/end', data: { reason: { kind: 'blocked' } } });
  await until(() => replies.length === 1, '归档提示送达');
  assert.equal(replies[0].text, '当前问答会话已归档，请发送「新会话」后再提问');
})

// —— 问答会话只读：宿主内置「仅可查看」预设 ——
const perms = (agent) => agent.session.events.filter((e) => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(e.type))

test('问答会话只读：首问前切到「仅可查看」预设（不是 custom）；已是该预设不重复追加', async () => {
  const { made, handlers, calls, replies, agentsBag } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  poke(made, '第一问');
  await until(() => calls.flush === 1, '首轮 followup');
  const agent = agentsBag[sid];
  assert.deepEqual(perms(agent), [
    { type: 'permission/preset', data: { preset: 'read-only' } },
    { type: 'sandbox/mode', data: { mode: 'read-only' } },
  ], '记预设身份、只改沙箱（审批本就是 ask）');
  assert.equal(fakePresets().current(agent.session), 'read-only', '界面上显示预设名，不是自定义');
  finishTurn(handlers, sid, '答一');
  await until(() => replies.length === 1, '第一答');
  await new Promise((r) => setTimeout(r, 0));
  poke(made, '第二问', { eventId: 'e2', messageId: 'm2' });
  await until(() => calls.flush === 2, '第二轮 followup');
  assert.equal(perms(agent).length, 2, '已是只读不再追加事件');
})

test('问答会话只读：被放开成完全权限、或停在上一版硬只读（custom）的老会话，下一问前拉回「仅可查看」', async () => {
  for (const [sandbox, approval] of [['danger-full-access', 'never'], ['read-only', 'never']]) {
    const { made, calls, agentsBag } = setup([APP('cli_a')]);
    made[0].startResolver.res();
    const sid = 'lark-cli-a-oc-1-test-0';
    const agent = agentsBag[sid] = fakeAgent(sid);
    agent.session.append('sandbox/mode', { mode: sandbox });
    agent.session.append('approval/policy', { policy: approval });
    poke(made, '你好');
    await until(() => calls.flush === 1, 'followup 落盘');
    assert.equal(fakePresets().current(agent.session), 'read-only', `${sandbox}+${approval} 应拉回仅可查看`);
  }
})

test('宿主缺权限预设服务：拒绝派发，不在不受限的会话里答', async () => {
  const { made, replies, logs, calls, agentsBag } = setup([APP('cli_a')], { noPermissions: true });
  made[0].startResolver.res();
  poke(made, '你好');
  await until(() => replies.length === 1, '失败回复送达');
  assert.equal(calls.flush, 0, '没落盘任何一轮');
  assert.equal(agentsBag['lark-cli-a-oc-1-test-0']?.followups.length ?? 0, 0, '问题没发给 agent');
  assert.ok(logs.warn.some((m) => /无法限定只读/.test(m)), '原因进日志');
})

// —— 会话组（Workspace）——
test('建组：create 带 workspaceId 不再带 cwd，目录经 workspaceRegistry 注册', async () => {
  const { made, calls, logs } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  poke(made, '你好');
  await until(() => calls.flush === 1, 'followup 落盘');
  assert.deepEqual(calls.create, [{ sessionId: 'lark-cli-a-oc-1-test-0', workspaceId: 'ws-1' }]);
  assert.ok(logs.info.some((m) => /已归组/.test(m)), '归组要有一次 info（现场在日志里）');
})

test('确定性 id 被组外 cwd 的老会话占住：create 拒绝领养 → 归档跳号重试，新会话照常建', async () => {
  const { made, calls, chats } = setup([APP('cli_a')], {
    // -0 已被库目录 cwd 的老会话占住（模拟极少见的 id 冲突）；从 -1 起放行
    createFail: (a) => /-0$/.test(a.sessionId)
      ? new Error(`session "${a.sessionId}" belongs to "/tmp/vault", not "/tmp/lark-group-test"`)
      : null,
  });
  made[0].startResolver.res();
  poke(made, '你好');
  await until(() => calls.flush === 1, 'followup 落盘');
  assert.deepEqual(calls.create.map((c) => c.sessionId), ['lark-cli-a-oc-1-test-0', 'lark-cli-a-oc-1-test-1'], '被拒后跳号重试');
  const rec = chats.list('cli_a')[0];
  assert.equal(rec.current, 'lark-cli-a-oc-1-test-1');
  assert.ok(rec.past.some((p) => p.id === 'lark-cli-a-oc-1-test-0'), '占住的老会话归档（它本来就是历史）');
})

test('拿不到 workspaceRegistry：建组失败退回库目录 cwd，warn 进日志，问答照常', async () => {
  const { made, calls, logs } = setup([APP('cli_a')], { noWorkspace: true });
  made[0].startResolver.res();
  poke(made, '你好');
  await until(() => calls.flush === 1, 'followup 落盘');
  assert.deepEqual(calls.create, [{ sessionId: 'lark-cli-a-oc-1-test-0', cwd: '/tmp/vault' }], '退回分组前的老行为');
  assert.ok(logs.warn.some((m) => /问答会话组未建立/.test(m)));
})

test('手动「新会话」指令全链：回确认、当前会话归档，下条消息建新会话（标题序号递增）', async () => {
  const { made, handlers, calls, chats, replies } = setup([APP('cli_a')])
  made[0].startResolver.res()
  const sid = 'lark-cli-a-oc-1-test-0'
  poke(made, '第一问')
  await until(() => calls.flush === 1, '首轮 followup')
  finishTurn(handlers, sid, '答一')
  await until(() => replies.length === 1, '第一答回复')
  await new Promise((r) => setTimeout(r, 0))

  poke(made, '新会话', { eventId: 'e2', messageId: 'm2' })
  await until(() => replies.length === 2, '确认回复送达')
  assert.equal(replies[1].text, '已准备好新会话，可以继续提问了')
  assert.equal(chats.list('cli_a')[0].current, '', '当前会话已清空')

  poke(made, '新会话的第一问', { eventId: 'e3', messageId: 'm3' })
  await until(() => calls.create.length === 2, '懒建新会话')
  const sid2 = calls.create[1].sessionId
  assert.equal(sid2, 'lark-cli-a-oc-1-test-1', '序号避开归档的 -0')
  assert.match(calls.rename[1].title, /#2$/, '标题序号跟着 past 走')
  await until(() => calls.flush === 2, '第二轮 followup')
  finishTurn(handlers, sid2, '答二')
  await until(() => replies.length === 3, '第二答回复')
})

// —— AI 追问（AskUserQuestion）→ Lark 交互卡片 ——
// 走到追问的前提是回合已开跑：先 poke 出一轮、running=true，再从宿主瀑布发问。
const startTurn = (made, handlers, calls) => async (sid) => {
  poke(made, '帮我整理');
  await until(() => calls.flush === 1, 'followup 落盘');
  handlers['agent/status']({ agent: { id: sid }, status: 'running' });
}
// 被认领的追问若落进这个 next()，说明认领判据漏了——直接判负
const NOT_MINE = () => Promise.reject(new Error('Lark 会话的追问不该交给宿主 UI'))

test('单选追问：点按钮 → 答案回瀑布，卡片锁已作答，回合照常收场', async () => {
  const { made, handlers, calls, replies } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [{ id: 'q1', question: '答哪部分？', options: [{ label: '定义' }, { label: '出处' }] }],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  const cardJson = JSON.stringify(made[0].sentCards[0].card);
  assert.ok(cardJson.includes('"value":{"q":"q1","o":"定义"}'), '按钮 value 带问题 id 与选项 label');
  assert.ok(cardJson.includes('出处'), '每个选项一个按钮');
  made[0].cardHandler({ messageId: made[0].sentCards[0].messageId, chatId: 'oc_1', value: { q: 'q1', o: '定义' } });
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['定义'] }] }, '结构化答案原样回瀑布');
  await until(() => made[0].patchedCards.length === 1, '卡片锁定');
  assert.ok(JSON.stringify(made[0].patchedCards[0].card).includes('已作答'));
  // 追问收卡后回合继续：收场照常、答案回 Lark
  finishTurn2(handlers, sid, '整理好了');
  await until(() => replies.length === 1, '回复送达');
})

test('多选追问：勾选即刷卡片（✓），提交定稿所选集合', async () => {
  const { made, handlers, calls } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [{ id: 'q1', question: '带哪些？', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] }],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  const mid = made[0].sentCards[0].messageId;
  made[0].cardHandler({ messageId: mid, chatId: 'oc_1', value: { q: 'q1', o: 'a' } });
  made[0].cardHandler({ messageId: mid, chatId: 'oc_1', value: { q: 'q1', o: 'b' } });
  await until(() => made[0].patchedCards.length === 2, '每次勾选都刷新卡片');
  assert.ok(JSON.stringify(made[0].patchedCards[1].card).includes('✓ a'), '勾选项高亮');
  made[0].cardHandler({ messageId: mid, chatId: 'oc_1', value: { q: 'q1', s: '1' } });
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['a', 'b'] }] });
})

test('追问挂起时来的文字＝自由作答：不当新问题，回填 custom 后收卡', async () => {
  const { made, handlers, calls, replies } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid }, questions: [{ id: 'q1', question: '你想问哪个文件夹？' }],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  poke(made, '认知', { eventId: 'e2', messageId: 'm2' });   // 挂卡期间用户回文字
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: [], custom: '认知' }] });
  assert.equal(calls.flush, 1, '那条文字被卡片吃掉，不进正常问答流');
  assert.equal(replies.length, 0, '也不回「还在想」');
  finishTurn2(handlers, sid, '好');
  await until(() => replies.length === 1, '回复送达');
})

test('多题追问：按钮＋文字混合作答，全部定稿才收卡', async () => {
  const { made, handlers, calls } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [
      { id: 'q1', question: '用哪种格式？', options: [{ label: '列表' }, { label: '表格' }] },
      { id: 'q2', question: '多长为宜？' },
    ],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  const mid = made[0].sentCards[0].messageId;
  made[0].cardHandler({ messageId: mid, chatId: 'oc_1', value: { q: 'q1', o: '表格' } });
  await new Promise((r) => setTimeout(r, 0));   // q1 定稿但 q2 未答，还没收卡
  assert.equal(made[0].patchedCards.filter((p) => JSON.stringify(p.card).includes('已作答')).length, 0, '没全答完不收卡');
  poke(made, '半页', { eventId: 'e2', messageId: 'm2' });
  assert.deepEqual(await answer, {
    answers: [
      { id: 'q1', selected: ['表格'] },
      { id: 'q2', selected: [], custom: '半页' },
    ],
  });
})

test('多题追问（文字题在前）：点按钮后刷卡标 ✓；先回的文字落到纯文字题，不占有按钮的题', async () => {
  const { made, handlers, calls } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [
      { id: 'what', question: '想找什么功能的入口？' },
      { id: 'end', question: '在哪端找？', options: [{ label: 'PC' }, { label: '手机' }] },
      { id: 'more', question: '还有补充吗？' },
    ],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  const mid = made[0].sentCards[0].messageId;
  made[0].cardHandler({ messageId: mid, chatId: 'oc_1', value: { q: 'end', o: '手机' } });
  await until(() => made[0].patchedCards.length === 1, '点完刷新卡片');
  assert.ok(JSON.stringify(made[0].patchedCards[0].card).includes('✓ 手机'), '所选项可见');
  poke(made, '请假', { eventId: 'e2', messageId: 'm2' });
  await until(() => made[0].patchedCards.length === 2, '文字作答后再刷卡片');
  assert.ok(JSON.stringify(made[0].patchedCards[1].card).includes('已回复：请假'), '文字答案回显');
  poke(made, '没有', { eventId: 'e3', messageId: 'm3' });
  assert.deepEqual(await answer, {
    answers: [
      { id: 'what', selected: [], custom: '请假' },
      { id: 'end', selected: ['手机'] },
      { id: 'more', selected: [], custom: '没有' },
    ],
  });
})

test('文字先于按钮：落到第一道纯文字题，有按钮的题留给按钮', async () => {
  const { made, handlers, calls } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [
      { id: 'end', question: '在哪端找？', options: [{ label: 'PC' }, { label: '手机' }] },
      { id: 'what', question: '想找什么功能的入口？' },
    ],
  }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  poke(made, '请假', { eventId: 'e2', messageId: 'm2' });
  made[0].cardHandler({ messageId: made[0].sentCards[0].messageId, chatId: 'oc_1', value: { q: 'end', o: 'PC' } });
  assert.deepEqual(await answer, {
    answers: [
      { id: 'end', selected: ['PC'] },
      { id: 'what', selected: [], custom: '请假' },
    ],
  });
})

test('非 Lark 问答会话的追问不认领：原样 next() 交给宿主，不发卡', async () => {
  const { made, handlers } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  let passed = false;
  const r = await handlers['user-questions/request'](
    { agent: { id: '别的会话' }, questions: [{ id: 'q1', question: 'x' }] },
    async () => { passed = true; return { answers: [] } },
  );
  assert.ok(passed, '要调 next() 交回');
  assert.deepEqual(r, { answers: [] });
  assert.equal(made[0].sentCards.length, 0, '不该发卡');
})

test('回合中止（abort）：卡片锁「回合已中止」，瀑布收到拒绝', async () => {
  const { made, handlers, calls, replies } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  await startTurn(made, handlers, calls)(sid);
  const signal = {
    aborted: false,
    addEventListener(_t, f) { this._fire = f },
    removeEventListener() {},
  };
  const answer = handlers['user-questions/request'](
    { agent: { id: sid }, questions: [{ id: 'q1', question: '还继续吗？', options: [{ label: '继续' }] }], signal },
    NOT_MINE,
  );
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  signal._fire();
  await assert.rejects(() => answer, /中止/);
  await until(() => made[0].patchedCards.length === 1, '卡片锁中止态');
  assert.ok(JSON.stringify(made[0].patchedCards[0].card).includes('回合已中止'));
  // 卡片已摘：这时来的文字不再被当自由作答——回合还挂着锁，走正常忙路
  poke(made, '继续', { eventId: 'e9', messageId: 'm9' });
  await until(() => replies.length === 1, '忙路回复送达');
  assert.equal(replies[0].text, '上一条还在想，稍等一下再问');
})

// —— 检测后补连：启动那下连失败的机器人被摘出 chans、不会自己重试，靠 reconnect 再起一条 ——
test('补连：启动时连失败的机器人，reconnect 再起一条通道，连上后状态转已连接', async () => {
  const { handle, made } = setup([APP('cli_a'), APP('cli_b', 'bbbbbbbbbb')]);
  made[0].startResolver.rej(new Error('网络未就绪'));
  made[1].startResolver.res();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(handle.status().apps[0].connected, false, '启动失败后摘掉');
  const p = handle.reconnect('cli_a');
  assert.equal(made.length, 3, '为 cli_a 新建一条通道');
  assert.equal(made[2].cfg.appId, 'cli_a');
  assert.equal(made[2].cfg.appSecret, 'aaaaaaaaaa', '凭证取已存配置');
  made[2].startResolver.res();
  assert.deepEqual(await p, { saved: true, connected: true });
  assert.equal(handle.status().apps[0].connected, true);
  assert.equal(handle.status().connected, true, '两个都连上');
})

test('补连：已连着（或正在连）不另起通道，免得同一 app_id 两条长连接', async () => {
  const { handle, made } = setup([APP('cli_a')]);
  assert.deepEqual(await handle.reconnect('cli_a'), { saved: true, connected: true, already: true }, '正在连也算');
  made[0].startResolver.res();
  assert.deepEqual(await handle.reconnect('cli_a'), { saved: true, connected: true, already: true });
  assert.equal(made.length, 1);
})

test('补连：再次失败回原因并摘掉；连点两次共用一次在途补连', async () => {
  const { handle, made, logs } = setup([APP('cli_a')]);
  made[0].startResolver.rej(new Error('首连失败'));
  await new Promise((r) => setTimeout(r, 0));
  const p1 = handle.reconnect('cli_a');
  const p2 = handle.reconnect('cli_a');
  assert.equal(made.length, 2, '并发两次只起一条');
  made[1].startResolver.rej(new Error('凭证被重置'));
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, { saved: true, connected: false, detail: '凭证被重置' });
  assert.deepEqual(r2, r1);
  assert.equal(handle.status().apps[0].connected, false);
  assert.ok(logs.error.some((m) => /凭证被重置/.test(m)));
  // 失败后可以再补
  const p3 = handle.reconnect('cli_a');
  assert.equal(made.length, 3);
  made[2].startResolver.res();
  assert.equal((await p3).connected, true);
})

test('补连：已存配置里没有这个机器人（草稿）不建通道', async () => {
  const { handle, made } = setup([APP('cli_a')]);
  assert.deepEqual(await handle.reconnect('cli_draft'), { saved: false, connected: false });
  assert.equal(made.length, 1);
})


// 话题全链：新话题不 @ 直接建会话（键带根消息）→ 追问卡片回进同一话题 → 回复回进话题
test('话题：新话题直接答，追问卡片与回复都回进该话题', async () => {
  const { made, handlers, calls, replies, chats } = setup([APP('cli_a')]);
  made[0].startResolver.res();
  poke(made, '报销怎么走', { chatType: 'group', messageId: 'om_root', threadId: 'omt_1' });
  await until(() => calls.flush === 1, '新话题已派发');
  const rec = chats.list('cli_a')[0];
  assert.equal(rec.chatId, 'oc_1#om_root', '一个话题一个会话');
  const sid = rec.current;
  assert.equal(calls.create[0].sessionId, sid);
  handlers['agent/status']({ agent: { id: sid }, status: 'running' });
  const answer = handlers['user-questions/request']({ agent: { id: sid }, questions: [{ id: 'q1', question: '哪类报销？', options: [{ label: '差旅' }] }] }, NOT_MINE);
  await until(() => made[0].sentCards.length === 1, '追问卡片已发');
  assert.equal(made[0].sentCards[0].chatId, 'oc_1', '卡片发到真实 chat');
  assert.equal(made[0].sentCards[0].threadRoot, 'om_root', '卡片回进该话题');
  made[0].cardHandler({ messageId: made[0].sentCards[0].messageId, chatId: 'oc_1', value: { q: 'q1', o: '差旅' } });
  await answer;
  finishTurn2(handlers, sid, '差旅这样报');
  await until(() => replies.length === 1, '回复送达');
  assert.deepEqual(replies[0], { messageId: 'om_root', text: '差旅这样报', inThread: true });
})

test('回复卡片全程：思考中 → AI 追问换成题卡（不另发）→ 作答后回到思考中 → 收场换成答案', async () => {
  const { made, handlers, calls, replies } = setup([APP('cli_a')], { liveCards: true });
  made[0].startResolver.res();
  const sid = 'lark-cli-a-oc-1-test-0';
  poke(made, '退款审批怎么对接');
  await until(() => calls.flush === 1, 'followup 落盘');
  handlers['agent/status']({ agent: { id: sid }, status: 'running' });
  handlers['session/event'](sid, { type: 'tool/call', data: { name: 'wiki_search', arguments: '{"query":"退款 审批"}' } });
  await until(() => made[0].repliedCards.length === 1, '思考卡作为回复发出');
  const live = made[0].repliedCards[0];
  assert.equal(live.messageId, 'm1');
  assert.match(JSON.stringify(live.card), /思考中[\s\S]*检索：退款 审批/);

  const answer = handlers['user-questions/request']({
    agent: { id: sid },
    questions: [{ id: 'q1', header: '对接方式', question: '走哪种？', options: [{ label: '回调' }, { label: '轮询' }] }],
  }, NOT_MINE);
  await until(() => made[0].patchedCards.some((c) => JSON.stringify(c.card).includes('需要你选择')), '同一张卡换成题卡');
  assert.equal(made[0].sentCards.length, 0, '不另发题卡');
  assert.ok(made[0].patchedCards.every((c) => c.messageId === live.id));

  made[0].cardHandler({ messageId: live.id, chatId: 'oc_1', value: { q: 'q1', o: '回调' } });
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['回调'] }] });
  await until(() => /思考中/.test(JSON.stringify(made[0].patchedCards.at(-1).card)), '作答后回到思考中');
  assert.doesNotMatch(JSON.stringify(made[0].patchedCards.at(-1).card), /已作答/, '思考卡只列检索与阅读');

  finishTurn2(handlers, sid, '用回调对接，步骤如下');
  await until(() => JSON.stringify(made[0].patchedCards.at(-1).card).includes('用回调对接'), '收场换成答案');
  assert.doesNotMatch(JSON.stringify(made[0].patchedCards.at(-1).card), /思考中|需要你选择/);
  assert.deepEqual(replies, [], '答案在卡片里，不另发富文本');
})

// 设置卡一张卡一个状态：status 带库阶段；文件夹在不在按「有没有页」判断（与工具层同一口径，「/」= 整库）
test('status：带库阶段 phase；folderExists 按页判断，「/」有页即在', async () => {
  const v = makeVault();
  try {
    const hub = { dir: () => v.dir, engine: { model: v.m, validating: false } };
    const apps = [APP('cli_a', 'aaaaaaaaaa', 'knowledge/ML'), APP('cli_b', 'aaaaaaaaaa', 'knowledge/Gone'), APP('cli_c', 'aaaaaaaaaa', '/')];
    const { handle, made } = setup(apps, { hub });
    made.forEach((ch) => ch.startResolver.res());
    const st = handle.status();
    assert.equal(st.phase, 'ok');
    assert.deepEqual(st.apps.map((a) => a.folderExists), [true, false, true]);
    // 磁盘上有目录但没页（空文件夹）也算不在
    const fs = await import('node:fs'); const path = await import('node:path');
    fs.mkdirSync(path.join(v.dir, 'knowledge/Empty'), { recursive: true });
    const h2 = setup([APP('cli_e', 'aaaaaaaaaa', 'knowledge/Empty')], { hub });
    h2.made[0].startResolver.res();
    assert.equal(h2.handle.status().apps[0].folderExists, false);
  } finally { v.cleanup() }
})

test('status：库校验中 / 没配库 / 打不开 → phase 对应，未挂载的兜底分支也带', () => {
  const val = setup([APP('cli_a')], { hub: { dir: () => '/tmp/vault', engine: { model: null, validating: true } } });
  assert.equal(val.handle.status().phase, 'validating');
  const none = setup([APP('cli_a')], { hub: { dir: () => '', engine: { model: null, validating: false } } });
  assert.equal(none.handle.status().phase, 'none');
  const failed = setup([APP('cli_a')]);
  assert.equal(failed.handle.status().phase, 'failed');
  // 宿主会话服务没注入：外层兜底视图
  const hub = { dir: () => '/tmp/vault', engine: { model: null, validating: true } };
  const ctx = { inject: () => {}, effect: () => () => {}, on: () => () => {}, logger: { warn() {}, info() {}, error() {} } };
  const cfg = { apps: () => [APP('cli_a')], chats: new ChatSessions() };
  const fb = mountLark(ctx, hub, cfg, () => { throw new Error('不该建通道') }).status();
  assert.equal(fb.phase, 'validating');
  assert.equal(fb.apps[0].folderExists, false);
  assert.ok(!JSON.stringify(fb).includes('aaaaaaaaaa'), '兜底视图也不带 app_secret');
})
