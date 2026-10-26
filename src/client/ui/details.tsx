export function PathLabel({ path }: { path: string }) {
  return <span title={path} style={{ overflowWrap: 'anywhere' }}>{path}</span>
}

export function StateDot({ state }: { state: 'idle' | 'ongoing' | 'error' | 'success' }) {
  return <span data-wiki-ui="" data-state={state} role="img" aria-label={state === 'ongoing' ? '运行中' : state === 'error' ? '出错' : state === 'success' ? '已完成' : '空闲'}
    className="wk:inline-block wk:size-1.5 wk:shrink-0 wk:rounded-full" style={{ background: state === 'ongoing' ? 'var(--wk-primary)' : state === 'error' ? 'var(--wk-destructive)' : state === 'success' ? 'var(--wk-success)' : 'var(--wk-muted-foreground)' }} />
}
