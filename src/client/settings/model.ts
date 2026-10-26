// Plugin-owned drafts and validation. The host adapter only supplies this small
// transport face; it has no dependency on the host's UI/form implementation.
export type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }
export interface SettingsFieldSpec { field: string; format(value: unknown): string; parse(text: string): FieldWrite | undefined }
export interface SettingsScope {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: unknown; writable: boolean; revision?: number }
  subscribe(listener: () => void): () => void
  mutate(ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>, revision?: number): Promise<boolean>
}
export interface FieldState { text: string; invalid: boolean }
export interface SettingsState {
  available: boolean; writable: boolean; dirty: boolean; invalid: boolean; saving: boolean; failed: boolean
  vaultDir: FieldState; larkApps: FieldState; mcpServers: FieldState
}

export class WikiSettingsModel {
  private scope: SettingsScope | null = null
  private unsubscribe = () => {}
  private listeners = new Set<() => void>()
  private drafts = new Map<string, string>()
  private revision: number | undefined
  private saving = false
  private pendingFields = new Set<string>()
  private failed = false
  private disposed = false
  private state: SettingsState

  constructor(private specs: SettingsFieldSpec[]) { this.state = this.read() }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  connect(scope: SettingsScope) {
    this.unsubscribe(); this.scope = scope
    this.unsubscribe = scope.subscribe(() => this.publish())
    this.publish()
    return () => { if (this.scope === scope) { this.unsubscribe(); this.scope = null; this.publish() } }
  }
  edit = (field: string, text: string) => {
    const spec = this.specs.find((s) => s.field === field)
    const snapshot = this.scope?.getSnapshot()
    if (!spec || !snapshot?.writable || snapshot.status !== 'ready') return
    if (!this.drafts.size) this.revision = snapshot.revision
    const stored = spec.format((snapshot.value as Record<string, unknown> | undefined)?.[field])
    // A pending write may replace the stored value. Reverting it is still a
    // new draft until that request settles, even if it matches today's store.
    if (text === stored && !this.pendingFields.has(field)) this.drafts.delete(field)
    else this.drafts.set(field, text)
    this.failed = false; this.publish()
  }
  discard = () => { this.drafts.clear(); this.failed = false; this.revision = undefined; this.publish() }
  save = async () => {
    if (!this.scope || !this.state.available || !this.state.writable || !this.state.dirty || this.state.invalid || this.saving) return
    const scope = this.scope, sent = new Map(this.drafts)
    const ops = [...sent].map(([field, text]) => {
      const write = this.specs.find((s) => s.field === field)!.parse(text)!
      return write.kind === 'clear' ? { op: 'unset' as const, path: [field] }
        : { op: 'set' as const, path: [field], value: write.value }
    })
    this.pendingFields = new Set(sent.keys())
    this.saving = true; this.failed = false; this.publish()
    try {
      const ok = await scope.mutate(ops, this.revision)
      if (ok) {
        for (const [field, text] of sent) if (this.drafts.get(field) === text) this.drafts.delete(field)
        this.revision = scope.getSnapshot().revision
      } else { this.failed = true; this.revision = scope.getSnapshot().revision }
    } catch { this.failed = true }
    finally { this.pendingFields.clear(); this.saving = false; this.publish() }
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.listeners.clear() }
  private read(): SettingsState {
    const s = this.scope?.getSnapshot()
    const value = (s?.value ?? {}) as Record<string, unknown>
    const fields = Object.fromEntries(this.specs.map((spec) => {
      const text = this.drafts.get(spec.field) ?? spec.format(value[spec.field])
      return [spec.field, { text, invalid: this.drafts.has(spec.field) && spec.parse(text) === undefined }]
    })) as Pick<SettingsState, 'vaultDir' | 'larkApps' | 'mcpServers'>
    return { ...fields, available: s?.status === 'ready', writable: !!s?.writable, dirty: this.drafts.size > 0,
      invalid: Object.values(fields).some((f) => f.invalid), saving: this.saving, failed: this.failed }
  }
  private publish() { if (this.disposed) return; this.state = this.read(); this.listeners.forEach((l) => l()) }
}

export const vaultDirField: SettingsFieldSpec = {
  field: 'vaultDir', format: (v) => typeof v === 'string' ? v : '',
  parse: (text) => text.trim() ? { kind: 'set', value: text.trim() } : { kind: 'clear' },
}
