// 滚动记忆：pane 被保活上限卸掉前记下滚动位置，重新挂上时还原。按 tab 键（tabKey）存，取完即删；
// 关 tab 时 forget。0 不记（本来就在顶上）
const memo = new Map<string, number>()
export const scrollMemo = {
  remember(key: string, top: number): void { if (top > 0) memo.set(key, top); else memo.delete(key) },
  take(key: string): number | undefined { const v = memo.get(key); memo.delete(key); return v },
  forget(key: string): void { memo.delete(key) },
}
