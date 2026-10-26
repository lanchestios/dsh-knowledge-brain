import fs from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { treeJson, graphJson } from '../core/vault/sitedata'
import { home, page, tagPages, pageLists } from '../core/model'
import { search } from '../core/search'
import { rawTree, readRaw } from '../core/raw'
import { inside } from '../core/guard'
import { loadBooks, readChapter, chapterMarkdown } from '../core/books'
import { renderPage } from '../core/render'
import { BlockHtmlCache } from '../core/vault/blockcache'
import { resolvePage, resolveRef, resolveNameStates } from '../core/llm'
import type { Book } from '../core/api'
import { loadDocuments } from '../core/documents'
import { createActions, runWiki, writeAtomic, type Place } from './actions'
import { nodeRel, folderRel, moveImpact } from '../core/tree-edit'
import { initPlan, createVault } from '../core/vault/create'
import { vaultTools } from './pkg'
import { verifyApp } from '../lark/channel.js'
import type { Hub } from '../core/hub'

type P = Record<string, any>
const id = (d: any) => d._id

export function registerRpc(ctx: Context, hub: Hub,
  lark?: import('../lark/mount.js').LarkHandle,
  verify: (appId: string, appSecret: string) => Promise<import('../lark/channel.js').VerifyResult> = verifyApp,
  extra?: Record<string, (p: P) => unknown>) {
  const act = createActions(() => hub.dir())
  // 登记里的 [[页名]] 按库的页名规则解析成页 id（只认唯一命中）；库没打开就原样留空
  const withPages = (b: Book): Book => {
    const m = hub.engine.model
    if (!m) return b
    return { ...b, chapters: b.chapters.map((c) => ({ ...c, pages: c.pages.map((p) => ({ name: p.name, id: resolveRef(m, p.name) })) })) }
  }
  const editable = (p: P) => {
    const rel = String(p.path ?? '')
    if (!rel.endsWith('.md')) throw new Error(`不是 md：${rel}`)
    // 原始内容只认 raw/document/（书的章节原文、进度页归 CLI 管，不在这里改）
    const abs = hub.model().byId.has(rel) ? inside(hub.dir(), rel)
      : rel.startsWith('raw/document/') ? inside(hub.dir(), rel, 'raw/document') : null
    if (!abs || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`不能编辑：${rel}`)
    return abs
  }
  const placeOf = (m: import('../core/model').Model, x: any): Place => {
    const q = x && typeof x === 'object' ? x : {}
    if (typeof q.before === 'string') return { before: nodeRel(m, q.before) }
    if (typeof q.after === 'string') return { after: nodeRel(m, q.after) }
    return q.first === true ? { first: true } : {}
  }
  const bookOf = (name: string) => { const b = loadBooks(hub.dir()).find((x) => x.name === name); if (!b) throw new Error(`书架上没有 ${name}`); return b }
  // 平台目录选择服务（ctx.directoryPicker）：native 后端开系统选目录框，browse 后端给逐层浏览的原语。
  // 不进 inject 列表——可选服务用 ctx.get 按需读（平台惯例，见 dsh-acp）：没这个服务的部署插件照常工作，只是选不了目录。
  // 错误码是平台定的封闭词汇，翻成中文给前端
  const picker = () => {
    const p = (ctx as any).get?.('directoryPicker')
    if (!p) throw new Error('本部署没有目录选择服务，无法选目录')
    return p.capability() as { kind: string } & Record<string, any>
  }
  const zhPickerError = (e: unknown, fallback: string) => {
    const c = (e as any)?.code
    if (c === 'directory-unreadable') return `目录打不开：${(e as any).path ?? ''}`
    if (c === 'directory-exists') return `同名目录已存在`
    return `${fallback}：${e instanceof Error ? e.message : String(e)}`
  }
  const handlers: Record<string, (p: P) => unknown> = {
    status: () => ({ ok: !!hub.engine.model, dir: hub.dir(), pages: hub.engine.model?.g.order.length ?? 0, error: hub.engine.error, degraded: hub.engine.degraded, validating: hub.engine.validating, checkOutput: hub.engine.checkOutput }),
    // 点「选择目录」先问后端形态：native 直接开系统选框、选完把路径带回来；browse 让前端弹层逐层浏览
    pickDir: async () => {
      const cap = picker()
      if (cap.kind !== 'native') return { kind: 'browse' }
      // 对话框可能开很久，别把请求挂成死连接；操作者取消时平台返回 null
      const path = await cap.pick(AbortSignal.timeout(600_000))
      return { kind: 'native', path: path == null ? null : String(path) }
    },
    // browse：列一层子目录；path 空 = 主目录。清单已按名排序、条目自带绝对路径和面包屑，隐藏目录带标记
    fsDirs: async (p) => {
      const cap = picker()
      if (cap.kind !== 'browse') throw new Error('本部署的目录选择后端不支持逐层浏览')
      const raw = String(p.path ?? '').trim()
      try {
        return await cap.list(raw || undefined)
      } catch (e) {
        throw new Error(zhPickerError(e, '列目录失败'))
      }
    },
    // browse：在当前目录下建一个子目录（新建文件夹），成功返回新目录的绝对路径
    fsMkdir: async (p) => {
      const cap = picker()
      if (cap.kind !== 'browse') throw new Error('本部署的目录选择后端不支持建目录')
      try {
        return { path: String(await cap.createDirectory(String(p.path ?? ''), String(p.name ?? ''))) }
      } catch (e) {
        throw new Error(zhPickerError(e, '建目录失败'))
      }
    },
    // 新建知识库：先看要挪什么（设置页据此决定要不要弹确认），再真建。建在当前已打开的目录上
    // 时 vaultDir 不变、不会触发重开，这里手动重开一次，让校验与模型跟上
    // 修好之后重新校验：vaultDir 没变时配置不触发重开，设置页「打开」同一目录走这里
    reopen: () => { hub.reopen(); return { ok: true } },
    initPlan: (p) => initPlan(String(p.dir ?? ''), { run: runWiki, wikiBin: vaultTools('bin', 'wiki'), toolsDir: vaultTools() }),
    create: async (p) => {
      const dir = String(p.dir ?? '')
      const r = await createVault(dir, String(p.template ?? ''), { run: runWiki, wikiBin: vaultTools('bin', 'wiki'), toolsDir: vaultTools() })
      if (dir === hub.dir()) hub.reopen()
      return r
    },
    home: () => home(hub.model()),
    // 沉淀两页的全量表（首页看板只取前 7）：草稿页 / 全部页按更新时间
    drafts: () => pageLists(hub.model()).drafts,
    recent: () => pageLists(hub.model()).recent,
    page: (p) => page(hub.model(), String(p.id)),
    tree: () => treeJson(hub.model().g, id),
    graph: () => graphJson(hub.model().g, id),
    tag: (p) => tagPages(hub.model(), String(p.tag)),
    search: (p) => search(hub.model().search, String(p.q ?? '')),
    rawTree: () => rawTree(hub.dir()),
    raw: (p) => readRaw(hub.model(), String(p.path)),
    // 知识探索：书与文档。书名 / 章号只认模型里已有的（白名单）
    books: () => loadBooks(hub.dir()),
    book: (p) => withPages(bookOf(String(p.name))),
    // 章节原文带 md 结构（标题、图、表、代码块）时按文档 md 渲染，相对图片路径随章节文件解析；
    // text/hash 给只读宿主（Task 16），hash 与 DocStore 自校验同口径（mtimeMs:size，对章节 md stat）
    chapter: async (p) => {
      const b = bookOf(String(p.book))
      const c = b.chapters.find((x) => x.id === String(p.id))
      const md = c?.text ? chapterMarkdown(hub.dir(), c.text) : null
      if (c?.text && md !== null) {
        const chAbs = inside(hub.dir(), c.text)
        const st = chAbs ? fs.statSync(chAbs, { throwIfNoEntry: false }) : undefined
        const { html, toc } = await renderPage({ _id: c.text, _content: md }, hub.model())
        return { book: b.name, chapter: c, raw: null, html, toc, readable: true, text: md, hash: st ? `${st.mtimeMs}:${st.size}` : '' }
      }
      return readChapter(hub.dir(), b, String(p.id))
    },
    documents: () => loadDocuments(hub.model()),
    document: (p) => { const x = loadDocuments(hub.model()).find((y) => y.path === String(p.path)); if (!x) throw new Error(`没有这份文档：${p.path}`); return x },
    // 写库：这四个走 wiki CLI（src/actions.ts 校验参数），外加下面编辑正文的 save / touchUpdated
    readChapter: (p) => act.readChapter(p as any),
    convertBook: (p) => act.convertBook(p as any),
    cover: (p) => act.cover(p as any),
    deposit: (p) => act.deposit(p as any),
    // 知识沉淀页「标记完成」：只收模型里现存的 draft 页，其余一律拒绝（白名单之外不放行）
    mark: (p) => {
      const rel = String(p.path)
      const d = hub.model().byId.get(rel)
      if (!d) throw new Error(`库里没有这页：${rel}`)
      if (d.status !== 'draft') throw new Error(`${rel} 不是草稿`)
      return act.mark({ path: rel })
    },
    // 目录拖动：节点 / 文件夹 / 兄弟都过白名单（沉淀五区之内、区根不算节点）；位置只认一个
    moveImpact: (p) => moveImpact(hub.model(), nodeRel(hub.model(), String(p.node ?? ''))),
    reorder: (p) => { const m = hub.model(); return act.reorder({ node: nodeRel(m, String(p.node ?? '')), place: placeOf(m, p.place) }) },
    move: (p) => { const m = hub.model(); return act.move({ node: nodeRel(m, String(p.node ?? '')), folder: folderRel(m, String(p.folder ?? '')), place: placeOf(m, p.place) }) },
    // 编辑正文：可编辑白名单只留给 save/touchUpdated；source 放开为「模型内 md 或 raw/ 下 md」
    // 任意可读（RawView/章节等只读宿主也要 load 源文）
    source: (p) => {
      const rel = String(p.path ?? '')
      const abs = hub.model().byId.has(rel) ? inside(hub.dir(), rel)
        : rel.startsWith('raw/') ? inside(hub.dir(), rel, 'raw') : null
      if (!abs || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`读不到：${rel}`)
      return act.source(abs)
    },
    save: (p) => act.save(editable(p), String(p.text ?? ''), String(p.baseHash ?? '')),
    touchUpdated: (p) => {
      const abs = editable(p)
      if (!hub.model().byId.has(String(p.path))) throw new Error('文件没有 updated')
      return act.touchUpdated(abs)
    },
    // excalidraw 场景保存（覆盖层画布）：白名单钉死 asset/diagrams/ 下的 .excalidraw，
    // 场景轻校验（type + elements 数组）。后写覆盖、不设冲突协议（个人库单人画、全屏覆盖层互斥）；
    // 纯附件写——不动 md、不刷 updated、不进台账。成功后广播资产变更让别的视图换新图
    saveExcalidraw: (p) => {
      const rel = String(p.path ?? '')
      if (!/^asset\/diagrams\/[^/\n][^\n]*\.excalidraw$/.test(rel)) throw new Error(`不是场景路径：${rel}`)
      const abs = inside(hub.dir(), rel, 'asset')
      if (!abs) throw new Error(`不能写：${rel}`)
      const scene = p.scene
      if (!scene || typeof scene !== 'object' || Array.isArray(scene) || (scene as P).type !== 'excalidraw' || !Array.isArray((scene as P).elements))
        throw new Error('场景内容不合法（要 {type:"excalidraw", elements:[…]}）')
      writeAtomic(abs, JSON.stringify(scene))
      hub.assetChanged(rel)
      return { ok: true }
    },
    // 编辑器批量双链态（死链着色）：按全站规则解析（路径精确 / 裸名唯一），与链接所在页无关
    resolveNames: (p) => resolveNameStates(hub.model(), Array.isArray(p.names) ? p.names.map(String) : []),
    // 编辑器里非文本块（代码、表格、公式、嵌入）与行内公式的批量渲染；宿主 blockHtml 内存缓存，
    // 命中零渲染。同窗去重在 BatchStore（客户端）已做一层，这里再按 src 去重一次；顺序对应返回。
    renderBlocks: async (p) => {
      const path = String(p.path ?? '')
      const srcs = Array.isArray(p.srcs) ? p.srcs.map(String) : []
      const m = hub.model()
      let cache = m.blockHtml.get(path)
      if (!cache) { cache = new BlockHtmlCache(); m.blockHtml.set(path, cache) }
      // 本批的 promise 自己拿着：一批 src 可以多过缓存上限（表格每格各一条），写进缓存后再回读，
      // 先写的已被后写的挤出，拿到 undefined——页首的嵌入件就这样一直停在源码
      const bySrc = new Map<string, Promise<string>>()
      const c = cache
      for (const src of new Set(srcs)) {
        let p = c.get(src)
        if (!p) {
          // 失败照返空串（widget 退源码），但不留缓存、报进日志——一次偶发错误不该钉死到重启
          p = renderPage({ _id: path, _content: src }, m).then((r) => r.html).catch((err) => {
            ctx.logger.warn('renderBlocks 失败 %s：%s', path, err?.stack ?? err)
            c.delete(src)
            return ''
          })
          c.set(src, p)
        }
        bySrc.set(src, p)
      }
      return { htmls: await Promise.all(srcs.map((x) => bySrc.get(x)!)) }
    },
    // 编辑器里点击双链：按全站规则解析（路径精确 / 裸名唯一）
    resolve: (p) => ({ id: resolveRef(hub.model(), String(p.name)) }),
    // Lark问答通道的只读视图（status 不含 app_secret）＋ 草稿凭证验证（secret 只进请求不进结果）
    ...(lark ? {
      larkStatus: () => lark.status(),
      larkVerify: (p) => verify(String(p?.appId ?? ''), String(p?.appSecret ?? '')),
      // 检测通过后补连：只按 app_id 找已存配置（凭证取存档），不收草稿 secret
      larkReconnect: (p) => lark.reconnect(String(p?.appId ?? '')),
    } : {}),
    ...(extra ?? {}),
  }
  // 通用 RPC 通道要借本插件 ctx 访问 webServer，第三方插件拿不到；改走 connection 自己的 /api 下的精确路由
  ;(ctx as any).connection.fetch.register({
    path: '/api/wiki.rpc', methods: ['POST'], requestBody: 'buffered',
    fetch: async (req: Request) => {
      let body: { method?: string; payload?: P }
      try { body = await req.json() } catch { return Response.json({ ok: false, error: { code: 'bad-request', message: '请求体不是 JSON' } }, { status: 400 }) }
      const h = handlers[String(body.method)]
      if (!h) return Response.json({ ok: false, error: { code: 'not-found', message: `未知方法 ${body.method}` } }, { status: 404 })
      try {
        return Response.json({ ok: true, value: (await h(body.payload ?? {})) ?? null })
      } catch (e) {
        return Response.json({ ok: false, error: { code: 'wiki', message: e instanceof Error ? e.message : String(e) } })
      }
    },
  })
}
