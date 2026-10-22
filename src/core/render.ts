import path from 'node:path'
import { statSync } from 'node:fs'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { visit, SKIP } from 'unist-util-visit'
import { toString } from 'hast-util-to-string'
import { slug } from 'github-slugger'
import type { Element, Root } from 'hast'
import type { Root as MdRoot, Code } from 'mdast'
import { rewriteWikilinks, resolveName, esc, nodePath } from './vault/graph'
import type { TocItem } from './api'

export interface Rendered { html: string; toc: TocItem[] }

// 正文与文档里的原始 HTML 会进 DSH 页面（同源，能调操作者 API），先净化：
// 去掉脚本、事件属性与非 http(s)/mailto 链接；留 class（mermaid 围栏）与 id；双链在此时还是 wikilink: 链接
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: { ...defaultSchema.attributes, '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'] },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'wikilink'],
  },
}

// 库里出现过的语言（mermaid 另走）；没列的落到纯文本
let hl: Promise<HighlighterCore> | null = null
const highlighter = () =>
  (hl ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
    langs: [
      import('@shikijs/langs/python'), import('@shikijs/langs/typescript'), import('@shikijs/langs/javascript'),
      import('@shikijs/langs/markdown'), import('@shikijs/langs/yaml'), import('@shikijs/langs/csharp'),
      import('@shikijs/langs/bash'), import('@shikijs/langs/json'),
    ],
    engine: createJavaScriptRegexEngine(),
  }))

// 文档相对地址：DSH 页面在哪个挂载路径下都能解析到 /api/wiki.asset
export const assetUrl = (rel: string) => 'api/wiki.asset?path=' + encodeURIComponent(rel)

// 链接 / 图片落在 asset/ 或 raw/ 下时给出库内路径，否则 null。
// 库里的写法是仓库根起（五区 `asset/…`、素材 `raw/…`，见 wiki 的 repo.py）；
// 其余相对该文档解析——书章节图 `../images/x.png` 归一化后也落 raw/…
export function assetRel(docId: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null
  let p = href.split('#')[0]
  try { p = decodeURI(p) } catch { /* 保持原样 */ }
  const rooted = p.startsWith('asset/') || p.startsWith('raw/')
  const rel = path.posix.normalize(rooted ? p : path.posix.join(path.posix.dirname(docId), p))
  return rel.startsWith('asset/') || rel.startsWith('raw/') ? rel : null
}

export function deadReason(e: any, g?: any): string {
  if (!e) return '解析不到'
  if (e.reason === 'ambiguous') {
    const at = (d: any) => (g ? nodePath(g.nodeOf.get(d._id)) : d._id)
    return '同名歧义：' + e.candidates.map(at).join('、') + '——写成路径形式'
  }
  if (e.reason === 'unpublished') return '双链只能指向沉淀区（素材写进 source）'
  return '库里也不存在'
}

// 客户端要画的围栏（mermaid 图、infographic 信息图）不交给 Shiki，
// 换成 <pre class="<lang>"> 原文，渲染进程再画
const VIEWER_FENCES = new Set(['mermaid', 'infographic'])
function remarkViewerFences() {
  return (tree: MdRoot) => {
    visit(tree, 'code', (node: Code, i, parent) => {
      if (!node.lang || !VIEWER_FENCES.has(node.lang) || !parent || i === undefined) return
      parent.children[i] = { type: 'html', value: '<pre class="' + node.lang + '">' + esc(node.value) + '</pre>' }
    })
  }
}

interface Ctx { docId: string; doc: any; dir: string; g: any; dead: Map<string, any>; toc: TocItem[] }

