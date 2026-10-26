import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homeEmpty, exploreEmpty, START_SAY, FIRST_STEPS, becameNonEmpty } from '../src/client/lib/launch.ts';

// 空库引导的判定端。「没加载完」绝不能当空库，否则看板加载的一瞬会闪一下引导；
// 开场白是一句自然话（不再是 /命令）——接住它的是常驻 wiki 技能，所以上手指引必须住在
// wiki 技能里（「上手」场景），不能缩回一个只靠命令命中的独立技能。

test('homeEmpty：一页都没有才算空；没加载完不算', () => {
  assert.equal(homeEmpty({ stats: { total: 0 } }), true);
  assert.equal(homeEmpty({ stats: { total: 3 } }), false);
  assert.equal(homeEmpty(null), false);
});

test('exploreEmpty：书与素材双空才算空；任一没加载完不算', () => {
  assert.equal(exploreEmpty([], []), true);
  assert.equal(exploreEmpty([], [{}]), false);
  assert.equal(exploreEmpty([{}], []), false);
  assert.equal(exploreEmpty(null, []), false);
  assert.equal(exploreEmpty([], null), false);
});

test('START_SAY：一句自然话，不是命令', () => {
  assert.equal(START_SAY, '今天要往库里收什么？一篇文章、一本书、一场会议，或者一个想写的主题。');
  assert.ok(!START_SAY.startsWith('/'), '开场白不该是斜杠命令');
});

test('FIRST_STEPS：三个入口都带 /wiki——页上点选与右栏 hero 快捷 chips 共用一份', () => {
  assert.equal(FIRST_STEPS.length, 3);
  for (const f of FIRST_STEPS) {
    assert.ok(f.name && f.hint && f.say, `「${f.name}」三件套（名/说明/话）缺一不可`);
    assert.ok(f.say.endsWith('：'), `「${f.name}」的话以冒号收尾，等人补内容`);
  }
  const article = FIRST_STEPS.find((f) => f.name.includes('文章'));
  assert.equal(article?.say, '/wiki 我想放一篇文章进来：你抓取归档到素材库，归档好了再问我要不要当场沉淀成一页知识。链接：');
  const book = FIRST_STEPS.find((f) => f.name.includes('书'));
  assert.equal(book?.say, '/wiki 我想放一本书：建进度页、拆好章节，我稍后把 epub / azw3 / pdf 文件放进书目录。书名：');
  const meeting = FIRST_STEPS.find((f) => f.name.includes('会议'));
  assert.equal(meeting?.say, '/wiki 我想沉淀一次会议：手里有听录或纪要，帮我按观察文档的流程整理成经历区的一页，时间、结论、待办都要留。素材在：');
  assert.ok(FIRST_STEPS.some((f) => f.name.includes('文章')) && FIRST_STEPS.some((f) => f.name.includes('书')) && FIRST_STEPS.some((f) => f.name.includes('会议')));
});

test('becameNonEmpty：只在「眼看着从空变不空」时为真——落成交接动画的闸门', () => {
  const empty = { stats: { total: 0 } };
  const full = { stats: { total: 1 } };
  assert.equal(becameNonEmpty(empty, full), true);   // 空着看它长出第一页：演
  assert.equal(becameNonEmpty(null, full), false);   // 一上来就有内容（进别人的库）：不演
  assert.equal(becameNonEmpty(empty, empty), false); // 一直空：不演
  assert.equal(becameNonEmpty(full, full), false);   // 一直有：不演
  assert.equal(becameNonEmpty(full, empty), false);  // 清库：不演
  assert.equal(becameNonEmpty(null, null), false);
});

const at = (p) => fileURLToPath(new URL(`../vault-tools/skills/${p}`, import.meta.url));

test('上手指引住在常驻 wiki 技能里（wiki-start 已收编）', () => {
  assert.ok(!existsSync(at('wiki-start')), 'wiki-start 不再是独立技能');
  assert.ok(existsSync(at('wiki/onboarding.md')));
  const wiki = readFileSync(at('wiki/SKILL.md'), 'utf8');
  assert.ok(wiki.includes('onboarding.md'), '场景表指到 onboarding.md');
  assert.ok(wiki.includes('第一次上手'), 'description 带空库第一次上手的触发词');
});
