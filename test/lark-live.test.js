import { test } from 'vitest'
import assert from 'node:assert/strict'
import { LiveReply, stepLine, buildThinkingCard, buildAnswerCard } from '../src/lark/live.ts'

// 一个问题一张回复卡片：思考中（列检索/阅读）→ 遇 AskUserQuestion 改成选择题 → 作答后
// 回到思考中 → 收场原位换成答案。卡片写入全部串行（防乱序覆盖）；快答（没到延迟）直接
// 发答案卡；卡片发不出 / 改不了退回富文本回复。计时全注入，单测用毫秒级参数跑真时钟。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fakeIo = (over = {}) => {
  const log = []
  let n = 0
  return {
    log,
    io: {
      sendCard: async (card) => { if (over.sendFail) throw new Error('send denied'); const id = `om_card_${++n}`; log.push({ op: 'send', id, card }); return id },
      updateCard: async (id, card) => { if (over.updateFail) throw new Error('update denied'); log.push({ op: 'update', id, card }) },
      replyText: async (text) => { log.push({ op: 'text', text }) },
      warn: () => {},
    },
  }
}
const OPTS = { delayMs: 30, throttleMs: 10, heartbeatMs: 1_000 }
const textOf = (card) => JSON.stringify(card)
const call = (name, args) => ({ type: 'tool/call', data: { name, arguments: JSON.stringify(args) } })

test('stepLine：只出检索与阅读两种行；其余工具（目录、追问、别的）不出行；坏参数不炸', () => {
  assert.equal(stepLine('wiki_search', '{"query":"回调 监听器"}'), '🔍 检索：回调 监听器')
  assert.equal(stepLine('wiki_read_page', '{"id":"工作/OA系统/流程实施/传入表单数据实施.md"}'), '📖 阅读：传入表单数据实施')
  assert.equal(stepLine('wiki_tree', '{"path":"工作/OA系统"}'), null)
  assert.equal(stepLine('ask_user_question', '{}'), null)
  assert.equal(stepLine('bash', 'not json'), null)
  assert.equal(stepLine('wiki_search', 'not json'), '🔍 检索：（空）')
})

test('快答：没到延迟就答完 → 不出思考卡，直接发一张答案卡', async () => {
  const { io, log } = fakeIo()
  const live = new LiveReply(io, OPTS)
  live.start()
  await live.finish('答案是 **42**')
  assert.deepEqual(log.map((x) => x.op), ['send'])
  assert.match(textOf(log[0].card), /答案是 \*\*42\*\*/)
  await sleep(50)
  assert.equal(log.length, 1, '收场后延迟到点也不再发思考卡')
})

test('慢答：到延迟发思考卡，步骤刷新同一张，收场原位换成答案', async () => {
  const { io, log } = fakeIo()
  const live = new LiveReply(io, OPTS)
  live.start()
  live.step(call('wiki_search', { query: '退款 审批' }))
  await sleep(45)
  assert.equal(log[0].op, 'send')
  assert.match(textOf(log[0].card), /思考中/)
  assert.match(textOf(log[0].card), /检索：退款 审批/, '延迟前攒下的步骤也在首张卡上')
  live.step(call('wiki_read_page', { id: '工作/OA系统/落地回调实现.md' }))
  await sleep(25)
  const upd = log.filter((x) => x.op === 'update')
  assert.ok(upd.length >= 1)
  assert.match(textOf(upd.at(-1).card), /阅读：落地回调实现/)
  await live.finish('最终答案')
  const last = log.at(-1)
  assert.equal(last.op, 'update')
  assert.equal(last.id, log[0].id, '同一张卡原位替换')
  assert.match(textOf(last.card), /最终答案/)
  assert.doesNotMatch(textOf(last.card), /思考中/)
  assert.match(textOf(last.card), /检索 1 次 · 阅读 1 页/, '页脚带用时与查阅统计')
})

test('追问：思考卡改成选择题；挂起期间步骤不刷卡；作答后回到思考中并记一行', async () => {
  const { io, log } = fakeIo()
  const live = new LiveReply(io, OPTS)
  live.start()
  await sleep(45)
  const qCard = { header: { title: { tag: 'plain_text', content: '知识问答 · 需要你选择' } } }
  const id = await live.ask(qCard)
  assert.equal(id, log[0].id, '题卡就是这张回复卡')
  assert.deepEqual(log.at(-1), { op: 'update', id, card: qCard })
  const before = log.length
  live.step(call('wiki_search', { query: '不该刷出来' }))   // 名字指「挂起期间不该刷出来」
  await sleep(25)
  assert.equal(log.length, before, '等人作答时不许用思考卡盖掉题卡')
  live.resume()
  await sleep(25)
  const back = log.at(-1)
  assert.equal(back.id, id)
  assert.match(textOf(back.card), /思考中/)
  assert.match(textOf(back.card), /检索：不该刷出来/, '挂起期间记下的步骤不丢：回到思考中时才出现在卡上')
  await live.finish('好了')
  assert.match(textOf(log.at(-1).card), /好了/)
})

