import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PERSONA, DEFAULT_BOT_NAME, scopeOf } from '../src/lark/persona.ts'

// 飞书问答人设：机器人名与范围嵌进去、取不到名字用默认；只依据绑定文件夹作答；
// 不带来源行、不 @ 人、对外不露内部机制（这几条一旦漂了，群里看得见）

test('人设嵌机器人名与范围；文件夹全路径只留给工具约束', () => {
  const p = PERSONA('工作/客服系统', '小客')
  assert.ok(p.includes('「小客」'))
  assert.ok(p.includes('客服系统'))
  assert.ok(p.includes('「工作/客服系统」'), '工具约束要认全路径')
  assert.ok(p.includes('wiki_search') && p.includes('wiki_read_page'))
})

test('人设让会话内加载 wiki-read 查库，不派 wiki_read 子 agent', () => {
  for (const p of [PERSONA('工作/客服系统', '小客'), PERSONA('认知')]) {
    assert.ok(p.includes('先加载 `wiki-read` 技能，照它在本会话里查'))
    assert.ok(!/wiki_read\b/.test(p), '不派子 agent')
  }
})

test('取不到机器人名用默认「知识问答Agent」', () => {
  assert.equal(DEFAULT_BOT_NAME, '知识问答Agent')
  for (const n of ['', '   ', undefined]) assert.ok(PERSONA('认知', n).includes('「知识问答Agent」'))
})

test('范围取文件夹最后一段', () => {
  assert.equal(scopeOf('工作/客服系统'), '客服系统')
  assert.equal(scopeOf('认知'), '认知')
  assert.equal(scopeOf('知识/机器学习/'), '机器学习')
})

test('不带来源行；不 @ 人；不暴露内部机制；准确性底线在', () => {
  const p = PERSONA('认知', '小知')
  assert.ok(!p.includes('来源：'), '来源行已去掉')
  assert.match(p, /不 @ 任何人/)
  assert.match(p, /知识库/)          // 列为禁止对外提的词
  assert.match(p, /宁可不说，也不能说错/)
  assert.match(p, /只搬页面里写的/)
})

test('人设：页面里有用的图照抄路径带上，最多 3 张，不编路径', () => {
  const p = PERSONA('认知', '小助')
  assert.match(p, /!\[简短说明\]\(页面里的原路径\)/)
  assert.match(p, /最多 3 张/)
  assert.match(p, /不编路径/)
})

const sha = (s) => createHash('sha256').update(s).digest('hex')

test('选具体文件夹时人设逐字不变（钉 sha256，取自 2026-10-19 改为加载 wiki-read 后的 persona.ts）', () => {
  assert.equal(sha(PERSONA('工作/客服系统', '小客')), '0428bb2f963713b2c7fd53cc4f7f786b9273dc6cdee47470650505d0003c1a48')
  assert.equal(sha(PERSONA('认知')), '184483032410c61befb275975f01bd3886a4838098e3dfea2c7b3e183608bc86')
})

test('「/」= 知识库：约束只依据知识库；对外自述不露范围名、不出现「「知识库」这块」', () => {
  assert.equal(scopeOf('/'), '')
  const p = PERSONA('/', '小知')
  assert.match(p, /只依据知识库里的页面/)
  assert.match(p, /负责解答这边的业务问题/)
  assert.match(p, /我目前能解答的是这边的业务问题/)
  for (const bad of ['「/」', '「」', '缩小范围', '「知识库」这块', '这个文件夹以外']) assert.ok(!p.includes(bad), bad)
  assert.match(p, /宁可不说，也不能说错/)   // 其余段落照旧
})
