import type { WikiApi } from '../api'
import { onFill, type FillRequest } from './fill'
import type { PanelState } from '../reader/panel'

// 会话挂在 Wiki 仓库这个工作区下（没挂工作区的会话显示「选择一个工作区开始」）；workspaces.create 已有则返回
export async function newSession(c: any, api: WikiApi): Promise<string> {
  const { dir } = await api.status()
  const ws = await c.get('workspaces').create({ path: dir })
  return c.get('sessions').create({ workspaceId: ws.workspaceId, cwd: dir })
}

// 文件引用：@ + 相对库根的路径，带空格加引号（照 DSH 文件 mention）
const at = (p: string) => (/\s/.test(p) ? `@"${p}"` : `@${p}`)
export function fillText(r: FillRequest): string {
  if (r.kind === 'chapter') return `/wiki-write 沉淀${r.book} ${r.id} 进知识区${r.text ? ' ' + at(r.text) : ''} `
  return `/wiki-write 沉淀这些文档 ${r.paths.map(at).join(' ')} `
}

// 待填草稿：会话组件挂上（或已挂着）时取走，setDraft 填进输入框；send=true 的接着发送
// （场景按钮：点了就是要跑，不再让人回车）。不带 send 的只填不发（右栏退路的话题）
export interface Draft { text: string; send: boolean }
const drafts = new Map<string, Draft>()
const ls = new Set<() => void>()
export const queueDraft = (sessionId: string, text: string, o: { send?: boolean } = {}) => {
  drafts.set(sessionId, { text, send: !!o.send }); ls.forEach((l) => l())
}
export const takeDraft = (sessionId: string): Draft | undefined => { const t = drafts.get(sessionId); drafts.delete(sessionId); return t }
export const onDraft = (l: () => void) => { ls.add(l); return () => { ls.delete(l) } }

/** 会话输入框挂上时调：取走排给这场的草稿填进去；带 send 的下一拍 submit——走 DSH 输入框自己的
 *  提交路（与人按回车同一条，/wiki-write 这类技能指令照常认），下一拍是等输入框吃进草稿。
 *  发送失败草稿留在框里，人回车即可 */
export function applyDraft(sessionId: string, actions: { setDraft(t: string): void; submit?(): void }): void {
  const d = takeDraft(sessionId)
  if (!d) return
  actions.setDraft(d.text)
  if (d.send && actions.submit) setTimeout(() => { try { actions.submit!() } catch { /* 草稿留在框里 */ } }, 0)
}

/** 场景按钮（知识沉淀、提炼、空库第一步）：新开一场会话挂进右栏（free 槽：换页不撤，直到下一个
 *  场景按钮 / 历史另挑 / 手动新开），草稿带 send 排队。 */
export async function openScene(
  panel: PanelState, c: any, api: WikiApi, text: string,
): Promise<string> {
  const id = await newSession(c, api)
  panel.free.set(id)
  panel.tab.set('session')
  panel.inspector.set(true)
  panel.error.set('')
  queueDraft(id, text, { send: true })
  return id
}

// 填指令（一章「知识沉淀」、文档表「知识沉淀」）：面板订阅一次（不挂在右栏组件上——右栏收起时
// 组件不在）。都是场景按钮：新开一场、指令直接发送；指令自带书名 / 章名 / 文件引用，不依赖人停在哪页
export function wireFills(panel: PanelState, c: any, api: WikiApi): () => void {
  return onFill((r) => {
    openScene(panel, c, api, fillText(r)).catch((e) => {
      panel.inspector.set(true)
      panel.tab.set('session')
      panel.error.set(String(e?.message ?? e))
    })
  })
}

// 目录串比对前抹尾斜杠：配置里 vaultDir 常写成 '.../wiki/'，DSH 建会话时把 cwd 规整成不带斜杠——
// 严格相等一条都对不上。两边都规整，带不带斜杠一个待遇
export const sameDir = (a: string | undefined, b: string) => !!a && a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

// 子智能体会话（origin = subagent）cwd 也是库目录、又总是最新动过的，不算顶层会话：
// 默认挂哪场、历史列哪些都跳过它，要看从会话栏头的子智能体胶囊进
const topLevel = (x: { origin?: string }) => x.origin !== 'subagent'

// 三区各页（一页 / 一本书 / 书架 / 文档表）右栏的「当前会话」：库目录下最近动过的哪场顶层会话就挂哪场
// （空白场也算——刚建没聊过的正是它，别再另建一场）；一场都没有返回 null，调用处建新的
export function latestVault(
  byId: Record<string, { cwd?: string; blank: boolean; updatedAt: number; origin?: string }>,
  dir: string,
): string | null {
  let best: { id: string; t: number } | null = null
  for (const [id, x] of Object.entries(byId)) {
    if (!sameDir(x.cwd, dir) || !topLevel(x)) continue
    if (!best || x.updatedAt > best.t) best = { id, t: x.updatedAt }
  }
  return best?.id ?? null
}

// 当前会话（右栏挂的、提炼指令排进的都是它）的统一解析：free 槽顶着的就它；否则库目录最近一场
// （latestVault，空白场也算——刚建的正是它）；一场都没有现建一场，建好进 free 槽顶着。
// 建场并发去重：右栏解析和提炼同时触发也只建一场。列表取不到就当一场没有，退到建新场
let making: Promise<string> | null = null
export async function currentSession(panel: PanelState, c: any, api: WikiApi): Promise<string> {
  const held = panel.free.get()
  if (held) return held
  try {
    const { dir } = await api.status()
    const byId = c.get('sessions')?.list?.getSnapshot?.()?.byId ?? {}
    const got = latestVault(byId, dir)
    if (got) return got
  } catch { /* 列表取不到就当一场没有，退到建新场 */ }
  if (!making) making = newSession(c, api).finally(() => { making = null })
  const id = await making
  if (!panel.free.get()) panel.free.set(id)
  return panel.free.get() ?? id
}

// 右栏「历史」的候选行：库目录下的会话（cwd 是库目录——库里开的会话都这样，别的目录的不算），
// 空白会话（从没说过话）不算历史；按最近动过排序，取前 cap 条。行上带 displayTitle / updatedAt 够画
export interface HistoryRow { id: string; title: string; updatedAt: number }
export function vaultSessions(
  byId: Record<string, { displayTitle: string; cwd?: string; blank: boolean; updatedAt: number; origin?: string }>,
  dir: string,
  cap = 10,
): HistoryRow[] {
  return Object.entries(byId)
    .filter(([, x]) => sameDir(x.cwd, dir) && !x.blank && topLevel(x))
    .map(([id, x]) => ({ id, title: x.displayTitle, updatedAt: x.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, cap)
}

// 最后退路：右栏嵌不了会话（拿不到 SessionProvider / 会话工厂）才走——开一个普通 DSH 会话
// （会切到会话界面），把草稿填进它的输入框。能嵌时退路在 WikiRightbar 里就地开右栏会话，不走这里。
// 草稿在切过去之前就填好（宿主 requestDraftInitialization：不等输入框挂上，切过去时已经在框里）
export async function discuss(c: any, api: WikiApi, text: string): Promise<void> {
  const id = await newSession(c, api)
  const sessions = c.get('sessions')
  const ref = sessions.retain(id, { source: 'dsh-knowledge-brain' })
  try {
    const binding = sessions.binding?.(id)
    if (binding) c.get('conversation').input.requestDraftInitialization(binding, { prompt: text })
    await c.get('uiWorkspace').openSession(id)
    if (!binding) c.get('conversation').input.for(sessions.scope(id)).setDraft(text)
  } finally { ref.release() }
}