test('追问早于延迟：直接把题卡作为回复发出；之后照常切回思考中', async () => {
  const { io, log } = fakeIo()
  const live = new LiveReply(io, OPTS)
  live.start()
  const qCard = { q: 1 }
  const id = await live.ask(qCard)
  assert.deepEqual(log, [{ op: 'send', id, card: qCard }])
  await sleep(45)
  assert.equal(log.length, 1, '延迟到点时正在追问，不发思考卡')
  live.resume()
  await live.finish('完')
  assert.equal(log.at(-1).id, id)
})

test('失败收场：有卡改成失败卡；没卡发失败卡', async () => {
  const a = fakeIo()
  const la = new LiveReply(a.io, OPTS)
  la.start()
  await sleep(45)
  await la.fail('这条没答上来，稍后再试')
  assert.equal(a.log.at(-1).op, 'update')
  assert.match(textOf(a.log.at(-1).card), /这条没答上来/)

  const b = fakeIo()
  const lb = new LiveReply(b.io, OPTS)
  lb.start()
  await lb.fail('忙')
  assert.deepEqual(b.log.map((x) => x.op), ['send'])
})

test('卡片发不出 / 改不了：答案退回富文本回复，不丢', async () => {
  const a = fakeIo({ sendFail: true })
  const la = new LiveReply(a.io, OPTS)
  la.start()
  await la.finish('答案A')
  assert.deepEqual(a.log, [{ op: 'text', text: '答案A' }])

  const b = fakeIo({ updateFail: true })
  const lb = new LiveReply(b.io, OPTS)
  lb.start()
  await sleep(45)
  await lb.finish('答案B')
  assert.deepEqual(b.log.at(-1), { op: 'text', text: '答案B' })
})

test('卡片构造：思考卡同时最多 5 项（最近的），不加「前面还有」；答案卡 markdown 转 lark_md，表格转行', () => {
  const lines = Array.from({ length: 11 }, (_, i) => `🔍 检索：q${i}`)
  const t = textOf(buildThinkingCard(lines, 75_000))
  assert.match(t, /已用时 1 分 15 秒/)
  assert.equal((t.match(/检索：q/g) ?? []).length, 5, '同时只列 5 项')
  assert.match(t, /q6[\s\S]*q10/)
  assert.doesNotMatch(t, /q5\\n|q5"/)
  assert.doesNotMatch(t, /前面还有/)

  const a = textOf(buildAnswerCard('# 标题\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n用 `a<b` 判断', { elapsedMs: 5_000, searches: 2, reads: 3 }))
  assert.match(a, /\*\*标题\*\*/, '标题转粗体')
  assert.match(a, /1  \|  2/, '表格行用竖线拼')
  assert.match(a, /a&lt;b/, '尖括号转义')
  assert.match(a, /用时 5 秒 · 检索 2 次 · 阅读 3 页/)
})

const KEYS = new Map([['asset/diagrams/a.png', 'img_a']])
const STATS = { elapsedMs: 3000, searches: 1, reads: 1 }

test('答案卡带图：文字 div / img / 文字 div / note；alt 用图注', () => {
  const card = buildAnswerCard('第一步\n\n![流程图](asset/diagrams/a.png)\n\n第二步', STATS, KEYS)
  const els = card.elements
  assert.deepEqual(els.map((e) => e.tag), ['div', 'img', 'div', 'note'])
  assert.deepEqual(els[1], { tag: 'img', img_key: 'img_a', alt: { tag: 'plain_text', content: '流程图' } })
  assert.match(els[0].text.content, /第一步/)
  assert.match(els[2].text.content, /第二步/)
})

test('答案卡：alt 为空用「图片」；库内图没 key 不发（不留链接）', () => {
  const card = buildAnswerCard('![](asset/diagrams/a.png)', STATS, KEYS)
  assert.equal(card.elements[0].alt.content, '图片')
  const plain = buildAnswerCard('前文\n\n![](asset/diagrams/a.png)', STATS)
  assert.deepEqual(plain.elements.map((e) => e.tag), ['div', 'note'])
  assert.ok(!JSON.stringify(plain).includes('asset/diagrams/a.png'))
})

test('答案卡：超 40 行的长答案中间夹图——前段照 40 行分块，图落在原位置', () => {
  const head = Array.from({ length: 45 }, (_, i) => `- 行${i + 1}`).join('\n')
  const card = buildAnswerCard(`${head}\n\n![图](asset/diagrams/a.png)\n\n尾`, STATS, KEYS)
  const tags = card.elements.map((e) => e.tag)
  assert.deepEqual(tags, ['div', 'div', 'img', 'div', 'note'])
  assert.equal(card.elements[0].text.content.split('\n').length, 40)
  assert.equal(card.elements[1].text.content.split('\n').length, 5)
})

test('finish 带 keys：答案卡出 img；卡片发不出退富文本时 keys 一并带上', async () => {
  const { io, log } = fakeIo()
  const live = new LiveReply(io, OPTS)
  live.start()
  await live.finish('![图](asset/diagrams/a.png)', KEYS)
  assert.match(textOf(log[0].card), /"img_key":"img_a"/)

  const texts = []
  const bad = fakeIo({ sendFail: true })
  bad.io.replyText = async (text, keys) => { texts.push({ text, keys }) }
  const live2 = new LiveReply(bad.io, OPTS)
  live2.start()
  await live2.finish('![图](asset/diagrams/a.png)', KEYS)
  assert.equal(texts[0].keys, KEYS)
})
