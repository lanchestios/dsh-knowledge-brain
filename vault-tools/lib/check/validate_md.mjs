// md 渲染校验 —— wiki check 的一部分，由 check.py 壳进来调。
// 用法：node validate_md.mjs <仓库根>，stdin 每行一个相对路径的 md。
// 与 dsh-knowledge-brain 的渲染同源：同一条 remark 管线取 AST（验的就是渲染的）。两组：
//   围栏与公式 —— mermaid.parse / parseSyntax + getTemplate / katex.renderToString 三个入口只验不画；
//   语法     —— 写成结构的 md 没渲染成结构（「落空」）：表格塌成段落、标记残留成字面、
//               标题/分隔线误判、围栏或注释没闭合吞掉后文。
// 输出：每行「路径:行 组 kind 消息」，组是 fence / syntax，由 check.py 分到各自的报错前缀。
// 退出码：0 = 跑完；3 = 依赖未装；2 / 1 = 用法错 / 脚本自身出错。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) { console.error('用法：validate_md.mjs <仓库根>'); process.exit(2) }
const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)

let unified, remarkParse, remarkGfm, remarkMath, remarkCjk, remarkCjkStrike, visit, katex, mermaid, ig
try {
  ;({ unified } = await import('unified'))
  ;({ default: remarkParse } = await import('remark-parse'))
  ;({ default: remarkGfm } = await import('remark-gfm'))
  ;({ default: remarkMath } = await import('remark-math'))
  ;({ default: remarkCjk } = await import('remark-cjk-friendly'))
  ;({ default: remarkCjkStrike } = await import('remark-cjk-friendly-gfm-strikethrough'))
  ;({ visit } = await import('unist-util-visit'))
  ;({ default: katex } = await import('katex'))
  // mermaid 12 的 dompurify 认 window，裸 Node 没有；先垫一个再加载
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!DOCTYPE html>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  ;({ default: mermaid } = await import('mermaid'))
  ig = await import('@antv/infographic')
} catch (e) {
  console.error('依赖未装：随 dsh-knowledge-brain 插件分发（插件根或 profile 根的 node_modules）——', String(e.message).split('\n')[0])
  process.exit(3)
}

const clean = (m) => String(m).replace(/\s+/g, ' ').trim().slice(0, 160)
// 与 src/core/render.ts 的 remark 段同序同插件（cjk-friendly 管中文标点旁的 ** 能不能闭合）
const parse = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkCjk).use(remarkCjkStrike)
const errors = []
const mermaidJobs = [] // { rel, line, code }
const fence = (rel, line, kind, msg) => errors.push(`${rel}:${line} fence ${kind} ${msg}`)
// 语法一行只报一条：表格里没转义的 | 会把行内代码也切坏，同一行连带出一串「标记残留」；
// 结构类（表格、标题、围栏、注释）是病根，先占位，残留只在这行没别的问题时才报
const syntaxAt = new Map() // "rel:line" → { kind, msg }
const syntax = (rel, line, kind, msg) => {
  const k = `${rel}:${line}`, had = syntaxAt.get(k)
  if (!had || (had.kind === '标记残留' && kind !== '标记残留')) syntaxAt.set(k, { kind, msg })
}

// ---- 渲染前的两道改写：照搬渲染侧，否则 AST 和读者看到的对不上 ----

// frontmatter 渲染前已剥掉；这里换成等量空行，行号不动（不剥会被解析成分隔线 + setext 标题）
function blankFrontmatter(md) {
  if (!md.startsWith('---\n')) return md
  const end = md.indexOf('\n---', 4)
  if (end === -1) return md
  const stop = md.indexOf('\n', end + 4)
  const head = md.slice(0, stop === -1 ? md.length : stop)
  return head.replace(/[^\n]/g, '') + md.slice(head.length)
}

