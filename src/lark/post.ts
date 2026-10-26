import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

type LarkStyle = 'bold' | 'italic' | 'lineThrough'

export type LarkInline =
  | { tag: 'text'; text: string; style?: LarkStyle[] }
  | { tag: 'a'; text: string; href: string; style?: LarkStyle[] }

/** post 行元素：图独占一行（飞书 post 的 img 只认 image_key） */
export type LarkPostElement = LarkInline | { tag: 'img'; image_key: string }

export interface LarkPost {
  zh_cn: { title: string; content: LarkPostElement[][] }
}

/** 答案里图片 url（markdown 原样）→ image_key；没有的图照旧当链接 */
export type ImageKeys = ReadonlyMap<string, string>

/** 规整后的一行：文字行，或一张有 key 的图（独占一行，alt 给答案卡用） */
export type LarkRow = LarkInline[] | { img: string; alt: string }

// 库内图拿不到 key（没开 im:resource、上传失败、格式不支持……）：整张不发——库内路径的链接
// 提问人点不开，留着只是噪音。只有 http(s) 外链图还当链接
const DROP = { drop: true } as const
type Piece = LarkInline | { img: string; alt: string } | typeof DROP
const isImg = (p: Piece): p is { img: string; alt: string } => 'img' in p
const isWeb = (url: string) => /^https?:\/\//i.test(url)

const parser = unified().use(remarkParse).use(remarkGfm)

const styleOf = (styles: LarkStyle[]): LarkStyle[] | undefined => styles.length ? [...new Set(styles)] : undefined

const textElement = (text: string, styles: LarkStyle[] = []): LarkInline => {
  const style = styleOf(styles)
  return style ? { tag: 'text', text, style } : { tag: 'text', text }
}

const inlineText = (node: any): string => {
  if (typeof node?.value === 'string') return node.value
  if (node?.type === 'image') return node.alt || node.url || '图片'
  return Array.isArray(node?.children) ? node.children.map(inlineText).join('') : ''
}

let dropped = false

const inline = (nodes: any[], keys: ImageKeys | undefined, styles: LarkStyle[] = []): Piece[] => {
  const out: Piece[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'text') out.push(textElement(node.value, styles))
    else if (node.type === 'strong') out.push(...inline(node.children, keys, [...styles, 'bold']))
    else if (node.type === 'emphasis') out.push(...inline(node.children, keys, [...styles, 'italic']))
    else if (node.type === 'delete') out.push(...inline(node.children, keys, [...styles, 'lineThrough']))
    else if (node.type === 'inlineCode') out.push(textElement(node.value, styles))
    else if (node.type === 'link') {
      const text = inlineText(node) || node.url
      const style = styleOf(styles)
      out.push(style ? { tag: 'a', text, href: node.url, style } : { tag: 'a', text, href: node.url })
    } else if (node.type === 'image') {
      const key = keys?.get(node.url)
      if (key) out.push({ img: key, alt: node.alt || '' })
      else if (isWeb(node.url)) out.push({ tag: 'a', text: node.alt || '图片', href: node.url })
      else { out.push(DROP); dropped = true }
    } else if (node.type === 'break') out.push(textElement('\n', styles))
    else if (typeof node.value === 'string') out.push(textElement(node.value.replace(/<[^>]+>/g, ''), styles))
    else if (Array.isArray(node.children)) out.push(...inline(node.children, keys, styles))
  }
  return out
}

/** markdown → 规整行（标题转粗、表格转行、代码按行、列表加标记）；有 key 的图独占一行 */
export function larkRows(markdown: string, keys?: ImageKeys): LarkRow[] {
  const root: any = parser.parse(markdown)
  const rows: LarkRow[] = []
  dropped = false

  // 一段内容按图切开：图前文字带前缀（列表标记 / 引用线），图后续行只留缩进；
  // 有图的段里，切出来只剩空白的文字片丢掉（免得图前后冒空行）。段首就是图时，
  // 有序编号 / 勾选框单独成一行留在图前（编号不能丢）；无序「•」直接省掉
  const push = (pieces: Piece[], prefix = '') => {
    const hasImg = pieces.some((p) => p === DROP || isImg(p))
    let run: LarkInline[] = []
    let first = true
    const flush = () => {
      const blank = run.every((e) => !e.text.trim())
      if (!(hasImg && blank)) {
        const pre = first ? prefix : prefix.replace(/[^\s│]/g, ' ')
        const row = pre ? [textElement(pre), ...run] : run
        if (row.length) { rows.push(row); first = false }
      }
      run = []
    }
    for (const p of pieces) {
      if (p === DROP) continue
      if (isImg(p)) {
        flush()
        if (first && /\d+\.|\[[ x]\]/.test(prefix)) rows.push([textElement(prefix.trimEnd())])
        rows.push(p); first = false
      }
      else run.push(p as LarkInline)
    }
    flush()
  }

  const blocks = (nodes: any[], prefix = '') => {
    for (const node of nodes ?? []) {
      if (node.type === 'paragraph') push(inline(node.children, keys), prefix)
      else if (node.type === 'heading') push(inline(node.children, keys, ['bold']), prefix)
      else if (node.type === 'code') {
        for (const line of String(node.value ?? '').split('\n')) push([textElement(line)], prefix)
      } else if (node.type === 'thematicBreak') push([textElement('────────')], prefix)
      else if (node.type === 'blockquote') blocks(node.children, `${prefix}│ `)
      else if (node.type === 'list') {
        const start = Number(node.start ?? 1)
        for (let i = 0; i < node.children.length; i++) {
          const item = node.children[i]
          const marker = node.ordered ? `${start + i}. ` : '• '
          const checked = item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : ''
          let first = true
          for (const child of item.children ?? []) {
            if (child.type === 'list') {
              blocks([child], `${prefix}  `)
              continue
            }
            if (child.type === 'paragraph') {
              push(inline(child.children, keys), first ? `${prefix}${marker}${checked}` : `${prefix}  `)
              first = false
            } else blocks([child], first ? `${prefix}${marker}${checked}` : `${prefix}  `)
          }
        }
      } else if (node.type === 'table') {
        for (let i = 0; i < node.children.length; i++) {
          const cells: Piece[] = []
          for (let j = 0; j < node.children[i].children.length; j++) {
            if (j) cells.push(textElement('  |  '))
            cells.push(...inline(node.children[i].children[j].children, keys, i === 0 ? ['bold'] : []))
          }
          push(cells, prefix)
        }
      } else if (typeof node.value === 'string') push([textElement(node.value)], prefix)
      else if (Array.isArray(node.children)) blocks(node.children, prefix)
    }
  }

  blocks(root.children)
  // 兜底给原文：只在确实没解析出东西时；全是丢掉的图就给空（不把 markdown 原样吐出去）
  if (!rows.length && !dropped) rows.push([textElement(markdown)])
  return rows
}

/** 将模型常见 Markdown 转成飞书 post 消息，避免 Markdown 标记在客户端原样展示。 */
export function toLarkPost(markdown: string, keys?: ImageKeys): LarkPost {
  const content = larkRows(markdown, keys).map((r): LarkPostElement[] => Array.isArray(r) ? r : [{ tag: 'img', image_key: r.img }])
  return { zh_cn: { title: '', content } }
}

/** 答案里所有图片 url（markdown 原样），按出现顺序去重——上传前收集用 */
export function imageUrls(markdown: string): string[] {
  const out = new Set<string>()
  const walk = (n: any) => {
    if (n?.type === 'image' && n.url) out.add(n.url)
    for (const c of n?.children ?? []) walk(c)
  }
  walk(parser.parse(markdown))
  return [...out]
}
