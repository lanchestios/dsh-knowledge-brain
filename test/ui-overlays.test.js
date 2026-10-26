// @vitest-environment jsdom
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal, Button, Input } from '../src/client/ui'
import { FolderPicker } from '../src/client/components/FolderPicker.tsx'
import { trackRoot } from './helpers/portals.js'

async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); trackRoot(root, host)
  function Harness() {
    const [open, setOpen] = useState(false), [folder, setFolder] = useState('')
    return h('div', null,
      h(Button, { onClick: () => setOpen(true) }, '打开'),
      h(Modal, { open, onClose: () => setOpen(false), title: '设置' },
        h(Input, { autoFocus: true, placeholder: '名称' }),
        h(FolderPicker, { value: folder, folders: ['认知'], onChange: setFolder })))
  }
  await act(async () => root.render(h(Harness)))
  const trigger = host.querySelector('button'); trigger.focus()
  await act(async () => trigger.click())
  return { host, trigger }
}
const key = (target, key, extra = {}) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))

test('真实弹窗有模态语义，autoFocus 输入不会破坏关闭后的焦点恢复', async () => {
  const { trigger } = await mount()
  const dialog = document.querySelector('[role=dialog]')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.ok(dialog.contains(document.activeElement))
  await key(document.activeElement, 'Escape')
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.equal(document.querySelector('[role=dialog]'), null)
  assert.equal(document.activeElement, trigger)
})

test('弹窗内树选择器保留焦点约束，Escape 先关树；输入法组合中不关弹窗', async () => {
  await mount()
  const picker = document.querySelector('button[aria-haspopup=tree]')
  await act(async () => picker.click())
  const search = document.querySelector('input[type=search]')
  assert.ok(document.querySelector('[role=dialog]').contains(search))
  await act(async () => search.focus())
  assert.equal(document.activeElement, search)
  await key(search, 'Escape')
  assert.equal(document.querySelector('[role=tree]'), null)
  assert.ok(document.querySelector('[role=dialog]'))
  await key(picker, 'Escape', { isComposing: true })
  assert.ok(document.querySelector('[role=dialog]'))
  await key(picker, 'Escape')
  assert.equal(document.querySelector('[role=dialog]'), null)
})
