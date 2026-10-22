// src/editor/kernel/surface.ts
import { Compartment, EditorState, EditorSelection, RangeSet, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, highlightActiveLine, type Command, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { buildDeco, nameStates, setNameStates, wikiTarget, refreshBlocksEffect, type DecoCtx } from './deco'
import { frontmatterRange } from './frontmatter'
import { blocksOf, excalidrawRef } from './blocks'
import { mathExt, wikilinkExt, cjkEmphasisExt } from './mdext'
import { registerServerKinds, BatchStore } from '../blocks/server'
import { registerTableKind } from '../blocks/table'
import { remeasure } from '../blocks/measure'
import { embedTheme, pushEmbedTheme } from './embed-theme'
import { registerViewerKinds } from '../blocks/mermaid'
import { registerExcalidraw } from '../blocks/excalidraw'
import { createSaver, type Saver } from '../save'
import { openBlockMenu, closeBlockMenu } from './blockmenu'
import type { EditRef, EditorIo, SaveStatus } from '../io'
import { toggleBold, toggleItalic, makeLink, skipBlankDown, skipBlankUp } from './keys'
import { openLightbox } from '../viewer/lightbox'
import s from '../editor.module.css'

export interface Surface {
  view: EditorView
  saver: Saver
  /** 原子块键位（Enter 进编辑入口 / Esc 收选区）：keymap 同款闭包命令，导出供测试直调 */
  atomicEnter: Command
  atomicEsc: Command
  setMode(mode: 'edit' | 'read'): void
  setDark(dark: boolean): void
  setFrontmatterVisible(visible: boolean): void
  /** 全量换文（载入/外部重载）：重建 state（撤销史清零），再解析双链名 */
  setText(text: string): void
  resolveNames(): Promise<void>
  destroy(): void
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'inherit' },
  // CM6 默认给聚焦编辑器一圈灰色点线轮廓——文章外点击就闪一圈灰框，按宿主观感去掉
  '&.cm-focused': { outline: 'none' },
  // highlightActiveLine 仍用于给标题前的零高空行恢复行高，但不绘制 CodeMirror 默认蓝底。
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '4px 0 40vh' },
})
// CM 基础主题按 darkTheme facet 挂 &dark 基类（caret 白、夜间选区底等）：theme 不带 {dark} 恒 &light，
// 宿主夜间 caret 仍黑、深底上看不见——facet 进 themeComp 随 setDark 翻，样式单例不动
const darkThemeFor = (dark: boolean) => EditorView.darkTheme.of(dark)

// 嵌入件 iframe 的高度上报监听（asset/ 页里 routes.ts 注入的脚本 postMessage 内容高度）：
// 从旧 src/client/lib/article.ts 逐段移植匹配语义（按消息里的 src path 参数找
// document 里的 [data-autosize] iframe 撑高），装一次。
// 高度消息同时是主题回信的挂点：每次上报顺带回一句 dshWikiTheme，懒加载晚到、首帧 theme 已过期的
// 嵌入件都能对上当前明暗（明暗口径见 embed-theme.ts）
let autosizeInstalled = false
export function installEmbedAutosize() {
  if (autosizeInstalled || typeof window === 'undefined') return
  autosizeInstalled = true
  // 不写 ?h= 的嵌入件自适应：嵌入页脚本（routes.ts 注入）postMessage 上报内容高度，给发
  // 消息的那个 iframe 定高。只认带 data-autosize 的 iframe、只收数字并夹在合理范围，别的
  // 消息不理——旧 lib/article.ts 同语义；编辑器里 iframe 在 .blockView 内，仍按
  // contentWindow 匹配（旧实现不按容器找，此处 document 全局查即可）
  window.addEventListener('message', (e) => {
    const h = (e.data as any)?.dshWikiEmbedHeight
    if (typeof h !== 'number' || !Number.isFinite(h)) return
    ;(e.source as Window | null)?.postMessage({ dshWikiTheme: embedTheme() }, '*')
    for (const f of document.querySelectorAll<HTMLIFrameElement>('iframe[data-autosize]')) {
      if (f.contentWindow === e.source) { f.style.height = Math.min(Math.max(h, 40), 20000) + 2 + 'px'; remeasure(f); return }
    }
  })
  // 宿主切主题：盯 body 上的夜间属性（唯一真源），变了就向全部嵌入件重推
  if (window.MutationObserver && document.body) {
    new MutationObserver(() => pushEmbedTheme()).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  }
}

