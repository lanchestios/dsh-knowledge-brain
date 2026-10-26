// src/editor/io.ts
// 编辑器包与宿主的唯一边界：包不 import 宿主任何东西。
// changed 的事件已在宿主侧按 touches(path) 过滤，这里回调无参。
export type EditRef =
  | { kind: 'wikilink'; name: string; anchor?: string }
  | { kind: 'page'; id: string; anchor?: string }
  | { kind: 'href'; href: string }
export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'conflict' | 'error'
export interface NameState { id: string | null; dead?: string }
export interface AssetRef { url?: string; title?: string }

export interface EditorIo {
  load(): Promise<{ text: string; hash: string }>
  save(text: string, baseHash: string): Promise<{ ok: true; hash: string } | { ok: false }>
  changed?(cb: () => void): () => void
  /** 页级批量块渲染（代码/表格/公式/嵌入），顺序对应、宿主侧去重 */
  renderBlocks(srcs: string[]): Promise<string[]>
  /** 双链名 → 页 id / 死链原因（阅读态装饰用） */
  resolveNames?(names: string[]): Promise<Record<string, NameState>>
  /** 库内资源解析（图片 src 重写、hover 元信息） */
  resolveAsset?(href: string): AssetRef | null
  /** ⌘+点击 / 链接落点 */
  open?(ref: EditRef): void
  /** 右键落在链接上（双链 / 块内页链 / 库内文档链接）：宿主弹自己的菜单并返回 true，surface 随即拦掉
   *  浏览器菜单；返回 false 或没实现则保留浏览器默认右键。外链、死链、普通文字不调 */
  menu?(ref: EditRef, at: { x: number; y: number }): boolean
  /** 卸载时（changed = 真写过盘且与载入不同） */
  exit?(changed: boolean): void
  /** 编辑态点 excalidraw 图位：宿主开画布覆盖层（rel 是 asset/ 下的 .excalidraw 路径） */
  editExcalidraw?(rel: string): void
}
