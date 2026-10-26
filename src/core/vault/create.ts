// 新建知识库：初始化全在 CLI（wiki init，Python 一份），这里只做两件 Python 做不了的：
// 校验入参、把 .wiki 软链与 pre-commit 钩子连到当前运行的插件包（只有插件知道包在哪）。
import fs from 'node:fs'
import path from 'node:path'
import { ensureToolchain } from './init'
import type { Runner } from '../../host/actions'

export type InitPlan = { git: boolean; extras: string[] }
export type InitReport = {
  git_inited: boolean; template: 'minimal' | 'preset'; seeded: string[]; skipped: string[]
  moved: string[]; backup: string | null; created: string[]; fixed: string[]; dropped: string[]
  check_ok: boolean; check_output: string
}
export type CreateDeps = { run: Runner; wikiBin: string; toolsDir: string; link?: (dir: string, toolsDir: string) => unknown }

const TEMPLATES = new Set(['minimal', 'preset'])

function target(dir: string): string {
  if (!path.isAbsolute(dir)) throw new Error(`要绝对路径：${dir}`)
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`目录不存在：${dir}`)
  return dir
}

export async function initPlan(dir: string, d: CreateDeps): Promise<InitPlan> {
  return JSON.parse(await d.run('python3', [d.wikiBin, 'init', '--plan', '--json'], target(dir)))
}

export async function createVault(dir: string, template: string, d: CreateDeps): Promise<InitReport> {
  if (!TEMPLATES.has(template)) throw new Error(`没有这个模板：${template}`)
  const cwd = target(dir)
  const report: InitReport = JSON.parse(await d.run('python3', [d.wikiBin, 'init', '--template', template, '--json'], cwd))
  ;(d.link ?? ensureToolchain)(cwd, d.toolsDir)
  return report
}
