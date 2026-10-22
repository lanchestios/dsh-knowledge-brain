// @vitest-environment jsdom
// 设置页「知识库目录」：新建在前、打开在后；新建 = 选目录 → 选模板 → （有多余项）确认迁移 → 完成卡片；
// 打开失败列 check 报错 + 一段可复制给 AI 的修复指引。api 全假，按真实客户端形态喂。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { DirField } from '../src/client/settings/WikiSettingsCard.tsx'
import { WikiEnvProvider } from '../src/client/env.tsx'

const OK = { ok: true, dir: '/v', pages: 12, error: null, degraded: false, validating: false, checkOutput: null }
const REPORT = (o = {}) => ({ git_inited: true, template: 'preset', seeded: ['认知'], skipped: [], moved: [], backup: null,
  created: [], fixed: [], dropped: [], check_ok: true, check_output: '', ...o })

async function mount({ status = OK, text = '', api = {} } = {}) {
  const edits = []
  const calls = []
  const full = {
    status: async () => status, onChanged: () => () => {},
    pickDir: async () => ({ kind: 'native', path: '/new' }),
    initPlan: async (dir) => { calls.push(['initPlan', dir]); return { git: false, extras: [] } },
    create: async (dir, tpl) => { calls.push(['create', dir, tpl]); return REPORT() },
    ...api,
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(h(WikiEnvProvider, { value: { api: full, c: {}, openExternal: () => {}, openExplorable: () => {}, useDark: () => false } },
      h(DirField, { state: { writable: true, vaultDir: { text } }, onEdit: (p) => edits.push(p) })))
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return { host, edits, calls }
}
const btn = (host, label) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const click = async (host, label) => { await act(async () => { btn(host, label).click() }); await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

test('还没有知识库：新建在前、打开在后，并给出提示', async () => {
  const { host } = await mount({ status: { ...OK, ok: false, dir: '', pages: 0 } })
  const labels = [...host.querySelectorAll('button')].map((b) => b.textContent).filter((t) => t === '新建' || t === '打开')
  assert.deepEqual(labels, ['新建', '打开'])
  assert.ok(host.textContent.includes('还没有知识库'))
})

test('校验中：两个按钮都收起，提示校验中', async () => {
  const { host } = await mount({ text: '/v', status: { ...OK, ok: false, validating: true } })
  assert.equal(btn(host, '新建').disabled, true)
  assert.equal(btn(host, '打开').disabled, true)
  assert.ok(host.textContent.includes('正在校验知识库'))
  assert.ok(host.querySelector('[data-icon="loading"]') !== null, '校验中用 LoadingOutlined 转圈图标')
  assert.ok(!host.textContent.includes('⟳'), '不再用 ⟳ 字符')
})

test('已打开：显示页数与校验通过', async () => {
  const { host } = await mount({ text: '/v' })
  assert.ok(host.textContent.includes('已打开 · 12 页 · 校验通过'))
})

test('打开失败：逐条列 ✗ 行，附可复制给 AI 的修复指引', async () => {
  const { host } = await mount({ text: '/v', status: { ...OK, ok: false, error: '没通过校验，知识库未打开',
    checkOutput: '✗ 顶层：多余条目 —— drafts\n✗ 引用：双链指向的页面不存在 —— 知识/A.md → [[B]]\n\n共 2 处问题' } })
  const items = [...host.querySelectorAll('li')].map((li) => li.textContent)
  assert.deepEqual(items, ['顶层：多余条目 —— drafts', '引用：双链指向的页面不存在 —— 知识/A.md → [[B]]'])
  assert.ok(host.textContent.includes('没通过校验，知识库未打开（2 处）'))
  assert.ok(host.textContent.includes('vault-tools/lib/check/check.py'))
  assert.ok(btn(host, '复制'))
})

test('打开失败但校验根本没跑起来（没有 python3 / 崩了）：显示原始输出，不出「0 处」与修复指引', async () => {
  const { host } = await mount({ text: '/v', status: { ...OK, ok: false, error: '没通过校验，知识库未打开',
    checkOutput: '校验没跑起来：spawn python3 ENOENT' } })
  assert.ok(host.textContent.includes('spawn python3 ENOENT'))
  assert.ok(!host.textContent.includes('0 处'))
  assert.ok(!host.textContent.includes('把这段发给 AI 修'))
})

test('打开：选目录即写 vaultDir（保存后由服务端校验）', async () => {
  const { host, edits } = await mount()
  await click(host, '打开')
  assert.deepEqual(edits, ['/new'])
})

test('打开：选的就是当前目录（修好后再开）→ 不写 vaultDir（写了也不变），而是让服务端重新校验', async () => {
  const reopened = []
  const { host, edits } = await mount({ text: '/v', status: { ...OK, ok: false, dir: '/v', error: '没通过校验，知识库未打开', checkOutput: '✗ 顶层：多余条目 —— x' },
    api: { pickDir: async () => ({ kind: 'native', path: '/v' }), reopen: async () => { reopened.push(1) } } })
  await click(host, '打开')
  assert.deepEqual(edits, [])
  assert.equal(reopened.length, 1)
})

test('新建：选目录 → 默认预置 → 没有多余项直接建 → 完成卡片 → 好 写 vaultDir', async () => {
  const { host, edits, calls } = await mount()
  await click(host, '新建')
  assert.ok(host.textContent.includes('/new'))
  assert.ok(host.querySelector('[data-template="preset"][aria-checked="true"]'), '默认选中预置')
  await click(host, '下一步')
  assert.deepEqual(calls, [['initPlan', '/new'], ['create', '/new', 'preset']])
  assert.ok(host.textContent.includes('✓ 已初始化 git'))
  assert.ok(host.textContent.includes('✓ 已初始化知识库模板'))
  assert.ok(!host.textContent.includes('已迁移无关文件'), '没挪东西就不出这行')
  await click(host, '好')
  assert.deepEqual(edits, ['/new'])
})

test('新建：有多余项先确认，列出清单；完成卡片带迁移去处；已有 git 不出那行', async () => {
  const { host, calls } = await mount({ api: {
    initPlan: async () => ({ git: true, extras: ['drafts', 'todo.txt'] }),
    create: async (dir, tpl) => { calls.push(['create', dir, tpl]); return REPORT({ git_inited: false, template: 'minimal', moved: ['drafts', 'todo.txt'], backup: '.wiki/backup/init-20261009-1830' }) },
  } })
  await click(host, '新建')
  await act(async () => { host.querySelector('[data-template="minimal"]').click() })
  await click(host, '下一步')
  assert.ok(host.textContent.includes('2 项不属于知识库结构'))
  assert.ok(host.textContent.includes('.wiki/backup/'))
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['drafts', 'todo.txt'])
  assert.equal(calls.length, 0, '确认前不建')
  await click(host, '移走并新建')
  assert.deepEqual(calls, [['create', '/new', 'minimal']])
  assert.ok(!host.textContent.includes('已初始化 git'))
  assert.ok(host.textContent.includes('✓ 已迁移无关文件到 .wiki/backup/init-20261009-1830'))
})

test('新建后 check 没过：不出完成卡片，直接写 vaultDir 进打开失败态', async () => {
  const { host, edits } = await mount({ api: { create: async () => REPORT({ check_ok: false, check_output: '✗ 引用：…' }) } })
  await click(host, '新建')
  await click(host, '下一步')
  assert.ok(!host.textContent.includes('已初始化知识库模板'))
  assert.deepEqual(edits, ['/new'])
})

test('新建失败（如家目录被拒）：弹窗里显示原因，不写 vaultDir', async () => {
  const { host, edits } = await mount({ api: { create: async () => { throw new Error('不在家目录或文件系统根上建知识库') } } })
  await click(host, '新建')
  await click(host, '下一步')
  assert.ok(host.textContent.includes('不在家目录或文件系统根上建知识库'))
  assert.deepEqual(edits, [])
})