function rewriteAnchor(node: Element, ctx: Ctx) {
  const href = String(node.properties.href ?? '')
  if (href.startsWith('wikilink:')) {
    let raw = href.slice('wikilink:'.length)
    try { raw = decodeURI(raw) } catch { /* 保持原样 */ }
    const h = raw.indexOf('#')
    const target = h === -1 ? raw : raw.slice(0, h)
    const anchor = h === -1 ? '' : raw.slice(h + 1)
    const d = resolveName(ctx.g, target)
    node.properties = d
      ? { href: '#', dataWikiId: d._id, ...(anchor ? { dataAnchor: slug(anchor) } : {}) }
      : { href: '#', dataDead: '', className: ['wiki-dead'], title: deadReason(ctx.dead.get(target), ctx.g) }
    return
  }
  if (/^https?:\/\//i.test(href)) { node.properties.dataExternal = href; return }
  const rel = assetRel(ctx.docId, href)
  if (rel) { node.properties.href = '#'; node.properties.dataExplorable = rel }
}

// ![](asset/….html?h=560) 与图片同写法的嵌入件，换成正文里的 iframe。目标和图片一样
// 按文档相对解析（库里的写法从仓库根起），只嵌 asset/ 下的 html。
// 净化之后才换标签，所以 schema 不必放行 iframe；沙箱只给 allow-scripts、不给同源，
// 与 /api/wiki.asset 对 asset/ 页下发的 CSP 一致，页里的脚本碰不到 DSH 的 /api。
// ?h= 声明实际使用高度：定死 iframe 高度（check 强制要写）。不滚动（scrolling=no）：
// 嵌入件的内部滚动会和文章滚动抢滚轮，干脆禁掉——高度不够内容会被裁，改 ?h= 调高就是了。
// 不写 ?h= 的老写法降级回自适应：routes.ts 往 asset/ 页里注入的脚本上报内容高度，
// article.ts 据此撑高（到达前先给 480px）。
// src 挂上文件的 mtime 版本号：asset 改了、SSE 让页面重取时，正文其余不变、html 字符串
// 仍会因这个数变了而变，React 才会换掉 iframe——改动即刻可见，不用手动刷新。
// alt 有文字就当 iframe 的 title。
function embedHtml(node: Element, rel: string, query: string, dir: string) {
  const alt = String(node.properties.alt ?? '').trim()
  const h = /^h=(\d+)$/.exec(query)
  let v = ''
  try { v = String(statSync(path.join(dir, rel)).mtimeMs) } catch { /* 文件不在就裸嵌，check 另有报错 */ }
  node.tagName = 'iframe'
  node.properties = {
    src: assetUrl(rel) + (v ? `&v=${v}` : ''),
    sandbox: ['allow-scripts'], scrolling: 'no', loading: 'lazy',
    title: alt || rel, className: ['wiki-embed'],
    style: h ? `height:${h[1]}px` : 'height:480px',
    ...(h ? {} : { dataAutosize: '' }),
  }
}

function rehypeWiki(ctx: Ctx) {
  return (tree: Root) => {
    let h1Done = false
    visit(tree, 'element', (node: Element, i, parent) => {
      if (!h1Done && node.tagName === 'h1' && parent && i !== undefined) {
        h1Done = true
        parent.children.splice(i, 1)
        return [SKIP, i]
      }
      if (node.tagName === 'h2' || node.tagName === 'h3') {
        ctx.toc.push({ id: String(node.properties.id ?? ''), text: toString(node), depth: node.tagName === 'h2' ? 2 : 3 })
      } else if (node.tagName === 'a') {
        rewriteAnchor(node, ctx)
      } else if (node.tagName === 'img') {
        // ?h=560 是嵌入件的高度参数：归 embedHtml 消费，不进路径解析
        const raw = String(node.properties.src ?? '')
        const at = raw.indexOf('?')
        const rel = assetRel(ctx.docId, at === -1 ? raw : raw.slice(0, at))
        if (rel && rel.startsWith('asset/') && /\.html?$/i.test(rel)) { embedHtml(node, rel, at === -1 ? '' : raw.slice(at + 1), ctx.dir); return SKIP }
        // excalidraw 图位只有客户端块管线能画（exportToSvg 在浏览器跑）：服务端渲染面
        // （章节原文 / Lark 只读视图）不产 <img> 破图，换中性占位块。样式内联自带，不依赖面侧 CSS
        if (rel && /\.excalidraw$/i.test(rel)) {
          node.tagName = 'div'
          node.properties = {
            className: ['wiki-excalidraw'],
            title: rel,
            style: 'padding:.8em 1em;border:1px dashed rgba(128,128,128,.45);border-radius:6px;color:rgba(128,128,128,.9);font-size:.85em;text-align:center',
          }
          node.children = [{ type: 'text', value: 'Excalidraw 图 · 在知识库客户端查看' }]
          return SKIP
        }
        if (rel) node.properties.src = assetUrl(rel)
      }
      return undefined
    })
  }
}

export async function renderPage(doc: any, m: { dir: string; g: any; dead: Map<string, any> }): Promise<Rendered> {
  const toc: TocItem[] = []
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    // $...$ 行内、$$...$$ 块级公式（Obsidian 同款分隔符）
    .use(remarkMath)
    // 中文标点紧贴 ** 时 CommonMark 判不出加粗边界，这两个插件补上
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkViewerFences)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeSlug)
    // 公式在净化之后展开：KaTeX 输出自带转义、不回消毒，省得给 schema 开 MathML 全家；
    // 又在 Shiki 之前，块级公式（pre>code.math-display）才不会被当成代码高亮。
    // 语法错由 rehype-katex 兜底（固定不抛，原地红字 + vfile 消息）
    .use(rehypeKatex)
    .use(rehypeShikiFromHighlighter, await highlighter(), {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'text',
    })
    .use(rehypeWiki, { docId: doc._id, doc, dir: m.dir, g: m.g, dead: m.dead, toc })
    .use(rehypeStringify)
    .process(rewriteWikilinks(doc._content || ''))
  return { html: String(file), toc }
}
