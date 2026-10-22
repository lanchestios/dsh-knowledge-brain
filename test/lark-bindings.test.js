import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeApps, nameOf } from '../src/lark/bindings.ts';

// 机器人列表（一个 app_id 一个文件夹）的归一：config 面只有 app_id/secret/文件夹三样，
// 名称、chatId 这些实现细节不出现。nameOf 从 appId 派生会话标题里的稳定名（ASCII、唯一）。
test('normalizeApps：合法机器人照收；nameOf 派生稳定 ASCII 后缀', () => {
  const r = normalizeApps([
    { appId: 'cli_aa00e1ffe4b8dbb6', appSecret: 's1', folder: '知识' },
    { appId: 'cli_bbb', appSecret: 's2', folder: '工作/项目甲', model: 'deepseek/chat' },
  ]);
  assert.deepEqual(r, { ok: [
    { appId: 'cli_aa00e1ffe4b8dbb6', appSecret: 's1', folder: '知识', model: '' },
    { appId: 'cli_bbb', appSecret: 's2', folder: '工作/项目甲', model: 'deepseek/chat' },
  ], problems: [] });
  assert.equal(nameOf('cli_aa00e1ffe4b8dbb6'), 'cli-aa00e1ffe4b8dbb6');
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(nameOf('-怪名字++')), '派生名必须合法工具后缀');
});

test('normalizeApps：缺字段 / model 形状 / 同 appId 重复，剔除并报原因', () => {
  const r = normalizeApps([
    { appSecret: 's', folder: '知识' },                     // 缺 appId
    { appId: 'cli_a', folder: '知识' },                     // 缺 secret
    { appId: 'cli_b', appSecret: 's' },                     // 缺 folder
    { appId: 'cli_c', appSecret: 's', folder: '知识', model: 'chat' },
    { appId: 'cli_a', appSecret: 's2', folder: '工作' },    // 与前面同 appId（前一条缺 secret 被剔，这条合法）
    { appId: 'cli_a', appSecret: 's3', folder: '学习' },    // 真·重复
    '不是对象',
  ]);
  assert.deepEqual(r.ok.map((a) => a.appId), ['cli_a']);
  assert.equal(r.problems.length, 6);
  assert.match(r.problems[3], /cli_c.*model/);
  assert.match(r.problems[4], /cli_a.*只能配一个/);
  assert.match(r.problems[5], /不是对象/);
});

test('normalizeApps：undefined / 非数组 → 空结果（undefined 不算问题）', () => {
  assert.deepEqual(normalizeApps(undefined), { ok: [], problems: [] });
  const r = normalizeApps({ appId: 'x' });
  assert.equal(r.ok.length, 0);
  assert.equal(r.problems.length, 1);
});

// config 的 schema 要放行任何形状：手改 yml 打错结构时，校验全部交给归一层
// （剔除并带原因），不能让 schemastery 在 config 加载时就抛——那会拖死整个插件（知识库
// 本体一起没了），违背「非法项剔除、其余照常」的承诺。
import { Config } from '../src/host/config.ts';

test('schema 对非法 larkApps 放行（normalizeApps 收口），不炸插件加载', () => {
  const shapes = ['不是数组', { a: 1 }, [{}], [['x']], null];
  for (const bad of shapes) assert.doesNotThrow(() => Config({ vaultDir: '/x', larkApps: bad }), `不该抛：${JSON.stringify(bad)}`);
  // 联动：这些形状进 normalizeApps 都被安全消化（空 ok + 带原因的 problems）
  for (const bad of shapes) {
    const r = normalizeApps(bad);
    assert.ok(Array.isArray(r.ok));
    assert.ok(r.problems.length >= 1 || JSON.stringify(bad) === 'null', `该报问题：${JSON.stringify(bad)}`);
  }
})

test('schema 兼容存量 yml：老键（单凭证 + feishuBindings）已删，还写着也不炸加载', () => {
  // 老部署升级后 yml 里还留着旧键。旧键已从 schema 删除（不留废弃字段），但 schemastery
  // 对 schema 外的键是原样忽略不报错——这条测试钉住「删了也不许炸」。
  assert.doesNotThrow(() => Config({
    vaultDir: '/x',
    feishuAppId: 'cli_old',
    feishuAppSecret: 'sec',
    feishuBindings: [{ name: 'old', folder: '知识', chatId: 'oc_1' }],
    larkApps: [{ appId: 'cli_new', appSecret: 's', folder: '工作' }],
  }));
})

test('folder「/」= 知识库；首尾斜杠去掉；.. 与空段拒绝；空仍是缺 folder', () => {
  const r = normalizeApps([
    { appId: 'cli_root', appSecret: 's', folder: '/' },
    { appId: 'cli_trim', appSecret: 's', folder: '/知识/' },
    { appId: 'cli_up', appSecret: 's', folder: '知识/../系统' },
    { appId: 'cli_gap', appSecret: 's', folder: '知识//系统' },
    { appId: 'cli_blank', appSecret: 's', folder: '  ' },
  ])
  assert.deepEqual(r.ok.map((a) => [a.appId, a.folder]), [['cli_root', '/'], ['cli_trim', '知识']])
  assert.deepEqual(r.problems, ['cli_up：folder 不能含空段、. 或 .. 段', 'cli_gap：folder 不能含空段、. 或 .. 段', 'cli_blank：缺 folder'])
})

test('folder 非字符串（数组、对象）不经 String() 强转：["/"] 不成知识库，报缺 folder', () => {
  const r = normalizeApps([
    { appId: 'cli_arr', appSecret: 's', folder: ['/'] },
    { appId: 'cli_obj', appSecret: 's', folder: {} },
  ])
  assert.deepEqual(r.ok, [])
  assert.deepEqual(r.problems, ['cli_arr：缺 folder', 'cli_obj：缺 folder'])
})
