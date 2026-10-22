// 宿主 primitives 的最小替身：组件挂载测试只关心 LarkSettings 自身（挂载期 effect 会不会炸树），
// primitives 的内部实现与本测无关——替掉它，顺带绕开它一串装不进本仓的传递依赖
// （simple-icons / clsx / dsh-util-*）。只补被用到的导出。
import { createElement as h } from 'react'

export const Button = (p) => h('button', { type: p.type ?? 'button', disabled: p.disabled, onClick: p.onClick, title: p.title, 'aria-label': p['aria-label'], 'aria-pressed': p['aria-pressed'] }, p.icon, p.children)
export const Input = (p) => h('input', {
  type: p.type ?? 'text', value: p.value, disabled: p.disabled, autoFocus: p.autoFocus,
  placeholder: p.placeholder, onChange: p.onChange,
})
export const Modal = (p) => h('div', { role: 'dialog', 'aria-label': p.title }, p.children, p.footer)
export const Tag = (p) => h('span', null, p.children)
export const Tooltip = (p) => h('span', null, p.children)
const glyph = (name) => (p) => h('span', { 'data-icon': name }, p.children)
export const IconPlusOutlineRegular = glyph('plus')
export const IconEditOutlineRegular = glyph('edit')
export const IconEnhanceOutlineRegular = glyph('enhance')
export const IconCheckCircleOutlineRegular = glyph('checkCircle')
export const IconTrashOutlineRegular = glyph('trash')
export const IconFlatListOutlineRegular = glyph('flatList')
export const IconMicrophoneOutlineRegular = glyph('microphone')
// reader-tabs 挂整棵 ReaderPage（TopBar / 面包屑 / 各列表页）后补的 icon 面
export const IconBranchOutlineRegular = glyph('branch')
export const IconBrowseOutlineRegular = glyph('browse')
export const IconCheckOutlineRegular = glyph('check')
export const IconChevronLeftOutlineRegular = glyph('chevronLeft')
export const IconChevronRightOutlineRegular = glyph('chevronRight')
export const IconChevronsUpDownOutlineRegular = glyph('chevronsUpDown')
export const IconClockOutlineRegular = glyph('clock')
export const IconCloseFillRegular = glyph('closeFill')
export const IconCloseOutlineRegular = glyph('close')
export const IconContextInjectionOutlineRegular = glyph('contextInjection')
export const IconFolderCloseRegular = glyph('folderClose')
export const IconPanelLeftOutlineRegular = glyph('panelLeft')
export const IconSearchOutlineRegular = glyph('search')
export const IconWorkspaceTreeOutlineRegular = glyph('workspaceTree')
export const PathLabel = (p) => h('span', { 'data-path': p.path }, p.path)
// tab 条 / 链接右键菜单用的 Menu：只渲染行为面（open 时列出 role=menuitem 行，点行回调 onSelect(id)、
// disabled 行不可点，Escape 关）。真 Menu 的定位、门户、键盘漫游不在单测范围，桌面端真机看
export const Menu = (p) => {
  if (!p.open) return h('span', null, p.anchor)
  const rows = (p.items ?? []).filter((x) => !x.type).map((x) => h('button', {
    key: x.id, role: 'menuitem', disabled: !!x.disabled, 'aria-disabled': x.disabled ? 'true' : undefined,
    onClick: () => { if (!x.disabled) p.onSelect?.(x.id) },
  }, x.label))
  return h('span', null, p.anchor, h('div', { role: 'menu', onKeyDown: (e) => { if (e.key === 'Escape') p.onClose() } }, rows))
}
// 顶栏右栏入口（属性 / 智能体）与会话栏头（子智能体胶囊）
export const IconInfoOutlineRegular = glyph('info')
export const IconAgentPresetOutlineRegular = glyph('agentPreset')
export const IconChevronDownOutlineRegular = glyph('chevronDown')
export const StateDot = (p) => h('span', { 'data-state': p.state })
// FolderPicker 的浮层定位：单测不量布局，开着就给个固定坐标，未开为 null（同真 hook 的「首测前 null」）
export const useAnchoredPosition = (o) => (o.open ? { left: 0, top: 0 } : null)
