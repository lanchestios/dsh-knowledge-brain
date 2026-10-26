// Lark事件号去重（官方文档说事件可能重推）。不落盘，重启即清——丢一条重推的
// 重复回答远好过把重推当新问题答两遍。

/** true = 这个 event_id 已经处理过（重推），调用方丢弃 */
export class SeenEvents {
  private ids: string[] = []
  private set = new Set<string>()
  constructor(private cap = 200) {}
  dup(eventId: string): boolean {
    if (!eventId) return false
    if (this.set.has(eventId)) return true
    this.set.add(eventId); this.ids.push(eventId)
    if (this.ids.length > this.cap) this.set.delete(this.ids.shift()!)
    return false
  }
}
