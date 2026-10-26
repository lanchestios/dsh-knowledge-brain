// src/editor/eol.ts
export type Eol = '\n' | '\r\n' | '\r'

export function detectEol(text: string): Eol {
  if (text.includes('\r\n')) return '\r\n'
  if (text.includes('\r')) return '\r'
  return '\n'
}

/** CM6 恒以 \n 分行：进编辑面前归一 */
export const toLf = (text: string): string => (text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text)

/** 出编辑面（保存）时按载入时探测的 EOL 还原 */
export const applyEol = (text: string, eol: Eol): string => (eol === '\n' ? text : text.replace(/\n/g, eol))
