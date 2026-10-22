import { useEffect, useRef, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconWorkspaceTreeOutlineRegular, SettingsFormModel, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import './styles/tokens.css'
import './styles/shiki.css'
import 'katex/dist/katex.min.css'
import { createWikiClient } from './api'
import { larkAppsField } from './settings/larkField'
import { mcpServersField } from './settings/mcpField'
import { createEnv, WikiEnvProvider, type WikiEnv } from './env'
import { ReaderPage } from './reader/ReaderPage'
import { WikiSidebar } from './sidebar/WikiSidebar'
import { WikiRightbar } from './sidebar/WikiRightbar'
import { SESSION_SLOT, SessionChat } from './sidebar/SessionPane'
import { HeroPreset } from './components/HeroPreset'
import { wireFills, openScene } from './lib/sessions'
import { startupCorrect } from './lib/startup'
import { createPanelState } from './reader/panel'
import { WikiPageTab, makeQuote } from './tab/WikiPageTab'
import { WIKI_TAB_ID, WIKI_TAB_KIND, wikiTabDefinition } from './tab/definition'
import { ReadPageRow, SearchRow } from './toolviews/rows'
import { wikiSource } from './reference/source'
import { WikiSettingsCard } from './settings/WikiSettingsCard'
import { registerShortcuts } from './shortcuts'
import { installEmbedAutosize } from '../editor/kernel/surface'

// DSH 左栏一个入口「格物致知」：整页阅读器（首页探索三入口、下方沉淀列表，历史一份）；order 为负，排在 DSH 自带的「插件」（order 0）之上
const PANEL = { id: 'wiki', label: '格物致知', Icon: IconWorkspaceTreeOutlineRegular, order: -19 }
export const inject = ['slots']

// 每个挂进插槽的组件外包一层 WikiEnv
export const withEnv = <P extends object>(env: WikiEnv, C: (p: P) => JSX.Element | null) =>
  (p: P) => <WikiEnvProvider value={env}><C {...p} /></WikiEnvProvider>

export function apply(ctx: Context): void {
  const c = ctx as any
  // 嵌入件桥（高度自适应 + 主题回信）在 client 一加载就装，别等 surface：正文 iframe 与其
  // load 上报可能早于任何 surface 挂载，装晚了首条上报落空、主题回信永远发不出去
  installEmbedAutosize()
  const env = createEnv(ctx, createWikiClient(ctx))

  // 左栏入口 + 整页阅读器
  const panel = createPanelState()
  c.effect(() => wireFills(panel, c, env.api), 'dsh-knowledge-brain: fills')
  // 启动纠偏：DSH 落点若是别的目录的空白会话，切到库工作区的空白会话（详见 lib/startup.ts）。
  // 挂载等 sessions 就绪——entry 本身只 inject ['slots']，激活时 sessions（要等 connection 链）多半还没来
  c.inject(['sessions'], (cc: any) => cc.effect(() => startupCorrect(c, env.api), 'dsh-knowledge-brain: startup correct'))
  env.openKb = (id) => { panel.nav.go({ kind: 'page', id }); try { c.get('layout')?.selectPanel('wiki') } catch { /* 面板未注册 */ } }
  // 设置卡机器人行的「会话」：跳知识库面板的会话记录页（nav 替换当前 tab）
  env.openLarkSessions = (appId) => { panel.nav.go({ kind: 'lark', appId }); try { c.get('layout')?.selectPanel('wiki') } catch { /* 面板未注册 */ } }
  c.slots.inject('main', () => c.slots.register({ name: 'main', key: 'wiki' }, withEnv(env, () => <ReaderPage panel={panel} />)))
  // 点左栏入口回面板首页：已在首页就不动（不在历史里压栈）
  const home = () => { const n = panel.nav; if (n.get().route.kind !== 'kb') n.go({ kind: 'kb' }) }
  c.slots.inject('sidebar.panellist', () => c.slots.register({
    name: 'sidebar.panellist', id: 'wiki', order: PANEL.order, label: () => PANEL.label,
  }, ({ size }: { size: number }) => <PanelGlyph Icon={PANEL.Icon} size={size} onClick={home} />))

  // 打开 wiki 面板时，用更高优先级（priority 更小）遮住 DSH 左栏的工作区 / 会话列表与右栏，
  // 左栏放目录树、右栏放检视内容；离开面板就注销，DSH 自己的两栏原样回来。
  // DSH 右栏自己只在会话界面显示（activePanelId 为空），在 wiki 面板上本来就是空的
  c.inject(['layout'], (cc: any) => {
    const layout = cc.layout
    const info = layout.panelInfo
    let current = false
    let disposers: (() => void)[] = []
    const syncRightbar = () => {
      // 要 DSH 的右栏轨道：网格分列、拖拽调宽都走宿主（宽度偏好与会话界面的右栏共用一份）
      if (panel.inspector.get() && panel.view.get().right) layout.openRightbar(true, false)
      else layout.closeRightbar()
    }
    const sync = () => {
      const active = (info.getSnapshot()?.activePanelId ?? null) === PANEL.id
      if (active === current) return
      const leaving = current
      disposers.forEach((d) => d()); disposers = []; current = active
      if (!active) { if (leaving) layout.closeRightbar(); return }
      disposers.push(cc.slots.inject('sidebar.workspaces', () => cc.slots.register({ name: 'sidebar.workspaces', priority: -1 },
        withEnv(env, (props: any) => <WikiSidebar {...props} store={panel.nav} edit={panel.edit} Icon={PANEL.Icon} label={PANEL.label} />))))
      // 右栏：检视或专属会话。声明会话作用域子插槽，才拿得到 SessionProvider 与会话组件工厂
      disposers.push(cc.slots.inject('rightbar', function* () {
        yield cc.slots.register({ name: 'rightbar', priority: -1, children: { [SESSION_SLOT]: { kind: 'single', scope: 'session' } } },
          withEnv(env, (props: any) => <WikiRightbar {...props} panel={panel} c={c} />))
        yield cc.slots.register({ name: SESSION_SLOT }, SessionChat)
      }))
      const resync = () => { if (current) syncRightbar() }
      disposers.push(panel.inspector.subscribe(resync), panel.view.subscribe(resync))
      syncRightbar()
    }
    sync()
    cc.effect(() => info.subscribe(sync), 'dsh-knowledge-brain: sidebars follow panel')
    cc.effect(() => () => { disposers.forEach((d) => d()); disposers = [] }, 'dsh-knowledge-brain: sidebars dispose')
  })

  // 右侧 wiki 页 tab；打开它要有会话，不在会话里时静默不开
  const openPage = (id: string) => { try { c.get('sidebarRight')?.openTab(WIKI_TAB_KIND, { params: { id } }) } catch { /* 没有会话 */ } }
  c.inject(['sidebarRightTabs'], (cc: any) => {
    cc.effect(() => cc.sidebarRightTabs.register(wikiTabDefinition), 'dsh-knowledge-brain: tab type')
    cc.slots.inject('sidebar.right.pane.tab', () => cc.slots.register({ name: 'sidebar.right.pane.tab', key: WIKI_TAB_ID },
      withEnv(env, (p: any) => <WikiPageTab {...p} quote={makeQuote(c, p)} />)))
  })

  // 工具卡片
  c.slots.inject('tool.call.toolview', function* () {
    yield c.slots.register({ name: 'tool.call.toolview', key: 'wiki_read_page' }, (p: any) => <ReadPageRow phase={p.phase} block={p.block} open={openPage} />)
    yield c.slots.register({ name: 'tool.call.toolview', key: 'wiki_search' }, (p: any) => <SearchRow phase={p.phase} block={p.block} open={openPage} />)
  })

  // 会话欢迎页（hero）的快捷开始：0.2.1 新开的 conversation.hero.options（list，session 作用域，
  // 新会话行里工作区与 preset 控件之后右对齐）。原先借的 hero.agentPreset 是 single 槽，归宿主的
  // preset 选择器（ui-agent-preset），占了会把它顶掉。cwd 是库目录的会话才露面，点一枚只填不发
  c.slots.inject('conversation.hero.options', () => c.slots.register(
    { name: 'conversation.hero.options', id: 'wiki' }, withEnv(env, HeroPreset)))

  // 输入框 @ 补全
  c.inject(['inputTriggers'], (cc: any) => {
    cc.effect(() => cc.inputTriggers.registerSource(wikiSource(env.api, openPage)), 'dsh-knowledge-brain: @ source')
  })

  // 设置 → 插件 里的库路径卡片（DSH 不按 schema 自动出表单）；和「终端」同一套暂存表单模型，改完只在保存时写
  c.inject(['configForms'], (cc: any) => {
    const model = new SettingsFormModel(cc.configForms.get('dsh-knowledge-brain'), [
      settingsTextField('vaultDir'),
      larkAppsField('larkApps'),
      mcpServersField('mcpServers'),
    ])
    const store = model.bind(() => ({
      ...model.shell(), vaultDir: model.field('vaultDir'), larkApps: model.field('larkApps'), mcpServers: model.field('mcpServers'),
    }))
    const actions = model.actions()
    cc.effect(() => () => model.dispose(), 'dsh-knowledge-brain: settings form')
    cc.effect(() => cc.configForms.whileServed(['dsh-knowledge-brain'], () => cc.slots.inject('plugins.item', () => cc.slots.register({
      name: 'plugins.item', id: 'dsh-knowledge-brain', order: 50, label: () => '格物致知',
      inject: () => ({ wikiForm: store, ...actions }),
    }, withEnv(env, WikiSettingsCard)))), 'dsh-knowledge-brain: settings')
  })

  c.inject(['shortcuts'], (cc: any) => registerShortcuts(cc))
}

// 左栏入口的图标：DSH 把它渲染在入口按钮里；要「点入口」的回调时，挂在外层按钮上（点到图标或文字都算）
function PanelGlyph({ Icon, size, onClick }: { Icon: ComponentType<{ size?: number }>; size: number; onClick: (() => void) | null }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const btn = ref.current?.closest('button')
    if (!btn || !onClick) return
    btn.addEventListener('click', onClick)
    return () => btn.removeEventListener('click', onClick)
  }, [onClick])
  return <span ref={ref} style={{ display: 'contents' }}><Icon size={size} /></span>
}