// [[目标#锚|标签]] → [标签](wikilink:…)。照搬 src/core/vault/graph.ts 的 WIKILINK_RE / walkProse /
// rewriteWikilinks，那边改了这边跟着改。不改写的话标签里的 | 会在表格里被当成分列。
const WIKILINK_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g
const lastSeg = (t) => t.slice(t.lastIndexOf('/') + 1)
function rewriteWikilinks(md) {
  const lines = md.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue }
    if (inFence || lines[i].indexOf('[[') === -1) continue
    const parts = lines[i].split('`')
    for (let j = 0; j < parts.length; j += 2) {
      parts[j] = parts[j].replace(WIKILINK_RE, (m, target, anchor, label) => {
        const t = target.trim()
        return t ? '[' + (label || lastSeg(t)).trim() + '](wikilink:' + encodeURI(t) + encodeURI(anchor || '') + ')' : m
      })
    }
    lines[i] = parts.join('`')
  }
  return lines.join('\n')
}

// ---- 围栏与公式 ----

const checkInfographic = (rel, line, code) => {
  const { errors: es, ast } = ig.parseSyntax(code)
  for (const e of es) fence(rel, e.line ?? line, 'infographic', clean(e.message))
  const name = ast.entries.infographic?.value
  if (!name) return fence(rel, line, 'infographic', '缺首行「infographic <模板名>」')
  if (!ig.getTemplate(name)) return fence(rel, line, 'infographic', `模板不在注册表：${name}`)
  // 官方 skill 的硬约束：compare-* 两个根节点，对比项做它们的 children
  if (name.startsWith('compare-')) {
    const roots = ast.entries.data?.entries?.items?.items?.length ?? 0
    if (roots !== 2) fence(rel, line, 'infographic', `compare-* 要两个根节点，现在是 ${roots} 个`)
  }
}

// ---- 语法：写成结构却没渲染成结构 ----

