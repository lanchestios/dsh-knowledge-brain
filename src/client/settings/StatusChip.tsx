import { IconLoading } from '../../icon'
import type { EntryStatus, Tone } from './entryStatus'
import s from './LarkSettings.module.css'

// 两张设置卡共用的状态 chip：颜色即状态；加载态用转圈图标替掉小圆点
const TONE: Record<Tone, string> = { draft: s.chipDraft, loading: s.chipLoadingTone, warn: s.chipWarn, err: s.chipErr, off: s.chipOff, ok: s.chipOk }

export function StatusChip({ status }: { status: EntryStatus }) {
  const cls = status.loading ? `${TONE[status.tone]} ${s.chipLoading}` : TONE[status.tone]
  return <span className={cls}>{status.loading && <IconLoading size={12} className={s.spin} />}{status.text}</span>
}
