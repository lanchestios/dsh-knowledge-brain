import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createImageResolver } from '../src/lark/images.ts'

// 答案里的图 → image_key：只传库内（raw/ asset/）、白名单格式、≤10MB 的图；外链不下载；
// 按「路径+mtime+size」缓存；单张失败 / 超时 / 缺权限都只是这张不发，resolve 本身不抛

const fake = (files, over = {}) => {
  const uploads = []
  const warns = []
  let n = 0
  const deps = {
    locate: (rel) => (rel.startsWith('raw/') || rel.startsWith('asset/')) && !rel.includes('..') ? `/vault/${rel}` : null,
    stat: async (abs) => {
      const f = files[abs.slice('/vault/'.length)]
      if (!f) throw new Error('ENOENT')
      return { size: f.size ?? 100, mtimeMs: f.mtime ?? 1 }
    },
    read: async (abs) => Buffer.from(abs),
    upload: async (buf) => { uploads.push(buf.toString()); return `img_${++n}` },
    warn: (m) => warns.push(m),
    ...over,
  }
  return { deps, uploads, warns }
}

test('只传库内白名单图：外链、越界、svg、超 10MB、不存在都跳过（不出 key）', async () => {
  const { deps, uploads } = fake({
    'asset/a.png': {}, 'asset/x.svg': {}, 'asset/big.jpg': { size: 11 * 1024 * 1024 },
  })
  const r = createImageResolver(deps)
  const keys = await r.resolve([
    '![](asset/a.png)', '![](https://e.com/x.png)', '![](asset/../../etc/p.png)',
    '![](asset/x.svg)', '![](asset/big.jpg)', '![](asset/missing.png)', '![](认知/a.png)',
  ].join('\n\n'))
  assert.deepEqual([...keys], [['asset/a.png', 'img_1']])
  assert.deepEqual(uploads, ['/vault/asset/a.png'])
})

test('路径里的 %20 解码后再找文件；key 仍按答案原样 url 记', async () => {
  const { deps } = fake({ 'raw/书/图 片/x.png': {} })
  const keys = await createImageResolver(deps).resolve('![](raw/书/图%20片/x.png)')
  assert.equal(keys.get('raw/书/图%20片/x.png'), 'img_1')
})

test('同图去重只传一次；超过 5 张的不传', async () => {
  const files = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`asset/${i}.png`, {}]))
  const { deps, uploads } = fake(files)
  const md = ['![](asset/0.png)', '![](asset/0.png)', ...Array.from({ length: 6 }, (_, i) => `![](asset/${i + 1}.png)`)].join('\n\n')
  const keys = await createImageResolver(deps).resolve(md)
  assert.equal(uploads.length, 5)
  assert.equal(keys.size, 5)
  assert.ok(keys.has('asset/0.png') && !keys.has('asset/6.png'))
})

test('缓存：同一文件第二次不再上传；mtime 变了重传', async () => {
  const files = { 'asset/a.png': { mtime: 1 } }
  const { deps, uploads } = fake(files)
  const r = createImageResolver(deps)
  await r.resolve('![](asset/a.png)')
  const again = await r.resolve('![x](asset/a.png)')
  assert.equal(uploads.length, 1)
  assert.equal(again.get('asset/a.png'), 'img_1')
  files['asset/a.png'].mtime = 2
  const fresh = await r.resolve('![](asset/a.png)')
  assert.equal(uploads.length, 2)
  assert.equal(fresh.get('asset/a.png'), 'img_2')
})

test('单张上传失败只影响这一张，记 warn，resolve 不抛', async () => {
  let n = 0
  const { deps, warns } = fake({ 'asset/a.png': {}, 'asset/b.png': {} }, {
    upload: async (buf) => { if (buf.toString().endsWith('a.png')) throw new Error('boom'); return `img_${++n}` },
  })
  const keys = await createImageResolver(deps).resolve('![](asset/a.png)\n\n![](asset/b.png)')
  assert.deepEqual([...keys], [['asset/b.png', 'img_1']])
  assert.equal(warns.length, 1)
  assert.match(warns[0], /boom/)
})

test('超时：卡住的那张不等，已传好的照用', async () => {
  const { deps } = fake({ 'asset/slow.png': {}, 'asset/fast.png': {} }, {
    upload: async (buf) => buf.toString().endsWith('slow.png') ? new Promise(() => {}) : 'img_fast',
  })
  const t0 = Date.now()
  const keys = await createImageResolver(deps, { timeoutMs: 30 }).resolve('![](asset/slow.png)\n\n![](asset/fast.png)')
  assert.ok(Date.now() - t0 < 500)
  assert.deepEqual([...keys], [['asset/fast.png', 'img_fast']])
})

test('缺权限（99991672）：只 warn 一次，之后这个 resolver 不再上传', async () => {
  const calls = []
  const { deps, warns } = fake({ 'asset/a.png': {}, 'asset/b.png': {} }, {
    upload: async (buf) => { calls.push(buf.toString()); throw Object.assign(new Error('Access denied'), { code: 99991672 }) },
  })
  const r = createImageResolver(deps)
  const k1 = await r.resolve('![](asset/a.png)\n\n![](asset/b.png)')
  const k2 = await r.resolve('![](asset/a.png)')
  assert.equal(k1.size + k2.size, 0)
  assert.equal(warns.length, 1)
  assert.match(warns[0], /im:resource/)
  assert.ok(calls.length <= 2, '并发中的那张可能已发出，之后不再发')
  assert.equal(calls.filter((c) => c.endsWith('a.png')).length, 1, '第二次 resolve 不再上传')
})

test('答案没图：不碰文件系统，返回空表', async () => {
  const { deps, uploads } = fake({}, { stat: async () => { throw new Error('不该调') } })
  const keys = await createImageResolver(deps).resolve('纯文字 [链](asset/a.png)')
  assert.equal(keys.size, 0)
  assert.equal(uploads.length, 0)
})
