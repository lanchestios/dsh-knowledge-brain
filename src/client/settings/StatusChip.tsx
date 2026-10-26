import { IconLoading } from '../../icon'
import { Tag } from '../ui'
import type { EntryStatus, Tone } from './entryStatus'

const TONE = { draft: 'quiet', loading: 'quiet', warn: 'warning', err: 'danger', off: 'quiet', ok: 'info' } as const satisfies Record<Tone, string>

export function StatusChip({ status }: { status: EntryStatus }) {
  return <Tag tone={TONE[status.tone]} data-slot="status-chip" data-tone={status.tone} data-loading={status.loading || undefined}
    className={`wk:gap-[5px] wk:border-0 wk:bg-transparent wk:p-0 wk:font-normal wk:leading-[1.4] ${status.tone === 'loading' ? 'wk:text-secondary-foreground' : ''}`}>
    {status.loading ? <IconLoading size={12} className="wk:shrink-0 wk:animate-spin wk:motion-reduce:[animation-duration:2.4s]" /> : <span aria-hidden="true" className="wk:size-[5px] wk:shrink-0 wk:rounded-full wk:bg-current" />}
    {status.text}
  </Tag>
}