export function createSurface(parent: HTMLElement, opts: { io: EditorIo; mode: 'edit' | 'read'; dark: boolean; frontmatterVisible?: boolean; onStatus?: (s: SaveStatus) => void }): Surface {
  registerServerKinds()
  registerTableKind()   // 后注册胜出：kind 'table' edit 态覆盖为本地网格（read 态 tableSpec 内部仍走 server）
  registerViewerKinds()
  registerExcalidraw()
  installEmbedAutosize()

  const modeComp = new Compartment()
  const decoComp = new Compartment()
  const themeComp = new Compartment()
  const batch = new BatchStore((srcs) => opts.io.renderBlocks(srcs))
  const saver = createSaver(opts.io, '', '', (st) => opts.onStatus?.(st))
  let mode = opts.mode
  let dark = opts.dark
  let frontmatterVisible = opts.frontmatterVisible ?? false
  const ctx = (): DecoCtx => ({ mode, dark, batch, io: opts.io, degrade: false, frontmatterVisible })

  // 块装饰必须由 StateField 提供（@codemirror/view 禁 ViewPlugin 出块装饰，挂载真实文档即崩）；
  // decoExt() 每调定义新 field 实例，Compartment reconfigure（mode/dark 翻转）重初始化即重跑 buildDeco，
  // 重建条件与原 ViewPlugin.update 一致：docChanged || selection 变 || nameStates field 变。
  // field 值复合：deco 供 EditorView.decorations，atomic 供 EditorView.atomicRanges（原子块选中：
  // 块区间与行内图片 span 的吸附规则，CM 内核据此处理拖选/Shift 选区的整块进出与光标不入块内）。
  // 引用存回闭包变量：单击/双击路由（Task 2）与选中态（Task 3）经 atomicSetOf 读同一实例。
  // 原子区间值：借用共享 Decoration.mark 值对象（只是 RangeValue 载体与 range 工厂，不进 decorations facet）
  const ATOMIC = Decoration.mark({ class: 'wiki-atomic' })
  interface DecoBuild { deco: DecorationSet; atomic: RangeSet<Decoration> }
  let decoField: StateField<DecoBuild>
  const buildSet = (st: EditorState): DecoBuild => {
    const a: Array<[number, number]> = []
    const deco = buildDeco(st, ctx(), a)
    // 块区间（顶层序）与行内区间（全树序）两段拼接天然无序，入 RangeSet 前按 from 排序
    const parts = a.map(([f, t]) => ATOMIC.range(f, t)).sort((x, y) => x.from - y.from || x.to - y.to)
    return { deco, atomic: RangeSet.of(parts) }
  }
  const atomicSetOf = (view: EditorView): RangeSet<Decoration> | null => view.state.field(decoField, false)?.atomic ?? null
  const decoExt = (): Extension => {
    decoField = StateField.define<DecoBuild>({
      create: (st) => buildSet(st),
      update: (value, tr) => (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(refreshBlocksEffect)) && tr.startState.field(nameStates, false) === tr.state.field(nameStates, false)) ? value : buildSet(tr.state),
      provide: (f) => [
        EditorView.decorations.from(f, (v) => v.deco),
        // atomicRanges facet 收 provider 函数（不是 decorations 那样的直供值）：按 field 取当前原子集
        EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomic ?? RangeSet.empty),
      ],
    })
    return decoField
  }

  // ---- 原子块路由（原子块选中设计：单击选中、双击/Enter 进各自编辑入口）----
  interface AtomicBlock { kind: string; from: number; to: number; src: string }
  // 事件目标 → 原子块。认 data-atomic 根（渲染态才有 widget DOM，源码态块天然找不到），
  // 再按 posAtDOM 落点在 blocksOf / Image 节点里对号。阅读态不路由（交互全不动）。
  const atomicAt = (view: EditorView, target: EventTarget | null): AtomicBlock | null => {
    if (mode !== 'edit') return null
    // 不用 instanceof Element：旧测试库自建 JSDOM 实例（跨 realm），鸭子式认法同 refAt
    const root = (target as Element | null)?.closest?.<HTMLElement>('[data-atomic]') ?? null
    if (!root || !view.contentDOM.contains(root)) return null
    let pos: number
    try { pos = view.posAtDOM(root) } catch { return null }
    const doc = view.state.doc.toString()
    const tree = syntaxTree(view.state)
    for (const b of blocksOf(doc, tree)) {
      // 块区间匹配用 [from, to]（不含 +1）：相邻块 prev.to+1 == next.from 时首匹配命中正确的根
      if (b.kind !== 'table' && pos >= b.from && pos <= b.to) return { kind: b.kind, from: b.from, to: Math.min(b.to + 1, doc.length), src: b.src }
    }
    let img: { from: number; to: number } | null = null
    tree.iterate({ enter(n) { if (n.name === 'Image' && pos >= n.from && pos <= n.to) { img = { from: n.from, to: n.to }; return false } } })
    const im = img as { from: number; to: number } | null   // 回调赋值绕过控制流收窄
    return im ? { kind: 'image', from: im.from, to: im.to, src: doc.slice(im.from, im.to) } : null
  }
  // 编辑入口：excalidraw 开画布；源码类（mermaid/信息图/code/mathblock/embed/html）光标进块内露源码。
  // 多行围栏落第二行首；单行块落在块尾（都满足 near 的「块内」判定）
  const editEntry = (ab: AtomicBlock) => {
    if (ab.kind === 'excalidraw') {
      const rel = excalidrawRef(ab.src)
      if (rel) opts.io.editExcalidraw?.(rel)
      // 开画布后收起覆盖选区：画布没抢到焦点的瞬间，打字会把图位引用行替换掉（ego 真机复现）
      view.dispatch({ selection: { anchor: ab.from } })
      return
    }
    const anchor = Math.min(Math.max(ab.from + 1, view.state.doc.lineAt(ab.from).to + 1), ab.to - 1)
    view.dispatch({ selection: { anchor }, scrollIntoView: true })
    view.focus()
  }
  // 选区恰好覆盖一个原子块（单击选中 / Enter 判定用）；图片 span 区间不含行，同样精确匹配
  const coveredAtomic = (view: EditorView): AtomicBlock | null => {
    const sel = view.state.selection.main
    if (sel.empty) return null
    const doc = view.state.doc.toString()
    const tree = syntaxTree(view.state)
    for (const b of blocksOf(doc, tree)) {
      // 覆盖选区两种形态都算选中：单击的不含尾换行 [from, to]，键盘吸附的含尾换行 [from, to+1]
      if (b.kind !== 'table' && sel.from === b.from && (sel.to === b.to || sel.to === Math.min(b.to + 1, doc.length))) return { kind: b.kind, from: b.from, to: sel.to, src: b.src }
    }
    let hit: AtomicBlock | null = null
    tree.iterate({ enter(n) { if (!hit && n.name === 'Image' && sel.from === n.from && sel.to === n.to) hit = { kind: 'image', from: n.from, to: n.to, src: doc.slice(n.from, n.to) } } })
    return hit
  }
  const atomicEnter: Command = (view) => {
    const ab = coveredAtomic(view)
    if (!ab || ab.kind === 'image') return false   // 图片无编辑入口，默认替换选区（同 Typora）
    editEntry(ab)
    return true
  }
  const atomicEsc: Command = (view) => {
    const ab = coveredAtomic(view)
    if (!ab) return false
    view.dispatch({ selection: { anchor: ab.from } })
    return true
  }
  // 选中态视觉：native selection 只画文本、替换装饰上看不见——按原子集给覆盖中的块根挂
  // data-selected（CSS 内描边）。posAtDOM 逐根定位（跨 realm 测试环境同样走鸭子路径，try 住）。
  const markSelected = (view: EditorView) => {
    if (mode !== 'edit') {
      view.contentDOM.querySelectorAll('[data-selected]').forEach((el) => { delete (el as HTMLElement).dataset.selected })
      return
    }
    const set = atomicSetOf(view)
    if (!set) return
    const sel = view.state.selection.main
    view.contentDOM.querySelectorAll('[data-atomic]').forEach((el) => {
      let pos: number
      try { pos = view.posAtDOM(el) } catch { return }
      let covered = false
      set.between(pos - 1, pos, (from, to) => { if (sel.from <= from && sel.to >= to) covered = true })
      const dom = el as HTMLElement
      if (covered) dom.dataset.selected = ''
      else delete dom.dataset.selected
    })
  }

  const modeExt = (): Extension => mode === 'read'
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [EditorState.readOnly.of(false), EditorView.editable.of(true)]

  // 行内 live preview 用 data-target；服务端块 HTML（表格/代码等）已经解析好页 id，
  // 用 data-wiki-id。两种形态统一在 surface 消费，避免块内双链落到 href="#" 后跳页首。
  // 认链接（refAt）与打开（openAt）分开：右键菜单（contextmenu → io.menu）复用同一份认法
  const refAt = (target: EventTarget | null): EditRef | 'dead' | null => {
    const el = target instanceof Element ? target : null
    if (!el) return null
    const wl = el.closest<HTMLElement>('[data-target]')
    if (wl) return { kind: 'wikilink', name: wl.dataset.target!, anchor: wl.dataset.anchor || undefined }
    const page = el.closest<HTMLElement>('[data-wiki-id]')
    if (page) return { kind: 'page', id: page.dataset.wikiId!, anchor: page.dataset.anchor || undefined }
    const href = el.closest<HTMLElement>('[data-href], [data-external]')
    const url = href?.dataset.href || href?.dataset.external
    if (url) return { kind: 'href', href: url }
    // 死链的服务端形态仍要吞掉 href="#"，不能让浏览器把阅读位置拉回页首。
    return el.closest('[data-dead]') ? 'dead' : null
  }
  const openAt = (target: EventTarget | null): boolean => {
    const ref = refAt(target)
    if (ref === null) return false
    if (ref !== 'dead') opts.io.open?.(ref)
    return true
  }

  const clickPolicy = EditorView.domEventHandlers({
    mousedown(event) {
      if (event.metaKey || event.ctrlKey) {
        // ⌘/Ctrl+点击（两种模式都收）：双链/外链打开。mousedown 上 preventDefault，编辑态光标不跟着跑
        if (openAt(event.target)) { event.preventDefault(); return true }
        return false
      }
      // 编辑态点原子块（excalidraw/mermaid/信息图/服务端块/行内图片）：整块选中（Typora 式）。
      // 编辑入口挪到双击/Enter（原子块选中设计）；表格不认 data-atomic，点格交互不受影响
      if (mode === 'edit' && event.button === 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        const ab = atomicAt(view, event.target)
        if (ab) {
          event.preventDefault()
          // 块边框盒右侧的行内空白 = 图位后方的光标落点：图占满行的块没有「行内之后」可站（行内打字会毁块），
          // 光标放下一行行首。判定用块根（边框盒）而非内部 svg——?h= 定高的块 svg 等比居中、
          // 块内空白是图身的一部分，点那里应选中不该出光标。几何缺失（jsdom 零矩形）退回选中语义
          if (ab.kind !== 'image') {
            const root = (event.target as Element | null)?.closest?.('[data-atomic]')
            const r = root?.getBoundingClientRect()
            if (r && r.right > 0 && event.clientX > r.right + 4) {
              view.dispatch({ selection: { anchor: Math.min(ab.to, view.state.doc.length) } })
              view.focus()
              return true
            }
          }
          // 选区不带尾换行：带了会把块后空行点亮成 activeLine（光标落在图下方、内容被顶下去）。
          // to 按 src 长度求（ab.to 已含尾换行）；head 放块首（caret 落图位左缘）；
          // 键盘吸附产生的含尾换行覆盖选区同样算「选中」（见 coveredAtomic）
          view.dispatch({ selection: EditorSelection.range(ab.from + ab.src.length, ab.from) })
          view.focus()
          return true
        }
      }
      return false
    },
    dblclick(event) {
      // 双击原子块 = 编辑入口（单击是选中）：excalidraw 开画布、源码类进源码；图片无编辑入口
      if (mode !== 'edit' || event.button !== 0) return false
      const ab = atomicAt(view, event.target)
      if (ab && ab.kind !== 'image') {
        event.preventDefault()
        editEntry(ab)
        return true
      }
      return false
    },
    click(event) {
      const t = event.target as HTMLElement
      // 图的全屏只在阅读态（编辑态点图是原子选中，见 mousedown；img 分支旧来没挂 mode 门）
      const img = mode === 'read' ? t.closest('img') : null
      if (img) { openLightbox(img); return true }
      const dg = mode === 'read' ? t.closest<HTMLElement>('.' + s.blockView + '[data-lightbox]') : null
      if (dg) { openLightbox(dg); return true }
      // 阅读态普通点击直接打开。不能依赖 document.getSelection()：宿主别处残留的文本选区
      // 也会让它变成 non-collapsed，导致链接看似完全失效。
      if (mode === 'read' && !event.metaKey && !event.ctrlKey && openAt(event.target)) {
        event.preventDefault()
        return true
      }
      return false
    },
    contextmenu(event) {
      // 右键链接：宿主菜单（打开 / 在新标签页打开）。外链交给浏览器默认菜单（复制链接地址等）。
      // 链接分支在前：服务端渲染块体内的链接（data-target/data-wiki-id）仍走链接菜单
      const ref = refAt(event.target)
      if (ref && ref !== 'dead' && !(ref.kind === 'href' && !ref.href.startsWith('raw/'))) {
        if (opts.io.menu?.(ref, { x: event.clientX, y: event.clientY })) { event.preventDefault(); return true }
      }
      // 右键原子块（编辑态）：编辑器自渲染菜单（编辑 / 删除引用；图片为复制 / 删除）
      if (mode === 'edit') {
        const ab = atomicAt(view, event.target)
        if (ab) {
          event.preventDefault()
          openBlockMenu(view, ab, { x: event.clientX, y: event.clientY }, { edit: () => editEntry(ab) })
          return true
        }
      }
      return false
    },
  })

  const buildState = (doc?: string) => EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [mathExt, wikilinkExt, cjkEmphasisExt] }),
      history(),
      keymap.of([
        { key: 'Enter', run: atomicEnter },   // 原子块键位在前：覆盖选中时拦截，其余落 default（含图片选中 Enter 替换选区）
        { key: 'Escape', run: atomicEsc },
        { key: 'ArrowDown', run: skipBlankDown },   // 落进空白行继续走（空行只承担块距，不当落点）
        { key: 'ArrowUp', run: skipBlankUp },
        ...defaultKeymap, ...historyKeymap, ...markdownKeymap,
        { key: 'Mod-b', run: toggleBold }, { key: 'Mod-i', run: toggleItalic }, { key: 'Mod-k', run: makeLink },
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      // 光标行挂 cm-activeLine（不配样式、纯类名）：块间距 CSS 靠它豁免光标所在的零高空行，
      // 否则光标落进标题上方空行时行高为 0、光标不可见
      highlightActiveLine(),
      nameStates,
      modeComp.of(modeExt()),
      decoComp.of(decoExt()),
      clickPolicy,
      theme,
      themeComp.of(darkThemeFor(dark)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) { saver.schedule(u.state.doc.toString()); closeBlockMenu() }   // 菜单开着时文档变了：立即收（块位置已过期）
        if (u.docChanged || u.selectionSet || u.viewportChanged) markSelected(u.view)   // 原子块选中标记随选区/文档/视口同步
      }),
    ],
  })

  const view = new EditorView({ parent, state: buildState() })

  async function resolveNames() {
    if (!opts.io.resolveNames) return
    try {
      const doc = view.state.doc.toString()
      const names: string[] = []
      syntaxTree(view.state).iterate({
        enter(n) { if (n.name === 'WikiLink') { const t = wikiTarget(doc.slice(n.from + 2, n.to - 2)).name; if (t && !names.includes(t)) names.push(t) } },   // 拆 # 拿裸名：[[页#节]] 按「页」解析，不误染死链
      })
      if (!names.length) return
      const r = await opts.io.resolveNames(names)
      if (!view.dom.isConnected) return          // 卸载竞态：不回写
      view.dispatch({ effects: setNameStates.of(r) })
    } catch { /* 拿不到死链态就当普通链接渲染，不炸宿主 */ }
  }

  return {
    view,
    saver,
    atomicEnter,
    atomicEsc,
    setMode(m) { if (m === mode) return; mode = m; view.dispatch({ effects: [modeComp.reconfigure(modeExt()), decoComp.reconfigure(decoExt())] }) },
    setDark(d) { if (d === dark) return; dark = d; view.dispatch({ effects: [themeComp.reconfigure(darkThemeFor(d)), decoComp.reconfigure(decoExt())] }) },
    setFrontmatterVisible(visible) {
      if (visible === frontmatterVisible) return
      frontmatterVisible = visible
      const fm = frontmatterRange(view.state.doc.toString())
      const head = view.state.selection.main.head
      const selection = !visible && fm && head >= fm.from && head <= fm.to
        ? { anchor: Math.min(fm.to + 1, view.state.doc.length) }
        : undefined
      view.dispatch({ ...(selection ? { selection } : {}), effects: decoComp.reconfigure(decoExt()) })
    },
    setText(text) { view.setState(buildState(text)); void resolveNames() },
    resolveNames,
    destroy() { closeBlockMenu(); view.destroy() },
  }
}
