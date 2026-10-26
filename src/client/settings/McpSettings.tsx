import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Collapsible, CollapsibleTrigger, CollapsibleContent, Card } from '../ui'
import { IconMoreDown, IconDelete, IconIncrease, IconQuote, IconWrite } from '../../icon'
import { useEnv } from '../env'
import { flattenFolders } from './larkField'
import { FolderPicker } from '../components/FolderPicker'
import { folderLabel } from '../../core/folder'
import { StatusChip } from './StatusChip'
import { mcpEntryStatus } from './entryStatus'
import { endpointError, endpointUrl, genToken, maskToken, mcpParams, nameError, parseMcpDraft, serializeMcp, type McpRow } from './mcpField'
import s from './LarkSettings.styles'

// Tailwind recipes for this surface.
const m: Record<string, string> = {
  "url": "wk:text-[11px] wk:text-secondary-foreground wk:select-all wk:[word-break:break-all]",
  "confirm": "wk:flex wk:items-center wk:gap-2 wk:mt-2 wk:py-2 wk:px-[10px] wk:rounded-[var(--wk-radius-md)] wk:text-xs wk:text-[var(--wk-alias-state-warn-primary)] wk:bg-secondary wk:[&_>_span]:flex-1",
  "copied": "wk:mt-[6px] wk:mr-0 wk:mb-0 wk:ml-0 wk:text-xs wk:text-primary",
  "preview": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:py-2 wk:px-[10px] wk:rounded-[var(--wk-radius-md)] wk:bg-secondary wk:font-mono wk:text-[var(--dsh-code-font-size,_11px)] wk:whitespace-pre-wrap wk:[word-break:break-all]",
  "tokenRow": "wk:flex wk:flex-wrap wk:gap-[6px] wk:items-center wk:[&_code]:flex-1 wk:[&_code]:min-w-0 wk:[&_code]:text-[12px] wk:[&_code]:overflow-hidden wk:[&_code]:text-ellipsis",
  "hint": "wk:text-[11.5px] wk:text-muted-foreground",
  "bad": "wk:text-[11.5px] wk:text-destructive",
}

// MCP 服务区块：一条 = 一个文件夹的只读 MCP 端点（/mcp/<endpoint>），name 只是显示名称。做法照知识问答：
// 卡片是只读摘要，行尾「MCP参数」「编辑」「删除」；增改走 Modal，确定才写回 mcpServers，外壳自动保存。
// 地址前缀只认服务端给的 endpointBase（127.0.0.1 + 宿主端口）：页面 origin 在桌面端是 dsh-app://app，拼不出能连的地址。
// token 只在暂存表单与剪贴板里：卡片、预览一律掩码；mcpStatus 也不含 token。
type Editing = { index: number; orig: McpRow | null; draft: McpRow; show: boolean; regen: boolean } | null
type Status = { phase: 'none' | 'validating' | 'failed' | 'ok'; endpointBase: string | null; servers: { endpoint: string; name: string; folder: string; folderExists: boolean }[] } | null

