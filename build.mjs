// build.mjs —— 两半各一个 esbuild 任务；--watch 时常驻；--install 时不产 sourcemap（prepare 用）
// Client 复刻 DSH 一方预设（packages/client/tsdown.client.ts）的要点：CJS/browser，
// 平台模块外置、其余打进，外包 __ModuleLoader__，CSS 注入 <style data-plugin-css>
import { build, context } from 'esbuild'
import { transform } from 'lightningcss'
import { cp, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const ID = 'dsh-knowledge-brain'
const watch = process.argv.includes('--watch')
// --install：prepare（git 安装）用——不产 sourcemap，免得 20 多 MB 的 map 落进 profile
const install = process.argv.includes('--install')
const PLATFORM = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']

const inject = (fileId, css, classMap) => [
  `const css = ${JSON.stringify(css)};`,
  `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
  `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
  `  const tag = document.createElement('style'); tag.dataset.plugin = ${JSON.stringify(ID)}; tag.dataset.pluginCss = tagId; tag.textContent = css; document.head.appendChild(tag);`,
  `}`,
  classMap ? `export default ${JSON.stringify(classMap)};` : 'export {};',
].join('\n')

// katex.min.css 引用同目录 fonts/ 下的字体文件，而 CSS 是内联成 <style> 的，相对地址没处落：
// 剥掉 woff/ttf 回退源只留 woff2（20 个共约 300KB），转成 base64 data URI 一起内联
async function inlineFonts(code, cssPath) {
  let css = code.toString()
  if (!css.includes('url(fonts/')) return code
  css = css.replaceAll(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, '')
  css = css.replaceAll(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '')
  const dir = join(dirname(cssPath), 'fonts')
  const data = new Map()
  for (const [, name] of css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g))
    if (!data.has(name)) data.set(name, 'data:font/woff2;base64,' + (await readFile(join(dir, name))).toString('base64'))
  return Buffer.from(css.replaceAll(/url\(fonts\/([^)]+\.woff2)\)/g, (_, name) => data.get(name)), 'utf8')
}

const cssPlugin = {
  name: 'dsh-css',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const code = await inlineFonts(await readFile(args.path), args.path)
      const local = args.path.endsWith('.module.css')
      const out = transform({ filename: args.path, code, minify: true, ...(local ? { cssModules: { pattern: 'wk_[hash]_[local]' } } : {}) })
      let map
      if (local) { map = {}; for (const [k, v] of Object.entries(out.exports ?? {})) map[k] = v.name }
      return { contents: inject(args.path, out.code.toString(), map), loader: 'js' }
    })
  },
}

// 编辑器原生 DOM widget 直接消费 SVG 源码；构建期读入字符串，产物不产生资源请求。
const svgRawPlugin = {
  name: 'dsh-svg-raw',
  setup(b) {
    b.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
      path: join(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'svg-raw',
    }))
    b.onLoad({ filter: /.*/, namespace: 'svg-raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }))
  },
}

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
