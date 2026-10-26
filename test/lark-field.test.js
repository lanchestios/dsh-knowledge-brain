import { test } from 'vitest';
import assert from 'node:assert/strict';
import { serializeApps, parseApps, parseAppsDraft, larkAppsField, rowValid } from '../src/client/settings/larkField.ts';

// larkApps 在表单模型里是一段 JSON 文本：机器人行编辑器改行 → serialize → edit()；
// 保存时 parse 校验过才落。format 用稳定序列化（键序固定），同值异串不会造成假 dirty。
// 一行 = 一个机器人：app_id、secret、文件夹三样（model 可空）。

const ROW = { appId: 'cli_a', appSecret: 's1', folder: '知识/ML', model: '' }

test('serialize/parse 往返；parse 对非法输入返回 null', () => {
  const rows = [ROW, { appId: 'cli_b', appSecret: 's2', folder: '工作', model: 'deepseek/chat' }];
  assert.deepEqual(parseApps(serializeApps(rows)), rows);
  assert.equal(parseApps('not json'), null);
  assert.equal(parseApps('{"a":1}'), null);                                  // 不是数组
  assert.equal(parseApps(JSON.stringify([{ appId: 'cli_a', appSecret: '', folder: 'x', model: '' }])), null);  // 缺 secret
  assert.equal(parseApps(JSON.stringify([{ appId: 'cli_a', appSecret: 's', folder: '', model: '' }])), null);  // 缺 folder
  assert.equal(parseApps(JSON.stringify([{ appId: 'cli_a', appSecret: 's', folder: 'x', model: 'chat' }])), null);  // model 不带 /
})

test('parseAppsDraft：草稿宽容解析管显示，打到一半的行不许整个消失（严格版仍在保存时把关）', () => {
  const fresh = '[{"appId":"","appSecret":"","folder":"knowledge/ML","model":""}]';   // 「加一个机器人」刚点出来的行
  assert.equal(parseApps(fresh), null, '严格版：空 appId 不合法（保存要挡）');
  assert.deepEqual(parseAppsDraft(fresh), [{ appId: '', appSecret: '', folder: 'knowledge/ML', model: '' }]);
  assert.equal(parseAppsDraft('not json'), null);
  assert.deepEqual(parseAppsDraft('[1,2]'), [], '非对象项丢弃');
})

test('larkAppsField：format 排稳定序列化、空数组/非数组给空串；parse 认 clear 与合法 set', () => {
  const f = larkAppsField('larkApps')
  assert.equal(f.format(undefined), '')
  assert.equal(f.format('不是数组'), '')
  const text = f.format([ROW])
  assert.equal(text, '[{"appId":"cli_a","appSecret":"s1","folder":"知识/ML","model":""}]')
  assert.deepEqual(f.parse(''), { kind: 'clear' })
  assert.deepEqual(f.parse(text), { kind: 'set', value: [ROW] })
  assert.equal(f.parse('[{"appId":"cli_a","appSecret":"","folder":"x","model":""}]'), undefined)   // 非法：挡住保存
  // 老文档的行可能缺后加的列（model…）：显示路径不许抛——serializeApps 直接吃会 'trim' of undefined
  assert.equal(f.format([{ appId: 'cli_a', appSecret: 's', folder: 'x' }]), '[{"appId":"cli_a","appSecret":"s","folder":"x","model":""}]')
})

// Modal 表单「确定」的门槛：与 parseApps 同一条规则（三样配齐、model 空或 provider/model）
test('rowValid：Modal 确定按钮的启用条件', () => {
  assert.equal(rowValid(ROW), true)
  assert.equal(rowValid({ ...ROW, appId: '  ' }), false, 'app_id 空')
  assert.equal(rowValid({ ...ROW, appSecret: '' }), false, 'secret 空')
  assert.equal(rowValid({ ...ROW, folder: '' }), false, '文件夹空')
  assert.equal(rowValid({ ...ROW, model: 'chat' }), false, 'model 不带 /')
  assert.equal(rowValid({ ...ROW, model: ' deepseek/chat ' }), true, 'model 前后空格容忍')
})

test('folder：「/」合法；首尾斜杠归一；.. 非法', () => {
  assert.deepEqual(parseApps(JSON.stringify([{ ...ROW, folder: '/' }])), [{ ...ROW, folder: '/' }])
  assert.deepEqual(parseAppsDraft(JSON.stringify([{ ...ROW, folder: '/知识/' }])), [{ ...ROW, folder: '知识' }])
  assert.equal(parseApps(JSON.stringify([{ ...ROW, folder: '知识/../x' }])), null)
  assert.equal(rowValid({ ...ROW, folder: '/' }), true)
  assert.equal(rowValid({ ...ROW, folder: 'a/../b' }), false)
  assert.deepEqual(parseAppsDraft(JSON.stringify([{ ...ROW, folder: ['/'] }])), [{ ...ROW, folder: '' }], '非字符串不强转成知识库')
})
