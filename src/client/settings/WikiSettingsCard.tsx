import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal, PathLabel, RadioGroup, RadioGroupItem, Alert, BreadcrumbTrail } from '../ui'
import { IconFolder, IconLoading } from '../../icon'
import { useEnv } from '../env'
import { LarkSettings } from './LarkSettings'
import { McpSettings } from './McpSettings'
import type { DirListing, WikiApi } from '../api'
import type { VaultStatus } from '../../core/api'
import type { InitPlan, InitReport } from '../../core/vault/create'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "field": "wk-settings-wikisettingscard-field wk:flex wk:flex-col wk:gap-[6px] wk:py-3 wk:px-0 wk:[&_+_.wk-settings-wikisettingscard-field]:[border-top:0.5px_solid_var(--wk-alias-border-l2)]",
  "head": "wk:flex wk:items-center wk:gap-2",
  "labelGroup": "wk:flex wk:items-center wk:gap-1 wk:flex-1 wk:min-w-0",
  "label": "wk:[flex:0_1_auto] wk:text-[13px] wk:font-medium wk:leading-normal wk:text-foreground",
  "autoForm": "wk:flex wk:flex-col",
  "placeholder": "wk:text-[var(--wk-alias-label-dimmed)]",
  "hint": "wk:m-0 wk:text-xs wk:leading-normal wk:text-muted-foreground",
  "hintLoading": "wk:flex wk:items-center wk:gap-[6px] wk:text-secondary-foreground",
  "spin": "wk:flex-none wk:[animation:wk-settings-wikisettingscard-wkDirSpin_1s_linear_infinite] wk:motion-reduce:[animation-duration:2.4s]",
  "invalid": "wk:m-0 wk:text-xs wk:leading-normal wk:text-destructive",
  "pickBar": "wk:flex wk:items-center wk:gap-2 wk:mb-2",
  "pickList": "wk:flex wk:flex-col wk:gap-[2px] wk:max-h-80 wk:overflow-auto",
  "pickRow": "wk:flex wk:items-center wk:gap-2 wk:h-[30px] wk:py-0 wk:px-2 wk:border-0 wk:rounded-[var(--wk-radius-md)] wk:bg-transparent wk:text-foreground wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:cursor-pointer wk:text-left wk:[&:hover]:bg-accent",
  "pickName": "wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "pickDim": "wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap wk:text-muted-foreground",
  "newRow": "wk:flex wk:items-center wk:gap-2 wk:mb-2 wk:text-secondary-foreground",
  "newName": "wk:flex-1 wk:min-w-0",
  "dirRow": "wk:flex wk:items-center wk:gap-2",
  "dirPath": "wk:flex-1 wk:min-w-0 wk:flex wk:items-center wk:h-[34px] wk:py-0 wk:px-3 wk:[border:0.5px_solid_var(--wk-alias-border-l4)] wk:rounded-[var(--wk-radius-md)] wk:bg-[var(--wk-alias-bg-layer-3)] wk:text-[13px] wk:overflow-hidden wk:whitespace-nowrap",
  "failList": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:pl-5 wk:text-xs wk:leading-[1.7] wk:text-destructive",
  "moveList": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:pl-5 wk:text-xs wk:leading-[1.7]",
  "copyBox": "wk:mt-2 wk:py-2 wk:px-[10px] wk:[border:0.5px_dashed_var(--wk-alias-border-l4)] wk:rounded-[var(--wk-radius-md)] wk:bg-[var(--wk-alias-bg-layer-3)]",
  "copyBar": "wk:flex wk:items-center wk:justify-between wk:text-xs wk:font-medium wk:text-secondary-foreground",
  "copyText": "wk:mt-1 wk:mr-0 wk:mb-0 wk:ml-0 wk:text-xs wk:leading-[1.7] wk:text-foreground wk:[word-break:break-all]",
  "result": "wk:m-0 wk:text-[13px] wk:leading-[1.9]",
}

