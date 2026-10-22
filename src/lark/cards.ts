// 把宿主 AskUserQuestion 的结构化问题渲染成 Lark 交互卡片，并把卡片按钮点按/文字回复映射
// 回结构化答案。纯函数、不碰 SDK——单测直接喂问题与点按值。卡片走经典 1.0 schema：按钮
// value 里带问题 id 与选项 label，回传事件原样带回（channel.ts 的 onCardAction）。

/** 一道选择题（宿主 AskUserQuestionItem 的裁剪：卡片只用到这些字段） */
export interface CardQuestion {
  id: string
  question: string
  detail?: string
  header?: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** 卡片挂起期间累积的勾选态：qid → 已选 label（多选的 ✓；单选点按即定稿，也记进来好在刷新卡上标 ✓） */
export type Picked = Record<string, string[]>

/** 定稿答案：qid → 选中 labels（文字作答时为空数组、正文在 customs） */
export type Settled = Record<string, string[]>

// lark_md 转义最小集（& 和 <；> 无配对语法可留）
const md = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const note = (text: string) => ({ tag: 'note', elements: [{ tag: 'plain_text', content: text }] })
const plain = (text: string) => ({ tag: 'plain_text', content: text })

/** 一道题的区块：题面（+说明/选项释义）＋按钮组。单选每项即答（多题时其余没答完，所选打 ✓、可改选）；
 *  多选点选打 ✓、末尾「提交」定稿；无选项的题只能回文字，题下写明（答过显示正文） */
function questionElements(q: CardQuestion, index: number, picked: Picked, customs: Record<string, string>): object[] {
  const els: object[] = [{
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${index + 1}. ${md(q.header ? `${q.header}：` : '')}${md(q.question)}${q.multiSelect ? '（可多选）' : ''}**`,
    },
  }]
  const tips: string[] = []
  if (q.detail) tips.push(q.detail)
  for (const o of q.options ?? []) if (o.description) tips.push(`${o.label}：${o.description}`)
  if (customs[q.id] !== undefined) tips.push(`已回复：${customs[q.id]}`)
  else if (!q.options?.length) tips.push('请直接回复文字作答')
  if (tips.length) els.push(note(tips.join('\n')))
  const actions: object[] = []
  const sel = picked[q.id] ?? []
  for (const o of q.options ?? []) {
    const checked = sel.includes(o.label)
    actions.push({
      tag: 'button', text: plain(checked ? `✓ ${o.label}` : o.label), type: checked ? 'primary' : 'default',
      value: { q: q.id, o: o.label },
    })
  }
  if (q.multiSelect) actions.push({ tag: 'button', text: plain('提交'), type: 'primary', value: { q: q.id, s: '1' } })
  if (actions.length) els.push({ tag: 'action', actions })
  return els
}

/** 发出的提问卡片（picked/customs 有值时是作答中的刷新版：所选项高亮、文字答案回显） */
export function buildAskCard(questions: CardQuestion[], picked: Picked = {}, customs: Record<string, string> = {}): object {
  return {
    config: { wide_screen_mode: true },
    header: { title: plain('知识问答 · 需要你选择'), template: 'blue' },
    elements: [
      ...questions.flatMap((q, i) => questionElements(q, i, picked, customs)),
      note('点按钮作答；也可以直接回复文字'),
    ],
  }
}

/** 收场卡片：锁定态（已作答/已取消/超时），按钮全部撤掉，只留题面与每题的结果 */
export function buildSettledCard(
  questions: CardQuestion[], settled: Settled, customs: Record<string, string>, banner: string,
): object {
  const els: object[] = [{ tag: 'div', text: { tag: 'lark_md', content: `**${md(banner)}**` } }]
  questions.forEach((q, i) => {
    els.push({ tag: 'div', text: { tag: 'lark_md', content: `**${i + 1}. ${md(q.header ? `${q.header}：` : '')}${md(q.question)}**` } })
    const sel = settled[q.id]
    const text = sel === undefined ? '未作答' : sel.length ? sel.map(md).join('、') : `文字作答：${md(customs[q.id] ?? '')}`
    els.push(note(text))
  })
  return { config: { wide_screen_mode: true }, header: { title: plain('知识问答 · 已收卡'), template: 'grey' }, elements: els }
}

export interface CardActionResult {
  picked: Picked
  /** 这次点给定稿的问题：qid → 选中 labels（单选点按、多选提交才产生） */
  settled: Settled
}

/** 按钮点按 → 状态变化。value 是卡片按钮 value 原样（{q,o} 单选/多选勾选、{q,s} 多选提交）；
 *  问题 id 或选项 label 对不上的原样丢弃（null），调用方不该因此改卡片 */
export function applyCardAction(questions: CardQuestion[], picked: Picked, value: unknown): CardActionResult | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { q?: unknown; o?: unknown; s?: unknown }
  const q = questions.find((x) => x.id === String(v.q ?? ''))
  if (!q) return null
  const next: Picked = { ...picked }
  if (v.s !== undefined) {
    // 多选提交：当前勾选即定稿（一个没勾也算交卷——AI 会看到空选）
    return { picked: next, settled: { [q.id]: [...(next[q.id] ?? [])] } }
  }
  const label = String(v.o ?? '')
  if (!(q.options ?? []).some((o) => o.label === label)) return null
  if (q.multiSelect) {
    const sel = [...(next[q.id] ?? [])]
    const at = sel.indexOf(label)
    if (at >= 0) sel.splice(at, 1); else sel.push(label)
    next[q.id] = sel
    return { picked: next, settled: {} }
  }
  next[q.id] = [label]
  return { picked: next, settled: { [q.id]: [label] } }
}
