// @vitest-environment jsdom
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentsTable } from '../src/client/explore/DocumentsTable.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'
import { NavProvider } from '../src/client/lib/nav.tsx'
import { onFill } from '../src/client/lib/fill.ts'
import { portalView, trackRoot } from './helpers/portals.js'

Element.prototype.scrollIntoView ??= () => {}
const docs = [
  { path: 'raw/document/a.pdf', name: '材料甲', ext: 'pdf', date: '2026-10-25', status: 'unprocessed', citedBy: [] },
  { path: 'raw/document/b.md', name: '材料乙', ext: 'md', date: '2026-10-24', status: 'processing', citedBy: [] },
  { path: 'raw/document/c.pdf', name: '材料丙', ext: 'pdf', date: '2026-10-24', status: 'done', citedBy: [] },
]
async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  trackRoot(root, host)
  const api = { documents: async () => docs, onChanged: () => () => {} }
  await act(async () => root.render(h(WikiEnvProvider, { value: { api } }, h(NavProvider, { initial: { kind: 'documents', status: '全部' } }, h(DocumentsTable, { status: '全部' })))))
  return portalView(host)
}
const click = async (el) => { await act(async () => el.click()) }
const button = (view, text) => [...view.querySelectorAll('button')].find((el) => el.textContent === text)
const checkbox = (view, label) => view.querySelector(`[role="checkbox"][aria-label="${label}"]`)

test('文档多选：半选 → 全选 → 取消；沉淀请求只包含勾选路径', async () => {
  const view = await mount()
  const all = checkbox(view, '全选')
  await click(checkbox(view, '材料甲'))
  assert.equal(all.getAttribute('aria-checked'), 'mixed')
  const fills = []
  const off = onFill((r) => fills.push(r))
  try { await click(button(view, '知识沉淀 1 份')) } finally { off() }
  assert.deepEqual(fills, [{ kind: 'deposit', paths: [docs[0].path] }])
  await click(all)
  assert.equal(view.querySelectorAll('[role="checkbox"][aria-checked="true"]').length, 4)
  await click(all)
  assert.equal(view.querySelectorAll('[role="checkbox"][aria-checked="true"]').length, 0)
  assert.equal(button(view, '知识沉淀').disabled, true)
})

test('文件类型可多选，日期 Select 与类型筛选叠加并恢复触发器焦点', async () => {
  const view = await mount()
  await click(button(view, 'pdf'))
  assert.equal(view.querySelectorAll('tbody tr').length, 2)
  const trigger = view.querySelector('[aria-label="到达日"]')
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const date = [...view.querySelectorAll('[role="option"]')].find((el) => el.textContent === '2026-10-24')
  assert.ok(date)
  await click(date)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.equal(view.querySelectorAll('tbody tr').length, 1)
  assert.match(view.querySelector('tbody').textContent, /材料丙/)
  assert.ok(document.activeElement === trigger, '选择日期后恢复焦点')
  await click(button(view, 'md'))
  assert.equal(view.querySelectorAll('tbody tr').length, 2, 'pdf 与 md 是并集')
})