// 插件设置的自动保存状态与恢复提示。
const formText = {
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  saveFailed: '自动保存没有成功，修改都还在，请重试保存。',
  saving: '自动保存中…',
}

export interface WikiSettingsProps {
  view?: 'summary' | 'page'
  wikiForm: { subscribe: (l: () => void) => () => void; getSnapshot: () => any }
  edit: (field: string, text: string) => void
  save: () => void
  discard: () => void
}

// DSH「设置 → 插件」的列表摘要和详情页；列表不会挂载表单或触发保存。
export function WikiSettingsCard({ view, ...props }: WikiSettingsProps) {
  if (view === 'summary') return <>所闻、所见、所学、所知</>
  return <SettingsDetails {...props} />
}

// 改完 400ms 自动保存，草稿与校验由插件自己的模型维护。
function SettingsDetails({ wikiForm: store, edit, save, discard }: WikiSettingsProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // 离开页面丢弃暂存（同宿主表单语义）；在途的自动保存定时器被 effect 清掉，不会半路写
  useEffect(() => () => discard(), [discard])
  // 自动保存：草稿一脏 400ms 就写。同一份草稿只自动写一次——宿主拒收（failed）就停手把话留在
  // 页上，等下一次改动再试，不会打失败死循环；invalid 的草稿不写（写关口在字段 parse）
  const fp = JSON.stringify([state.vaultDir?.text ?? '', state.larkApps?.text ?? '', state.mcpServers?.text ?? ''])
  const attempted = useRef('')
  useEffect(() => {
    if (!state.available || !state.dirty || !state.writable || state.invalid || state.saving) return
    if (fp === attempted.current) return
    const t = setTimeout(() => { attempted.current = fp; void save() }, 400)
    return () => clearTimeout(t)
  }, [fp, state.available, state.dirty, state.writable, state.invalid, state.saving, save])
  if (!state.available) return <p data-wiki-ui="" className={s.hint}>{formText.unavailable}</p>
  return (
    <div data-wiki-ui="" className={s.autoForm}>
      {!state.writable && <p data-wiki-ui="" className={s.invalid}>{formText.readOnly}</p>}
      <DirField state={state} onEdit={(path) => edit('vaultDir', path)} />
      <LarkSettings state={state} edit={edit} />
      <McpSettings state={state} edit={edit} />
      {(state.saving || state.failed) && (
        <Alert role={state.failed ? 'alert' : 'status'} variant={state.failed ? 'destructive' : 'default'} className="wk:mt-2 wk:flex wk:flex-wrap wk:items-center wk:gap-2">
          {state.failed ? formText.saveFailed : formText.saving}
          {state.failed && <Button variant="outline" size="sm" disabled={!state.writable || state.invalid} onClick={() => void save()}>重试保存</Button>}
        </Alert>
      )}
    </div>
  )
}

