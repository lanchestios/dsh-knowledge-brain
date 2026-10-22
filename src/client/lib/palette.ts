import type { Area } from '../../core/api'

export function palette(el: Element) {
  const s = getComputedStyle(el)
  const v = (k: string) => s.getPropertyValue(k).trim()
  return {
    edge: v('--dsw-alias-label-tertiary'),
    hl: v('--dsw-alias-brand-primary'),
    text: v('--dsw-alias-label-primary'),
    // 区色按区名取 CSS 变量 --area-<区名>；没配色的区退到次要文字色
    area: (a: Area) => v('--wk-area-' + a) || v('--dsw-alias-label-secondary'),
  }
}
