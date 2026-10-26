// src/excalidraw-standalone.ts
// 独立 IIFE 件的入口（build.mjs 第三任务，globalName=WikiExcalidraw，产物
// assets/excalidraw/excalidraw.iife.js 由 /api/wiki.exfonts 前缀路由服务）。
// 为什么不进 client 主 bundle：excalidraw 的 ESM 产物在 CJS 单 factory 里惰性 init 的
// 裸 require 与命名空间 getter 互操作不可靠（真机：THEME/Button 活、组件 undefined），
// 且整包 +7MB 全量进主产物；独立件按需注入 script、react 走宿主 shim，两个问题一起没。
// UI 样式表不在 JS 产物里（真机「编辑态打开样式乱」根因）：build.mjs 构建期把包内
// dist/prod/index.css 拷成 assets/excalidraw/excalidraw.iife.css、其引用的 Assistant
// 字体一并拷进 fonts/——不能走 esbuild import（css 里 url() 的 woff2 会炸 loader），
// 拷贝的相对 url 恰好落在本插件 fonts 路由上。装载见 loadExcalidrawLib 注 <link>。
export { Excalidraw, exportToSvg } from '@excalidraw/excalidraw'