// 库路径字段行：路径只读显示 + 右侧「新建」「打开」（新建在前）。打开 = 选目录写 vaultDir，保存后服务端
// 完整校验，过了才开；新建 = 选目录 → 选模板 → 有多余项先确认迁移 → wiki init → 完成卡片 → 写 vaultDir
export function DirField({ state, onEdit }: { state: any; onEdit: (path: string) => void }) {
  const { api } = useEnv()
  const [status, setStatus] = useState<VaultStatus>()
  const [browse, setBrowse] = useState<((dir: string | null) => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState<string | null>(null)   // 新建弹窗的目标目录
  useEffect(() => {
    const load = () => { api.status().then(setStatus).catch(() => setStatus(undefined)) }
    load()
    return api.onChanged(load)
  }, [api])
  // 选目录：native 后端直接开系统选框；browse 后端弹逐层浏览框，选完/取消都回到这里
  const pick = async (): Promise<string | null> => {
    const r = await api.pickDir()
    if (r.kind === 'native') return r.path
    return new Promise((done) => setBrowse(() => (d: string | null) => { setBrowse(null); done(d) }))
  }
  const run = async (then: (dir: string) => void) => {
    if (busy) return
    setBusy(true); setErr('')
    try { const d = await pick(); if (d) then(d) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const text: string = state.vaultDir?.text ?? ''
  // 选的就是已保存的目录（典型：照报错修好后再开）：vaultDir 不变、配置不会触发重开，直接让服务端重新校验
  const open = (d: string) => { if (d === status?.dir) void api.reopen().catch((e) => setErr(e instanceof Error ? e.message : String(e))); else onEdit(d) }
  const unchanged = text === (status?.dir ?? '')
  const locked = !state.writable || busy || !!status?.validating
  return (
    <div data-wiki-ui="" className={s.field}>
      <div data-wiki-ui="" className={s.head}><div data-wiki-ui="" className={s.labelGroup}><span data-wiki-ui="" className={s.label}>知识库目录</span></div></div>
      <div data-wiki-ui="" className={s.dirRow}>
        <span data-wiki-ui="" className={s.dirPath}>{text ? <PathLabel path={text} /> : <span data-wiki-ui="" className={s.placeholder}>还没有知识库</span>}</span>
        <Button variant={status?.ok ? 'ghost' : 'default'} size="sm" disabled={locked} onClick={() => void run(setCreating)}>新建</Button>
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(open)}>打开</Button>
      </div>
      {err && <p data-wiki-ui="" className={s.invalid}>{err}</p>}
      {status && unchanged && <DirStatus status={status} />}
      {browse && <DirPicker api={api} initial={text} onClose={() => browse(null)} onPick={(d) => browse(d)} />}
      {creating && <NewVaultModal dir={creating} onClose={() => setCreating(null)} onDone={(d) => { setCreating(null); onEdit(d) }} />}
    </div>
  )
}

function DirStatus({ status }: { status: VaultStatus }) {
  if (status.validating) return <p data-wiki-ui="" className={`${s.hint} ${s.hintLoading}`}><IconLoading size={12} className={s.spin} />正在校验知识库，约十几秒…</p>
  if (status.ok) return <p data-wiki-ui="" className={s.hint}>✓ 已打开 · {status.pages} 页 · 校验通过</p>
  if (!status.dir) return <p data-wiki-ui="" className={s.hint}>还没有知识库。新建：选目录、挑模板，建好即打开；打开：选一个已经是知识库的目录。</p>
  if (status.checkOutput) return <OpenFailure dir={status.dir} output={status.checkOutput} />
  return <p data-wiki-ui="" className={s.invalid}>{status.error ?? `${status.dir} 打不开`}</p>
}

// 打开失败：wiki check 的 ✗ 行逐条列出；下面一段给 AI 的修复指引（库打不开时 AI 拿不到 wiki 技能，
// 规则说明在 check.py 的注释里）
function OpenFailure({ dir, output }: { dir: string; output: string }) {
  const [copied, setCopied] = useState(false)
  const items = output.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2))
  // 一条 ✗ 都没有 = 校验根本没跑起来（没有 python3、进程崩了、超时）：原样给原因，修复指引帮不上
  if (!items.length) return <p data-wiki-ui="" className={s.invalid}>✗ 知识库未打开：{output}</p>
  const prompt = `知识库 ${dir} 没通过校验。在库根跑 ./.wiki/bin/wiki check，规则说明在插件包 vault-tools/lib/check/check.py 的注释里（.wiki/bin 软链指向插件包）；按注释把每条报错修掉，改完再跑 check，直到通过。`
  const copy = () => { void navigator.clipboard?.writeText(prompt).then(() => setCopied(true), () => {}) }
  return (
    <>
      <p data-wiki-ui="" className={s.invalid}>✗ 没通过校验，知识库未打开（{items.length} 处）</p>
      <ul data-wiki-ui="" className={s.failList}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div data-wiki-ui="" className={s.copyBox}>
        <div data-wiki-ui="" className={s.copyBar}><span>把这段发给 AI 修</span><Button variant="ghost" size="sm" onClick={copy}>{copied ? '已复制' : '复制'}</Button></div>
        <p data-wiki-ui="" className={s.copyText}>{prompt}</p>
      </div>
    </>
  )
}

