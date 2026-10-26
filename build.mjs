// build.mjs —— 两半各一个 esbuild 任务；--watch 时常驻；--install 时不产 sourcemap（prepare 用）
// Client 复刻 DSH 一方预设（packages/client/tsdown.client.ts）的要点：CJS/browser，
// 平台模块外置、其余打进，外包 __ModuleLoader__，CSS 注入 <style data-plugin-css>
import { build, context } from 'esbuild'
import { cp, rm } from 'node:fs/promises'
import { cssPlugin, svgRawPlugin } from './build/assets.mjs'

const ID = 'dsh-knowledge-brain'
const watch = process.argv.includes('--watch')
// --install：prepare（git 安装）用——不产 sourcemap，免得 20 多 MB 的 map 落进 profile
const install = process.argv.includes('--install')
const PLATFORM = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis']

// 平台模块外置；其他 @deepseek-ai 值导入一律报错（类型导入会被擦掉，到不了这里）
const purity = {
  name: 'dsh-purity',
  setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
      if (PLATFORM.includes(args.path)) return { path: args.path, external: true }
      return { errors: [{ text: `client 不能值导入 ${args.path}：只许 DSH 平台模块，其余走 ctx 服务或 import type` }] }
    })
  },
}

const client = {
  entryPoints: { client: 'src/client/index.tsx' },
  outdir: 'lib', bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic', sourcemap: !install, minify: !watch, external: PLATFORM, plugins: [purity, cssPlugin, svgRawPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
}

const host = {
  entryPoints: { index: 'src/index.ts' },
  outdir: 'lib', bundle: true, format: 'esm', platform: 'node', target: 'node22',
  packages: 'external', sourcemap: !install, logLevel: 'info',
}

// 独立 excalidraw IIFE 件：与主 bundle 分开产（互操作与体量见 src/excalidraw-standalone.ts 头注）。
// react 三面走 src/standalone/ 的宿主 shim；产物落 assets/excalidraw/ 随包分发、由前缀路由服务
const standalone = {
  entryPoints: { 'excalidraw.iife': 'src/excalidraw-standalone.ts' },
  outdir: 'assets/excalidraw', bundle: true, format: 'iife', globalName: 'WikiExcalidraw',
  platform: 'browser', target: 'es2022', minify: true, sourcemap: false, conditions: ['production'],
  alias: {
    'react': './src/standalone/react.ts',
    'react-dom': './src/standalone/react-dom.ts',
    'react/jsx-runtime': './src/standalone/jsx-runtime.ts',
  },
  logLevel: 'info',
}

// excalidraw 画布 UI 样式表：包内 css 不能进 esbuild（url() 的 woff2 无 loader），
// 构建期整文件拷贝——相对 url(./fonts/...) 落在本插件 fonts 路由上；Assistant 是 css 唯一
// 引用而 fonts/ 未随包带的族，一并拷入
const copyExdCss = async () => {
  const src = 'node_modules/@excalidraw/excalidraw/dist/prod'
  await cp(`${src}/index.css`, 'assets/excalidraw/excalidraw.iife.css')
  await cp(`${src}/fonts/Assistant`, 'assets/excalidraw/fonts/Assistant', { recursive: true })
}

if (watch) {
  for (const o of [client, host, standalone]) await (await context(o)).watch()
} else {
  if (install) await rm('lib', { recursive: true, force: true }) // 清掉可能残留的 dev 构建产物（含 .map）
  await Promise.all([build(client), build(host), build(standalone)])
  await copyExdCss()
}
