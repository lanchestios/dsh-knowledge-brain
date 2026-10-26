import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { build } from 'esbuild'
import postcss from 'postcss'
import { cssPlugin } from '../build/assets.mjs'

const root = join(import.meta.dirname, '..')
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(dir, entry.name))
    : /\.(tsx?|css)$/.test(entry.name) ? [join(dir, entry.name)] : [])
}

test('客户端基础 UI 和主题不再依赖宿主组件库或 --dsw-* 变量', () => {
  for (const file of sources(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    assert.ok(!/from\s+['"]@deepseek-ai\/dsh-client-ui-primitives['"]/.test(text), file)
    assert.ok(!text.includes('--dsw-'), file)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(!pkg.devDependencies['@deepseek-ai/dsh-client-ui-primitives'])
  assert.ok(!readFileSync(join(root, 'build.mjs'), 'utf8').includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('真实构建产出的 Tailwind CSS 不重置宿主选择器、变量或 @property', async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: "import './src/client/styles/ui.css'", resolveDir: root },
    bundle: true, write: false, format: 'iife', plugins: [cssPlugin],
  })
  let css = ''
  vm.runInNewContext(result.outputFiles[0].text, { document: {
    querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: (tag) => { css = tag.textContent } },
  } })
  assert.ok(css.includes('wk\\:bg-primary'), '真实 UI 类被扫描和编译')
  assert.ok(!css.includes('--tw-'), 'Tailwind 内部变量也属于插件')
  const tree = postcss.parse(css)
  tree.walkAtRules('layer', () => assert.fail('插件控件不能被宿主未分层的元素 reset 覆盖'))
  tree.walkAtRules('property', (rule) => assert.ok(rule.params.startsWith('--wk-'), rule.params))
  tree.walkRules((rule) => {
    let parent = rule.parent
    while (parent) { if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return; parent = parent.parent }
    for (const selector of rule.selectors) assert.ok(selector.includes('[data-wiki-ui]') || selector.includes('.wk\\:'), selector)
  })
})
