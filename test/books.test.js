import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chapterKey, loadBooks, parseChapterFile, readChapter } from '../src/core/books.ts'
import { createActions, syncChapterIndex, wikiTimeout } from '../src/host/actions.ts'

const setup = (status = 'init') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-book-'))
  const name = '测试书'
  const book = path.join(dir, 'raw', 'book', name)
  fs.mkdirSync(book, { recursive: true })
  fs.writeFileSync(path.join(book, 'source.pdf'), 'pdf')
  fs.writeFileSync(path.join(book, `${name}.md`), [
    '---', `title: ${name}`, 'status: draft', `material_status: ${status}`, 'progress: 未读', '---', '',
    `# ${name}`, '', '## 章节进度', '', '- [x] 1 占位', '', '## 知识沉淀', '', '- （暂无）', '',
  ].join('\n'))
  return { dir, name, book }
}

test('loadBooks：书籍转换状态与章节阅读状态彼此独立', () => {
  const { dir, name } = setup()
  try {
    const book = loadBooks(dir)[0]
    assert.equal(book.name, name)
    assert.equal(book.materialStatus, 'init')
    assert.equal(book.chapters[0].state, 'read')
    assert.equal(book.chapters[0].text, null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('loadBooks：有源文件时 unavailable 归一为 init', () => {
  const { dir } = setup('unavailable')
  try {
    assert.equal(loadBooks(dir)[0].materialStatus, 'init')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：临时转换成功后同步章节目录、进度清单与 frontmatter', async () => {
  const { dir, name, book: bookDir } = setup()
  const calls = []
  const run = async (_file, args) => {
    calls.push(args.slice(1, 3))
    if (args[2] !== 'split') return ''
    const output = args[4]
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, '1 第一章.md'), '# 第一章\n\n正文')
    fs.writeFileSync(path.join(output, '2 第二章.md'), '# 第二章\n\n正文')
    return ''
  }
  try {
    await createActions(() => dir, run).convertBook({ book: name })
    assert.deepEqual(calls, [['book', 'split'], ['book', 'images']], '装好章节后自动搬书图')
    const converted = loadBooks(dir)[0]
    assert.equal(converted.materialStatus, 'text')
    assert.deepEqual(converted.chapters.map((c) => [c.id, c.title, c.read, !!c.text]), [
      ['1', '第一章', true, false], ['2', '第二章', false, false],
    ])
    assert.ok(fs.existsSync(path.join(bookDir, '章节', '1 第一章.md')))
    assert.ok(fs.existsSync(path.join(bookDir, '章节', '2 第二章.md')))
    const index = fs.readFileSync(path.join(bookDir, `${name}.md`), 'utf8')
    assert.match(index, /material_status: "text"/)
    assert.match(index, /status: draft\nmaterial_status: "text"\nmaterial_error: ""\nprogress: 未读/)
    assert.ok(index.includes('- [x] 1 第一章 → `章节/1 第一章.md`\n- [ ] 2 第二章 → `章节/2 第二章.md`\n'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：转换异常持久化失败状态与原因', async () => {
  const { dir, name } = setup()
  try {
    await assert.rejects(createActions(() => dir, async () => { throw new Error('PDF 没有文字层') }).convertBook({ book: name }), /没有文字层/)
    const failed = loadBooks(dir)[0]
    assert.equal(failed.materialStatus, 'failed')
    assert.match(failed.materialError, /没有文字层/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：扫描版落 init + 说明，不落 failed、不留章节目录', async () => {
  const { dir, name, book: bookDir } = setup()
  const run = async () => { throw new Error('× 扫描版 PDF：9/10 页没有文字层，需要 AI 看页图转写（wiki-write-book-ingest）') }
  try {
    await assert.rejects(createActions(() => dir, run).convertBook({ book: name }), /扫描版/)
    const b = loadBooks(dir)[0]
    assert.equal(b.materialStatus, 'init')
    assert.match(b.materialError, /扫描版/)
    assert.equal(fs.existsSync(path.join(bookDir, '章节')), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：只有 init / failed 能转', async () => {
  for (const st of ['text', 'figures', 'proofread', 'readable']) {
    const { dir, name } = setup(st)
    try {
      await assert.rejects(createActions(() => dir, async () => '').convertBook({ book: name }), /不能再转换/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
})

test('loadBooks：只有 readable 的书给章节文本；旧词表值与无源无状态的推导', () => {
  const { dir, book: bookDir, name } = setup('readable')
  fs.mkdirSync(path.join(bookDir, '章节'))
  fs.writeFileSync(path.join(bookDir, '章节', '1 占位.md'), '# 占位\n')
  try {
    assert.equal(loadBooks(dir)[0].chapters[0].text, `raw/book/${name}/章节/1 占位.md`)
    const idx = path.join(bookDir, `${name}.md`)
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('material_status: readable', 'material_status: proofread'))
    assert.equal(loadBooks(dir)[0].chapters[0].text, null)
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('material_status: proofread', 'material_status: done'))
    assert.equal(loadBooks(dir)[0].materialStatus, 'init', '旧值 done 不认，按有源文件推成 init')
    fs.rmSync(path.join(bookDir, 'source.pdf'))
    assert.equal(loadBooks(dir)[0].materialStatus, 'unavailable')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：安装章节后失败会恢复索引并清理半成品', async () => {
  const { dir, name, book: bookDir } = setup()
  const indexPath = path.join(bookDir, `${name}.md`)
  fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('## 章节进度', '## 阅读记录'))
  const run = async (_file, args) => {
    const output = args[4]
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, '1 第一章.md'), '# 第一章\n\n正文')
    return ''
  }
  try {
    await assert.rejects(createActions(() => dir, run).convertBook({ book: name }), /缺少「## 章节进度」/)
    assert.equal(fs.existsSync(path.join(bookDir, '章节')), false)
    const index = fs.readFileSync(indexPath, 'utf8')
    assert.match(index, /material_status: "failed"/)
    assert.match(index, /## 阅读记录/)
    assert.match(index, /- \[x\] 1 占位/)
    assert.doesNotMatch(index, /章节\/1 第一章\.md/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('写库动作传给 CLI 的是作用域新名', async () => {
  const { dir, name } = setup('readable')
  const calls = []
  const run = async (_file, args) => { calls.push(args.slice(1)); return '' }
  fs.mkdirSync(path.join(dir, 'raw', 'document', '2026-10-12'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'raw', 'document', '2026-10-12', 'a.md'), '# a\n')
  fs.mkdirSync(path.join(dir, '知识'), { recursive: true })
  fs.writeFileSync(path.join(dir, '知识', '甲.md'), '---\nstatus: draft\n---\n')
  try {
    const a = createActions(() => dir, run)
    await a.readChapter({ book: name, id: '1' })
    await a.deposit({ book: name, id: '1', done: true })
    await a.cover({ path: 'raw/document/2026-10-12/a.md', grade: 'done' })
    await a.mark({ path: '知识/甲.md' })
    await a.reorder({ node: '知识/甲.md', place: { before: '知识/乙.md' } })
    await a.reorder({ node: '知识/甲.md', place: {} })
    await a.move({ node: '知识/甲.md', folder: '知识/丙', place: { first: true } })
    await a.move({ node: '知识/丙', folder: '工作', place: { after: '工作/丁.md' } })
    assert.deepEqual(calls, [
      ['book', 'read', name, '1'],
      ['book', 'deposit', name, '1', '--done'],
      ['document', 'cover', 'raw/document/2026-10-12/a.md', 'done'],
      ['page', 'mark', '知识/甲.md', 'stable'],
      ['page', 'order', '知识/甲.md', '--before', '知识/乙.md'],
      ['page', 'order', '知识/甲.md', '--last'],
      ['page', 'move', '知识/甲.md', '知识/丙/', '--first'],
      ['page', 'move', '知识/丙', '工作/', '--after', '工作/丁.md'],
    ])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('wikiTimeout：只看命令位——拆书 10 分钟、建库 3 分钟，参数里碰巧有同名词不算', () => {
  assert.equal(wikiTimeout(['/p/wiki', 'book', 'split', 'a.epub', 'out']), 10 * 60_000)
  assert.equal(wikiTimeout(['/p/wiki', 'init', '--template', 'minimal', '--json']), 180_000)
  assert.equal(wikiTimeout(['/p/wiki', 'book', 'read', '《split》', 'ch01']), 30_000)
  assert.equal(wikiTimeout(['/p/wiki', 'page', 'mark', 'init', 'stable']), 30_000)
})

test('readChapter：不可读的书标 readable=false，阅读器据此提示还在整理', () => {
  const { dir } = setup('proofread')
  try {
    const b = loadBooks(dir)[0]
    const d = readChapter(dir, b, '1')
    assert.equal(d.readable, false)
    assert.equal(d.raw, null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('convertBook：只认「<号> <标题>.md」——CH02-、ch02-、00- 都不进清单', async () => {
  const { dir, name, book: bookDir } = setup()
  const run = async (_file, args) => {
    if (args[2] !== 'split') return ''
    const output = args[4]
    fs.mkdirSync(output, { recursive: true })
    for (const f of ['1 一.md', 'CH02-二.md', 'ch02-二.md', '00-前言.md']) fs.writeFileSync(path.join(output, f), '# x\n')
    return ''
  }
  try {
    await createActions(() => dir, run).convertBook({ book: name })
    const index = fs.readFileSync(path.join(bookDir, `${name}.md`), 'utf8')
    assert.match(index, /- \[x\] 1 一 → `章节\/1 一\.md`/)
    assert.doesNotMatch(index, /二|前言/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// 与 vault-tools/tests/test_book_ids.py 的 SYNC_EXPECTED 逐字相同（Python sync 与 TS syncChapterIndex 一致）
const SYNC_EXPECTED = [
  '## 章节进度', '',
  '- [ ] 1 一 → `章节/1 一.md`',
  '### 2 第二部分',
  '- [ ] 2.1 甲 → `章节/2.1 甲.md`',
  '- [x] 2.2 乙 → `章节/2.2 乙.md`',
  '- [ ] 2.10 癸 → `章节/2.10 癸.md`', '',
].join('\n')

test('syncChapterIndex：分组行保留、数字排序、勾按号保留——与 Python sync 逐字一致', () => {
  const { dir, book: bookDir, name } = setup()
  const idx = path.join(bookDir, `${name}.md`)
  try {
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('- [x] 1 占位', '### 2 第二部分\n- [x] 2.2 乙\n- [ ] 9 旧的'))
    syncChapterIndex(idx, ['1 一.md', '2.1 甲.md', '2.10 癸.md', '2.2 乙.md', '00-前言.md'], new Map([['2.2', true]]))
    assert.ok(fs.readFileSync(idx, 'utf8').includes(SYNC_EXPECTED + '\n## 知识沉淀'), fs.readFileSync(idx, 'utf8'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('loadBooks：分组、点分号、知识沉淀前缀安全；不带书名号的书目录照样列出', () => {
  const { dir, book: bookDir, name } = setup('readable')
  const idx = path.join(bookDir, `${name}.md`)
  try {
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8')
      .replace('- [x] 1 占位', '- [x] 1 一\n### 2 第二部分\n- [x] 2.1 甲\n- [ ] 2.10 癸\n- [ ] 3.1 丙')
      .replace('- （暂无）', '- 2.10 癸 · 沉淀中\n- 1 一 → `知识/`\n  - [[某页]]'))
    const b = loadBooks(dir)[0]
    assert.equal(b.name, '测试书')
    assert.deepEqual(b.chapters.map((c) => [c.id, c.title, c.group, c.state]), [
      ['1', '一', null, 'done'], ['2.1', '甲', '2 第二部分', 'read'], ['2.10', '癸', '2 第二部分', 'depositing'], ['3.1', '丙', '3', 'unread'],
    ])
    assert.deepEqual(b.chapters[0].pages.map((x) => x.name), ['某页'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('chapterKey / parseChapterFile：数字排序、文件名解析', () => {
  assert.deepEqual(['1.10', '1.2', '10', '9', '1.9', '1'].sort(chapterKey), ['1', '1.2', '1.9', '1.10', '9', '10'])
  assert.deepEqual(parseChapterFile('1.1 什么是向量.md'), { id: '1.1', title: '什么是向量' })
  assert.deepEqual(parseChapterFile('3 1984年.md'), { id: '3', title: '1984年' })
  for (const f of ['00-前言.md', 'ch01-a.md', '1.md', 'CH02-二.md']) assert.equal(parseChapterFile(f), null, f)
})

test('bookChapter 白名单：章节号只认 1 / 1.1', async () => {
  const { dir, name, book: bookDir } = setup('readable')
  const idx = path.join(bookDir, `${name}.md`)
  try {
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('- [x] 1 占位', '- [x] 1.1 甲'))
    const a = createActions(() => dir, async () => '')
    await a.readChapter({ book: name, id: '1.1' })
    await assert.rejects(a.readChapter({ book: name, id: 'ch01' }), /没有 ch01/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('syncChapterIndex：章节进度是最后一节时，文件以单个换行结尾（与 Python sync 一致）', () => {
  const { dir, book: bookDir, name } = setup()
  const idx = path.join(bookDir, `${name}.md`)
  try {
    const t = fs.readFileSync(idx, 'utf8')
    fs.writeFileSync(idx, t.slice(0, t.indexOf('## 知识沉淀')).replace('- [x] 1 占位', '### 2 第二部分\n- [x] 2.2 乙'))
    syncChapterIndex(idx, ['1 一.md', '2.1 甲.md', '2.10 癸.md', '2.2 乙.md'], new Map([['2.2', true]]))
    const out = fs.readFileSync(idx, 'utf8')
    assert.ok(out.endsWith(SYNC_EXPECTED.replace(/\n$/, '') + '\n') && !out.endsWith('\n\n'), JSON.stringify(out.slice(-40)))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('loadBooks：分组只认「## 章节进度」节里的 ### 行，别的节里的 ### 不算', () => {
  const { dir, book: bookDir, name } = setup('readable')
  const idx = path.join(bookDir, `${name}.md`)
  try {
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('- [x] 1 占位', '- [ ] 2.1 甲') + '\n## 笔记\n\n### 2 不是分组\n')
    assert.equal(loadBooks(dir)[0].chapters[0].group, '2')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
