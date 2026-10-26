import browse from './browse.svg?raw'
import archive from './archive.svg?raw'
import chevrons_up_down from './chevrons-up-down.svg?raw'
import branch from './branch.svg?raw'
import workspace_tree from './workspace-tree.svg?raw'
import { useId } from 'react'
import menu from './menu.svg?raw'
import aiAssistant from './ai-assistant.svg?raw'
import write from './write.svg?raw'
import eye from './eye.svg?raw'
import checkMark from './check-mark.svg?raw'
import moreRight from './more-right.svg?raw'
import moreLeft from './more-left.svg?raw'
import moreDown from './more-down.svg?raw'
import search from './search.svg?raw'
import close from './close.svg?raw'
import history from './history.svg?raw'
import increase from './increase.svg?raw'
import quote from './quote.svg?raw'
import successOutline from './success-outline.svg?raw'
import del from './delete.svg?raw'
import comment from './comment.svg?raw'
import folder from './folder.svg?raw'
import loading from './loading.svg?raw'

// 插件自带图标（src/icon 一处放全部：React 组件在这，编辑器原生 DOM 的表格浮栏 / 全屏查看直接 ?raw 读同目录 svg）。
// SVG 源码拷自 @univerjs/icons 1.43.2（MIT，DreamNum Co., Ltd.），每个一份文件，构建期按字符串读入；
// 不引 Univer 包，也没有运行时资源请求。接口照 primitives 的 Icon*Regular（size / className），换引用只改名字。
// 渲染成真 <svg>（不包 span），父级按 svg 写的样式照旧生效；data-icon 给测试认图标用。
// 多色图标（ai-assistant）带渐变 id：同页多份会撞 id，前一份藏起来后一份就丢色——按实例用 useId 改写
type Props = { size?: number; className?: string }

function parse(src: string) {
  const m = src.match(/<svg([^>]*)>([\s\S]*)<\/svg>/)
  if (!m) throw new Error('icon: not an svg')
  const viewBox = m[1].match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 16 16'
  // 标签间的换行缩进去掉：留着会变成文本节点，混进按钮 textContent
  const body = m[2].replace(/>\s+</g, '><').trim()
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1])
  return { viewBox, body, ids }
}

function make(name: string, src: string) {
  const { viewBox, body, ids } = parse(src)
  const Icon = ({ size = 16, className }: Props) => {
    // useId 带冒号，url(#…) 里不认，去掉
    const uid = useId().replace(/:/g, '')
    const html = ids.length ? ids.reduce((s, id) => s.replaceAll(`id="${id}"`, `id="${id}-${uid}"`).replaceAll(`url(#${id})`, `url(#${id}-${uid})`), body) : body
    return <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden="true" className={className} data-icon={name} dangerouslySetInnerHTML={{ __html: html }} />
  }
  Icon.displayName = `Icon(${name})`
  return Icon
}

export const IconMenu = make('menu', menu)
export const IconAiAssistant = make('ai-assistant', aiAssistant)
export const IconWrite = make('write', write)
export const IconEye = make('eye', eye)
export const IconCheckMark = make('check-mark', checkMark)
export const IconMoreRight = make('more-right', moreRight)
export const IconMoreLeft = make('more-left', moreLeft)
export const IconMoreDown = make('more-down', moreDown)
export const IconSearch = make('search', search)
export const IconClose = make('close', close)
export const IconHistory = make('history', history)
export const IconIncrease = make('increase', increase)
export const IconQuote = make('quote', quote)
export const IconSuccessOutline = make('success-outline', successOutline)
export const IconDelete = make('delete', del)
export const IconComment = make('comment', comment)
export const IconFolder = make('folder', folder)
export const IconLoading = make('loading', loading)

export const IconWorkspaceTree = make('workspace-tree', workspace_tree)

export const IconBranch = make('branch', branch)

export const IconChevronsUpDown = make('chevrons-up-down', chevrons_up_down)

export const IconArchive = make('archive', archive)

export const IconBrowse = make('browse', browse)
