import { test } from 'vitest';
import assert from 'node:assert/strict';
import { openScene, applyDraft, wireFills, fillText, takeDraft, queueDraft, currentSession, latestVault, vaultSessions } from '../src/client/lib/sessions.ts';
import { requestFill } from '../src/client/lib/fill.ts';
import { rightOf, createPanelState } from '../src/client/reader/panel.ts';

// 右栏会话：打开右栏默认挂「当前会话」（库目录最近一场，没有就新建）；空库首页不再自动开栏、
// 不自动建引导会话。场景按钮（知识沉淀、提炼、空库第一步）每点一次新开一场会话，填好这个场景的
// 指令并直接发送（排队草稿带 send，会话输入框挂上时 setDraft 后 submit）。

function platform(byId) {
  const calls = { sessions: 0 };
  const services = {
    workspaces: { create: async () => ({ workspaceId: 'ws1' }) },
    sessions: {
      create: async () => `sid-${++calls.sessions}`,
      retain: () => ({ release: () => {} }),
      scope: (id) => `scope#${id}`,
      ...(byId ? { list: { getSnapshot: () => ({ byId }) } } : {}),
    },
    uiWorkspace: { openSession: async () => {} },
    conversation: { input: { for: () => ({ setDraft: () => {} }) } },
  };
  return { c: { get: (n) => services[n] }, calls };
}

const api = () => ({ status: async () => ({ dir: '/tmp/vault' }) });

// 右栏按路由：探索（书）/ 文档 / 沉淀三区的页都自带「会话｜属性」右栏；图谱 / 标签不在三区里，没栏
test('rightOf（单面板按路由）：首页、读一章/一份、沉淀读页、文档表、书架、一本书都开会话栏；图谱/标签没有', () => {
  const p = createPanelState();
  assert.ok(rightOf(p, { kind: 'kb' })); // 首页
  assert.ok(rightOf(p, { kind: 'page', id: 'x' })); // 沉淀读页也分会话和属性
  assert.ok(rightOf(p, { kind: 'chapter', book: 'b', id: 'c' }));
  assert.ok(rightOf(p, { kind: 'raw', path: 'a.md' }));
  assert.ok(rightOf(p, { kind: 'documents', status: '待沉淀' })); // 文档表默认也开
  assert.ok(rightOf(p, { kind: 'books' })); // 书架
  assert.ok(rightOf(p, { kind: 'book', name: 'n' })); // 一本书
  assert.equal(rightOf(p, { kind: 'graph' }), null);
  assert.equal(rightOf(p, { kind: 'tag', tag: 't' }), null);
});

test('空库首页不再自动开栏：面板状态里没有引导会话 / 临时沉淀会话这两个槽', () => {
  const p = createPanelState();
  assert.equal(p.inspector.get(), false, '右栏默认收着');
  assert.equal('onboard' in p, false);
  assert.equal('deposit' in p, false);
});

test('openScene（场景按钮）：每点一次新开一场，挂进 free 槽并开栏，草稿带 send 排队', async () => {
  const { c, calls } = platform();
  const panel = createPanelState();
  panel.error.set('上次的错');
  const a = await openScene(panel, c, api(), '/wiki-write 沉淀这些文档 @a.md ');
  assert.equal(calls.sessions, 1);
  assert.equal(panel.free.get(), a, '挂进 free 槽：换页不撤');
  assert.equal(panel.inspector.get(), true);
  assert.equal(panel.tab.get(), 'session');
  assert.equal(panel.error.get(), '');
  assert.deepEqual(takeDraft(a), { text: '/wiki-write 沉淀这些文档 @a.md ', send: true });
  const b = await openScene(panel, c, api(), '再来一次');
  assert.notEqual(b, a, '再点又是新的一场，不往旧会话里填');
  assert.equal(panel.free.get(), b);
  assert.equal(calls.sessions, 2);
});

test('openScene：before 钩子在排草稿前拿到新会话 id（提炼绑听录 raw 键）；钩子失败不拦', async () => {
  const { c } = platform();
  const panel = createPanelState();
  const seen = [];
  const id = await openScene(panel, c, api(), 'x', async (sid) => { seen.push(sid); throw new Error('绑不上'); });
  assert.deepEqual(seen, [id]);
  assert.deepEqual(takeDraft(id), { text: 'x', send: true });
});

