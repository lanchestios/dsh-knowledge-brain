// 阅读器暴露给快捷键（Task 13）的动作；ReaderPage 挂载时赋值、卸载时清空。
// tab 不支持前进后退（每个 tab 一篇，普通点击原地替换）；prev/next 是翻页（上一页/下一章），不是历史
export const readerCommands: {
  prev?(): void; next?(): void; search?(): void
  root?: HTMLElement | null
} = {}