// 文本节点的源码里还留着这些，就是标记没被认出来、读者看到的是字面符号。
// 先去掉反斜杠转义（\* 是作者要的字面），行内代码、公式不是文本节点，天然不查。
const RESIDUE = [
  [/\*\*/, '「**」没配成加粗（不成对，或贴着空格）'],
  [/~~/, '「~~」没配成删除线'],
  [/\]\(/, '「](」没成链接（目标里有空格要写成 <…> 或 %20，括号要配对）'],
  [/\[\[|\]\]/, '「[[ ]]」没成双链（目标不能空、不能含 [ ] |）'],
  [/\[\^[^\]\s]+\]/, '脚注引用没有对应的「[^名]: …」定义'],
  [/`/, '「`」没配成行内代码（反引号不成对）'],
]
const unescape = (s) => s.replace(/\\[\\`*_{}\[\]()#+\-.!|~<>]/g, '')
const DELIM_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
// 容器前缀（引用 > 、列表缩进）在表格行首；比对前剥掉
const stripContainer = (s) => s.replace(/^(\s*>)+\s?/, '').trimStart()
const cells = (s) => stripContainer(s).replace(/\\\|/g, '').trim().replace(/^\||\|$/g, '').split('|').length

// 一级标题只管沉淀页：raw/ 素材原样收（书的章节以 # 章名 起头），README 是库首页（GitHub 上要标题）
const h1Exempt = (rel) => rel === 'README.md' || rel === 'raw' || rel.startsWith('raw/')

function checkSyntax(rel, src, tree) {
  const lineAt = (off) => src.slice(0, off).split('\n').length
  const srcOf = (n) => src.slice(n.position.start.offset, n.position.end.offset)
  visit(tree, (node, _i, parent) => {
    // 解析插件生成的节点没有 position（如 GFM 把 www.x..y 拆成 link + text），源码里没有它对应的片段，无从查起
    if (!node.position) return
    const line = node.position.start.line
    switch (node.type) {
      case 'text': {
        if (parent?.type === 'link' && /^wikilink:/.test(parent.url)) break   // 双链标签里的字面随它
        const raw = unescape(srcOf(node))
        for (const [re, msg] of RESIDUE) {
          const m = re.exec(raw)
          if (m) { syntax(rel, line + (raw.slice(0, m.index).split('\n').length - 1), '标记残留', msg); break }
        }
        break
      }
      case 'paragraph': {
        const lines = srcOf(node).split('\n')
        if (/^#{1,6}[^#\s]/.test(stripContainer(lines[0])))
          syntax(rel, line, '标题缺空格', '「#」后面要跟空格才是标题，现在是普通段落')
        for (let k = 1; k < lines.length; k++) {
          if (lines[k].includes('|') && DELIM_ROW.test(stripContainer(lines[k])) && lines[k - 1].includes('|')) {
            const h = cells(lines[k - 1]), d = cells(lines[k])
            syntax(rel, line + k, '表格塌成段落', h !== d
              ? `表头 ${h} 列、分隔行 ${d} 列，整张表渲染成普通段落——分隔行补成与表头同列数`
              : '整张表渲染成普通段落——表格前空一行')
          }
        }
        break
      }
      case 'table': {
        const n = node.align.length
        for (const row of node.children.slice(1))
          if (row.children.length > n)
            syntax(rel, row.position.start.line, '表格行溢出', `这行 ${row.children.length} 格、表头 ${n} 列，多出的格子不显示——单元格里的竖线写成 \\|`)
        break
      }
      case 'heading': {
        if (node.position.start.line !== node.position.end.line)
          syntax(rel, line, '误成标题', '段落下一行是 --- 或 ===，整段被渲染成标题——分隔线前空一行')
        else if (node.depth === 1 && !h1Exempt(rel))
          syntax(rel, line, '一级标题', '阅读器标题栏已显示页名，正文不写一级标题——删掉这行，正文从二级标题起')
        break
      }
      case 'code': {
        const lines = srcOf(node).split('\n').map(stripContainer)
        const open = /^(`{3,}|~{3,})/.exec(lines[0])
        if (!open) break                               // 缩进代码块没有闭合一说
        const close = lines.length > 1 ? lines[lines.length - 1].trim() : ''
        if (!(close.startsWith(open[1][0].repeat(open[1].length)) && /^(`+|~+)$/.test(close)))
          syntax(rel, line, '围栏未闭合', `${open[1]} 没有对应的结尾，后文到 ${lineAt(node.position.end.offset)} 行都被当成代码`)
        break
      }
      case 'html': {
        if (node.value.includes('<!--') && !node.value.includes('-->'))
          syntax(rel, line, '注释未闭合', `<!-- 没有 -->，后文到 ${lineAt(node.position.end.offset)} 行都被吞掉`)
        break
      }
    }
  })
}

for (const rel of files) {
  let src, tree
  try {
    src = rewriteWikilinks(blankFrontmatter(readFileSync(join(root, rel), 'utf8')))
    tree = parse.parse(src)
  } catch { /* 读不了或解析不了：check 的引用校验会报，这里不重复 */ continue }
  visit(tree, (node) => {
    const line = node.position?.start?.line ?? 0
    if (node.type === 'code' && node.lang === 'mermaid') mermaidJobs.push({ rel, line, code: node.value })
    if (node.type === 'code' && node.lang === 'infographic') checkInfographic(rel, line, node.value)
    if (node.type === 'math' || node.type === 'inlineMath') {
      try { katex.renderToString(node.value, { throwOnError: true, strict: 'ignore' }) }
      catch (e) { fence(rel, line, '公式', clean(e.message)) }
    }
  })
  checkSyntax(rel, src, tree)
}

// mermaid.parse 是异步的，小并发跑完
const results = await Promise.all(mermaidJobs.map(async (j) => {
  try { await mermaid.parse(j.code) } catch (e) { return `${j.rel}:${j.line} fence mermaid ${clean(e.message)}` }
}))
errors.push(...results.filter(Boolean))
for (const [k, { kind, msg }] of syntaxAt) errors.push(`${k} syntax ${kind} ${msg}`)

// 按文件、再按行号排（字符串排序会把 :8 排到 :27 后面）
const key = (e) => { const m = /^(.*?):(\d+) /.exec(e); return m ? [m[1], +m[2]] : [e, 0] }
errors.sort((a, b) => { const [fa, la] = key(a), [fb, lb] = key(b); return fa < fb ? -1 : fa > fb ? 1 : la - lb })
for (const e of errors) console.log(e)
