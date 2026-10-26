import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseFrontmatter } from '../core/vault/vault'
import { readRaw } from '../core/raw'
import { clip, rootImages } from '../core/llm'
import { inside } from '../core/guard'
import type { Hub } from '../core/hub'
import { createWikiOps } from './wiki-ops'

const output = { schema: { type: 'json' } as const, render: (_a: unknown, v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] }

export function registerTools(ctx: Context, hub: Hub) {
  const tools = (ctx as any).tools
  const reg = (d: any) => ctx.effect(() => tools.register(defineTool({ ...d, output, isConcurrencySafe: () => true })), `dsh-knowledge-brain.tool.${d.name}`)
  const ops = createWikiOps(() => hub.model())

  reg({
    name: 'wiki_search',
    description: '在格物致知 wiki 里全文搜索（中文分词）。返回页 id、页名、面包屑与命中摘要。读正文用 wiki_read_page。',
    parameters: { query: { type: 'string', required: true, description: '检索词' }, limit: { type: 'number', description: '最多条数，默认 10' } },
    async execute(a: any) { return ops.search(a.query, a.limit ?? 10) },
  })

  reg({
    name: 'wiki_read_page',
    description: '读 wiki 沉淀页：frontmatter 元数据 + markdown 正文 + 前后页 + 反链。id 可以是库内路径（如 知识/机器学习/模型族/模型族.md）或页名；页名有歧义或找不到时返回候选。正文超长会截断，按返回的 next_offset 续读。',
    parameters: { id: { type: 'string', required: true, description: '库内路径或页名' }, offset: { type: 'number', description: '正文起始字符位置，默认 0' } },
    async execute(a: any) { return ops.readPage(a.id, a.offset ?? 0) },
  })

  reg({
    name: 'wiki_backlinks',
    description: '列出引用了某页的其他页及引用处上下文。',
    parameters: { id: { type: 'string', required: true, description: '库内路径或页名' } },
    async execute(a: any) { return ops.backlinks(a.id) },
  })

  reg({
    name: 'wiki_tree',
    description: '看 wiki 的目录树（区 → 文件夹 → 页），含每项描述与页数。path 给某个文件夹页 id 只看它下面；depth 默认 2。',
    parameters: { path: { type: 'string', description: '文件夹页 id，省略为根' }, depth: { type: 'number', description: '展开层数，默认 2' } },
    async execute(a: any) { return ops.tree(a.path, a.depth ?? 2) },
  })

  reg({
    name: 'wiki_tags',
    description: '不给 tag：列出全部标签与页数；给 tag：列出该标签下的页。',
    parameters: { tag: { type: 'string', description: '标签名' } },
    async execute(a: any) { return ops.tags(a.tag) },
  })

  reg({
    name: 'wiki_raw',
    description: '读 raw/ 下的文档或听录。md 返回正文（超长截断，按 next_offset 续读）；pdf / html / 其他只返回元信息。',
    parameters: { path: { type: 'string', required: true, description: '库内路径，以 raw/ 开头' }, offset: { type: 'number', description: '正文起始字符位置' } },
    async execute(a: any) {
      const m = hub.model(); const r = await readRaw(m, a.path)
      if (!r.ok) throw new Error(`读不到文件 ${a.path}（只许 raw/ 下的已有文件）`)
      const { html: _h, toc: _t, url: _u, ...meta } = r.raw
      if (r.raw.kind !== 'md' || r.raw.offline) return meta
      const c = clip(rootImages(a.path, parseFrontmatter(readFileSync(inside(m.dir, a.path, 'raw')!, 'utf8')).body), a.offset ?? 0)
      return { ...meta, body: c.text, next_offset: c.next }
    },
  })
}

// Lark 问答已改走真实 DSH 会话（见 lark/ask.ts 与 lark/mount.ts）：会话里的 agent 用上面
// 这组全局 wiki_* 工具，文件夹范围由会话首条的约束指令圈定，不再挂绑定专属的工具对。
