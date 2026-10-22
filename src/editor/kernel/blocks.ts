// src/editor/kernel/blocks.ts
import type { Tree } from '@lezer/common'

// 顶层块分类（替代旧 remark classify）：文本块不出现在结果里（不需要 widget）。
// EMBED 修复旧正则不认 ?h=560 的问题（spec 编辑2 根因 a）。
export type BlockKind = 'code' | 'mermaid' | 'infographic' | 'table' | 'mathblock' | 'embed' | 'html' | 'excalidraw'
export interface BlockInfo { from: number; to: number; kind: BlockKind; src: string; info: string }

const EMBED = /^ {0,3}!\[[^\]\n]*\]\([^()\s]*\.html?(?:\?[^()\s]*)?\)[ \t]*$/i

// excalidraw 图位：asset/ 下的 .excalidraw 引用（写通道只许 asset/diagrams/，这里认整个 asset/——
// 与 html 嵌入同宽，check 的附件纪律管越界）。只认顶层段落，列表/引用内不识别。
// ?h=<160-2000> 可选定高（同 html 嵌入件纪律）；别的参数不认。
const EXCALIDRAW = /^ {0,3}!\[[^\]\n]*\]\((asset\/[^\s()]*\.excalidraw)(?:\?h=(\d+))?\)[ \t]*$/i
export const excalidrawRef = (src: string): string | null => {
  for (const line of src.split('\n')) { const m = EXCALIDRAW.exec(line); if (m) return m[1] }
  return null
}

const VIEWER_FENCE = new Set(['mermaid', 'infographic'])

export function blocksOf(doc: string, tree: Tree): BlockInfo[] {
  const out: BlockInfo[] = []
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (n.name === 'FencedCode') {
      // 未闭合单行围栏（正在敲 ```js）：lezer 对它也产出 FencedCode 节点，但不判 code
      const src = doc.slice(n.from, n.to)
      if (!src.includes('\n')) continue
      // CodeInfo 子节点在开围栏后；没有时为空串
      let info = ''
      for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === 'CodeInfo') { info = doc.slice(c.from, c.to); break }
      const first = info.split(/[\s{]/)[0]
      out.push({ from: n.from, to: n.to, kind: VIEWER_FENCE.has(first) ? (first as BlockKind) : 'code', src, info: first })
    } else if (n.name === 'CodeBlock') {
      out.push({ from: n.from, to: n.to, kind: 'code', src: doc.slice(n.from, n.to), info: '' })
    } else if (n.name === 'Table' || n.name === 'HTMLBlock') {
      out.push({ from: n.from, to: n.to, kind: n.name === 'Table' ? 'table' : 'html', src: doc.slice(n.from, n.to), info: '' })
    } else if (n.name === 'Paragraph') {
      const src = doc.slice(n.from, n.to)
      const oneLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'))
      if (EXCALIDRAW.test(oneLine)) out.push({ from: n.from, to: n.to, kind: 'excalidraw', src, info: '' })
      else if (EMBED.test(oneLine)) out.push({ from: n.from, to: n.to, kind: 'embed', src, info: '' })
      else if (src.startsWith('$$')) out.push({ from: n.from, to: n.to, kind: 'mathblock', src, info: '' })
    }
  }
  return out
}
