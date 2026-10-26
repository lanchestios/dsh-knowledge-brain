import { useState } from 'react'
import { Button, Tag, Tooltip, BreadcrumbTrail } from '../ui'
import { IconAiAssistant, IconCheckMark, IconWrite } from '../../icon'
import { useEnv } from '../env'
import { useData, useNav } from '../lib/nav'
import { useRaw } from '../lib/page'
import { requestFill } from '../lib/fill'
import { DOCUMENT_LABEL } from '../lib/explore'
import { STATE_LABEL } from './BooksShelf'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "tail": "wk:flex-none wk:inline-flex wk:items-center wk:gap-2 wk:ml-2 wk:text-[13px] wk:leading-normal wk:font-sans wk:font-normal",
  "err": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-destructive",
}

// 状态词 → Tag tone，与 KbCrumb 一张表：进行中 warning，完成 success（同词同色优先于面板内的颜色分级）
const TONE = { unread: 'neutral', read: 'info', depositing: 'warning', done: 'success' } as const
// 文档同一套：没动 neutral（同未读）、有页引了 info（同已读）、沉淀中 warning、完成 success
const MAT_TONE = { unprocessed: 'neutral', cited: 'info', processing: 'warning', done: 'success' } as const

// 顶栏面包屑（探索区）：知识库 › 书架 › 书 › 章 / 知识库 › 文档 › 一份；首页不显示。
// 结构与 KbCrumb 同构（行内文本流 + tail，面包屑布局样式 的 tail 照抄它的）：读一章时状态与动作上顶栏——
// 未读「标记已读」（wiki book read）→ 已读「知识沉淀」（wiki book deposit + 在这一章的会话里填好指令，不发送）→
// 沉淀中「标记完成」（wiki book deposit --done，只由人标）→ 完成：没有按钮。
// icon 一套：勾掉类动作（已读 / 完成）✓，动笔（知识沉淀）笔——与 KbCrumb 的「标记完成」同一个 ✓
// 读一份文档：状态（文档两层状态合一）+「标记完成」（wiki document cover 完成，身份 human:）；
// md 文档的「编辑」入口在顶栏右簇。已引用另给「继续沉淀」（wiki document cover 沉淀中），已完成没有按钮。
// 读一份听录：frontmatter 状态 +「提炼」（右栏打开绑定会话），位置和控件规格与沉淀页一致。
// 状态是 DSH Tag；动作一律 icon 按钮 + Tooltip 提示动作名
export function ExploreCrumb() {
  const { api } = useEnv()
  const { route, go } = useNav()
  const raw = useRaw()
  const bookName = route.kind === 'book' ? route.name : route.kind === 'chapter' ? route.book : null
  const book = useData(() => (bookName ? api.book(bookName) : Promise.resolve(undefined)), [bookName], 'documents')
  const documentPath = route.kind === 'raw' && route.path.startsWith('raw/document/') ? route.path : null
  const document = useData(() => (documentPath ? api.document(documentPath) : Promise.resolve(undefined)), [documentPath], 'documents')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const root = { label: '知识库', onClick: () => go({ kind: 'kb' }) }
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f() } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }
  if (route.kind === 'documents') return <BreadcrumbTrail items={[root, { label: `文档 · ${route.status ?? '待沉淀'}` }]} />
  if (route.kind === 'raw') {
    const m = document?.path === route.path ? document : null
    const path = route.path
    const name = route.path.split('/').pop()
    return (
      <>
        <BreadcrumbTrail items={[root, { label: '文档', onClick: () => go({ kind: 'documents', status: '待沉淀' }) }, { label: name }]} />
        {m && (
          <span data-wiki-ui="" className={s.tail}>
            {err && <span data-wiki-ui="" className={s.err} title={err}>操作失败</span>}
            <Tag tone={MAT_TONE[m.status]}>{DOCUMENT_LABEL[m.status]}</Tag>
            {m.status === 'cited' && (
              <Tooltip label="继续沉淀" side="bottom">
                <Button variant="ghost" size="sm" disabled={busy} icon={<IconWrite size={16} />} onClick={() => void run(() => api.cover(path, 'processing'))} aria-label="继续沉淀" />
              </Tooltip>
            )}
            {m.status !== 'done' && (
              <Tooltip label="标记完成" side="bottom">
                <Button variant="ghost" size="sm" disabled={busy} icon={<IconCheckMark size={16} />} onClick={() => void run(() => api.cover(path, 'done'))} aria-label="标记完成" />
              </Tooltip>
            )}
          </span>
        )}
      </>
    )
  }
  if (!bookName) return route.kind === 'books' ? <BreadcrumbTrail items={[root, { label: '书架' }]} /> : null
  const ch = route.kind === 'chapter' && book?.chapters.find((c) => c.id === route.id)
  const act = ch ? {
    unread: { label: '标记已读', icon: <IconCheckMark size={16} />, go: () => api.readChapter(bookName, ch.id) },
    read: { label: '知识沉淀', icon: <IconWrite size={16} />, go: async () => { await api.deposit(bookName, ch.id); requestFill({ kind: 'chapter', book: bookName, id: ch.id, text: ch.text }) } },
    depositing: { label: '标记完成', icon: <IconCheckMark size={16} />, go: () => api.deposit(bookName, ch.id, true) },
    done: null,
  }[ch.state] : null
  return (
    <>
      <BreadcrumbTrail items={[
        root, { label: '书架', onClick: () => go({ kind: 'books' }) },
        { label: bookName, onClick: ch ? () => go({ kind: 'book', name: bookName }) : undefined },
        ...(ch ? [{ label: `${ch.id} ${ch.title}` }] : []),
      ]} />
      {ch && (
        <span data-wiki-ui="" className={s.tail}>
          {err && <span data-wiki-ui="" className={s.err} title={err}>操作失败</span>}
          <Tag tone={TONE[ch.state]}>{STATE_LABEL[ch.state]}</Tag>
          {act && (
            <Tooltip label={act.label} side="bottom">
              <Button variant="ghost" size="sm" disabled={busy} icon={act.icon} onClick={() => void run(act.go)} aria-label={act.label} />
            </Tooltip>
          )}
        </span>
      )}
    </>
  )
}