test('wireFills：一章「知识沉淀」与文档表「知识沉淀」都新开一场并发送；建不起来进 error', async () => {
  const { c, calls } = platform();
  const panel = createPanelState();
  const off = wireFills(panel, c, api());
  try {
    requestFill({ kind: 'chapter', book: '《书》', id: '01', text: 'raw/book/书/01.md' });
    await new Promise((r) => setTimeout(r, 0));
    const first = panel.free.get();
    assert.ok(first);
    assert.deepEqual(takeDraft(first), { text: fillText({ kind: 'chapter', book: '《书》', id: '01', text: 'raw/book/书/01.md' }), send: true });
    requestFill({ kind: 'deposit', paths: ['raw/a.md'] });
    await new Promise((r) => setTimeout(r, 0));
    assert.notEqual(panel.free.get(), first, '文档表沉淀也是新的一场');
    assert.deepEqual(takeDraft(panel.free.get()), { text: '/wiki-write 沉淀这些文档 @raw/a.md ', send: true });
    assert.equal(calls.sessions, 2);
  } finally { off(); }
  const bad = { get: (n) => (n === 'workspaces' ? { create: async () => { throw new Error('建不起来') } } : undefined) };
  const p2 = createPanelState();
  const off2 = wireFills(p2, bad, api());
  try {
    requestFill({ kind: 'deposit', paths: ['x'] });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(p2.error.get(), /建不起来/);
  } finally { off2(); }
});

test('applyDraft：取走排给这场的草稿填进输入框；带 send 的下一拍 submit；没有草稿啥也不做', async () => {
  const log = [];
  const actions = { setDraft: (t) => log.push(['set', t]), submit: () => log.push(['submit']) };
  queueDraft('s1', '/wiki-write-draft 写一页 @知识/甲.md ', { send: true });
  applyDraft('s1', actions);
  assert.deepEqual(log, [['set', '/wiki-write-draft 写一页 @知识/甲.md ']], 'setDraft 立即');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(log.at(-1), ['submit'], '下一拍发送（等输入框吃进草稿）');
  assert.equal(takeDraft('s1'), undefined, '取走即删');

  log.length = 0;
  queueDraft('s2', '只填不发');
  applyDraft('s2', actions);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(log, [['set', '只填不发']], '不带 send 只填');

  log.length = 0;
  applyDraft('s3', actions);
  assert.deepEqual(log, []);
});

// 右栏「当前会话」的取场规则：库目录下最近动过的哪场就挂哪场（空白场也算——刚建没聊过的正是它，
// 别再另建一场）；别的目录的不要，一场没有返回 null（调用处建新的）
test('latestVault（当前会话默认挂哪）：库目录下最近动过的一场，空白也算；没有则 null', () => {
  const byId = {
    a: { cwd: '/vault', blank: false, updatedAt: 3 },
    b: { cwd: '/elsewhere', blank: false, updatedAt: 9 }, // 别的目录的不要
    c: { cwd: '/vault', blank: true, updatedAt: 8 },      // 空白场也算（刚建的当前场）
    d: { cwd: '/vault/', blank: false, updatedAt: 5 },    // 尾斜杠规整后对得上
  };
  assert.equal(latestVault(byId, '/vault'), 'c');
  assert.equal(latestVault(byId, '/vault/'), 'c');
  assert.equal(latestVault({}, '/vault'), null);
  assert.equal(latestVault({ x: { cwd: '/elsewhere', blank: false, updatedAt: 1 } }, '/vault'), null);
});

// 当前会话的统一解析（右栏挂的、提炼指令排进的都是它）：free 槽顶着的就它；否则库目录最近一场；
// 一场没有现建一场，建好进 free 槽顶着（挑了 / 新开的全站跟着，导航不清）。建场并发去重——
// 右栏解析和提炼同时触发也只建一场
test('currentSession：free 槽顶着的直接返回，不建新的', async () => {
  const { c, calls } = platform();
  const p = createPanelState();
  p.free.set('sid-x');
  assert.equal(await currentSession(p, c, api()), 'sid-x');
  assert.equal(calls.sessions, 0);
});

test('currentSession：库目录最近一场命中直接返回，不建、不进 free', async () => {
  const byId = { a: { cwd: '/tmp/vault', blank: true, updatedAt: 2 } }; // 空白场也算当前场
  const { c, calls } = platform(byId);
  const p = createPanelState();
  assert.equal(await currentSession(p, c, api()), 'a');
  assert.equal(calls.sessions, 0);
  assert.equal(p.free.get(), null);
});

