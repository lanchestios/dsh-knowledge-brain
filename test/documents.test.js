// 文档清单只认 raw/document；raw/listen 残留一律不进清单（耳闻已撤）
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadDocuments } from '../src/core/documents.ts'

const fakeModel = (dir) => ({ dir, byId: new Map(), html: new Map() })

const build = (d) => {
  const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), text) }
  put('raw/document/2026-09-30/纪要.md')
  put('raw/listen/2026-10-03/20261003143005.md')          // 待提炼：转写定稿、还没人提炼
  put('raw/listen/2026-10-03/20261003143005-2.md')        // 同秒顺延的待提炼
  put('raw/listen/2026-10-03/产品周会要点.md', '# 产品周会要点\n')   // 已提炼：真实标题名
  put('raw/listen/2026-10-04/搜索改版定案.md', '# 搜索改版定案\n')   // 已提炼（另一天）
  put('raw/listen/2026-10-04/.gitkeep')
}

test('loadDocuments：只列 raw/document，raw/listen 全部留在耳闻', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-mat-'))
  try {
    build(dir)
    const rows = loadDocuments(fakeModel(dir))
    assert.deepEqual(rows.map((r) => r.path), ['raw/document/2026-09-30/纪要.md'])
    assert.ok(rows.every((r) => r.status === 'unprocessed'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('loadDocuments：文章文件夹里的 md 是素材，images/ 里的图不是，散文件照列', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-mat-'))
  try {
    const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text) }
    put('raw/document/2026-09-30/文章甲/文章甲.md', '正文 ![](images/01.png)')
    put('raw/document/2026-09-30/文章甲/images/01.png', Buffer.from('89504e47', 'hex'))
    put('raw/document/2026-09-30/报告.pdf')
    const rows = loadDocuments(fakeModel(dir))
    const paths = rows.map((r) => r.path)
    assert.ok(paths.includes('raw/document/2026-09-30/文章甲/文章甲.md'), '文件夹里的 md 列出')
    assert.ok(paths.includes('raw/document/2026-09-30/报告.pdf'), '日期目录下的散文件照列')
    assert.ok(!paths.some((p) => p.endsWith('.png')), '图片不是素材')
    const md = rows.find((r) => r.path.endsWith('文章甲.md'))
    assert.equal(md.name, '文章甲')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
