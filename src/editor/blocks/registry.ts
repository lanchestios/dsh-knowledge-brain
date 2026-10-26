import { WidgetType } from '@codemirror/view'
import type { BatchStore } from './server'
import type { EditorIo } from '../io'

// 块渲染器注册表：kind → DOM 构造。服务端块（code/table/...）与客户端块
// （mermaid/infographic，Task 6）挂同一入口；宿主未来可注入自定义块，不动内核。
// io/degrade 可选：deco 侧传的 DecoCtx 是超集，表格等需要降级判定的 kind 直接读。
export interface BlockViewCtx { dark: boolean; mode: 'edit' | 'read'; batch: BatchStore; io?: EditorIo; degrade?: boolean }
export interface BlockViewSpec {
  build(src: string, info: string, ctx: BlockViewCtx): HTMLElement
  // 可选：widget 从视图移除时 CM6 调用（如 infographic 销毁实例，防文档级监听累积）
  destroy?(dom: HTMLElement): void
  // 可选：src 变化时的保 DOM 判定（打字不重建的秘密——表格 eq 三重一致走这里）。
  // dom 是已挂载的 widget 根（至少一侧），返回 true 则 CM6 保留 DOM 不重建。
  eq?(prevSrc: string, nextSrc: string, dom: HTMLElement): boolean
  // 可选：src 没变时也要重建的判定（excalidraw 场景文件被重写、引用行没动——版本号走这里）。
  // 返回 true = 陈旧（重建）。同 eq 一样在 dispatch 同步路径上跑，抛错按陈旧处理。
  stale?(dom: HTMLElement): boolean
  // true → widget 内事件放行给编辑器事件链（表格网格要收点击）
  interactive?: boolean
}
const kinds = new Map<string, BlockViewSpec>()
export function registerBlock(kind: string, spec: BlockViewSpec) { kinds.set(kind, spec) }

class BlockWidget extends WidgetType {
  dom: HTMLElement | null = null   // toDOM 记录根节点；eq 保 DOM 时向对侧传递（WeakMap 状态按根查）
  constructor(readonly kind: string, readonly src: string, readonly info: string, readonly ctx: BlockViewCtx) { super() }
  eq(o: BlockWidget) {
    if (o.kind !== this.kind || o.info !== this.info || o.ctx.dark !== this.ctx.dark || o.ctx.mode !== this.ctx.mode || o.ctx.batch !== this.ctx.batch) return false
    if (o.src === this.src) {
      // src 相同不短路：kind 可能因外部状态（场景文件重写）陈旧。dom 引用必须双向补齐——
      // CM 在相等时保留新实例，若不把已挂载的 dom 转移给对侧，中间实例（如选区触发的重建产出的
      // 那一代）永远 dom-less，后续 stale 判定拿不到 dom.dataset 只能当「不陈旧」，保存后永不重建
      // （桌面「保存不刷新」根因：点图必经选区 dispatch，正好埋下这个中间实例）
      const spec = kinds.get(this.kind)
      const dom = this.dom ?? o.dom
      if (dom) { this.dom = dom; o.dom = dom }
      if (spec?.stale && dom) { try { return !spec.stale(dom) } catch { return false } }
      return true
    }
    const spec = kinds.get(this.kind)
    const dom = this.dom ?? o.dom
    if (!spec?.eq || !dom) return false
    // 纵深（宿主崩溃纪律）：eq 在 CM6 dispatch 同步路径上跑，kind 抛错按 false（重建）不逃逸
    let keep: boolean
    try { keep = spec.eq(this.src, o.src, dom) } catch { return false }
    if (!keep) return false
    // 保 DOM 成立：把 dom 引用传给对侧——CM6 若保留存量实例，新实例后续对比也能查到状态
    this.dom = dom; o.dom = dom
    return true
  }
  toDOM() {
    const spec = kinds.get(this.kind)
    if (!spec) { const d = document.createElement('span'); d.textContent = this.src; return d }
    this.dom = spec.build(this.src, this.info, this.ctx)
    return this.dom
  }
  ignoreEvent() { return !(kinds.get(this.kind)?.interactive) }
  // CM6 移除 widget 时转调 kind 的 destroy（无则跳过）
  destroy(dom: HTMLElement) { kinds.get(this.kind)?.destroy?.(dom) }
}

export function blockWidget(kind: string, src: string, info: string, ctx: BlockViewCtx): WidgetType | null {
  return kinds.has(kind) ? new BlockWidget(kind, src, info, ctx) : null
}
