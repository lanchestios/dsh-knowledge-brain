// pageLists：沉淀两页的全量表——草稿/动态与 home() 同口径（draft=status: draft、按 updated 倒序），
// 但不截断；home() 看板仍取前 7。真实 vault 建模型（状态/updated 都走真解析）
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildModel, home, pageLists } from '../src/core/model.ts'

let dir
const page = (rel, fm = '') => {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, `---\ntitle: ${path.basename(rel, '.md')}\n${fm}---\n正文`)
}
test('pageLists：草稿全量 + 动态全量倒序；home() 仍截 7', () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-plists-'))
  try {
    fs.mkdirSync(path.join(dir, '.git'))
    fs.mkdirSync(path.join(dir, '.wiki'))
    fs.writeFileSync(path.join(dir, '.wiki', 'wiki.json'), '{ "version": 1, "parts": { "认知": { "order": 1 }, "知识": { "order": 2 } } }')
    // 12 页草稿（知识区）+ 2 页完成页（认知区），updated 各不相同（页在库根的区目录下）
    for (let i = 1; i <= 12; i++) page(`知识/草稿${String(i).padStart(2, '0')}.md`, `status: draft\nupdated: 2026-10-${String(i).padStart(2, '0')}\n`)
    page('认知/稳定页.md', 'status: stable\nupdated: 2026-09-28\n')
    page('认知/又一稳定页.md', 'status: stable\nupdated: 2026-09-30\n')
    const m = buildModel(dir)
    const { drafts, recent } = pageLists(m)
    assert.equal(drafts.length, 12, '草稿全量不截')
    assert.ok(drafts[0].updated >= drafts.at(-1).updated, '草稿按更新倒序')
    assert.equal(recent.length, 14, '动态 = 全部页')
    assert.deepEqual(recent.slice(0, 2).map((r) => r.updated), ['2026-10-12', '2026-10-11'], '最新在前')
    assert.equal(home(m).stats.drafts.length, 7, '首页看板仍取前 7')
    assert.equal(home(m).stats.recent.length, 7)
    assert.ok(drafts.every((r) => r.id && r.name && r.area), '行形状齐（id/name/area）')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
