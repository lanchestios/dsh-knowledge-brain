import { useEffect, useMemo, useRef, useState } from 'react'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import { DocView } from '../../editor'
import type { DocViewHandle, EditorIo } from '../../editor'
import { assetRel, assetUrl } from '../lib/asset'
import { useEdit, touches, assetRefreshRels } from '../lib/edit'
import { bumpAssetVersion } from '../../editor/blocks/excalidraw'
import { openWikiRef, routeForRef, useRouteMenu } from './RouteMenu'
import { ExcalidrawOverlay } from './ExcalidrawOverlay'

// 编辑器与 wiki 的接线（新内核）：DocView 的 io 全部落在这翻译。page = 沉淀页（退出刷 updated），
// false = raw 文档。mode 由 EditStore 决定（阅读态 = 弱化编辑态，同一实例）。
// 每个挂着的 WikiEditor 都有自己的活 saver，桥顶栏时只认正在编辑的这个实例（editing === path）
export function WikiEditor({ path, page, anchor, frontmatterVisible = false }: { path: string; page: boolean; anchor?: string; frontmatterVisible?: boolean }) {
  const env = useEnv()
  const { api, openExternal } = env
  const { go, openTab } = useNav()
  // 右键双链：「打开 / 在新标签页打开」（只在阅读器 / 左栏这类有 openTab 的导航下有，右栏为 null）
  const menu = useRouteMenu()
  const showMenu = menu?.show
  const dark = env.useDark()
  const { store, path: editing } = useEdit()
  const ref = useRef<DocViewHandle>(null)
  const mode = editing === path ? 'edit' : 'read'
  // excalidraw 画布：编辑态点图位开全屏覆盖层（rel 存在期间挂载）；setExd 稳定、不进 io 依赖
  const [exd, setExd] = useState<string | null>(null)
  const io = useMemo<EditorIo>(() => ({
    load: () => api.source(path),
    save: (text, base) => api.save(path, text, base),
    // 宿主侧预过滤。本页 md 变了走 cb（整页 reload）；excalidraw 场景被重写走定点重建（bump 版本
    // + refreshBlocks，不整页 reload、不动滚动位置），两类同帧时整页优先
    changed: (cb) => api.onChanged((ev) => {
      if (touches(path, ev)) { cb(); return }
      const rels = assetRefreshRels(ev)
      if (rels.length) { for (const r of rels) bumpAssetVersion(r); ref.current?.refreshBlocks() }
    }),
    renderBlocks: (srcs) => api.renderBlocks(path, srcs).then((r) => r.htmls),
    resolveNames: (names) => api.resolveNames(names),
    resolveAsset: (href) => { const rel = assetRel(path, href); return rel ? { url: assetUrl(rel), title: rel } : null },
    open: (ref) => {
      if (ref.kind === 'href' && /^https?:\/\//i.test(ref.href)) { openExternal(ref.href); return }
      // 双链 / 页链 / raw/ 文档：修饰键在解析前取走（Cmd+点开新 tab）；跳转失败不当错误弹（宿主崩溃纪律：无裸 promise）
      void openWikiRef({ api, go, openTab }, ref).catch(() => {})
    },
    menu: showMenu ? (ref, at) => showMenu({ clientX: at.x, clientY: at.y, preventDefault: () => {} }, () => routeForRef(api, ref)) : undefined,
    exit: page ? (changed) => { if (changed) void api.touchUpdated(path) } : undefined,
    editExcalidraw: (rel) => setExd(rel),
    // io 里的闭包都只吃 api/path/go/openExternal，这几个都是稳定引用；换了页（path 变）才换 io
  }), [api, path, go, openTab, openExternal, page, showMenu])
  // 顶栏冲突按钮落到本实例的 saver 上；卸载/不再编辑时放手（别的挂载实例随时会接管）
  useEffect(() => {
    if (!store || editing !== path) return
    store.handle = { reload: () => ref.current?.reload(), overwrite: () => ref.current?.overwrite() }
    return () => { store.handle = null }
  }, [store, editing, path])
  // data-tab-source：正文里的 Cmd/Ctrl + 点击算开新 tab（installClickModifier 只认这类区域）
  return <div data-tab-source=""><DocView ref={ref} io={io} mode={mode} dark={dark} anchor={anchor} frontmatterVisible={frontmatterVisible} onStatus={(s) => { if (editing === path) store?.setStatus(s) }} />{menu?.node}{exd && <ExcalidrawOverlay rel={exd} url={assetUrl(exd)} dark={dark} api={api} onClose={() => setExd(null)} onSaved={() => ref.current?.refreshBlocks()} />}</div>
}
