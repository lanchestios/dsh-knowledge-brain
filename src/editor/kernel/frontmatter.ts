// src/editor/kernel/frontmatter.ts
// 首行恰好 ---（可带尾随空白）、其后存在闭合围栏行（--- 或 ...）：区间含闭合行的行尾换行。
// 缺闭合 → null，整篇按正文（旧 head 语义：frontmatter 不可编辑，正文从其后开始）。
export function frontmatterRange(doc: string): { from: number; to: number } | null {
  const nl = doc.indexOf('\n')
  const first = doc.slice(0, nl === -1 ? doc.length : nl)
  if (!/^---[ \t]*$/.test(first)) return null
  const lines = doc.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      let to = lines.slice(0, i + 1).join('\n').length
      if (to < doc.length) to++
      return { from: 0, to }
    }
  }
  return null
}
