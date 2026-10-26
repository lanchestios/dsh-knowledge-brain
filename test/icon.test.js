// @vitest-environment jsdom
// 插件自带图标（src/icon）：渲染成真 svg、接口同 primitives（size / className）、多色图标的渐变 id 按实例去重；
// 顶栏属性 / AI 两颗带文字；全屏查看工具栏换成拷来的 svg
import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { IconAiAssistant, IconMoreRight } from '../src/icon/index.tsx'
import { openLightbox } from '../src/editor/viewer/lightbox.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => { createRoot(host).render(el) })
  return host
}

test('渲染成 svg：size 落到宽高、className 透传、aria-hidden、不往 textContent 里掺空白', async () => {
  const host = await mount(h(IconMoreRight, { size: 14, className: 'x' }))
  const svg = host.querySelector('svg')
  assert.equal(svg.getAttribute('width'), '14')
  assert.equal(svg.getAttribute('height'), '14')
  assert.equal(svg.getAttribute('viewBox'), '0 0 16 16')
  assert.equal(svg.getAttribute('class'), 'x')
  assert.equal(svg.getAttribute('aria-hidden'), 'true')
  assert.equal(svg.dataset.icon, 'more-right')
  assert.equal(host.textContent, '')
})

test('多色图标同页两份：渐变 id 各不相同，url(#…) 指向自己那份', async () => {
  const host = await mount(h(Fragment, null, h(IconAiAssistant), h(IconAiAssistant)))
  const svgs = [...host.querySelectorAll('svg')]
  const ids = svgs.map((s) => s.querySelector('linearGradient').id)
  assert.equal(new Set(ids).size, 2, '两份 id 不撞')
  svgs.forEach((s, i) => assert.equal(s.querySelector('path').getAttribute('fill'), `url(#${ids[i]})`))
  ids.forEach((id) => assert.ok(!id.includes(':'), 'id 里没有冒号（url() 不认）'))
})

test('全屏查看工具栏：五颗按钮都是拷来的 svg，标 aria-hidden', () => {
  const img = document.createElement('img')
  document.body.appendChild(img)
  openLightbox(img)
  const svgs = [...document.querySelectorAll('.lbBar button svg')]
  assert.equal(svgs.length, 5)
  svgs.forEach((s) => assert.equal(s.getAttribute('aria-hidden'), 'true'))
})
