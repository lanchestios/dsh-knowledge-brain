import { test } from 'vitest';
import assert from 'node:assert/strict';
import { verifyApp, LARK_SCOPES } from '../src/lark/channel.ts';

// verifyApp：保存前验证草稿凭证（设置卡「验证」按钮背后的函数）。建临时 lark Client 打
// /bot/v3/info——secret 错在取 tenant_access_token 就失败；凭证对但没加机器人能力则 info
// 取不到 bot。结果只有 ok/botName/detail，绝不含 secret。makeClient 注入，单测不碰网络。

const SECRET = 'SECRET_VALUE_qy'

// 按 URL 应答：bot/v3/info 给 info，application/v6/scopes 给授权列表（默认全授权）
const ALL = LARK_SCOPES.map((x) => x.scope)
const grant = (names, status = 1) => ({ code: 0, data: { scopes: names.map((scope_name) => ({ scope_name, grant_status: status, scope_type: 'tenant' })) } })
const fake = (info, scopes = grant(ALL)) => () => ({ request: async ({ url }) => {
  if (url.includes('/application/v6/scopes')) { if (scopes instanceof Error) throw scopes; return scopes }
  return info
} })

test('验证通过：凭证有效 + 机器人名；结果不含 secret', async () => {
  const r = await verifyApp('cli_ok', SECRET, fake({ bot: { open_id: 'ou_1', bot_name: '格物致知小助手' } }))
  assert.deepEqual(r, { ok: true, botName: '格物致知小助手' })
  assert.ok(!JSON.stringify(r).includes(SECRET))
})

test('宽容解析：bot 挂在 data.bot 下也认（与通道取 open_id 同一套解析）', async () => {
  const r = await verifyApp('cli_ok', SECRET, fake({ data: { bot: { open_id: 'ou_2', bot_name: '小格' } } }))
  assert.deepEqual(r, { ok: true, botName: '小格' })
})

test('secret 不对：detail 归类「app_id 或 app_secret 不对」并保留错误原文（99991663）', async () => {
  const r = await verifyApp('cli_bad', SECRET, () => ({ request: async () => { throw new Error('code 99991663, app_secret not match, get tenant_access_token failed') } }))
  assert.equal(r.ok, false)
  assert.match(r.detail, /app_id 或 app_secret 不对/)
  assert.match(r.detail, /99991663/)
  assert.ok(!JSON.stringify(r).includes(SECRET))
})

test('凭证对但没机器人能力：info 没有bot → 明确提示去加「机器人」能力', async () => {
  const r = await verifyApp('cli_nob', SECRET, () => ({ request: async () => ({}) }))
  assert.equal(r.ok, false)
  assert.match(r.detail, /机器人/)
})

test('其它异常：原文透出，不吞现场（同 qa detail 的口径）', async () => {
  const r = await verifyApp('cli_net', SECRET, () => ({ request: async () => { throw new Error('connect ETIMEDOUT open.feishu.cn:443') } }))
  assert.equal(r.ok, false)
  assert.match(r.detail, /ETIMEDOUT/)
})

test('appId/appSecret 没填全：直接拒绝，不碰网络（makeClient 不该被调）', async () => {
  let called = false
  const r = await verifyApp('', SECRET, () => { called = true; return { request: async () => ({}) } })
  assert.equal(r.ok, false)
  assert.match(r.detail, /都要填/)
  assert.equal(called, false)
  const r2 = await verifyApp('cli_x', '', () => { called = true; return { request: async () => ({}) } })
  assert.equal(r2.ok, false)
  assert.equal(called, false)
})


// 权限核对：凭证与机器人能力都过了再查授权状态。缺必需项判不通过；缺群聊/可选项照样通过、列出缺项；
// 授权状态查不到不拦，记 scopeError
const BOT = { bot: { open_id: 'ou_1', bot_name: '小助' } }

test('权限齐全：通过，不带 missing', async () => {
  assert.deepEqual(await verifyApp('cli_ok', SECRET, fake(BOT)), { ok: true, botName: '小助' })
})

test('只开了发消息与单聊（某企业实况）：缺上传图片判不通过；群 @、群消息、群信息、通讯录照列缺口', async () => {
  const r = await verifyApp('cli_ok', SECRET, fake(BOT, grant(['im:message:send_as_bot', 'im:message.p2p_msg:readonly'])))
  assert.equal(r.ok, false)
  assert.match(r.detail, /必需权限/)
  assert.deepEqual(r.missing.map((m) => [m.scope, m.level]), [
    ['im:resource', 'required'],
    ['im:message.group_at_msg:readonly', 'group'],
    ['im:message.group_msg', 'optional'],
    ['im:chat:readonly', 'optional'],
    ['contact:contact.base:readonly', 'optional'],
  ])
  const ok = await verifyApp('cli_ok', SECRET, fake(BOT, grant(['im:message:send_as_bot', 'im:message.p2p_msg:readonly', 'im:resource'])))
  assert.equal(ok.ok, true, '必需三项齐了就通过，群聊/可选缺口照列')
})

test('缺必需权限：不通过，detail 指去权限管理发布版本', async () => {
  const r = await verifyApp('cli_ok', SECRET, fake(BOT, grant(ALL.filter((x) => x !== 'im:message:send_as_bot'))))
  assert.equal(r.ok, false)
  assert.match(r.detail, /必需权限/)
  assert.deepEqual(r.missing.map((m) => m.scope), ['im:message:send_as_bot'])
})

test('申请了未授权（grant_status≠1）与 user 身份的同名权限都不算', async () => {
  const scopes = { code: 0, data: { scopes: [
    ...ALL.filter((x) => x !== 'im:message.group_msg').map((scope_name) => ({ scope_name, grant_status: 1, scope_type: 'tenant' })),
    { scope_name: 'im:message.group_msg', grant_status: 0, scope_type: 'tenant' },
    { scope_name: 'im:message.group_msg', grant_status: 1, scope_type: 'user' },
  ] } }
  const r = await verifyApp('cli_ok', SECRET, fake(BOT, scopes))
  assert.deepEqual(r.missing.map((m) => m.scope), ['im:message.group_msg'])
})

test('授权状态查不到：凭证结论照给，记 scopeError，不当缺权限', async () => {
  const r = await verifyApp('cli_ok', SECRET, fake(BOT, new Error('code 99991672, no permission')))
  assert.deepEqual(r, { ok: true, botName: '小助', scopeError: 'code 99991672, no permission' })
  const r2 = await verifyApp('cli_ok', SECRET, fake(BOT, { code: 99991400, msg: 'rate limited' }))
  assert.equal(r2.ok, true)
  assert.match(r2.scopeError, /99991400/)
})
