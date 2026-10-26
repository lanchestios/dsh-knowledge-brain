import { useMemo } from 'react'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import { DocView } from '../../editor'
import type { EditorIo } from '../../editor'
import { assetRel, assetUrl } from '../lib/asset'
import { useChapter } from '../lib/page'
import { openWikiRef, routeForRef, useRouteMenu } from '../components/RouteMenu'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "root": "wk:h-full wk:flex wk:min-h-0",
  "pane": "wk:flex-1 wk:min-w-0 wk:min-h-0 wk:flex wk:flex-col",
  "scroll": "wk:flex-1 wk:min-h-0 wk:overflow-auto",
  "raw": "wk:max-w-240 wk:my-0 wk:mx-auto wk:py-8 wk:px-10 wk:[font:var(--wk-font-markdown-base)] wk:leading-[1.75] wk:text-foreground wk:whitespace-pre-wrap wk:[word-break:break-word] wk:[&_p]:my-[.9em] wk:[&_p]:mx-0 wk:[&_.wk-explore-reader-h]:font-semibold wk:[&_.wk-explore-reader-h]:mt-[1.5em] wk:[&_.wk-explore-reader-h]:mr-0 wk:[&_.wk-explore-reader-h]:mb-[.5em] wk:[&_.wk-explore-reader-h]:ml-0 wk:[@container_(max-width:_700px)]:p-4",
  "md": "wk:max-w-240 wk:my-0 wk:mx-auto wk:py-8 wk:px-10 wk:[@container_(max-width:_700px)]:p-4",
  "empty": "wk:py-10 wk:px-6 wk:flex wk:flex-col wk:gap-[10px] wk:items-start wk:text-secondary-foreground wk:text-sm wk:leading-normal wk:font-sans wk:font-normal",
  "h": "wk-explore-reader-h",
}

// 章节原文 = 只读 DocView：save 不可达（ok:false）、exit 不传、mode 恒 read。
// 章节不是模型页——renderBlocks/resolveAsset 用章节 md 的库内路径当 docId（图按章节文件解析）
function ChapterDoc({ text, hash, docId }: { text: string; hash: string; docId: string }) {
  const env = useEnv()
  const { api, openExternal } = env
  const { go, openTab } = useNav()
  // 右键双链：「打开 / 在新标签页打开」（同 WikiEditor）
  const menu = useRouteMenu()
  const showMenu = menu?.show
  const dark = env.useDark()
  const io = useMemo<EditorIo>(() => ({
    load: async () => ({ text, hash }),
    save: async () => ({ ok: false }),
    renderBlocks: (srcs) => api.renderBlocks(docId, srcs).then((r) => r.htmls),
    resolveNames: (names) => api.resolveNames(names),
    resolveAsset: (href) => { const rel = assetRel(docId, href); return rel ? { url: assetUrl(rel), title: rel } : null },
    open: (ref) => {
      if (ref.kind === 'href') { if (/^https?:\/\//i.test(ref.href)) openExternal(ref.href); return }   // 章节原文不跳库内文档链接（照旧）
      // 双链 / 页链：修饰键在解析前取走（Cmd+点开新 tab）；跳转失败不当错误弹（宿主崩溃纪律：无裸 promise）
      void openWikiRef({ api, go, openTab }, ref).catch(() => {})
    },
    menu: showMenu ? (ref, at) => showMenu({ clientX: at.x, clientY: at.y, preventDefault: () => {} }, () => routeForRef(api, ref)) : undefined,
  }), [api, go, openTab, openExternal, text, hash, docId, showMenu])
  return <div data-tab-source=""><DocView io={io} mode="read" dark={dark} />{menu?.node}</div>
}

// 读一章：章节原文（数据由 ReaderPage 取、经 ChapterCtx 下发）——真 md 走统一只读编辑器，PDF 直抽的纯文本合并断行后显示。
// 状态与动作（标记已读 / 知识沉淀 / 标记完成）在顶栏面包屑旁（ExploreCrumb），这里只有原文
export function ChapterReader({ book, id }: { book: string; id: string }) {
  const data = useChapter() // 阅读器取一份，右栏「属性」共用
  if (!data || data.book !== book || data.chapter.id !== id) return null
  return (
    <div data-wiki-ui="" className={s.root}>
      <div data-wiki-ui="" className={s.pane}>
        <div data-wiki-ui="" className={s.scroll}>{data.text && data.hash ? <div data-wiki-ui="" className={s.md}><ChapterDoc text={data.text} hash={data.hash} docId={data.chapter.text!} /></div> : data.raw ? <RawText text={data.raw} /> : <div data-wiki-ui="" className={s.empty}>{data.readable ? '这一章没有抽出原文。' : '这本书还在整理（补图、梳理、质检），完成转为「可读」后才能在这里读。'}</div>}</div>
      </div>
    </div>
  )
}

function RawText({ text }: { text: string }) {
  const heading = (p: string) => /^(Chapter \d+|\d+(\.\d+)*\s{2,}\S)/.test(p) || (p.length <= 40 && !/[.。]$/.test(p))
  return <div data-wiki-ui="" className={s.raw}>{text.split('\n').filter((p) => p.trim()).map((p, i) => <p data-wiki-ui="" key={i} className={heading(p) ? s.h : undefined}>{p}</p>)}</div>
}