// 新建弹窗：选模板 →（initPlan 有多余项）确认迁移 → create → 完成卡片。check 没过不出完成卡片，
// 直接把目录交出去（写 vaultDir → 打开失败态列报错）。完成卡片三行，没发生的那行不出
type Step = { at: 'template' } | { at: 'confirm'; plan: InitPlan } | { at: 'running' } | { at: 'done'; report: InitReport } | { at: 'error'; msg: string }

function NewVaultModal({ dir, onClose, onDone }: { dir: string; onClose: () => void; onDone: (dir: string) => void }) {
  const { api } = useEnv()
  const [template, setTemplate] = useState<'minimal' | 'preset'>('preset')
  const [step, setStep] = useState<Step>({ at: 'template' })
  const fail = (e: unknown) => setStep({ at: 'error', msg: e instanceof Error ? e.message : String(e) })
  const build = async () => {
    setStep({ at: 'running' })
    try {
      const report = await api.create(dir, template)
      if (report.check_ok) setStep({ at: 'done', report })
      else onDone(dir)
    } catch (e) { fail(e) }
  }
  const next = async () => {
    try {
      const plan = await api.initPlan(dir)
      if (plan.extras.length) setStep({ at: 'confirm', plan })
      else await build()
    } catch (e) { fail(e) }
  }
  const opt = (v: 'minimal' | 'preset', title: string, desc: string) => (
    <RadioGroupItem value={v} data-template={v}>
      <b>{title}</b><span data-wiki-ui="" className="wk:text-xs wk:text-muted-foreground">{desc}</span>
    </RadioGroupItem>
  )
  if (step.at === 'template') return (
    <Modal open onClose={onClose} title="新建知识库" closeLabel="取消"
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>取消</Button><Button variant="default" size="sm" onClick={() => void next()}>下一步</Button></>}>
      <p data-wiki-ui="" className={s.hint}>目录：<code>{dir}</code></p>
      <RadioGroup aria-label="知识库模板" value={template} onValueChange={(v) => setTemplate(v as 'minimal' | 'preset')} className="wk:my-2.5">
        {opt('minimal', '无模板', '建立经历、认知、学习、知识、系统五区与空门面，以及素材、附件目录。')}
        {opt('preset', '预置模板', '加入五区写作规则、系统分析与设计、知识库系统层方法论，以及 10 篇知识工程页。')}
      </RadioGroup>
      <p data-wiki-ui="" className={s.hint}>已有区保留区根文件，只补缺失的模板子树文件与 frontmatter；已有内容不覆盖。</p>
    </Modal>
  )
  if (step.at === 'confirm') return (
    <Modal open onClose={onClose} title="确认新建" closeLabel="取消"
      footer={<><Button variant="ghost" size="sm" onClick={() => setStep({ at: 'template' })}>上一步</Button><Button variant="default" size="sm" onClick={() => void build()}>移走并新建</Button></>}>
      <p data-wiki-ui="" className={s.copyText}>这个目录里有 {step.plan.extras.length} 项不属于知识库结构，会移到 <code>.wiki/backup/init-&lt;时间&gt;/</code>：</p>
      <ul data-wiki-ui="" className={s.moveList}>{step.plan.extras.map((x) => <li key={x}>{x}</li>)}</ul>
      <p data-wiki-ui="" className={s.hint}>.wiki/backup/ 不进 git：移走后 git 里显示为删除，文件仍在磁盘上。</p>
    </Modal>
  )
  if (step.at === 'running') return <Modal open onClose={() => {}} title="新建知识库" closeLabel="关闭"><p data-wiki-ui="" className={s.hint}>正在新建…</p></Modal>
  if (step.at === 'error') return (
    <Modal open onClose={onClose} title="新建没有成功" closeLabel="关闭" footer={<Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>}>
      <p data-wiki-ui="" className={s.invalid}>{step.msg}</p>
    </Modal>
  )
  const r = step.report
  return (
    <Modal open onClose={() => onDone(dir)} title="新建完成" closeLabel="关闭" footer={<Button variant="default" size="sm" onClick={() => onDone(dir)}>好</Button>}>
      <p data-wiki-ui="" className={s.result}>
        {r.git_inited && <>✓ 已初始化 git<br /></>}
        ✓ 已初始化知识库模板
        {r.backup && <><br />✓ 已迁移无关文件到 {r.backup}</>}
      </p>
    </Modal>
  )
}

