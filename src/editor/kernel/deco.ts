// src/editor/kernel/deco.ts
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import GithubSlugger from 'github-slugger'
import { blocksOf } from './blocks'
import { frontmatterRange } from './frontmatter'
import { blockWidget } from '../blocks/registry'
import { ImageWidget, MathWidget, TaskWidget, HrWidget } from '../blocks/inline'
import type { BatchStore } from '../blocks/server'
import type { EditorIo, NameState } from '../io'
import s from '../editor.module.css'

// 双链名 → 解析态（id / 死链原因）。surface 拿到 io.resolveNames 结果后 dispatch 进来；
// 装饰直接读 state（field 变更自动重建），不额外走 ctx。
export const setNameStates = StateEffect.define<Record<string, NameState>>()

// 定点重建块装饰（excalidraw 场景被重写、md 没动）：dispatch 即重跑 buildDeco，
// 块按版本判陈旧重建（registry 的 stale），正文与撤销史不动
export const refreshBlocksEffect = StateEffect.define<null>()
export const nameStates = StateField.define<Record<string, NameState>>({
  create: () => ({}),
  update(v, tr) { for (const e of tr.effects) if (e.is(setNameStates)) return e.value; return v },
})

export interface DecoCtx { mode: 'edit' | 'read'; dark: boolean; batch: BatchStore; io: EditorIo; degrade: boolean; frontmatterVisible?: boolean }

// syntaxTree(state) may only cover the initial viewport when a document first opens. Decorations are
// held in a StateField, so a partial first tree would leave every later block as raw Markdown forever.
// Complete the parse once for this build; on unusually large/slow input, keep CodeMirror responsive
// by falling back after the bounded synchronous parse window.
const decorationTree = (state: EditorState): Tree =>
  ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)

// [[目标#锚|别名]] 目标拆解：# 先于 | 拆（对齐服务端 render.ts rewriteAnchor 的拆序——
// resolveNames/染色拿裸页名，锚点单独随链接走，surface 的名单收集与 ⌘点击 EditRef 共用本拆）。
// 空锚（[[页#]]）视同无锚。
export function wikiTarget(raw: string): { name: string; anchor?: string } {
  const h = raw.indexOf('#')
  const name = (h === -1 ? raw : raw.slice(0, h)).split('|')[0]
  const anchor = h === -1 ? '' : raw.slice(h + 1).split('|')[0]
  return { name, anchor: anchor || undefined }
}

// 阅读态隐藏占位：renderPage 产出的阅读 html 里本就没有 frontmatter（DocStore 剥进 meta）
// 与首个 h1（h1Done），DocView 阅读态按同规则让它们不出现在版面上
class HideWidget extends WidgetType {
  eq() { return true }
  toDOM() { return document.createElement('span') }
}

