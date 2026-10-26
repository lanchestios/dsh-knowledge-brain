import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-10-19 读写两路拆分：写作线统一 wiki-write- 前缀、skills/wiki 支撑文件改英文名，不留旧名别名。
// 包内再出现旧技能名或旧中文文件名，就是有人照着一个已不存在的技能/文件指路。
// 例外：.wiki/review/ 账本在库里不在包里；docs/ 是设计史，不扫。文件名只认前面不是汉字、也不是 raw/ 的（「raw/素材.md」「结构化写作.md」是普通素材与页名）。

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SELF = fileURLToPath(import.meta.url)
const SCAN = ['vault-tools/skills', 'vault-tools/lib', 'vault-tools/seeds', 'vault-tools/tests', 'vault-tools/bin', 'src', 'test', 'README.md', 'DESIGN.md', 'vault-tools/README.md']
const LEGACY = /wiki-(compose|explore|humanize|review|book-ingest|distill)\b|wiki_(explore|humanize|review|write)\b|(?<![\u4e00-\u9fa5]|raw\/)(写作|绘图|素材|元数据|锚点|排序|上手)\.md/

function* walk(p) {
  if (!existsSync(p)) return
  const st = statSync(p)
  if (st.isFile()) { yield p; return }
  for (const e of readdirSync(p)) {
    if (e === 'node_modules' || e === '__pycache__' || e.startsWith('.')) continue
    yield* walk(join(p, e))
  }
}

test('包内不再引用旧技能名与旧中文文件名', () => {
  const hits = []
  for (const s of SCAN) for (const f of walk(join(ROOT, s))) {
    if (f === SELF || !/\.(md|ts|tsx|js|mjs|py|json)$|\/bin\/wiki$/.test(f)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (LEGACY.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 80)}`) })
  }
  assert.deepEqual(hits, [], `残留 ${hits.length} 处：\n${hits.join('\n')}`)
})

test('skills/ 下文件名只含 ASCII', () => {
  const bad = []
  for (const f of walk(join(ROOT, 'vault-tools/skills'))) if (!/^[\x20-\x7e]+$/.test(basename(f))) bad.push(relative(ROOT, f))
  assert.deepEqual(bad, [])
})

test('技能正文不再把 compose 当名词用（wiki-compose 已改名 wiki-write）', () => {
  const hits = []
  for (const f of walk(join(ROOT, 'vault-tools/skills'))) {
    if (!f.endsWith('.md')) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (/\bcompose\b/i.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`) })
  }
  assert.deepEqual(hits, [])
})