test('currentSession：一场都没有就现建一场，建好进 free 槽', async () => {
  const { c, calls } = platform();
  const p = createPanelState();
  const id = await currentSession(p, c, api());
  assert.equal(id, 'sid-1');
  assert.equal(p.free.get(), 'sid-1');
  assert.equal(await currentSession(p, c, api()), 'sid-1'); // 再解析还是它（free 顶着）
  assert.equal(calls.sessions, 1);
});

test('currentSession：并发只建一场（右栏解析和提炼同时触发）', async () => {
  const { c, calls } = platform();
  const p = createPanelState();
  const [a, b] = await Promise.all([currentSession(p, c, api()), currentSession(p, c, api())]);
  assert.equal(a, b);
  assert.equal(calls.sessions, 1);
  assert.equal(p.free.get(), a);
});

// 右栏历史切换：栏里点「历史」挑一场库里的旧会话挂上（free 槽），挑了就一直顶着（导航不清，
// 全站哪页都是它）。图谱 / 标签没有自己的右栏，挑了历史才开栏
test('rightOf（free 随手会话）：图谱/标签开栏，三区的页照旧自带栏', () => {
  const p = createPanelState();
  p.free.set('sid-9');
  assert.ok(rightOf(p, { kind: 'graph' }));
  assert.ok(rightOf(p, { kind: 'tag', tag: 't' }));
  assert.ok(rightOf(p, { kind: 'page', id: 'x' })); // 自带栏
  assert.ok(rightOf(p, { kind: 'chapter', book: 'b', id: 'c' })); // 自带会话
  assert.ok(rightOf(p, { kind: 'kb' })); // 首页自带会话
  const q = createPanelState();
  assert.equal(rightOf(q, { kind: 'graph' }), null); // 没挑过历史，图谱没栏
});

test('vaultSessions（右栏历史候选）：库目录里的非空白会话，按最近动过排序，截前 N 条', () => {
  const byId = {
    a: { displayTitle: 'A', cwd: '/vault', blank: false, updatedAt: 3 },
    b: { displayTitle: 'B', cwd: '/elsewhere', blank: false, updatedAt: 9 }, // 别的目录的不要
    c: { displayTitle: 'C', cwd: '/vault', blank: true, updatedAt: 8 },      // 空白会话不算历史
    d: { displayTitle: 'D', cwd: '/vault', blank: false, updatedAt: 1 },
    e: { displayTitle: 'E', blank: false, updatedAt: 5 },                    // 没目录的不要
  };
  assert.deepEqual(vaultSessions(byId, '/vault').map((x) => x.id), ['a', 'd']);
  assert.deepEqual(vaultSessions(byId, '/vault', 1).map((x) => x.id), ['a']);
});

// 尾斜杠：配置里 vaultDir 常写成 '.../dsh-wiki/'，DSH 存的会话 cwd 是 '.../dsh-wiki'——
// 严格相等一条都对不上，历史列表整个空掉。比对前先规整
test('vaultSessions：目录比对抹掉尾斜杠（配置带斜杠 / 会话带斜杠都要对得上）', () => {
  const byId = { a: { displayTitle: 'A', cwd: '/vault', blank: false, updatedAt: 1 } };
  assert.deepEqual(vaultSessions(byId, '/vault/').map((x) => x.id), ['a']); // 配置带斜杠
  const byId2 = { a: { displayTitle: 'A', cwd: '/vault/', blank: false, updatedAt: 1 } };
  assert.deepEqual(vaultSessions(byId2, '/vault').map((x) => x.id), ['a']); // 会话带斜杠
});

test('子智能体会话不算顶层：默认挂的、历史列的都跳过它（它 cwd 也是库目录、又总是最新）', () => {
  const byId = {
    top: { displayTitle: '顶层', cwd: '/vault', blank: false, updatedAt: 1 },
    kid: { displayTitle: '子', cwd: '/vault', blank: false, updatedAt: 9, origin: 'subagent' },
  };
  assert.equal(latestVault(byId, '/vault'), 'top');
  assert.deepEqual(vaultSessions(byId, '/vault').map((x) => x.id), ['top']);
  assert.equal(latestVault({ kid: byId.kid }, '/vault'), null, '只有子智能体会话也当没有，调用处建新的');
});
