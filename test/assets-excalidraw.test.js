// test/assets-excalidraw.test.js
// 字体离线：①装的 excalidraw 包引用的每个 woff2 都随插件分发（pnpm 升版本换哈希时这里先红）
// ②前缀路由的取件纯函数：白名单、woff2 头、immutable 缓存
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { exfontResponse } from '../src/host/exfonts.ts';

// 产物 chunk 里引用的全部 ./fonts/…（与运行时加载清单同源）
const chunk = 'node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js';
const refs = [...new Set([...readFileSync(chunk, 'utf8').matchAll(/"\.\/(fonts\/[^"]+\.woff2)"/g)].map((m) => m[1]))];

test('包引用的每个 woff2 都在 assets/excalidraw/ 里且是合法 woff2', () => {
  assert.ok(refs.length > 200, `字体清单异常地短：${refs.length}`)
  const missing = refs.filter((f) => !fs.existsSync(path.join('assets/excalidraw', f)))
  assert.deepEqual(missing, [], '缺字体文件（pnpm 升 excalidraw 换了哈希名？重新下载对齐版本）')
  const bad = refs.filter((f) => fs.readFileSync(path.join('assets/excalidraw', f)).subarray(0, 4).toString('latin1') !== 'wOF2')
  assert.deepEqual(bad.slice(0, 3), [])
});

test('exfontResponse：合法路径回字节与缓存头，越界/非白名单/不存在回 null', async () => {
  const root = process.cwd()   // 包根（vitest cwd = 仓库根）
  const ok = exfontResponse(root, refs[0]);
  assert.ok(ok, '合法字体有响应')
  assert.equal(ok.headers['Content-Type'], 'font/woff2')
  assert.match(ok.headers['Cache-Control'], /immutable/)
  const bytes = new Uint8Array(await new Response(ok.body).arrayBuffer()).subarray(0, 4)
  assert.equal(String.fromCharCode(...bytes), 'wOF2')
  assert.equal(exfontResponse(root, '../package.json'), null)
  assert.equal(exfontResponse(root, 'fonts/X/../../x.woff2'), null)
  assert.equal(exfontResponse(root, 'fonts/X/y.txt'), null)
  assert.equal(exfontResponse(root, 'fonts/X/没有这个.woff2'), null)
  // 独立 IIFE 件：js 头、按天缓存（同名随包升级换内容，不 immutable）
  const js = exfontResponse(root, 'excalidraw.iife.js')
  assert.ok(js, 'iife 件有响应')
  assert.equal(js.headers['Content-Type'], 'application/javascript; charset=utf-8')
  assert.equal(js.headers['Cache-Control'], 'private, max-age=86400')
  assert.equal(exfontResponse(root, 'excalidraw.iife.js.map'), null)
  const css = exfontResponse(root, 'excalidraw.iife.css')
  assert.ok(css, 'iife 样式表有响应')
  assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8', 'css 按 css 头服务')
  assert.equal(css.headers['Cache-Control'], 'private, max-age=86400', '同名随包升级换内容，只缓存一天')
  assert.equal(exfontResponse(root, 'excalidraw.iife.css.map'), null)

});

// —— 评审修复 I2：路径解码不抛（坏 % 编码 → null 走 404），不炸宿主 ——
import { exfontRelOf } from '../src/host/exfonts.ts';

test('exfontRelOf：正常路径剥前缀；坏 % 编码返回 null 不抛', () => {
  assert.equal(exfontRelOf('/api/wiki.exfonts/fonts/Excalifont/x.woff2'), 'fonts/Excalifont/x.woff2')
  assert.equal(exfontRelOf('/api/wiki.exfonts/'), '')
  assert.equal(exfontRelOf('/api/wiki.exfonts/fonts/%A0bad.woff2'), null)
  assert.equal(exfontRelOf('/api/wiki.exfonts/fonts/%2e%2e%2fx.woff2'), 'fonts/../x.woff2')
});