export function McpSettings({ state, edit }: { state: any; edit: (field: string, text: string) => void }) {
  const { api } = useEnv()
  const [folders, setFolders] = useState<string[]>([])
  const [status, setStatus] = useState<Status>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [copied, setCopied] = useState<{ i: number; text: string } | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const rows: McpRow[] = useMemo(() => parseMcpDraft(state.mcpServers?.text ?? '') ?? [], [state.mcpServers?.text])

  // 挂载期调用整链兜底：服务抛 / 回非 thenable 都不能炸设置树（见 LarkSettings 的同款纪律）
  const refresh = () => {
    try { Promise.resolve(api.tree()).then((t: any) => setFolders(flattenFolders(t?.children)), () => {}) } catch { /* 没有树 */ }
    try { Promise.resolve(api.mcpStatus()).then(setStatus, () => setStatus(null)) } catch { setStatus(null) }
  }
  useEffect(() => { refresh(); return api.onChanged(refresh) }, [api])
  // 文本一变先查一次（多半还是「保存中」）；外壳保存落定（saving 翻回 false）再查一次——mcpServers 是 volatile，
  // 保存不重载插件、不触发 onChanged，不补这次新行会一直卡在「保存中」
  useEffect(() => { refresh() }, [state.mcpServers?.text, state.saving])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 8000)
    return () => clearTimeout(t)
  }, [copied])

  const editRows = (next: McpRow[]) => edit('mcpServers', next.length ? serializeMcp(next) : '')
  const base = typeof status?.endpointBase === 'string' && status.endpointBase ? status.endpointBase : null
  const urlOf = (r: McpRow) => (base && r.endpoint ? endpointUrl(base, r.endpoint) : null)

  const chip = (r: McpRow) => {
    if (!status) return null   // 状态取不到（RPC 失败 / 旧服务端）：不显示 chip，卡片照常
    // 一张卡一个状态：保存中 → 库阶段 → 文件夹 → 已连接（见 entryStatus）
    return <StatusChip status={mcpEntryStatus(status.phase, status.servers.find((x) => x.endpoint === r.endpoint && x.folder === r.folder))} />
  }

  const doCopy = (i: number) => {
    const r = rows[i]
    const url = urlOf(r)
    if (!url || !r.token) return
    const text = mcpParams(url, r)
    try { void navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用：静默 */ }) } catch { /* 同上 */ }
    setCopied({ i, text: text.split(r.token).join(maskToken(r.token)) })
    setConfirmDel(null)
  }

  const openAdd = () => {
    setEditing({ index: -1, orig: null, draft: { endpoint: '', name: '', folder: '', token: genToken() }, show: false, regen: false })
    setConfirmDel(null)
  }
  const openEdit = (i: number) => { setEditing({ index: i, orig: { ...rows[i] }, draft: { ...rows[i] }, show: false, regen: false }); setConfirmDel(null) }
  const patch = (p: Partial<McpRow>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e))
  const epErr = editing ? endpointError(editing.draft.endpoint, rows, editing.index) : ''
  const nmErr = editing ? nameError(editing.draft.name) : ''
  const canCommit = !!editing && !epErr && !nmErr && !!editing.draft.folder
  const commit = () => {
    if (!editing || !canCommit) return
    const d = { ...editing.draft, endpoint: editing.draft.endpoint.trim(), name: editing.draft.name.trim() }
    editRows(editing.index < 0 ? [...rows, d] : rows.map((x, j) => (j === editing.index ? d : x)))
    setEditing(null); setCopied(null)
  }

  const guide = (
    <div data-wiki-ui="" className={s.guideBox}>
      <p>每条对应一个文件夹。外部客户端（Claude Code、Cursor、别的 DSH）连上后，只能搜索、读取这个文件夹里的页面和页面里引用的图片，不能写入，也看不到文件夹外的内容。</p>
      <ol>
        <li>点「新增」，填端点和名称，选一个文件夹。token 会自动生成。</li>
        <li>在卡片上点「MCP参数」，复制一份通用 MCP 配置，贴进客户端（Claude Code 的 .mcp.json、Cursor 的 mcp.json 等）。</li>
        <li>DSH 开着时才能用。token 等同密码，别外传。</li>
      </ol>
    </div>
  )

  return (
    <div data-wiki-ui="" className={s.block}>
      <div data-wiki-ui="" className={s.headRow}>
        <h3 data-wiki-ui="" className={s.title}>MCP 服务</h3>
        <Button size="sm" type="button" className={s.addBtn} disabled={!state.writable || !folders.length} onClick={openAdd}><IconIncrease size={14} />新增</Button>
      </div>
      {rows.length ? (
        <>
          <div data-wiki-ui="" className={s.cards}>
            {rows.map((r, i) => {
              const url = urlOf(r)
              return (
                <Card key={i} data-slot="connection-card" className={s.botCard}>
                  <div data-wiki-ui="" data-slot="connection-header" className={s.botHead}>
                    <span data-wiki-ui="" data-slot="connection-name" className={s.botName}>{r.name || r.endpoint || '未命名'}</span>
                    {r.name && r.endpoint && <code data-wiki-ui="" data-slot="connection-id" className={s.botId}>{r.endpoint}</code>}
                    {chip(r)}
                    <span data-wiki-ui="" data-slot="connection-actions" className={s.cardActions}>
                      <Button size="sm" type="button" data-act="params" className={s.actBtn} disabled={!url || !r.token}
                        title={base ? undefined : 'DSH 还没给出端点地址'} onClick={() => doCopy(i)}><IconQuote size={14} />MCP参数</Button>
                      <Button size="sm" type="button" data-act="edit" className={s.actBtn} disabled={!state.writable} onClick={() => openEdit(i)}><IconWrite size={14} />编辑</Button>
                      <Button size="sm" type="button" data-act="delete" className={s.actBtn} disabled={!state.writable} onClick={() => setConfirmDel(i)}><IconDelete size={14} />删除</Button>
                    </span>
                  </div>
                  <div data-wiki-ui="" data-slot="connection-meta" className={s.botMeta}>
                    <span>{r.folder ? folderLabel(r.folder) : '未选文件夹'}</span>
                    {url && <code data-wiki-ui="" data-slot="endpoint-url" className={m.url}>{url}</code>}
                  </div>
                  {confirmDel === i && (
                    <div data-wiki-ui="" className={m.confirm}>
                      <span>删除后，用这个地址和 token 连过来的客户端会立刻失效。</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDel(null)}>取消</Button>
                      <Button variant="default" size="sm" onClick={() => { editRows(rows.filter((_, j) => j !== i)); setConfirmDel(null); setCopied(null) }}>确认删除</Button>
                    </div>
                  )}
                  {copied?.i === i && (
                    <>
                      <p data-wiki-ui="" className={m.copied}>✓ 已复制MCP参数</p>
                      <pre data-wiki-ui="" data-slot="mcp-preview" className={m.preview}>{copied.text}</pre>
                    </>
                  )}
                </Card>
              )
            })}
          </div>
          <Collapsible open={guideOpen} onOpenChange={setGuideOpen} className={s.guideEntry}>
            <CollapsibleTrigger asChild><Button size="sm" className="wk:self-start" data-slot="guide-trigger" aria-label="配置引导"><IconMoreDown size={12} className={guideOpen ? undefined : "wk:-rotate-90"} />配置引导</Button></CollapsibleTrigger>
            <CollapsibleContent>{guide}</CollapsibleContent>
          </Collapsible>
        </>
      ) : guide}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.index < 0 ? '新增 MCP 服务' : '编辑 MCP 服务'} closeLabel="取消"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
              <Button variant="default" size="sm" disabled={!canCommit} onClick={commit}>确定</Button>
            </>
          }>
          <div data-wiki-ui="" className={s.form}>
            <label data-wiki-ui="" className={s.mField}>
              <span>端点</span>
              <Input autoFocus value={editing.draft.endpoint} placeholder="比如 ml-notes" onChange={(e: any) => patch({ endpoint: e.target.value })} />
              {editing.draft.endpoint && epErr && <span data-wiki-ui="" className={m.bad}>{epErr}</span>}
            </label>
            <label data-wiki-ui="" className={s.mField}>
              <span>名称</span>
              <Input value={editing.draft.name} placeholder="比如 机器学习笔记" onChange={(e: any) => patch({ name: e.target.value })} />
              {editing.draft.name && nmErr && <span data-wiki-ui="" className={m.bad}>{nmErr}</span>}
            </label>
            <div data-wiki-ui="" className={s.mField}>
              <span>文件夹</span>
              <FolderPicker value={editing.draft.folder} folders={folders} onChange={(folder) => patch({ folder })} />
            </div>
            <div data-wiki-ui="" className={s.mField}>
              <span>Token</span>
              <div data-wiki-ui="" className={m.tokenRow}>
                <code>{editing.show ? editing.draft.token : maskToken(editing.draft.token)}</code>
                <Button variant="ghost" size="sm" onClick={() => setEditing((e) => (e ? { ...e, show: !e.show } : e))}>{editing.show ? '隐藏' : '显示'}</Button>
                <Button variant="ghost" size="sm" onClick={() => { try { void navigator.clipboard?.writeText(editing.draft.token).catch(() => {}) } catch { /* 静默 */ } }}>复制</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing((e) => (e ? { ...e, draft: { ...e.draft, token: genToken() }, regen: true } : e))}>重新生成</Button>
              </div>
              <span data-wiki-ui="" className={m.hint}>自动生成，客户端连接时放在 Authorization 头里</span>
            </div>
            {editing.orig && editing.regen && <div data-wiki-ui="" className={m.confirm}><span>token 换了，确定后，用旧 token 的客户端会连不上，要重新复制 MCP参数。</span></div>}
            {editing.orig && editing.orig.endpoint !== editing.draft.endpoint.trim() && !epErr && <div data-wiki-ui="" className={m.confirm}><span>改端点会改地址，已经配好的客户端要重新复制 MCP参数。</span></div>}
          </div>
        </Modal>
      )}
    </div>
  )
}
