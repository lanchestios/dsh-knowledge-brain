import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconComment, IconDelete, IconIncrease, IconSuccessOutline, IconWrite } from '../../icon'
import { useEnv } from '../env'
import { flattenFolders, parseAppsDraft, rowValid, serializeApps, type AppRow } from './larkField'
import { ModelSelect } from './ModelSelect'
import { FolderPicker } from '../components/FolderPicker'
import { folderLabel } from '../../core/folder'
import { StatusChip } from './StatusChip'
import { larkEntryStatus } from './entryStatus'
import s from './LarkSettings.module.css'

// 知识问答区块（Lark 机器人）：机器人是只读摘要行（卡头名字/app_id + 连接状态，卡身文件夹 · 模型），
// 行尾四个动作——会话（跳知识库面板的会话记录整页，见 components/LarkSessionsView）、编辑（铅笔，
// 开 Modal）、检测（用行里的凭证当场验）、删除；标题行右侧「+ 新增」开同一个 Modal 加机器人。
// 确定才写回 larkApps，外壳改完自动保存。说明行已删：零机器人时引导直接顶在标题下（即空态）。
type Editing = { index: number; draft: AppRow } | null   // index < 0 = 加新的
// 检测出的权限缺项（scope 空 = 授权状态没查到的提示行）；按级别加前缀说清影响
type ScopeGap = { scope: string; label: string; level: 'required' | 'group' | 'optional' }
const SCOPE_TAG: Record<ScopeGap['level'], string> = { required: '必需 · ', group: '群聊 · ', optional: '可选 · ' }

