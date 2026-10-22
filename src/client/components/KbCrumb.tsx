import { Fragment, useState } from 'react'
import { Button, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCheckMark } from '../../icon'
import { useEnv } from '../env'
import { useNav } from '../lib/nav'
import { usePage } from '../lib/page'
import s from './KbCrumb.module.css'

// 状态词 → Tag tone，两个 header 一张表：进行中 warning，完成 success。
// 确认与完成同绿，靠文字区分——「完成」在探索区也出现，同词同色优先于区域内的颜色分级
const TONE = { 草稿: 'warning', 完成: 'success', 确认: 'success' } as const

// 顶栏面包屑（沉淀区）：知识库 › 上级页… › 本页，只在页路由显示；图谱、标签、主页不显示。
// 结构与 ExploreCrumb 同构（行内文本流，› 是文字），状态与动作拆在后面的 tail 里——
// 塞进 crumb 会被它的 ellipsis 裁掉，也不能像 flex 那样自己撑间距。
// 状态合并成一枚 DSH Tag：草稿（status: draft）→ 完成（非草稿、没人核过）→ 确认（verified 有人工条目）。
// 草稿给「标记完成」icon（wiki page mark stable，Host 白名单）；确认不设按钮——人工确认走 CLI（wiki page verify），这里要有摩擦。
// 动作一律 icon 按钮 + Tooltip 提示动作名（两个 header 同规）；「编辑」入口在顶栏右簇图谱左侧（editor/EditControls）
export function KbCrumb() {
  const { api } = useEnv()
  const { route, go } = useNav()
  const page = usePage()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 沉淀两页（草稿 / 动态）：只有一级，落点直接挂知识库下
  if (route.kind === 'drafts' || route.kind === 'activity') {
    return <span className={s.crumb}><button onClick={() => go({ kind: 'kb' })}>知识库</button> › <span>{route.kind === 'drafts' ? '草稿' : '动态'}</span></span>
  }
  if (route.kind !== 'page') return null
  // 翻页时旧页数据会先留一会儿，按 id 判不过就不显示
  const p = page?.ok && page.page.id === route.id ? page.page : null
  const state = !p ? null : p.status.draft ? '草稿' : p.status.human ? '确认' : '完成'
  const mark = async () => {
    setBusy(true); setErr('')
    try { await api.mark(p!.id) } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }
  return (
    <>
      <span className={s.crumb}>
        <button onClick={() => go({ kind: 'kb' })}>知识库</button>
        {(p?.crumbs ?? []).map((c) => (
          <Fragment key={c.id}> › <button onClick={() => go({ kind: 'page', id: c.id })}>{c.name}</button></Fragment>
        ))}
        {p && <> › <span>{p.title}</span></>}
      </span>
      {state && (
        <span className={s.tail}>
          {err && <span className={s.err} title={err}>操作失败</span>}
          <Tag tone={TONE[state]}>{state}</Tag>
          {state === '草稿' && (
            <Tooltip label="标记完成" side="bottom" portal>
              <Button variant="ghost" size="sm" disabled={busy} icon={<IconCheckMark size={16} />} onClick={() => void mark()} aria-label="标记完成" />
            </Tooltip>
          )}
        </span>
      )}
    </>
  )
}
