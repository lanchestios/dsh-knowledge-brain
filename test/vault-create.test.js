import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initPlan, createVault } from '../src/core/vault/create.ts'

// 新建知识库的编排：先 wiki init（Python 侧干全部初始化），再连本插件包的软链与钩子。
// run 是假的：只记参数、回放 JSON；真跑 init 的测试在 vault-tools/tests/test_init.py。

const REPORT = { git_inited: true, template: 'preset', seeded: ['认知'], skipped: [], moved: [], backup: null,
  created: [], fixed: [], dropped: [], check_ok: true, check_output: '✓ 校验通过' }

const deps = (out) => {
  const calls = []
  return { calls, d: { wikiBin: '/pkg/vault-tools/bin/wiki', toolsDir: '/pkg/vault-tools',
    run: async (file, args, cwd) => { calls.push({ file, args, cwd }); return JSON.stringify(out) },
    link: (dir, tools) => calls.push({ link: [dir, tools] }) } }
}

test('initPlan：在目标目录跑 wiki init --plan --json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'))
  try {
    const { calls, d } = deps({ git: false, extras: ['drafts'] })
    assert.deepEqual(await initPlan(dir, d), { git: false, extras: ['drafts'] })
    assert.deepEqual(calls[0], { file: 'python3', args: ['/pkg/vault-tools/bin/wiki', 'init', '--plan', '--json'], cwd: dir })
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('createVault：先 init 再连软链，返回报告', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'))
  try {
    const { calls, d } = deps(REPORT)
    assert.deepEqual(await createVault(dir, 'preset', d), REPORT)
    assert.deepEqual(calls[0].args, ['/pkg/vault-tools/bin/wiki', 'init', '--template', 'preset', '--json'])
    assert.deepEqual(calls[1], { link: [dir, '/pkg/vault-tools'] })
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('createVault：模板名不认 / 目录不存在 / 相对路径 → 拒绝，不跑 init', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'))
  try {
    const { calls, d } = deps(REPORT)
    await assert.rejects(createVault(dir, 'fancy', d), /模板/)
    await assert.rejects(createVault(path.join(dir, 'nope'), 'preset', d), /不存在/)
    await assert.rejects(createVault('relative/x', 'preset', d), /绝对路径/)
    assert.equal(calls.length, 0)
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('createVault：init 报错（家目录被拒等）原样抛出，不连软链', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'))
  try {
    const calls = []
    const d = { wikiBin: 'w', toolsDir: 't', run: async () => { throw new Error('不在家目录或文件系统根上建知识库') }, link: () => calls.push('link') }
    await assert.rejects(createVault(dir, 'minimal', d), /家目录/)
    assert.deepEqual(calls, [])
  } finally { fs.rmSync(dir, { recursive: true }) }
})
