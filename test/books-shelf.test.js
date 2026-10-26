import { test } from 'vitest'
import assert from 'node:assert/strict'
import { chapterRows, convertAction } from '../src/client/explore/BooksShelf.tsx'

const book = (materialStatus, materialError = '', source = 'raw/book/《甲》/甲.pdf') =>
  ({ name: '甲', path: 'raw/book/甲', progress: '', source, materialStatus, materialError, chapters: [] })

test('convertAction：init / failed 可转；其余状态或没有源文件不给按钮', () => {
  assert.equal(convertAction(book('init')), '转换为文字')
  assert.equal(convertAction(book('failed', 'pdftotext 失败')), '转换为文字')
  for (const st of ['text', 'figures', 'proofread', 'readable', 'unavailable']) assert.equal(convertAction(book(st)), null, st)
  assert.equal(convertAction(book('init', '', null)), null)
})

test('convertAction：扫描版仍给按钮（换了源文件后要能重试），文案改成重新检测', () => {
  assert.equal(convertAction(book('init', '× 扫描版 PDF：9/10 页没有文字层')), '重新检测')
})

test('chapterRows：组变化时先插一行组标题，顶层章不插', () => {
  const ch = (id, group) => ({ id, title: id, group, state: 'unread', read: false, text: null, dest: null, pages: [] })
  const rows = chapterRows([ch('1', null), ch('2.1', '2 第二部分'), ch('2.2', '2 第二部分'), ch('3.1', '3'), ch('4', null)])
  assert.deepEqual(rows.map((r) => (r.kind === 'group' ? `#${r.title}` : r.chapter.id)), ['1', '#2 第二部分', '2.1', '2.2', '#3', '3.1', '4'])
})
