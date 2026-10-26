// src/editor/kernel/embed-theme.ts
// 嵌入件（asset/*.html iframe）的明暗跟 DSH 宿主：DSH 夜间是 body[data-ds-dark-theme]，沙箱 iframe 里
// 感知不到。两条路给到嵌入页（页内的落地见 routes.ts 的 injectEmbedScripts）：
// - 首帧：iframe 进 DOM 前 themeEmbeds 给 src 补 &theme=，服务端下发时直接写进 <html data-dsh-theme>
// - 之后：pushEmbedTheme 向全部嵌入件广播 dshWikiTheme，页内监听改属性（宿主切主题时由 surface.ts 的桥触发）

export function embedTheme(): 'dark' | 'light' {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

export function pushEmbedTheme() {
  const t = embedTheme()
  for (const f of document.querySelectorAll<HTMLIFrameElement>('iframe.wiki-embed')) {
    try { f.contentWindow?.postMessage({ dshWikiTheme: t }, '*') } catch { /* 未加载完的等 load 上报时回信补 */ }
  }
}

// 必须在 iframe 挂进文档之前调：挂上后再改 src 会让它重新导航一次
export function themeEmbeds(root: ParentNode, theme: 'dark' | 'light' = embedTheme()) {
  for (const f of root.querySelectorAll<HTMLIFrameElement>('iframe.wiki-embed')) {
    const src = f.getAttribute('src')
    if (!src) continue
    f.setAttribute('src', src.replace(/&theme=[^&]*/g, '') + '&theme=' + theme)
  }
}
