// 库初始化判定与工具链连接（无 cordis 依赖，可独立跑）。
// .wiki/ 目录是唯一的库标识（与 CLI 的 find_root 同一判据）；结构版本记在
// .wiki/wiki.json 的 version。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 与 vault-tools/lib/init.py 的 WIKI_VERSION 一致（建库在 Python 侧写 wiki.json）
export const WIKI_VERSION = 5;

// 判别联合给足：不标的话调用方窄化不了 refuse 的 reason
export type MigrateDecision = { action: 'migrate' };
export type OpenDecision = { action: 'open' };
export type RefuseDecision = { action: 'refuse'; reason: string };
export type InitDecision = MigrateDecision | OpenDecision | RefuseDecision;

// 没有 .wiki 就不是知识库：建库只走「新建」（CLI wiki init），开库不再自建
export const NOT_A_VAULT = '这不是知识库；要在这里建库，点「新建」'

export function decideInit(_names: string[], hasWiki: boolean, version: number | null, current: number): InitDecision {
  if (!hasWiki) return { action: 'refuse', reason: NOT_A_VAULT }
  if (version == null) return { action: 'refuse', reason: `wiki.json 读不出 version（缺失或文件损坏），认不出这个库；按「打开失败」给的提示修好再打开` }
  if (version > current) return { action: 'refuse', reason: `库版本 v${version} 比插件认的 v${current} 新，先升级 dsh-knowledge-brain 插件` }
  if (version < current) return { action: 'migrate' }
  return { action: 'open' }
}

// 库必须有 git 管理（actor 落回 git 身份、move 按改名记录修引用、anchor 钉基线、pre-commit）。
// 没有 → init + 起步 .gitignore（raw/project/ 是外部代码仓，不入库）；init 失败返回原因字符串，成功返回 null。
export function ensureGit(dir: string): string | null {
  if (fs.existsSync(path.join(dir, '.git'))) return null
  const r = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0 || !fs.existsSync(path.join(dir, '.git')))
    return `git init 失败（${(r.stderr || '').trim() || (r.error && r.error.message) || '未知原因'}），知识库需要 git 管理`
  if (!fs.existsSync(path.join(dir, '.gitignore')))
    fs.writeFileSync(path.join(dir, '.gitignore'), '.wiki/bin\nraw/project/\n')
  return null
}

// 幂等建软链：没有就建、断链重建、指向别处的活链重指（旧安装还在，不重指就一直跑旧工具）、
// 指得对的真实软链与真实文件不动（后者只进 skipped）。两个 profile 同时开且版本不同时后开的赢，
// 各自开库各重指一次，换来「软链永远跟着正在运行的插件」。
function link(abs: string, target: string, made: string[], skipped: string[], repointed: string[], root: string): void {
  const st = fs.lstatSync(abs, { throwIfNoEntry: false })
  if (st) {
    if (st.isSymbolicLink()) {
      if (!fs.existsSync(abs)) fs.rmSync(abs)
      else if (fs.readlinkSync(abs) !== target) {
        fs.rmSync(abs)
        fs.symlinkSync(target, abs)
        repointed.push(path.relative(root, abs))
        return
      } else { skipped.push(path.relative(root, abs)); return }
    } else { skipped.push(path.relative(root, abs)); return }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.symlinkSync(target, abs)
  made.push(path.relative(root, abs))
}

// 工具链连接：.wiki/bin（技能文案与子 agent 的稳定入口）、.wiki/skills 与 .wiki/agents
// （.claude/ 下入库的相对软链经这一层转到包内源）+ .git/hooks/pre-commit。
// 前置：ensureGit 已过（.git 存在）。
export function ensureToolchain(dir: string, toolsDir: string): { made: string[]; skipped: string[]; repointed: string[] } {
  const made: string[] = [], skipped: string[] = [], repointed: string[] = []
  link(path.join(dir, '.wiki', 'bin'), path.join(toolsDir, 'bin'), made, skipped, repointed, dir)
  link(path.join(dir, '.wiki', 'skills'), path.join(toolsDir, 'skills'), made, skipped, repointed, dir)
  link(path.join(dir, '.wiki', 'agents'), path.join(toolsDir, 'agents'), made, skipped, repointed, dir)
  link(path.join(dir, '.git', 'hooks', 'pre-commit'), path.join(toolsDir, 'hooks', 'pre-commit'), made, skipped, repointed, dir)
  return { made, skipped, repointed }
}

// .wiki/wiki.json 的 version：读不出（无文件 / 写坏了 / 不是整数）→ null；写只改 version，其余字段原样。
// 与 vault-tools/lib/upgrade/upgrade.py 同口径
const WIKI_JSON = (dir: string) => path.join(dir, '.wiki', 'wiki.json')

export function readWikiVersion(dir: string): number | null {
  try {
    const v = JSON.parse(fs.readFileSync(WIKI_JSON(dir), 'utf8'))?.version
    return Number.isInteger(v) ? v : null
  } catch { return null }
}

export function setWikiVersion(dir: string, v: number): void {
  const data = JSON.parse(fs.readFileSync(WIKI_JSON(dir), 'utf8'))
  fs.writeFileSync(WIKI_JSON(dir), JSON.stringify({ ...data, version: v }, null, 2) + '\n', 'utf8')
}
