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
