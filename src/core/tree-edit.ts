import fs from 'node:fs'
import path from 'node:path'
import { resolveName } from './vault/graph'
import type { Model } from './model'

// 目录拖动的 Host 侧：节点与目标文件夹的白名单（沉淀五区之内，区根不算节点），跨文件夹确认框的影响面。
// 落盘在 actions.ts（走 wiki CLI）

const segs = (rel: string) => rel.split('/')
function plain(m: Model, rel: string): string[] {
  const s = segs(rel)
  if (!rel || s.some((x) => !x || x === '.' || x === '..' || x.startsWith('.'))) throw new Error(`路径不对：${rel}`)
  if (!(m.g.areas as string[]).includes(s[0])) throw new Error(`不在知识沉淀里：${rel}`)
  return s
}
const isDir = (m: Model, rel: string) => !!fs.statSync(path.join(m.dir, rel), { throwIfNoEntry: false })?.isDirectory()

/** 可拖的节点：区里的页（区自己的页不算）或区以下的文件夹 */
export function nodeRel(m: Model, rel: string): string {
  const s = plain(m, rel)
  if (rel.endsWith('.md')) {
    if (!m.byId.has(rel)) throw new Error(`库里没有这页：${rel}`)
    if (s.length === 2 && s[1] === `${s[0]}.md`) throw new Error(`区页不能拖：${rel}`)
    return rel
  }
  if (s.length < 2 || !isDir(m, rel)) throw new Error(`不是可拖的文件夹：${rel}`)
  return rel
}

/** 放得进去的文件夹：区根或区以下的文件夹 */
export function folderRel(m: Model, rel: string): string {
  plain(m, rel)
  if (rel.endsWith('.md') || !isDir(m, rel)) throw new Error(`不是文件夹：${rel}`)
  return rel
}

/** 被移节点（及其子孙）之外，有几页的双链指进它——移动后这些页的链接会被改写 */
export function moveImpact(m: Model, rel: string): { pages: number } {
  const inside = (id: string) => id === rel || id.startsWith(rel + '/')
  let pages = 0
  for (const [id, links] of m.g.linksOf as Map<string, { target: string }[]>) {
    if (inside(id)) continue
    if (links.some((l) => { const d = resolveName(m.g, l.target); return !!d && inside(d._id) })) pages++
  }
  return { pages }
}
