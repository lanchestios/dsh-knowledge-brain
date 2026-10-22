// src/editor/blocks/measure.ts
import { EditorView } from '@codemirror/view'

// 异步变高后必须通知 CM6 重新测量：widget 在挂载后改自身高度（batch html 替换、图片解码、
// mermaid/信息图渲染、iframe 自适应），heightmap 若不知情就永远记着旧高，点击落点与光标
// 画位从此按旧高折算、随块数累计漂移（「点 A 行光标落 B 行」的第二根因）。
// findFromDOM 在元素未挂载（卸载竞态）时返回 null，安全无事。
export const remeasure = (el: Element) => { EditorView.findFromDOM(el as HTMLElement)?.requestMeasure() }