export function LarkSettings({ state, edit }: { state: any; edit: (field: string, text: string) => void }) {
  const { api, openLarkSessions } = useEnv()
  const [folders, setFolders] = useState<string[]>([])
  const [status, setStatus] = useState<any>(null)
  const [editing, setEditing] = useState<Editing>(null)
  // 卡上「检测」的状态：按 app_id 记结果（行删了/换了就不认）；检测中只锁当前那行
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [rowVerify, setRowVerify] = useState<Record<string, { ok: boolean; text: string; scopes?: ScopeGap[] }>>({})
  // 行编辑器吃草稿宽容解析：打到一半的非法行也要显示（保存关口才是严格校验）
  const rows: AppRow[] = useMemo(() => parseAppsDraft(state.larkApps?.text ?? '') ?? [], [state.larkApps?.text])
  // 折叠开关只服务已有机器人的场景；零机器人时引导不走开关、直接顶在标题下（见 return）
  const [guideOpen, setGuideOpen] = useState(false)

  const appsText = state.larkApps?.text ?? ''
  const refresh = () => {
    api.tree().then((t) => setFolders(flattenFolders(t.children))).catch(() => {})
    api.larkStatus().then(setStatus).catch(() => setStatus(null))
  }
  useEffect(() => { refresh(); return api.onChanged(refresh) }, [api])
  // 同 MCP 卡：larkApps 是 volatile，保存不重载插件、不触发 onChanged；文本一变、保存落定各查一次，
  // 不然新行一直卡在「保存中…」
  useEffect(() => { refresh() }, [state.larkApps?.text, state.saving])
  // 草稿一动旧检测结果全失效（保存重新序列化后文本不变，结果能留到保存之后）
  useEffect(() => { setRowVerify({}) }, [appsText])

  const editRows = (next: AppRow[]) => edit('larkApps', next.length ? serializeApps(next) : '')

  const openAdd = () => setEditing({ index: -1, draft: { appId: '', appSecret: '', folder: '', model: '' } })
  const openEdit = (i: number) => setEditing({ index: i, draft: { ...rows[i] } })
  const patchDraft = (p: Partial<AppRow>) => setEditing((e) => e ? { ...e, draft: { ...e.draft, ...p } } : e)
  const commit = () => {
    if (!editing || !rowValid(editing.draft)) return
    editRows(editing.index < 0 ? [...rows, editing.draft] : rows.map((x, j) => j === editing.index ? editing.draft : x))
    setEditing(null)
  }

  // 行上的「检测」用行里现成的凭证（不用进 Modal）：取不到结果时错误原文也落在行下。
  // 凭证有效且已保存、当前没连着 → 顺手补连一次（启动那下连失败的机器人不会自己重试），连接结果并进同一行
  const verifyRow = async (i: number) => {
    const r = rows[i]
    if (!r?.appId.trim() || !r.appSecret.trim() || verifyingId) return
    const id = r.appId.trim()
    setVerifyingId(id)
    let scopes: ScopeGap[] | undefined
    const put = (ok: boolean, text: string) => setRowVerify((m) => ({ ...m, [id]: { ok, text, ...(scopes ? { scopes } : {}) } }))
    try {
      const v = await api.larkVerify(id, r.appSecret.trim())
      // 权限缺项与补连结果并列：先记下，后面每个分支的 put 都带上
      scopes = v.missing?.length ? v.missing : v.scopeError ? [{ scope: '', label: `权限授权状态未查到：${v.scopeError}`, level: 'optional' }] : undefined
      if (!v.ok) { put(false, v.detail ?? '检测失败'); return }
      const head = `凭证有效 · 机器人「${v.botName ?? ''}」`
      if (!savedState(id) || savedState(id)?.connected) { put(true, head); return }
      const c = await api.larkReconnect(id)
      if (!c.saved) put(true, `${head} · 尚未保存，保存后自动连接`)
      else if (c.connected) put(true, c.already ? head : `${head} · 已重新连接`)
      else put(false, `${head} · 重连失败：${c.detail ?? '未知原因'}`)
    } catch (e) {
      put(false, e instanceof Error ? e.message : String(e))
    } finally { setVerifyingId(null); refresh() }
  }

  // 摘要卡状态：草稿里能对上已存配置才有连接状态，对不上（新行/改了 id）标「未保存」
  const savedState = (appId: string) => (appId && status?.apps ? status.apps.find((a: any) => a.appId === appId) : undefined)

  // 配置引导八步：零机器人时直接顶在标题下当空态；有机器人时折进「配置引导」开关里
  const guide = (
    <div className={s.guideBox}>
      <ol>
        <li>打开 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">Lark 开放平台</a></li>
        <li>创建<b>企业自建应用</b>，获取 <b>app_id、app_secret</b></li>
        <li>应用能力 → 添加「<b>机器人</b>」</li>
        <li>事件与回调 → 订阅方式选「<b>使用长连接接收事件</b>」，再添加事件「<b>接收消息</b>（im.message.receive_v1）」</li>
        <li>事件与回调 → <b>卡片回传交互</b>选「长连接接收」（AI 追问的选择卡片靠它回传点按）</li>
        <li>权限管理 → 开通 <code>im:message:send_as_bot</code> 与上传图片 <code>im:resource</code>；要群里新开话题不 @ 也自动答，再开「获取群组中所有消息」<code>im:message.group_msg</code>（敏感权限，需管理员审批）</li>
        <li>创建版本并<b>发布</b></li>
        <li>打开插件配置点击右上角「新增」把相关信息填入</li>
      </ol>
    </div>
  )

  return (
    <div className={s.block}>
      <div className={s.headRow}>
        <h3 className={s.title}>知识问答</h3>
        <button type="button" className={s.addBtn} disabled={!state.writable || !folders.length} onClick={openAdd}><IconIncrease size={14} />新增</button>
      </div>
      {rows.length ? (
        <>
          <div className={s.cards}>
            {rows.map((r, i) => {
              const id = r.appId.trim()
              const st = savedState(id)
              const v = rowVerify[id]
              return (
                <div key={i} className={s.botCard}>
                  <div className={s.botHead}>
                    {st?.name
                      ? <><span className={s.botName}>{st.name}</span><code className={s.botId}>{id}</code></>
                      : <code className={s.botId}>{id || '新机器人'}</code>}
                    {/* 一张卡一个状态：保存中 → 库阶段 → 文件夹 → 连接（见 entryStatus）；状态取不到不显示 */}
                    {status && id && <StatusChip status={larkEntryStatus(status.phase, st)} />}
                    <span className={s.cardActions}>
                      <button type="button" className={s.actBtn} disabled={!id} onClick={() => openLarkSessions?.(id)}><IconComment size={14} />会话</button>
                      <button type="button" className={s.actBtn} disabled={!state.writable} onClick={() => openEdit(i)}><IconWrite size={14} />编辑</button>
                      <button type="button" className={s.actBtn} disabled={!state.writable || !id || !r.appSecret.trim() || verifyingId === id} onClick={() => void verifyRow(i)}><IconSuccessOutline size={14} />{verifyingId === id ? '检测中…' : '检测'}</button>
                      <button type="button" className={s.actBtn} disabled={!state.writable} onClick={() => editRows(rows.filter((_, j) => j !== i))}><IconDelete size={14} />删除</button>
                    </span>
                  </div>
                  <div className={s.botMeta}>
                    <span>{r.folder ? folderLabel(r.folder) : '未选文件夹'}</span>
                    {r.model && <code className={s.botModel}>{r.model}</code>}
                  </div>
                  {v && <p className={v.ok ? s.verifyOk : s.verifyErr}>{v.ok ? '✓ ' : '✗ '}{v.text}</p>}
                  {v?.scopes && (
                    <ul className={s.scopeList}>
                      {v.scopes.map((g) => (
                        <li key={g.scope || g.label} className={g.level === 'required' ? s.scopeErr : s.scopeWarn}>
                          {g.scope ? <>{SCOPE_TAG[g.level]}缺权限：{g.label} <code>{g.scope}</code></> : g.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          <div className={s.guideEntry}>
            <button type="button" className={s.guideToggle} onClick={() => setGuideOpen(!guideOpen)}>{guideOpen ? '▾' : '▸'} 配置引导</button>
            {guideOpen && guide}
          </div>
        </>
      ) : guide}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.index < 0 ? '加机器人' : '编辑机器人'} closeLabel="取消"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" size="sm" disabled={!rowValid(editing.draft)} onClick={commit}>确定</Button>
            </>
          }>
          <div className={s.form}>
            <label className={s.mField}>
              <span>app_id</span>
              <Input autoFocus value={editing.draft.appId} placeholder="cli_…" disabled={!state.writable} onChange={(e) => patchDraft({ appId: e.target.value })} />
            </label>
            <label className={s.mField}>
              <span>app_secret</span>
              <Input type="password" value={editing.draft.appSecret} placeholder="Lark 后台的密钥" disabled={!state.writable} onChange={(e) => patchDraft({ appSecret: e.target.value })} />
            </label>
            <div className={s.mField}>
              <span>文件夹</span>
              <FolderPicker value={editing.draft.folder} folders={folders} disabled={!state.writable} onChange={(folder) => patchDraft({ folder })} />
            </div>
            <label className={s.mField}>
              <span>模型</span>
              <ModelSelect value={editing.draft.model} onChange={(model) => patchDraft({ model })} disabled={!state.writable} emptyLabel="默认" />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
