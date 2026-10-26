// 事件引擎：分类路由（本文件）+ watcher/防抖/调度/自愈（VaultEngine，见下）。
// Model 的单一写者——开库后任何时刻只有这里能改模型。
import path, { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { watch } from 'chokidar';
import { DEFAULT_AREAS } from './graph';
import { loadParts } from './vault';
import { decideInit, ensureGit, ensureToolchain, readWikiVersion, WIKI_VERSION } from './init';
import { watchIgnored } from './watch';
import { buildModel, type Model } from '../model';
import { DocStore } from './docstore';
import { applyDocOps, applyAssets, applyRaws, applyAnchors, type DocOp, type Flags, type OpResult } from './ops';
import { vaultTools } from '../../host/pkg';

export type ChangeEvent =
  | { kind: 'patch'; ids: string[]; flags: Flags }
  | { kind: 'structural' };                       // 客户端语义 = 全 flags 全刷
export type HubEvent = ChangeEvent | { kind: 'tools' };

export interface FlushPlan {
  kind: 'reopen' | 'structural' | 'patch' | 'none';
  docOps: DocOp[];
  assets: string[];
  raws: string[];
  anchors: boolean;
  coverage: boolean;
  tools: boolean;
}

// 防抖窗收的是去重后的 (path → 最后事件) 集：同路径后到覆盖即设计本身——以落盘终态为准，
// 同窗 unlink+add 只剩 add（重建已存在的页由 ops.doCreate 守卫转 doChange 兜住）。这里仍按
// 集合判定（净零、unlink 优先），供多事件直传的调用方与测试使用；引擎路径每 rel 至多一个事件。
// 优先级 reopen > structural > patch > tools（tools 不压别人，与 patch 并存分别发）。
export function classifyEvents(events: Array<{ evt: string; path: string }>, ctx: { dir: string; areas: string[]; toolsDir: string }): FlushPlan {
  const plan: FlushPlan = { kind: 'patch', docOps: [], assets: [], raws: [], anchors: false, coverage: false, tools: false };
  let structural = false;
  const perRel = new Map<string, Set<string>>();
  for (const { evt, path: raw } of events) {
    const p = raw.normalize('NFC');
    if (p === path.join(ctx.dir, '.wiki', 'wiki.json')) { plan.kind = 'reopen'; continue }
    if (p.startsWith(ctx.toolsDir + path.sep)) { plan.tools = true; continue }
    if (!p.startsWith(ctx.dir + path.sep)) { structural = true; continue }
    const rel = p.slice(ctx.dir.length + 1);
    if (evt === 'addDir' || evt === 'unlinkDir') { structural = true; continue }
    if (!perRel.has(rel)) perRel.set(rel, new Set());
    perRel.get(rel)!.add(evt);
  }
  for (const [rel, evts] of perRel) {
    if (rel === '.wiki/coverage.conf') { plan.coverage = true; continue }
    if (rel === '.wiki/anchors.conf') { plan.anchors = true; continue }
    if (rel.startsWith('asset/')) { plan.assets.push(rel); continue }
    if (rel.startsWith('raw/')) { plan.raws.push(rel); continue }
    if (/\.md$/i.test(rel)) {
      if (!ctx.areas.includes(rel.split('/')[0])) continue;   // 区外 md：监听面上本不该有；真有了不动模型不重建
      if (evts.has('add') && evts.has('unlink') && !evts.has('change')) continue;      // 建了又删：净零
      const op = evts.has('unlink') ? 'unlink' : evts.has('add') ? 'create' : 'change';
      plan.docOps.push({ op, rel });
      continue;
    }
    structural = true;    // .folder.json、.wiki 其余成员、认不出的
  }
  if (plan.kind === 'reopen') return plan;
  if (structural) plan.kind = 'structural';
  else if (!plan.docOps.length && !plan.assets.length && !plan.raws.length && !plan.anchors && !plan.coverage) plan.kind = 'none';
  return plan;
}

// 监听器形貌：引擎只用 on / close（真身是 chokidar FSWatcher）。真实 fs watch 的错误
// 没法确定性触发，构造器留了注入口给测试塞假货。
type WatcherLike = { on(evt: string, fn: (...a: any[]) => void): unknown; close(): Promise<void> }
const realWatch = (paths: string[], opts: { ignoreInitial: boolean; ignored: (p: string) => boolean }): WatcherLike =>
  watch(paths, opts)

// 开库校验：跑插件包里的 wiki check，退出码 0 才算过。没有 python3 / 进程崩了也给一份能读的 output。
export type CheckResult = { ok: boolean; output: string }

const realCheck = (dir: string): Promise<CheckResult> => new Promise((done) =>
  execFile('python3', [vaultTools('bin', 'wiki'), 'check'], { cwd: dir, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    (e, out, err) => {
      const text = `${out ?? ''}${err ?? ''}`.trim()
      done({ ok: !e, output: text || (e ? `校验没跑起来：${e.message}` : '') })
    }))

// 开库前升级：库版本低于插件时跑 wiki upgrade（按版本逐级跑 vault-tools/lib/upgrade/steps/）。
// 进程跑完（退出码 0 / 非 0）→ resolve，output 是升级原文；进程没跑起来（没有 python3、超时被杀）→ reject
const realUpgrade = (dir: string): Promise<CheckResult> => new Promise((done, fail) =>
  execFile('python3', [vaultTools('bin', 'wiki'), 'upgrade'], { cwd: dir, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    (e, out, err) => {
      if (e && typeof e.code !== 'number') { fail(e); return }
      done({ ok: !e, output: `${out ?? ''}${err ?? ''}`.trim() })
    }))

export class VaultEngine {
  model: Model | null = null
  /** 打不开的原因（判定拒绝、git init 失败、中途异常），打开成功为 null */
  error: string | null = null
  /** 文件监听已中断：模型停在最后状态，改动不自动刷新；重开库复位 */
  degraded = false
  /** 开库校验进行中（完整 wiki check，大库十几秒）：期间无模型、无报错 */
  validating = false
  /** 校验没过时 wiki check 的原文（设置页逐条列给人看） */
  checkOutput: string | null = null
  private gen = 0                                   // 每次 open 自增；校验结果回来时对不上就作废
  private store: DocStore | null = null
  private storeDir = ''
  private stop: (() => Promise<void>) | null = null
  private pending = new Map<string, string>()      // path → 事件类型（同路径后到覆盖）
  private timer: NodeJS.Timeout | undefined

  constructor(
    private dirOf: () => string,
    private notify: (ev: HubEvent) => void,
    private makeWatch: (paths: string[], opts: { ignoreInitial: boolean; ignored: (p: string) => boolean }) => WatcherLike = realWatch,
    private opts: { debounceMs?: number; apply?: (m: Model, ops: DocOp[]) => OpResult; toolsDir?: string; check?: (dir: string) => Promise<CheckResult>; upgrade?: (dir: string) => Promise<CheckResult> } = {},
  ) {}

  /** validate：（库版本低时先 wiki upgrade）跑完整 wiki check，过了才建模型（启动、换目录、新建后由 hub.reopen 传）；
   *  会话内的重开（wiki.json 变了）不传，免得写到一半留个断链库就被锁住；也不升级、不改版本号 */
  open(o: { validate?: boolean } = {}) {
    const gen = ++this.gen
    this.stop?.().catch((e) => console.error('[vault] 关旧监听失败', e))
    this.stop = null
    this.model = null
    this.error = null
    this.degraded = false
    this.validating = false
    this.checkOutput = null
    const dir = this.dirOf()
    if (!dir) return
    if (!existsSync(dir)) { this.error = `目录不存在：${dir}`; return }
    let areas: string[]
    let needUpgrade = false
    try {
      const hasWiki = statSync(join(dir, '.wiki'), { throwIfNoEntry: false })?.isDirectory() ?? false
      const d = decideInit(readdirSync(dir), hasWiki, hasWiki ? readWikiVersion(dir) : null, WIKI_VERSION)
      if (d.action === 'refuse') { this.error = d.reason; return }
      const gitErr = ensureGit(dir)
      if (gitErr) { this.error = gitErr; return }
      needUpgrade = d.action === 'migrate'            // 版本低：只在带校验的开库里升级（见下）
      // git 带不过去、开库照旧补建的（不算违规）：.wiki/tmp、空的固定目录、指向本插件包的软链与钩子
      mkdirSync(join(dir, '.wiki', 'tmp'), { recursive: true })
      areas = loadParts(dir, DEFAULT_AREAS)
      for (const a of [...areas, 'asset', 'raw']) if (!existsSync(join(dir, a))) mkdirSync(join(dir, a), { recursive: true })
      const t = ensureToolchain(dir, vaultTools())
      if (t.repointed.length) console.warn(`[vault] 工具链软链原指向别的插件安装，已重指到当前插件：${t.repointed.join('、')}`)
      if (t.skipped.length) console.warn(`[vault] 工具链连接跳过（同名项已存在，未动）：${t.skipped.join('、')}`)
    } catch (e) {
      this.error = `打开库失败：${e instanceof Error ? e.message : String(e)}`
      return
    }
    if (!o.validate) { this.build(dir, areas); return }
    this.validating = true
    const live = () => gen === this.gen
    const settle = (fn: () => void) => { if (!live()) return; this.validating = false; fn(); this.emit({ kind: 'structural' }) }
    const stall = new Promise<never>(() => {})       // 已作废：后面的一步都不跑
    const runCheck = () => Promise.resolve().then(() => (this.opts.check ?? realCheck)(dir)).then(   // 同步抛错也走下面的报错
      (r) => settle(() => {
        if (r.ok) this.build(dir, areas)
        else { this.error = '没通过校验，知识库未打开'; this.checkOutput = r.output }
      }),
      (e) => settle(() => { this.error = `校验没跑起来：${e instanceof Error ? e.message : String(e)}` }),
    )
    if (!needUpgrade) { runCheck(); return }
    // 版本低：先 wiki upgrade，退出码 0 才往下校验；升级不过不打开，原文按校验没过同样展示
    Promise.resolve().then(() => (this.opts.upgrade ?? realUpgrade)(dir)).then(
      (r) => {
        if (!live()) return stall
        if (r.ok) return runCheck()
        settle(() => { this.error = '升级没成功，知识库未打开'; this.checkOutput = r.output })
      },
      (e) => settle(() => { this.error = `升级没跑起来：${e instanceof Error ? e.message : String(e)}` }),
    )
  }

  /** 建模型与监听（原 open 尾段）。失败落 error，不抛 */
  private build(dir: string, areas: string[]) {
    try {
      // 解析仓：同目录 reopen 保留缓存，换目录清空
      if (this.storeDir !== dir) { this.store = new DocStore(dir); this.storeDir = dir }
      this.model = buildModel(dir, this.store ?? undefined)
      const w = this.makeWatch([...areas.map((a) => join(dir, a)), join(dir, 'asset'), join(dir, 'raw'), join(dir, '.wiki', 'anchors.conf'), join(dir, '.wiki', 'coverage.conf'), join(dir, '.wiki', 'wiki.json'), this.opts.toolsDir ?? vaultTools('skills')], {
        ignoreInitial: true,
        ignored: watchIgnored(dir),
      })
      w.on('error', (e: unknown) => {
        console.error('[vault] 监听出错', e)
        if (!this.degraded) { this.degraded = true; this.emit({ kind: 'structural' }) }   // 只通知一次；重开复位
      })
      w.on('all', (evt: string, p: string) => {
        this.pending.set(String(p).normalize('NFC'), evt)
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), this.opts.debounceMs ?? 300)
      })
      this.stop = () => { clearTimeout(this.timer); this.pending.clear(); return w.close() }
    } catch (e) {
      this.model = null
      this.error = `打开库失败：${e instanceof Error ? e.message : String(e)}`
      this.stop?.().catch(() => {})
      this.stop = null
    }
  }

  private emit(ev: HubEvent) { try { this.notify(ev) } catch (e) { console.error('[vault] 变更回调出错', e) } }

  private flush() {
    if (!this.pending.size || !this.model) return
    const events = [...this.pending].map(([path, evt]) => ({ evt, path }))
    this.pending.clear()
    const dir = this.dirOf()
    // DSH 对未捕获异常直接退出进程：flush 全路径吞错
    try {
      const plan = classifyEvents(events, { dir, areas: this.model.g.areas, toolsDir: this.opts.toolsDir ?? vaultTools('skills') })
      if (plan.kind === 'reopen') {
        try { this.open() } catch (e) { console.error('[vault] 重开失败', e) }
        this.emit({ kind: 'structural' })
        return
      }
      if (plan.kind === 'structural') {
        try { this.rebuild() } catch (e) { console.error('[vault] structural 全量重建失败，模型停在最后好状态', e) }
        this.emit({ kind: 'structural' })
        return
      }
      if (plan.kind === 'patch') {
        const ids = new Set<string>()
        const flags: Flags = {}
        const merge = (r: OpResult) => {
          for (const id of r.ids) ids.add(id)
          for (const k of Object.keys(r.flags) as (keyof Flags)[]) if (r.flags[k]) flags[k] = true
        }
        const apply = this.opts.apply ?? applyDocOps
        merge(apply(this.model, plan.docOps))
        merge(applyAssets(this.model, plan.assets))
        merge(applyRaws(this.model, plan.raws))
        if (plan.anchors) merge(applyAnchors(this.model))
        if (plan.coverage) flags.documents = true
        if (ids.size || Object.keys(flags).length) this.emit({ kind: 'patch', ids: [...ids], flags })
      }
      if (plan.tools) this.emit({ kind: 'tools' })
    } catch (e) {
      // 补丁抛异常 → 就地自愈：该批改走全量重建、载荷发 structural；绝不带半补丁状态跑
      console.error('[vault] 增量补丁失败，退回全量重建', e)
      try { this.rebuild() } catch (e2) { console.error('[vault] 全量重建也失败，模型停在最后好状态', e2) }
      this.emit({ kind: 'structural' })
    }
  }

  private rebuild() { this.model = buildModel(this.dirOf(), this.store ?? undefined) }

  async close() {
    this.gen++                                      // 关库后回来的校验结果也作废
    const s = this.stop
    this.stop = null
    this.model = null
    clearTimeout(this.timer)
    this.pending.clear()
    await s?.()
  }
}
