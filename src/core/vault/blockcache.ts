// src/core/vault/blockcache.ts
// 块级渲染缓存：src 字符串即键（哈希只是省内存的变体，直接可读性更好）。
// 上限 32/页（spec §四：防编辑态 churn）；get 触发提位；pending promise 被逐出也能照常
// resolve 给正在等它的 widget——只是不再缓存。
export class BlockHtmlCache {
  private map = new Map<string, Promise<string>>()
  constructor(private cap = 32) {}
  get(src: string): Promise<string> | undefined {
    const v = this.map.get(src)
    if (v !== undefined) { this.map.delete(src); this.map.set(src, v) }
    return v
  }
  set(src: string, p: Promise<string>) {
    if (this.map.has(src)) this.map.delete(src)
    this.map.set(src, p)
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
  has(src: string) { return this.map.has(src) }
  delete(src: string) { this.map.delete(src) }
  clear() { this.map.clear() }
}
