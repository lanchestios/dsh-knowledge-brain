import { transform } from 'lightningcss'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const ID = 'dsh-knowledge-brain'

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

export const cssPlugin = {
  name: 'dsh-css',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      let code = await inlineFonts(await readFile(args.path), args.path)
      const watchFiles = [], watchDirs = []
      if (args.path.endsWith(join('styles', 'ui.css'))) {
        const result = await postcss([tailwindcss(), {
          postcssPlugin: 'wiki-tailwind-scope',
          OnceExit(root) {
            // Host element resets may be unlayered. Emit our prefixed classes
            // unlayered too, so a global `button` rule cannot override them
            // merely through cascade-layer precedence. Local CSS modules still
            // override defaults by normal specificity and source order.
            root.walkAtRules('layer', (rule) => {
              if (rule.nodes) rule.replaceWith(...rule.nodes)
              else rule.remove()
            })
            // Tailwind prefixes theme variables, but keeps --tw-* utility
            // internals global (including @property). Give those a namespace too.
            root.walkDecls((decl) => {
              decl.prop = decl.prop.replaceAll('--tw-', '--wk-tw-')
              decl.value = decl.value.replaceAll('--tw-', '--wk-tw-')
            })
            root.walkAtRules('property', (rule) => { rule.params = rule.params.replaceAll('--tw-', '--wk-tw-') })
            // Tailwind's theme and custom-property initializers must not reset
            // the host's own Tailwind state. All utility selectors are wk: prefixed.
            root.walkRules((rule) => {
              if (rule.selector === ':root, :host' || rule.selector === ':root,:host') rule.selector = '[data-wiki-ui]'
              if (rule.parent?.type === 'atrule' && rule.parent.name === 'supports') {
                if (rule.selector.trim().startsWith('*') && rule.selector.includes('::before')) rule.selector = '[data-wiki-ui], [data-wiki-ui] *, [data-wiki-ui]::before, [data-wiki-ui]::after, [data-wiki-ui]::backdrop'
              }
            })
          },
        }]).process(code.toString(), { from: args.path })
        code = Buffer.from(result.css)
        for (const message of result.messages) {
          if (message.type === 'dependency' && message.file) watchFiles.push(message.file)
          if (message.type === 'dir-dependency' && message.dir) watchDirs.push(message.dir)
        }
      }
      const local = args.path.endsWith('.module.css')
      const out = transform({ filename: args.path, code, minify: true, ...(local ? { cssModules: { pattern: 'wk_[hash]_[local]' } } : {}) })
      let map
      if (local) { map = {}; for (const [k, v] of Object.entries(out.exports ?? {})) map[k] = v.name }
      return { contents: inject(args.path, out.code.toString(), map), loader: 'js', watchFiles, watchDirs }
    })
  },
}

// 编辑器原生 DOM widget 直接消费 SVG 源码；构建期读入字符串，产物不产生资源请求。
export const svgRawPlugin = {
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

