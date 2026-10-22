import { test } from 'vitest';
import assert from 'node:assert/strict';
import { route, questionOf, ChatLocks, isTopicStart, conversationKey, parseConversationKey } from '../src/lark/route.ts';

// 路由：精确 chatId 优先，没命中落到空 chatId 的兜底绑定（「一个机器人一个文件夹」的
// 用法，chatId 永远不用配）。消息判定：单聊全答、群聊只答 @ 了机器人的，@ 占位符从问题
// 里剥掉；非文本一律忽略。锁：每会话串行，忙时新消息即拒。

const B = [
  { name: 'loss', folder: '知识/机器学习/Loss', chatId: 'oc_1', model: '' },
  { name: 'work', folder: '工作/项目甲', chatId: 'oc_2', model: '' },
  { name: 'idle', folder: '知识', chatId: '', model: '' },  // 兜底：没被单独绑定的会话都归它
]
const msg = (o) => ({ eventId: 'e1', chatId: 'oc_1', chatType: 'p2p', messageId: 'm1', messageType: 'text', text: '你好', mentionKeys: [], mentionOpenIds: [], ...o })

test('route：精确 chatId 优先；没命中落到空 chatId 兜底；没有兜底才返回 undefined', () => {
  assert.equal(route('oc_1', B).name, 'loss');
  assert.equal(route('oc_9', B).name, 'idle');               // 谁都没单绑 → 兜底接走
  assert.equal(route('', B).name, 'idle');
  assert.equal(route('oc_9', B.slice(0, 2)), undefined);     // 没有兜底绑定时维持旧行为
})

test('questionOf：单聊文本全答', () => {
  assert.equal(questionOf(msg({ text: '啥是 focal loss' }), 'ou_bot'), '啥是 focal loss');
})

test('questionOf：群聊 @ 机器人才答，@ 占位符剥掉、空白收拢', () => {
  const m = msg({ chatType: 'group', text: '@_user_1 请讲讲 focal loss', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_bot'] })
  assert.equal(questionOf(m, 'ou_bot'), '请讲讲 focal loss');
  // @ 的是别人：不答
  const other = msg({ chatType: 'group', text: '@_user_1 讲讲', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_someone'] })
  assert.equal(questionOf(other, 'ou_bot'), null);
  // bot open_id 还没拿到（连上后才有）：群聊一律不答，单聊不受影响
  assert.equal(questionOf(m, null), null);
  assert.equal(questionOf(msg({ text: '单聊' }), null), '单聊');
})

test('questionOf：非文本消息一律忽略；剥完 @ 只剩空白也不答', () => {
  assert.equal(questionOf(msg({ messageType: 'image' }), 'ou_bot'), null);
  assert.equal(questionOf(msg({ chatType: 'group', text: '@_user_1', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_bot'] }), 'ou_bot'), null);
})

test('ChatLocks：同会话忙时即拒，答完释放后可再来', () => {
  const locks = new ChatLocks();
  assert.equal(locks.try('oc_1'), true);
  assert.equal(locks.try('oc_1'), false);   // 同会话第二条：拒
  assert.equal(locks.try('oc_2'), true);    // 别的会话不受影响
  locks.release('oc_1');
  assert.equal(locks.try('oc_1'), true);
})


// 话题：新开的话题（在话题里、自己就是根）群里不 @ 也答；话题里的追问照旧要 @；
// 普通群里引用回复（有 rootId 没 threadId）不算话题。会话键：话题按「chat＋根消息」一个
const G = (o) => msg({ chatType: 'group', messageId: 'om_root', ...o })

test('新话题不 @ 也答；话题内追问不 @ 不答、@ 了照答；引用回复不算话题', () => {
  assert.equal(isTopicStart(G({ threadId: 'omt_1' })), true);
  assert.equal(questionOf(G({ threadId: 'omt_1', text: '报销怎么走' }), 'ou_bot'), '报销怎么走', '新话题直接答');
  assert.equal(questionOf(G({ threadId: 'omt_1', text: '报销怎么走' }), null), '报销怎么走', '新话题不依赖机器人身份');
  assert.equal(questionOf(G({ threadId: 'omt_1', rootId: 'om_root', messageId: 'om_2', text: '那差旅呢' }), 'ou_bot'), null, '追问不 @ 不答');
  assert.equal(questionOf(G({ threadId: 'omt_1', rootId: 'om_root', messageId: 'om_2', text: '@_user_1 那差旅呢', mentionKeys: ['@_user_1'], mentionOpenIds: ['ou_bot'] }), 'ou_bot'), '那差旅呢');
  assert.equal(questionOf(G({ rootId: 'om_x', text: '顺便问下' }), 'ou_bot'), null, '普通群引用回复不 @ 不答');
  assert.equal(questionOf(G({ text: '大家好' }), 'ou_bot'), null, '普通群消息不 @ 不答');
  assert.equal(isTopicStart(msg({ threadId: 'omt_1' })), false, '单聊不走话题规则');
})

test('会话键：话题按「chat＋根消息」，新话题与其追问同键；话题外照旧 chat_id；可解回', () => {
  const start = G({ threadId: 'omt_1' });
  const follow = G({ threadId: 'omt_1', rootId: 'om_root', messageId: 'om_2' });
  const other = G({ threadId: 'omt_2', messageId: 'om_root2' });
  assert.equal(conversationKey(start), 'oc_1#om_root');
  assert.equal(conversationKey(follow), conversationKey(start), '追问回到同一个会话');
  assert.notEqual(conversationKey(other), conversationKey(start), '另一个话题另一个会话');
  assert.equal(conversationKey(G({ rootId: 'om_x' })), 'oc_1', '引用回复不分会话');
  assert.equal(conversationKey(msg()), 'oc_1');
  assert.deepEqual(parseConversationKey('oc_1#om_root'), { chatId: 'oc_1', root: 'om_root' });
  assert.deepEqual(parseConversationKey('oc_1'), { chatId: 'oc_1', root: '' });
})
