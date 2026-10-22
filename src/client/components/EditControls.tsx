import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconEye, IconWrite } from '../../icon'
import { useEdit, type SaveStatus } from '../lib/edit'
import s from './EditControls.module.css'

// 只报要你动手的两种：保存中 / 未保存是自动保存的过程态，每次停笔都闪一轮，在顶栏里占位挤动按钮（切换编辑/查看时 header 抖）
const LABEL: Partial<Record<SaveStatus, string>> = { conflict: '已在别处修改', error: '保存失败' }

// 顶栏右簇里的编辑入口（图谱左侧，icon+文字同图谱）：沉淀页与 md 文档两处共用。
// 编辑/查看是一对模式开关——保存是自动的，点「查看」只是切回阅读（退出时兜底补一次落盘），
// 不是「确认保存」；保存状态只报冲突 / 失败，冲突时另给重新载入 / 覆盖
export function EditControls({ path }: { path: string }) {
  const { store, path: editing, status } = useEdit()
  if (!store) return null
  if (editing !== path) return (
    <Button variant="ghost" size="sm" icon={<IconWrite size={16} />} onClick={() => store.start(path)} title="编辑" aria-label="编辑" data-collapse="act"><span data-label>编辑</span></Button>
  )
  return (
    <>
      {LABEL[status] && <span className={s.statusBad}>{LABEL[status]}</span>}
      {status === 'conflict' && <>
        <Button variant="ghost" size="sm" onClick={() => store.handle?.reload()}>重新载入</Button>
        <Button variant="ghost" size="sm" onClick={() => store.handle?.overwrite()}>覆盖</Button>
      </>}
      <Button variant="ghost" size="sm" icon={<IconEye size={16} />} onClick={() => store.stop()} title="查看" aria-label="查看" data-collapse="act"><span data-label>查看</span></Button>
    </>
  )
}
