import { useEnv } from '../env'
import { useData } from '../lib/nav'
import { MATERIAL_LABEL, stat } from './BooksShelf'
import type { Document } from '../../core/api'
import s from './documents.module.css'

// 右栏「属性」里的区情卡（书架 / 一本书 / 文档表三张，样式跟 DocumentPanel 同一套栏内卡）：
// 主区已经是内容本身，这里给的是侧过来看的账——进度统计与沉淀去向。数据走各自的 api，不依赖阅读器发布

const TYPES = ['pdf', 'html', 'md', '其他']
const typeOf = (m: Document) => (['pdf', 'html', 'md'].includes(m.ext) ? m.ext : '其他')

// 书架：图书馆的账——几本在读、章进度汇总、在读哪几本
export function ShelfPanel() {
  const { api } = useEnv()
  const books = useData(() => api.books(), [], 'documents')
  if (!books) return null
  const reading = books.filter((b) => b.progress === '在读')
  const chs = books.flatMap((b) => b.chapters)
  return (
    <div className={s.panel}>
      <div><div className={s.lbl}>图书馆</div><div className={s.meta}>{books.length} 本 · 在读 {reading.length} 本</div></div>
      <div><div className={s.lbl}>章进度</div>
        <div className={s.meta}>共 {chs.length} 章 · 读过 {chs.filter((c) => c.read).length} · 沉淀中 {chs.filter((c) => c.state === 'depositing').length} · 完成 {chs.filter((c) => c.state === 'done').length}</div></div>
      <div><div className={s.lbl}>在读</div>
        {reading.length === 0 && <div className={s.meta}>没有在读的书</div>}
        {reading.map((b) => <div key={b.name} className={s.meta}>{b.name}</div>)}
      </div>
    </div>
  )
}

// 一本书：源文件、进度统计、全书沉淀页清单（页名点了直接进）
export function BookPanel({ name }: { name: string }) {
  const { api, openKb } = useEnv()
  const b = useData(() => api.book(name), [name], 'documents')
  if (!b) return null
  const st = stat(b)
  const pages = b.chapters.flatMap((c) => c.pages)
  return (
    <div className={s.panel}>
      <div><div className={s.lbl}>源文件</div><div className={s.meta}>{b.source ?? '没有源文件'}</div></div>
      <div><div className={s.lbl}>文字转换</div><div className={s.meta}>{MATERIAL_LABEL[b.materialStatus]}</div></div>
      <div><div className={s.lbl}>进度</div>
        <div className={s.meta}>{b.progress || '未读'} · 读过 {st.read} / {b.chapters.length} 章 · 沉淀中 {st.depositing} · 完成 {st.done}</div></div>
      <div><div className={s.lbl}>知识沉淀 {pages.length}</div>
        {pages.length === 0 && <div className={s.meta}>这本书还没有登记沉淀页</div>}
        {pages.map((p) => p.id
          ? <button key={p.name} className={s.link} onClick={() => openKb?.(p.id!)}>{p.name}</button>
          : <div key={p.name} className={s.meta}>{p.name}（库里找不到这一页）</div>)}
      </div>
    </div>
  )
}

// 文档表：状态账 + 按类型分布（表头那行 meta 的加强版）
export function DocumentsSummary() {
  const { api } = useEnv()
  const all = useData(() => api.documents(), [], 'documents')
  if (!all) return null
  const n = (st: string) => all.filter((m) => m.status === st).length
  return (
    <div className={s.panel}>
      <div><div className={s.lbl}>状态</div>
        <div className={s.meta}>{all.length} 份 · 未沉淀 {n('unprocessed')} · 沉淀中 {n('processing')} · 已引用 {n('cited')} · 完成 {n('done')}</div>
        <div className={s.meta}>待沉淀 {n('unprocessed') + n('processing')}</div></div>
      <div><div className={s.lbl}>按类型</div>
        <div className={s.meta}>{TYPES.map((t) => `${t} ${all.filter((m) => typeOf(m) === t).length}`).join(' · ')}</div></div>
    </div>
  )
}