// browse 后端的路径选择弹层：面包屑可逐级跳，列表点子目录进入；平台已按名排序、条目自带绝对路径，前端不拼路径
function DirPicker({ api, initial, onClose, onPick }: { api: WikiApi; initial: string; onClose: () => void; onPick: (dir: string) => void }) {
  const [cur, setCur] = useState<string | null>(initial || null) // null = 主目录
  const [data, setData] = useState<DirListing | null>(null)
  const [err, setErr] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [newName, setNewName] = useState<string | null>(null) // 非 null = 正在新建文件夹
  useEffect(() => {
    let dead = false
    setData(null); setErr('')
    api.fsDirs(cur ?? '').then((d) => { if (!dead) setData(d) }).catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { dead = true }
  }, [api, cur])
  const shown = data ? data.entries.filter((e) => showHidden || !e.hidden) : []
  const hasHidden = !!data && data.entries.some((e) => e.hidden)
  // 建完直接进去——新建的目录通常就是要选的那个
  const mkdir = async () => {
    const name = (newName ?? '').trim()
    if (!name || !data) return
    try {
      const r = await api.fsMkdir(data.path, name)
      setNewName(null); setErr(''); setCur(r.path)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="选择知识库目录" closeLabel="取消"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        <Button variant="default" size="sm" disabled={!data} onClick={() => data && onPick(data.path)}>就用这个目录</Button>
      </>}>
      <div data-wiki-ui="" className={s.pickBar}>
        <Button variant="ghost" size="sm" disabled={!data || data.path === data.home} onClick={() => data && setCur(data.home)}>主目录</Button>
        <Button variant="ghost" size="sm" disabled={!data || newName !== null} onClick={() => setNewName('')}>新建文件夹</Button>
        {hasHidden && (
          <Button variant="ghost" size="sm" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '不显示隐藏目录' : '显示隐藏目录'}</Button>
        )}
      </div>
      {data && (
        <div data-wiki-ui="" className="wk:mb-2"><BreadcrumbTrail items={data.crumbs.map((c, i) => ({ label: c.name, title: c.path, onClick: i === data.crumbs.length - 1 ? undefined : () => setCur(c.path) }))} /></div>
      )}
      {err && <p data-wiki-ui="" className={s.invalid}>{err}</p>}
      {newName !== null && data && (
        <div data-wiki-ui="" className={s.newRow}>
          <IconFolder size={14} />
          <Input className={s.newName} value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void mkdir(); if (e.key === 'Escape') setNewName(null) }}
            placeholder="新目录名" />
          <Button variant="ghost" size="sm" onClick={() => setNewName(null)}>取消</Button>
          <Button variant="default" size="sm" disabled={!newName.trim()} onClick={() => void mkdir()}>创建</Button>
        </div>
      )}
      {data && (shown.length ? (
        <div data-wiki-ui="" className={s.pickList}>
          {shown.map((e) => (
            <Button size="sm" type="button" key={e.path} className={s.pickRow} title={e.path} onClick={() => setCur(e.path)}>
              <IconFolder size={14} /><span data-wiki-ui="" className={e.hidden ? s.pickDim : s.pickName}>{e.name}</span>
            </Button>
          ))}
          {data.truncated && <p data-wiki-ui="" className={s.hint}>子目录太多，未列全</p>}
        </div>
      ) : <p data-wiki-ui="" className={s.hint}>这个目录下没有子目录{hasHidden ? '（点上方「显示隐藏目录」查看）' : ''}</p>)}
    </Modal>
  )
}
