import { useMemo } from 'react'
import { ROOT_FOLDER, folderLabel } from '../../core/folder'
import { TreePicker, squeeze, type PickNode, type PickTree } from './TreePicker'

// 库内文件夹选择器（知识问答、MCP 服务两个弹窗共用），底座见 TreePicker。
// 根是「知识库」（值 '/'），五个区挂在它下面；每个文件夹都可选，值 = 节点 rel。

export type FolderNode = PickNode

export function buildFolderTree(folders: string[]): PickTree {
  const root: FolderNode = { rel: ROOT_FOLDER, name: folderLabel(ROOT_FOLDER), depth: 0, parent: null, children: [], root: true, value: ROOT_FOLDER }
  const byRel = new Map<string, FolderNode>([[ROOT_FOLDER, root]])
  const rels = [...new Set(folders)].filter((f) => f && f !== ROOT_FOLDER)
    .sort((a, b) => a.split('/').length - b.split('/').length)   // 稳定排序：同层保持 tree() 给的顺序
  for (const rel of rels) {
    const segs = rel.split('/')
    const parentRel = segs.length > 1 ? segs.slice(0, -1).join('/') : null
    const parent = (parentRel && byRel.get(parentRel)) || root
    // 父不在清单里（理论上不会）：挂到根下，名字用全路径免得看不出是谁
    const node: FolderNode = { rel, name: parent === root && segs.length > 1 ? rel : segs[segs.length - 1], depth: parent.depth + 1, parent: parent.rel, children: [], value: rel }
    byRel.set(rel, node)
    parent.children.push(node)
  }
  return { root, byRel, byValue: byRel }
}

export function crumbParts(value: string): string[] {
  if (value === ROOT_FOLDER) return [folderLabel(ROOT_FOLDER)]
  return squeeze(value.split('/').filter(Boolean))
}

const TEXT = {
  pick: '选一个文件夹…',
  search: '搜文件夹名；带 / 按路径搜，比如 建模/loss',
  searchLabel: '搜索文件夹',
  none: '库未打开，选不了文件夹',
  noHit: (q: string) => `没有名字里带「${q}」的文件夹`,
  missing: '已不在库里，重新选一个',
}

export function FolderPicker({ value, onChange, folders, disabled }: { value: string; onChange: (folder: string) => void; folders: string[]; disabled?: boolean }) {
  const tree = useMemo(() => buildFolderTree(folders), [folders])
  return (
    <TreePicker tree={tree} value={value} onChange={onChange} disabled={disabled} text={TEXT}
      // 树取不到（库未打开）时不判「已删」：此时什么都在不在树里都说明不了
      ready={folders.length > 0}
      parts={value ? crumbParts(value) : []} label={value ? folderLabel(value) : undefined} />
  )
}
