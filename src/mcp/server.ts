// 一个 MCP 条目 = 一个文件夹：每请求由 factory 新建 McpServer（SDK createMcpHandler 的约定），
// 2026-07-28 走新线协议，旧 initialize 握手走 SDK 自带的无状态回退。工具全只读，scope 在 wiki-ops 里硬隔离。
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { createWikiOps } from '../host/wiki-ops'
import { readImage } from './image'
import { isVaultRoot } from '../core/folder'
import type { Model } from '../core/model'

const RO = { readOnlyHint: true } as const
const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] })
const safe = <A>(fn: (a: A) => any) => async (a: A) => { try { return await fn(a) } catch (e) { return fail(e) } }

/** title：条目的显示名称，进 serverInfo.title（客户端可拿来显示）；name 固定是插件名 */
export function buildMcpServer(getModel: () => Model, folder: string, title?: string): McpServer {
  const ops = createWikiOps(getModel, folder)
  const s = new McpServer({ name: 'dsh-knowledge-brain', version: '0.1.0', ...(title ? { title } : {}) })
  const where = isVaultRoot(folder) ? '知识库' : `「${folder}」文件夹`

  s.registerTool('wiki_search', {
    description: `在${where}里全文搜索（中文分词）。返回页 id、页名、面包屑与命中摘要。读正文用 wiki_read_page。`,
    inputSchema: z.object({ query: z.string().describe('检索词'), limit: z.number().optional().describe('最多条数，默认 10') }),
    annotations: RO,
  }, safe(({ query, limit }) => json(ops.search(query, limit ?? 10))))

  s.registerTool('wiki_read_page', {
    description: `读${where}里的页：frontmatter 元数据 + markdown 正文 + 前后页 + 反链。id 可以是库内路径或页名；页名有歧义或找不到时返回候选。正文超长会截断，按返回的 next_offset 续读。正文里的图片用 wiki_image 看。`,
    inputSchema: z.object({ id: z.string().describe('库内路径或页名'), offset: z.number().optional().describe('正文起始字符位置，默认 0') }),
    annotations: RO,
  }, safe(({ id, offset }) => json(ops.readPage(id, offset ?? 0))))

  s.registerTool('wiki_backlinks', {
    description: `列出${where}里引用了某页的其他页及引用处上下文。`,
    inputSchema: z.object({ id: z.string().describe('库内路径或页名') }),
    annotations: RO,
  }, safe(({ id }) => json(ops.backlinks(id))))

  s.registerTool('wiki_tree', {
    description: `看${where}的目录树（文件夹 → 页），含每项描述与页数。path 给某个文件夹页 id 只看它下面；depth 默认 2。`,
    inputSchema: z.object({ path: z.string().optional().describe(`文件夹页 id，省略为${isVaultRoot(folder) ? '整个知识库' : '本文件夹'}`), depth: z.number().optional().describe('展开层数，默认 2') }),
    annotations: RO,
  }, safe(({ path, depth }) => json(ops.tree(path, depth ?? 2))))

  s.registerTool('wiki_tags', {
    description: `不给 tag：列出${where}里的全部标签与页数；给 tag：列出该标签下的页。`,
    inputSchema: z.object({ tag: z.string().optional().describe('标签名') }),
    annotations: RO,
  }, safe(({ tag }) => json(ops.tags(tag))))

  s.registerTool('wiki_image', {
    description: `看${where}页面正文里引用的图片。path 用正文里 ![](…) 的库根路径（asset/… 或 raw/…）。只支持 png/jpg/jpeg/gif/webp/bmp，单张 ≤5MB。`,
    inputSchema: z.object({ path: z.string().describe('图片的库根路径，如 asset/xx/a.png') }),
    annotations: RO,
  }, safe(({ path }) => {
    const img = readImage(ops.model(), folder, path)
    return { content: [{ type: 'image' as const, data: img.data, mimeType: img.mimeType }] }
  }))

  return s
}

export function createFolderHandler(getModel: () => Model, folder: string, title?: string) {
  return createMcpHandler(() => buildMcpServer(getModel, folder, title), {
    onerror: (e) => console.error('[dsh-knowledge-brain] MCP', e.message),
  })
}
