// src/editor/viewer/DocView.tsx
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { createSurface, type Surface } from '../kernel/surface'
import { refreshBlocksEffect } from '../kernel/deco'
import { detectEol, toLf, applyEol, type Eol } from '../eol'
import type { EditorIo, SaveStatus } from '../io'
import s from '../editor.module.css'
// 排版基底（article 体系）：CM6 的正文行是 div.cm-line，元素级规则够不着——基础字体/行高
// 与块渲染件内层服务端 HTML（pre/table/katex/mermaid 等）由 .article 承担，行级视觉由 deco 行 class 承担。
// 曾挂在 client 侧，T15–T17 迁移后失去唯一引用者、整篇排版随 CSS 注入一起消失
import a from '../article.module.css'

export interface DocViewHandle { scrollTo(anchor: string): void; reload(): void; overwrite(): void; refreshBlocks(): void }

// 对外唯一组件。EOL 边界在这层：CM6/saver 全程 LF，落盘前按载入时探测的 EOL 还原；
// 外部变更经 saver.external() 三分（ignored/reload/conflict）；卸载 flush + exit(changed)。
// onStatus 透传给宿主（wiki 侧桥到顶栏保存状态）；ref 存最新回调，[io] 依赖的 surface 效果不捕旧闭包。
export const DocView = forwardRef<DocViewHandle, { io: EditorIo; mode?: 'edit' | 'read'; dark?: boolean; anchor?: string; frontmatterVisible?: boolean; onStatus?: (s: SaveStatus) => void }>(
  function DocView({ io, mode = 'read', dark = false, anchor, frontmatterVisible = false, onStatus }, ref) {
    const host = useRef<HTMLDivElement>(null)
    const surf = useRef<Surface | null>(null)
    const load = useRef<() => Promise<void>>(async () => {})
    const eol = useRef<Eol>('\n')
    // 锚点只在装载完成后用一次（ref 读取，不进 effect 依赖——prop 变化本身不滚，
    // 同页锚点滚动仍归宿主 PageView 的 effect 管）
    const anchorRef = useRef(anchor)
    anchorRef.current = anchor
    const onStatusRef = useRef(onStatus)
    onStatusRef.current = onStatus
    const [st, setSt] = useState<{ phase: 'loading' } | { phase: 'error'; msg: string } | { phase: 'ready'; status: SaveStatus }>({ phase: 'loading' })

    useEffect(() => {
      let dead = false
      // saver 全程 LF 空间：落盘前在边界还原 EOL（load 也归一，保证 external() 重载同空间）。
      // eolIo 必须先于 createSurface 定义并直接作为其 io——surface 的 saver 自此建立在 LF 空间上。
      const eolIo: EditorIo = {
        ...io,
        load: async () => { const c = await io.load(); return { text: toLf(c.text), hash: c.hash } },
        save: (t, b) => io.save(applyEol(t, eol.current), b),
      }
      const sf = createSurface(host.current!, {
        io: eolIo, mode, dark, frontmatterVisible,
        onStatus: (s2) => { if (!dead) { setSt({ phase: 'ready', status: s2 }); onStatusRef.current?.(s2) } },
      })
      surf.current = sf

      const doLoad = async () => {
        try {
          const raw = await io.load()
          if (dead) return
          eol.current = detectEol(raw.text)          // 用原始文本探测（toLf 之前）
          const text = toLf(raw.text)
          sf.setText(text)
          sf.saver.reset(text, raw.hash)
          // 跨页锚点与异步装载赛跑：装载完成时锚点元素还没进 DOM，宿主侧立即查必落空——
          // 等一帧（装饰行 id 已落）再按 scrollTo 同款查一次，每次装载至多一次；dead 兜卸载竞态
          const a = anchorRef.current
          if (a) requestAnimationFrame(() => {
            if (!dead) sf.view.dom.ownerDocument.getElementById(a)?.scrollIntoView({ behavior: 'smooth' })
          })
        } catch (e) {
          if (!dead) setSt({ phase: 'error', msg: e instanceof Error ? e.message : String(e) })
        }
      }
      load.current = doLoad
      void doLoad()

      const unsub = io.changed?.(() => {
        void (async () => {
          const r = await sf.saver.external().catch(() => null)
          if (dead || !r) return
          if (r.kind === 'reload') await doLoad()      // saver.reset 在 doLoad 里
          // conflict：saver 已置 conflict 态；UI 横幅给「覆盖 / 重新载入」
        })()
      })

      return () => {
        dead = true
        unsub?.()
        surf.current = null
        // 冲突中离开（切页/⌘跳转）：flush 对 conflict 直接返回、会静默丢稿——镜像旧 Editor 的
        // 卸载 confirm（DocView 无文件名，用通用措辞）。确定 = overwrite（它本身就是写，跳过 flush）；
        // 取消 = 丢弃本地改动。两条路都照常 detach + exit(changed)
        if (sf.saver.conflict && sf.saver.dirty) {
          sf.saver.detach()
          if (window.confirm('这份文档在别处被改过，你还有没保存的改动。\n确定 = 用你的版本覆盖；取消 = 丢弃你的改动')) {
            void sf.saver.overwrite().then(() => io.exit?.(sf.saver.changed)).catch(console.error)
          } else {
            io.exit?.(sf.saver.changed)
          }
          sf.destroy()
          return
        }
        void sf.saver.flush()
          .catch(() => {})
          .then(() => { sf.saver.detach(); io.exit?.(sf.saver.changed) })
        sf.destroy()
      }
    }, [io])

    useEffect(() => { surf.current?.setMode(mode) }, [mode])
    useEffect(() => { surf.current?.setDark(dark) }, [dark])
    useEffect(() => { surf.current?.setFrontmatterVisible(frontmatterVisible) }, [frontmatterVisible])
    useImperativeHandle(ref, () => ({
      scrollTo(anchor) { surf.current?.view.dom.ownerDocument.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }) },
      reload() { void load.current() },
      overwrite() { void surf.current?.saver.overwrite() },
      refreshBlocks() { surf.current?.view.dispatch({ effects: refreshBlocksEffect.of(null) }) },
    }), [])

    // 有未存内容时关页要提示（旧 Editor 同语义：ready 且非 saved 才拦，其余状态不挂）
    useEffect(() => {
      if (st.phase !== 'ready' || st.status === 'saved') return
      const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
      document.addEventListener('beforeunload', onUnload)
      return () => document.removeEventListener('beforeunload', onUnload)
    }, [st])

    return (
      <div className={`${a.article} ${s.docView}`}>
        <div ref={host} />
        {st.phase === 'error' && <div className={s.err}>载入失败：{st.msg}</div>}
        {st.phase === 'ready' && st.status === 'conflict' && (
          <div className={s.conflict}>
            这份文档在别处被修改了。
            <button onClick={() => void surf.current?.saver.overwrite()}>覆盖远端</button>
            <button onClick={() => void load.current()}>重新载入</button>
          </div>
        )}
      </div>
    )
  },
)
