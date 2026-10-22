import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { parseFrontmatter } from '../core/vault/vault'
import { vaultTools } from './pkg'
import type { Hub } from '../core/hub'

// 包内 vault-tools/agents/*.md 的 frontmatter tools 是 Claude Code 工具名，映射成 DSH 名
export const TOOL_MAP: Record<string, string> = {
  Read: 'read', Write: 'write', Edit: 'edit', Grep: 'grep', Glob: 'glob', Bash: 'bash', WebSearch: 'web_search', WebFetch: 'web_fetch',
}

export interface AgentDef { name: string; toolName: string; description: string; persona: string; allow: string[]; skills: string[] }

// frontmatter skills: 逗号串（与 tools: 同写法）或 YAML 列表都认；去空白、空项、重复，保持声明顺序
export function parseSkillList(v: unknown): string[] {
  const items = Array.isArray(v) ? v.map(String) : v == null ? [] : String(v).split(',')
  return [...new Set(items.map((t) => t.trim()).filter(Boolean))]
}

export function readAgents(warn: (msg: string) => void, root = vaultTools('agents')): AgentDef[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((f) => f.endsWith('.md')).sort().flatMap((f) => {
    let raw: string
    try { raw = readFileSync(join(root, f), 'utf8') } catch (e) { warn(`${f}: 读不出来，已跳过（${(e as Error).message}）`); return [] }
    const { data, body } = parseFrontmatter(raw)
    const name = String(data.name ?? f.replace(/\.md$/, ''))
    const description = String(data.description ?? '')
    const declared = String(data.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    // 认不出的工具名跳过——只会更窄，不会放宽
    const allow = declared.flatMap((t) => (TOOL_MAP[t] ? [TOOL_MAP[t]] : (warn(`${f}: 认不出工具 ${t}，已跳过`), [])))
    // 子 agent 跑在独立 preset 里，看不到主会话的技能目录：skills: 列出的技能直接给绝对路径。
    // 没写 skills: 退回同名技能（存在才挂）；列了但包里没有的 warn 跳过——只会更窄
    const skillPath = (s: string) => vaultTools('skills', s, 'SKILL.md')
    const listed = parseSkillList(data.skills)
    const skills = data.skills == null
      ? (existsSync(skillPath(name)) ? [name] : [])
      : listed.filter((s) => existsSync(skillPath(s)) || (warn(`${f}: 找不到技能 ${s}，已跳过`), false))
    const skillLines = skills.map((s) => `\n\n预载技能 ${s} 的全文在 ${skillPath(s)}，开工先 read 它、照它做；它引用的相对路径按它所在目录解析。`).join('')
    const persona = `你是 ${name} 子 agent。${description}${skillLines}\n\n${body.trim()}`
    return [{ name, toolName: 'wiki_' + name.replace(/^wiki-/, '').replace(/-/g, '_'), description, persona, allow, skills }]
  }).filter((a) => a.allow.length > 0)
}

// 0.2.1 起 tool-subagent 不收 persona / toolFilter：人设与工具改由 Agent Preset 组合。
// 一个子 agent 一个 preset，只挂 allow 里有的工具插件——fs-search 的 grep / glob 是一体的，
// 声明了其中一个就两个都给（四个 agent 里没有只要一半的）
export const presetId = (d: AgentDef) => `dsh-knowledge-brain.${d.name}`

export function presetFor(d: AgentDef) {
  const has = (t: string) => d.allow.includes(t)
  const rows: any[] = [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: d.persona } }]
  if (has('read') || has('write') || has('edit')) {
    rows.push({ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { read: has('read'), readImage: false, write: has('write'), edit: has('edit') } })
  }
  if (has('grep') || has('glob')) rows.push({ id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } })
  if (has('bash')) {
    rows.push({ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', config: { enableRunInBackground: false }, disabled: process.platform === 'win32' })
    rows.push({ id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: process.platform !== 'win32' })
  }
  if (has('web_search') || has('web_fetch')) rows.push({ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { search: has('web_search'), fetch: has('web_fetch') } })
  // order 排到内置 preset 后面：注册表没有「隐藏」位，这几行会出现在会话的 preset 列表里
  return { id: presetId(d), name: `知识库 · ${d.name}`, description: d.description, order: 900, plugins: rows }
}

export function mountAgents(ctx: Context, hub: Hub) {
  ctx.inject(['tools', 'subagents', 'systemPrompt', 'sessionProjections', 'agentPresets'] as any, (c: Context) => {
    const presets = (c as any).agentPresets
    let mounted: { fiber: any; unregister: () => Promise<void> }[] = []
    let sig = ''
    const teardown = async (list: typeof mounted) => {
      // 先卸工具再撤 preset：工具还在时撤 preset，正在起的子 agent 会找不到组合
      await Promise.all(list.map((m) => m.fiber.dispose()))
      await Promise.all(list.map((m) => m.unregister()))
    }
    const sync = async () => {
      const defs = hub.engine.model ? readAgents((m) => c.logger.warn(m)) : []
      const next = JSON.stringify(defs)
      if (next === sig) return
      sig = next
      // 同名实例与同 id preset 都会冲突：先全部卸掉再挂
      const old = mounted; mounted = []
      await teardown(old)
      for (const d of defs) {
        // preset 要先于工具登记：tool-subagent 挂载时校验 agentPreset 指向已声明的 preset
        const unregister = await presets.register(presetFor(d))
        const broken = (await presets.resolve(presetId(d)))?.broken
        if (broken) c.logger.warn(`子 agent ${d.name} 的 preset 激活失败：${broken}`)
        const fiber = c.plugin(ToolSubagent as any, { provider: 'spawn', toolName: d.toolName, agentPreset: presetId(d) })
        mounted.push({ fiber, unregister })
      }
    }
    // 串行：上一次卸载没完就开始下一次，会挂出同名 tool-subagent 而冲突
    let chain = Promise.resolve()
    const queue = () => { chain = chain.then(sync).catch((e) => console.error('[dsh-knowledge-brain] 子 agent 同步失败', e)) }
    queue()
    c.effect(() => hub.onChanged((ev) => { if (ev.kind === 'tools' || ev.kind === 'structural') queue() }), 'dsh-knowledge-brain.agents')
    c.effect(() => () => { teardown(mounted).catch(() => {}) }, 'dsh-knowledge-brain.agents.dispose')
  })
}
