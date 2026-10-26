// @vitest-environment jsdom
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ModelSelect } from '../src/client/settings/ModelSelect.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'
import { Modal } from '../src/client/ui'
import { trackRoot } from './helpers/portals.js'

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
Element.prototype.scrollIntoView ??= function () {}
const catalog = { ok: true, value: { groups: [{ id: 'deepseek', models: [{ id: 'chat' }, { id: 'reasoner' }] }, { id: 'local', models: [{ id: 'qwen' }] }] } }
async function mount(initial = '', disabled = false, modal = false) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); trackRoot(root, host)
  const picks = []
  const env = { c: { get: () => ({ modelCatalog: async () => catalog }) } }
  function App() {
    const [value, setValue] = useState(initial), [open, setOpen] = useState(true)
    const picker = h(ModelSelect, { value, disabled, onChange: (v) => { picks.push(v); setValue(v) } })
    return h(WikiEnvProvider, { value: env }, modal ? h(Modal, { open, onClose: () => setOpen(false), title: '编辑机器人' }, picker) : picker)
  }
  await act(async () => root.render(h(App)))
  return { picks, trigger: () => document.querySelector('button[aria-label="选择模型"]') }
}
const open = async (trigger) => act(async () => trigger().click())
const search = () => document.querySelector('input[aria-label="搜索模型"]')
async function query(text) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search(), text)
    search().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('模型 Combobox 按服务商分组，可搜索和选择，选完恢复焦点', async () => {
  const { trigger, picks } = await mount()
  await open(trigger)
  assert.ok(document.activeElement === search(), '搜索框应聚焦')
  assert.deepEqual([...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.textContent), ['deepseek', 'local'])
  await query('reasoner')
  const option = document.querySelector('[cmdk-item][data-value="deepseek/reasoner"]')
  assert.ok(option)
  assert.equal(document.querySelector('[cmdk-item][data-value="local/qwen"]'), null)
  await act(async () => option.click())
  assert.deepEqual(picks, ['deepseek/reasoner'])
  assert.equal(search(), null)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.ok(document.activeElement === trigger(), '焦点应回到模型字段')
  assert.ok(trigger().textContent.includes('deepseek/reasoner'))
})

test('旧模型仍显示并可回到默认，搜不到显示空态', async () => {
  const { trigger, picks } = await mount('old/model')
  assert.ok(trigger().textContent.includes('不在目录里'))
  await open(trigger)
  assert.ok(document.querySelector('[cmdk-item][data-value="old/model"]'))
  await query('no-such-model')
  assert.ok(document.querySelector('[cmdk-empty]').textContent.includes('没有匹配的模型'))
  await query('默认')
  await act(async () => document.querySelector('[cmdk-item][data-value="__default__"]').click())
  assert.deepEqual(picks, [''])
})

test('禁用时不能打开', async () => {
  const disabled = await mount('', true)
  await open(disabled.trigger)
  assert.equal(search(), null)
})

test('弹窗内 Esc 先关选择器，组字时不选模型', async () => {
  const { trigger, picks } = await mount('', false, true)
  await open(trigger)
  await act(async () => search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
  assert.deepEqual(picks, [])
  await act(async () => search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(search(), null)
  assert.ok(document.querySelector('[data-wiki-dialog]'))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.ok(document.activeElement === trigger(), '焦点应回到模型字段')
})