export function buildDeco(state: EditorState, ctx: DecoCtx, atomic: Array<[number, number]> = []): DecorationSet {
  const doc = state.doc.toString()
  const tree = decorationTree(state)
  const deco: Range<Decoration>[] = []
  const sel = state.selection.main
  // near：选区「边界落在块内」才露源码（原子块选中设计）——空选区光标在 (from, to] 内算块内；
  // 非空选区只有 from/to 两侧边界之一严格落在 (from, to) 里才算。只是跨过（两侧边界都在块外）
  // 的选区保持渲染件：拖选扫过不再把块闪成源码。旧「块尾放宽一格」（head <= to+1）随之取消——
  // 贴块尾光标按新边界规则在块外，保留放宽会把渲染件闪没。
  // 阅读态虽然不可编辑，CodeMirror 仍会在 mousedown 时移动内部选区。若继续按选区
  // 展开 Markdown，链接的 data-target 会在随后 click 到来前被拆掉，普通点击只能露出
  // [[源码]] 而无法跳转。阅读态没有“就地编辑源码”的需求，所有行内语法恒按展示态处理。
  const near = (from: number, to: number) => ctx.mode === 'read'
    ? false
    : sel.empty ? sel.head > from && sel.head <= to : (sel.from > from && sel.from < to) || (sel.to > from && sel.to < to)

  const fm = frontmatterRange(doc)
  // 属性入口由文章标题栏统一控制。默认完全隐藏；展开后以源码行显示，阅读态只读、编辑态可修改。
  if (fm && !ctx.frontmatterVisible) {
    deco.push(Decoration.replace({ block: true }).range(fm.from, fm.to))
  } else if (fm) {
    const first = state.doc.lineAt(fm.from)
    const last = state.doc.lineAt(Math.max(fm.from, fm.to - 1))
    for (let n = first.number; n <= last.number; n++) {
      const line = state.doc.line(n)
      const edge = n === first.number ? 'start' : n === last.number ? 'end' : 'middle'
      deco.push(Decoration.line({ class: s.fmLine, attributes: { 'data-fm-edge': edge } }).range(line.from))
    }
  }

  // 标题锚点 slug 用类实例（具名 slug() 是无状态单发、不做同页去重，计数会与服务端 rehype-slug 分叉）
  const slugger = new GithubSlugger()
  // 大文档护栏同样约束块件选择（表格超限退 server 用）——inlineDeco 自查 doc.lines，块级在这里带上
  const bctx: DecoCtx = ctx.degrade || state.doc.lines > 20000 ? { ...ctx, degrade: true } : ctx
  for (const b of blocksOf(doc, tree)) {
    // 表格无源码态：光标进表不抬起源码，而是（点击后）就地激活该格——与其他块的 near 语义分叉
    if (ctx.mode === 'edit' && b.kind !== 'table' && near(b.from, b.to)) {
      // 围栏/缩进代码露源码时仍按代码块的样子排（逐行底色 + 等宽，首末行收圆角），不平铺成正文
      if (b.kind === 'code' || b.kind === 'mermaid' || b.kind === 'infographic') {
        const first = state.doc.lineAt(b.from).number, last = state.doc.lineAt(b.to).number
        for (let n = first; n <= last; n++) {
          const edge = first === last ? 'only' : n === first ? 'start' : n === last ? 'end' : 'middle'
          deco.push(Decoration.line({ class: s.codeLine, attributes: { 'data-code-edge': edge } }).range(state.doc.line(n).from))
        }
      }
      continue
    }
    // 原子块区间收集（编辑态、渲染件在位时）：区间含尾换行，整块选中后 Backspace 一刀带走整行。
    // 表格不进（点格激活是它自己的编辑形态）；阅读态不进（阅读态交互全不动）
    if (ctx.mode === 'edit' && b.kind !== 'table' && atomic) atomic.push([b.from, Math.min(b.to + 1, doc.length)])
    const w = blockWidget(b.kind, b.src, b.info, bctx)
    if (w) deco.push(Decoration.replace({ widget: w, block: true }).range(b.from, b.to))
  }

  // 标题行锚点：id 规则与服务端 rehype-slug 同库。renderPage 会剥掉首个 h1（宿主标题栏已示
  // 标题）——阅读态照同规则整行隐藏；slug 对隐藏行照常消费（rehype-slug 在剥除之前跑，
  // 「h1 与后续标题同名」时 -1 后缀两端必须一致，Task 18 语料钉死）
  const HEAD = /^(ATXHeading|SetextHeading)/
  const H1 = /^(ATXHeading1|SetextHeading1)$/
  let h1Seen = false
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (!HEAD.test(n.name)) continue
    // frontmatter 在 lezer 眼里是 HR + SetextHeading（不认 --- 围栏）；服务端 rehype-slug 跑在
    // DocStore 剥掉 frontmatter 之后，不会给它的「标题」配 id——编辑器同规则跳过 fm 区间内节点
    if (fm && n.from < fm.to) continue
    // 剥前导 #；尾 ATX 闭合序列（## 你好 ## → 你好）只对 ATX 剥——Setext 正文里的尾 # 是字面
    // 内容（标题 #\n=== → 服务端 slug「标题-」），无差别剥会反向分叉
    const raw = doc.slice(n.from, n.to).replace(/^ {0,3}#{1,6}[ \t]+/, '').replace(/\n.*$/, '')
    const text = (n.name.startsWith('ATXHeading') ? raw.replace(/\s+#+\s*$/, '') : raw).trim()
    const line = state.doc.lineAt(n.from).from
    // 行级视觉：CM6 把标题渲染成 div.cm-line，article 的 h1..h4 元素选择器够不着，
    // 层级字体必须由行 class 承担（h5/h6 收敛 h4，与阅读页视觉降级约定一致）
    const lvl = Math.min(4, Number(/(\d)$/.exec(n.name)?.[1] ?? '2'))
    // data-h 是给块间距 CSS 的稳定标记（class 名经 css-modules 哈希进不了 :has 选择器，属性选择器不受哈希）
    deco.push(Decoration.line({ class: s['h' + lvl], attributes: { id: slugger.slug(text), 'data-h': String(lvl) } }).range(line))
    if (ctx.mode === 'read' && !h1Seen && H1.test(n.name)) {
      h1Seen = true
      const end = state.doc.lineAt(n.from).to
      deco.push(Decoration.replace({ widget: new HideWidget(), block: true }).range(n.from, end < doc.length ? end + 1 : end))
    }
  }

  inlineDeco(state, ctx, deco, near, tree, atomic)   // 行内 live preview
  return Decoration.set(deco, true)    // sort=true 自动排序，无需手工保证顺序
}

const children = (node: { node: { firstChild: any } }) => {
  const out: Array<{ name: string; from: number; to: number }> = []
  for (let c = node.node.firstChild; c; c = c.nextSibling) out.push({ name: c.name, from: c.from, to: c.to })
  return out
}

function inlineDeco(state: EditorState, ctx: DecoCtx, deco: Range<Decoration>[], near: (f: number, t: number) => boolean, tree: Tree, atomic: Array<[number, number]> = []) {
  if (ctx.degrade || state.doc.lines > 20000) return   // 大文档护栏：行内装饰整体让路（spec §五）
  const doc = state.doc.toString()
  const fm = frontmatterRange(doc)
  const names = state.field(nameStates, false) ?? {}
  const hidden = (f: number, t: number) => deco.push(Decoration.mark({ class: near(f, t) ? s.meta : s.hidden }).range(f, t))

  tree.iterate({
    enter: (node) => {
      // frontmatter 在 lezer 眼里是 HR + SetextHeading（不认 --- 围栏）——完全落座于 fm 区间内的
      // 节点不做行内装饰（否则折叠条里会顶出 HrWidget）。回归钉：这里曾是 node.from < fm.to，
      // 在 Document 根（from=0 < fm.to）直接 false，整棵树的行内装饰被吞——凡带 frontmatter 的
      // 文档双链/标记隐藏/图片公式全部失效。跨界节点（Document、fm 后的段落）from<fm.to 但 to>fm.to，
      // 必须继续进入
      if (fm && node.from >= fm.from && node.to <= fm.to) return false
      const n = node.name
      if (n === 'Image') {
        if (!near(node.from, node.to)) {
          deco.push(Decoration.replace({ widget: new ImageWidget(doc.slice(node.from, node.to), ctx.io) }).range(node.from, node.to))
          atomic.push([node.from, node.to])   // 图片 span 原子区间（同行可能有别的文字，区间不含行）
        }
        return false
      }
      if (n === 'InlineMath') {
        if (!near(node.from, node.to)) deco.push(Decoration.replace({ widget: new MathWidget(doc.slice(node.from, node.to), ctx.batch) }).range(node.from, node.to))
        return false
      }
      if (n === 'WikiLink') {
        // Typora 式显示形态：[[ ]] 与「目标|」前缀（路径形式连同「…/」）隐藏，只显显示名（别名或页名）标蓝可点；
        // 点击语义（data-target/anchor）挂在显示名区间上。光标进链（near）回源码全显
        if (!near(node.from, node.to)) {
          const raw = doc.slice(node.from + 2, node.to - 2)
          const bar = raw.indexOf('|')
          const hash = raw.indexOf('#')
          const slash = raw.lastIndexOf('/', hash === -1 ? raw.length : hash)
          const dispFrom = node.from + 2 + (bar !== -1 ? bar + 1 : slash + 1)   // 无别名：路径形式只显最后一段
          deco.push(Decoration.mark({ class: s.hidden }).range(node.from, dispFrom))
          deco.push(Decoration.mark({ class: s.hidden }).range(node.to - 2, node.to))
          if (dispFrom < node.to - 2) {
            const { name, anchor } = wikiTarget(raw)
            const ns = names[name]
            const dead = ns && !ns.id
            deco.push(Decoration.mark({
              class: dead ? s.wikilink + ' ' + s.dead : s.wikilink,
              attributes: { 'data-target': name, ...(anchor ? { 'data-anchor': anchor } : {}), ...(dead && ns.dead ? { title: ns.dead } : {}) },
            }).range(dispFrom, node.to - 2))
          }
        }
        return false
      }
      if (n === 'Link') {
        // 显文本保留，( url ) 隐藏；绝对地址在文本区间挂 data-href（⌘点击走 io.open）
        const kids = children(node)
        const first = kids.find((c) => c.name === 'LinkMark')
        const last = [...kids].reverse().find((c) => c.name === 'LinkMark')
        for (const c of kids) if (c.name === 'LinkMark' || c.name === 'URL' || c.name === 'LinkTitle') hidden(c.from, c.to)
        if (first && last && first !== last) {
          const url = kids.find((c) => c.name === 'URL')
          const href = url ? doc.slice(url.from, url.to) : ''
          if (/^https?:\/\//.test(href)) deco.push(Decoration.mark({ class: s.wikilink, attributes: { 'data-href': href } }).range(first.to, last.from))
        }
        return false
      }
      if (n === 'Autolink' || n === 'LinkReference' || n === 'Escape' || n === 'Entity') return   // 原样保留
      if (n === 'HorizontalRule') { deco.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to)); return false }
      if (n === 'TaskMarker') {
        if (!near(node.from, node.to)) {
          const checked = doc.slice(node.from, node.to).includes('x')
          deco.push(Decoration.replace({ widget: new TaskWidget(node.from, checked) }).range(node.from, node.to))
        }
        return false
      }
      // 内容强调常显（Typora 式）：class 挂首尾标记符之间的正文区间，光标进了也保持样式；
      // 返回 undefined 继续下降，内部 Mark 子节点仍走通用分支隐藏/露出
      if (n === 'StrongEmphasis' || n === 'Emphasis' || n === 'Strikethrough' || n === 'InlineCode') {
        const kids = children(node)
        const first = kids[0]
        const last = kids[kids.length - 1]
        if (first && last && first !== last) {
          const cls = n === 'StrongEmphasis' ? s.strong : n === 'Emphasis' ? s.em : n === 'Strikethrough' ? s.del : s.code
          deco.push(Decoration.mark({ class: cls }).range(first.to, last.from))
        }
        return undefined
      }
      if (n.endsWith('Mark')) {
        // ATX 标题的 HeaderMark 只覆盖 "###"，语法要求的分隔空格不在节点里。只隐藏 # 会让
        // 展示态标题永久留一个行首空格。首标记连同最多三格缩进和其后空白一起收起。
        if (n === 'HeaderMark' && /^#{1,6}$/.test(doc.slice(node.from, node.to))) {
          const line = state.doc.lineAt(node.from)
          if (/^[ \t]{0,3}$/.test(doc.slice(line.from, node.from))) {
            let to = node.to
            while (to < line.to && /[ \t]/.test(doc[to])) to++
            hidden(line.from, to)
            return false
          }
        }
        // 有序列表编号常显（.num）；其余标记按 near 隐藏/露出。
        // 无序圆点/引用角标隐藏时行首视觉（•/左边界）由行级 class 补——光标进项时裸源码不补，避免「•- 」双头
        const text = doc.slice(node.from, node.to)
        if (/^\d+[.)]\s*$/.test(text)) deco.push(Decoration.mark({ class: s.num }).range(node.from, node.to))
        else {
          hidden(node.from, node.to)
          if (!near(node.from, node.to)) {
            if (/^[-+*]\s*$/.test(text)) deco.push(Decoration.line({ class: s.bullet }).range(state.doc.lineAt(node.from).from))
            if (/^>\s*$/.test(text)) deco.push(Decoration.line({ class: s.quote }).range(state.doc.lineAt(node.from).from))
          }
        }
        return false
      }
      return undefined
    },
  })
}

// 表格激活格 mini-CM6 复用主文档行内装饰语义（spec §一）：near 恒真 = 格内源码形态
//（标记符全可见走 s.meta 色阶、图片/公式/双链不换渲染件），强调常显分支照常生效。
export function inlineDecoRanges(state: EditorState, ctx: DecoCtx): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  inlineDeco(state, ctx, out, () => true, decorationTree(state))
  return out
}
