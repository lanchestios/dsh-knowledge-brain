import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal, PathLabel } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconFolder, IconLoading, IconMoreRight } from '../../icon'
import { useEnv } from '../env'
import { LarkSettings } from './LarkSettings'
import { McpSettings } from './McpSettings'
import type { DirListing, WikiApi } from '../api'
import type { VaultStatus } from '../../core/api'
import type { InitPlan, InitReport } from '../../core/vault/create'
import s from './WikiSettingsCard.module.css'

// 表单框架的中文文案。不用宿主 SettingsForm 的保存条：改完自动保存（见下），只保留不可用/只读/失败三种话
const formText = {
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  saveFailed: '自动保存没有成功，修改都还在；再改动一下会自动重试。',
  saving: '自动保存中…',
}

// 设置 → 插件 里的「格物致知」卡片：改完 400ms 自动保存，不要保存按钮（宿主 SettingsForm 的
// 暂存-保存壳随之撤掉，不可用/只读/失败提示自己出）。view=summary 是插件列表里的一行，view=page 是详情页
export function WikiSettingsCard({ view, wikiForm: store, edit, save, discard }: {
  view?: 'summary' | 'page'
  wikiForm: { subscribe: (l: () => void) => () => void; getSnapshot: () => any }
  edit: (field: string, text: string) => void
  save: () => void
  discard: () => void
}) {
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
  if (view === 'summary') return <>所闻、所见、所学、所知</>
  if (!state.available) return <p className={s.hint}>{formText.unavailable}</p>
  return (
    <div className={s.autoForm}>
      {!state.writable && <p className={s.invalid}>{formText.readOnly}</p>}
      <DirField state={state} onEdit={(path) => edit('vaultDir', path)} />
      <LarkSettings state={state} edit={edit} />
      <McpSettings state={state} edit={edit} />
      {(state.saving || state.failed) && (
        <p className={state.failed ? s.invalid : s.autosave}>{state.failed ? formText.saveFailed : formText.saving}</p>
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
    <div className={s.field}>
      <div className={s.head}><div className={s.labelGroup}><span className={s.label}>知识库目录</span></div></div>
      <div className={s.dirRow}>
        <span className={s.dirPath}>{text ? <PathLabel path={text} /> : <span className={s.placeholder}>还没有知识库</span>}</span>
        <Button variant={status?.ok ? 'ghost' : 'primary'} size="sm" disabled={locked} onClick={() => void run(setCreating)}>新建</Button>
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(open)}>打开</Button>
      </div>
      {err && <p className={s.invalid}>{err}</p>}
      {status && unchanged && <DirStatus status={status} />}
      {browse && <DirPicker api={api} initial={text} onClose={() => browse(null)} onPick={(d) => browse(d)} />}
      {creating && <NewVaultModal dir={creating} onClose={() => setCreating(null)} onDone={(d) => { setCreating(null); onEdit(d) }} />}
    </div>
  )
}

function DirStatus({ status }: { status: VaultStatus }) {
  if (status.validating) return <p className={`${s.hint} ${s.hintLoading}`}><IconLoading size={12} className={s.spin} />正在校验知识库，约十几秒…</p>
  if (status.ok) return <p className={s.hint}>✓ 已打开 · {status.pages} 页 · 校验通过</p>
  if (!status.dir) return <p className={s.hint}>还没有知识库。新建：选目录、挑模板，建好即打开；打开：选一个已经是知识库的目录。</p>
  if (status.checkOutput) return <OpenFailure dir={status.dir} output={status.checkOutput} />
  return <p className={s.invalid}>{status.error ?? `${status.dir} 打不开`}</p>
}

// 打开失败：wiki check 的 ✗ 行逐条列出；下面一段给 AI 的修复指引（库打不开时 AI 拿不到 wiki 技能，
// 规则说明在 check.py 的注释里）
function OpenFailure({ dir, output }: { dir: string; output: string }) {
  const [copied, setCopied] = useState(false)
  const items = output.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2))
  // 一条 ✗ 都没有 = 校验根本没跑起来（没有 python3、进程崩了、超时）：原样给原因，修复指引帮不上
  if (!items.length) return <p className={s.invalid}>✗ 知识库未打开：{output}</p>
  const prompt = `知识库 ${dir} 没通过校验。在库根跑 ./.wiki/bin/wiki check，规则说明在插件包 vault-tools/lib/check/check.py 的注释里（.wiki/bin 软链指向插件包）；按注释把每条报错修掉，改完再跑 check，直到通过。`
  const copy = () => { void navigator.clipboard?.writeText(prompt).then(() => setCopied(true), () => {}) }
  return (
    <>
      <p className={s.invalid}>✗ 没通过校验，知识库未打开（{items.length} 处）</p>
      <ul className={s.failList}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className={s.copyBox}>
        <div className={s.copyBar}><span>把这段发给 AI 修</span><Button variant="ghost" size="sm" onClick={copy}>{copied ? '已复制' : '复制'}</Button></div>
        <p className={s.copyText}>{prompt}</p>
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
    <button type="button" role="radio" aria-checked={template === v} data-template={v}
      className={template === v ? s.optOn : s.opt} onClick={() => setTemplate(v)}>
      <b>{title}</b><span>{desc}</span>
    </button>
  )
  if (step.at === 'template') return (
    <Modal open onClose={onClose} title="新建知识库" closeLabel="取消"
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>取消</Button><Button variant="primary" size="sm" onClick={() => void next()}>下一步</Button></>}>
      <p className={s.hint}>目录：<code>{dir}</code></p>
      <div role="radiogroup" className={s.opts}>
        {opt('minimal', '无模板', '只建结构：git、.wiki、认知 / 学习 / 知识 / 工作 / asset / raw，四区各一页空门面。')}
        {opt('preset', '预置模板', '在此之上种下四区写作规则，以及「知识/知识工程」10 页（结构化写作、OKF、Sensemaking）。')}
      </div>
      <p className={s.hint}>目录里已有的区文件夹不覆盖，只补 frontmatter 与缺的子文件夹。</p>
    </Modal>
  )
  if (step.at === 'confirm') return (
    <Modal open onClose={onClose} title="确认新建" closeLabel="取消"
      footer={<><Button variant="ghost" size="sm" onClick={() => setStep({ at: 'template' })}>上一步</Button><Button variant="primary" size="sm" onClick={() => void build()}>移走并新建</Button></>}>
      <p className={s.copyText}>这个目录里有 {step.plan.extras.length} 项不属于知识库结构，会移到 <code>.wiki/backup/init-&lt;时间&gt;/</code>：</p>
      <ul className={s.moveList}>{step.plan.extras.map((x) => <li key={x}>{x}</li>)}</ul>
      <p className={s.hint}>.wiki/backup/ 不进 git：移走后 git 里显示为删除，文件仍在磁盘上。</p>
    </Modal>
  )
  if (step.at === 'running') return <Modal open onClose={() => {}} title="新建知识库" closeLabel="关闭"><p className={s.hint}>正在新建…</p></Modal>
  if (step.at === 'error') return (
    <Modal open onClose={onClose} title="新建没有成功" closeLabel="关闭" footer={<Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>}>
      <p className={s.invalid}>{step.msg}</p>
    </Modal>
  )
  const r = step.report
  return (
    <Modal open onClose={() => onDone(dir)} title="新建完成" closeLabel="关闭" footer={<Button variant="primary" size="sm" onClick={() => onDone(dir)}>好</Button>}>
      <p className={s.result}>
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
        <Button variant="primary" size="sm" disabled={!data} onClick={() => data && onPick(data.path)}>就用这个目录</Button>
      </>}>
      <div className={s.pickBar}>
        <Button variant="ghost" size="sm" disabled={!data || data.path === data.home} onClick={() => data && setCur(data.home)}>主目录</Button>
        <Button variant="ghost" size="sm" disabled={!data || newName !== null} onClick={() => setNewName('')}>新建文件夹</Button>
        {hasHidden && (
          <Button variant="ghost" size="sm" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '不显示隐藏目录' : '显示隐藏目录'}</Button>
        )}
      </div>
      {data && (
        <div className={s.crumbs}>
          {data.crumbs.map((c, i) => (
            <span key={c.path} className={s.crumbWrap}>
              {i > 0 && <IconMoreRight size={12} className={s.crumbSep} />}
              <button type="button" className={i === data.crumbs.length - 1 ? s.crumbCur : s.crumb} title={c.path} onClick={() => setCur(c.path)}>{c.name}</button>
            </span>
          ))}
        </div>
      )}
      {err && <p className={s.invalid}>{err}</p>}
      {newName !== null && data && (
        <div className={s.newRow}>
          <IconFolder size={14} />
          <Input className={s.newName} value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void mkdir(); if (e.key === 'Escape') setNewName(null) }}
            placeholder="新目录名" />
          <Button variant="ghost" size="sm" onClick={() => setNewName(null)}>取消</Button>
          <Button variant="primary" size="sm" disabled={!newName.trim()} onClick={() => void mkdir()}>创建</Button>
        </div>
      )}
      {data && (shown.length ? (
        <div className={s.pickList}>
          {shown.map((e) => (
            <button type="button" key={e.path} className={s.pickRow} title={e.path} onClick={() => setCur(e.path)}>
              <IconFolder size={14} /><span className={e.hidden ? s.pickDim : s.pickName}>{e.name}</span>
            </button>
          ))}
          {data.truncated && <p className={s.hint}>子目录太多，未列全</p>}
        </div>
      ) : <p className={s.hint}>这个目录下没有子目录{hasHidden ? '（点上方「显示隐藏目录」查看）' : ''}</p>)}
    </Modal>
  )
}
