// src/editor/kernel/mdext.ts
import type { InlineContext, MarkdownConfig } from '@lezer/markdown'
import {
  classifyCharacter, classifyPrecedingCharacter, isCjk, isCjkOrIvs, isNonCjkPunctuation,
  isSpaceOrPunctuation, isUnicodeWhitespace,
} from 'micromark-extension-cjk-friendly-util'

// 强调定界与服务端 remark-cjk-friendly 对齐（render.ts 渲染阅读 html 用它）。CommonMark 原规则下
// 「**术语：**说明」的闭符前是标点、后是汉字，判不成右侧定界，lezer 整段露星号而服务端正常加粗。
// lezer 不导出 Emphasis 的定界类型（resolveMarkers 按类型身份配对 */_），没法自建同型定界——
// 包一层默认 Emphasis 解析：它照常追加定界（类型/区间都对），这里只按 cjk-friendly 规则（照抄
// micromark-extension-cjk-friendly attention.js）重算 open/close 位。拿不到默认解析即原样退回 CommonMark。
type Parse = (cx: InlineContext, next: number, pos: number) => number
const codeBefore = (cx: InlineContext, pos: number): number | null => {
  if (pos <= cx.offset) return null
  const lo = cx.char(pos - 1)
  if (lo >= 0xdc00 && lo <= 0xdfff && pos - 2 >= cx.offset) {
    const hi = cx.char(pos - 2)
    if (hi >= 0xd800 && hi <= 0xdbff) return (hi - 0xd800) * 0x400 + lo - 0xdc00 + 0x10000
  }
  return lo
}
const codeAt = (cx: InlineContext, pos: number): number | null => {
  if (pos >= cx.end) return null
  const hi = cx.char(pos)
  if (hi >= 0xd800 && hi <= 0xdbff && pos + 1 < cx.end) {
    const lo = cx.char(pos + 1)
    if (lo >= 0xdc00 && lo <= 0xdfff) return (hi - 0xd800) * 0x400 + lo - 0xdc00 + 0x10000
  }
  return hi
}
const cjkSides = (cx: InlineContext, marker: number, start: number, end: number): number => {
  const previous = codeBefore(cx, start)
  const before = classifyCharacter(previous)
  const beforePrimary = classifyPrecedingCharacter(before, () => {
    const p = previous !== null && previous > 0xffff ? start - 2 : start - 1
    return codeBefore(cx, p)
  }, previous)
  const code = codeAt(cx, end)
  const after = classifyCharacter(code)
  const beforeNonCjkPunct = isNonCjkPunctuation(beforePrimary)
  const beforeSpaceOrNonCjkPunct = beforeNonCjkPunct || isUnicodeWhitespace(beforePrimary)
  const afterNonCjkPunct = isNonCjkPunctuation(after)
  const afterSpaceOrNonCjkPunct = afterNonCjkPunct || isUnicodeWhitespace(after)
  // attentionMarkers（* _）：lezer 已把同字符连串吞进本定界，前后紧邻的只可能是另一种标记符
  const isMarker = (c: number | null) => c === 42 || c === 95
  const open = !afterSpaceOrNonCjkPunct || (afterNonCjkPunct && (beforeSpaceOrNonCjkPunct || isCjkOrIvs(beforePrimary))) || isMarker(code)
  const close = !beforeSpaceOrNonCjkPunct || (beforeNonCjkPunct && (afterSpaceOrNonCjkPunct || isCjk(after))) || isMarker(previous)
  const o = marker === 42 ? open : open && (isSpaceOrPunctuation(beforePrimary) || !close)
  const c = marker === 42 ? close : close && (isSpaceOrPunctuation(after) || !open)
  return (o ? 1 : 0) | (c ? 2 : 0)
}
const baseEmphasis = (cx: InlineContext): Parse | undefined => {
  const p = cx.parser as unknown as { inlineNames?: string[]; inlineParsers?: Parse[] }
  return p.inlineParsers?.[p.inlineNames?.indexOf('Emphasis') ?? -1]
}
export const cjkEmphasisExt: MarkdownConfig = {
  parseInline: [{
    name: 'CjkEmphasis',
    parse(cx, next, pos) {
      if (next !== 42 && next !== 95) return -1
      const base = baseEmphasis(cx)
      if (!base) return -1
      const end = base(cx, next, pos)
      if (end < 0) return end
      const parts = (cx as unknown as { parts?: Array<{ from: number; to: number; side?: number } | null> }).parts
      const d = parts?.[parts.length - 1]
      if (d && d.from === pos && d.to === end && typeof d.side === 'number') d.side = cjkSides(cx, next, pos, end)
      return end
    },
    before: 'Emphasis',
  }],
}

// $...$（单美元；开符后、闭符前不是空白；内容无换行、\ 转义跳一格）与
// [[目标|别名]]（单行闭合）。defineNodes 注册名，装饰层按节点名识别。
export const mathExt: MarkdownConfig = {
  defineNodes: ['InlineMath'],
  parseInline: [{
    name: 'InlineMath',
    parse(cx, next, pos) {
      if (next !== 36 /* $ */ || cx.char(pos + 1) === 36 || /\s/.test(String.fromCharCode(cx.char(pos + 1)))) return -1
      for (let i = pos + 1; i < cx.end; i++) {
        const c = cx.char(i)
        if (c === 10) return -1
        if (c === 92 /* \ */) { i++; continue }
        if (c === 36 && !/\s/.test(String.fromCharCode(cx.char(i - 1)))) {
          cx.addElement(cx.elt('InlineMath', pos, i + 1))
          return i + 1   // lezer 内层循环是 pos = result（绝对位置），返回相对偏移会倒退死循环
        }
      }
      return -1
    },
    before: 'Link',
  }],
}

export const wikilinkExt: MarkdownConfig = {
  defineNodes: ['WikiLink'],
  parseInline: [{
    name: 'WikiLink',
    parse(cx, next, pos) {
      if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1
      const rest = cx.slice(pos + 2, cx.end)
      const close = rest.indexOf(']]')
      if (close < 0 || rest.slice(0, close).includes('\n')) return -1
      const end = pos + 2 + close + 2
      cx.addElement(cx.elt('WikiLink', pos, end))
      return end      // 同上：绝对位置（相对偏移会让 pos 倒退回小地址，解析死循环）
    },
    before: 'Link',
  }],
}
