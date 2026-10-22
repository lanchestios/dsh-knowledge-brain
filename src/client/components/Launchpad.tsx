import { useState, type ReactNode } from 'react'
import { IconArchiveOutlineRegular, IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconIncrease } from '../../icon'
import { useEnv } from '../env'
import { usePanel } from '../lib/panelCtx'
import { openScene } from '../lib/sessions'
import { FIRST_STEPS } from '../lib/launch'
import s from './Launchpad.module.css'

interface ExploreStart {
  name: string
  hint: string
  say: string
  icon: ReactNode
}

const GUIDED_STARTS: ExploreStart[] = [
  {
    name: '书籍',
    hint: '导入第一本书',
    say: FIRST_STEPS[1].say,
    icon: <IconBrowseOutlineRegular size={18} />,
  },
  {
    name: '文档',
    hint: '收下第一篇文章',
    say: FIRST_STEPS[0].say,
    icon: <IconArchiveOutlineRegular size={18} />,
  },
]

// 空库直接预演知识库首页：探索入口是真行动，沉淀区则展示内容形成后的落点。不自动开右栏、
// 不自动建会话；点一张入口卡是场景按钮——新开一场会话挂右栏，这一步的话直接发出去。
// 文件一变，HomeView 会自然切回真实首页。
export function Launchpad() {
  const { api, c } = useEnv()
  const panel = usePanel()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const step = (say: string) => {
    if (busy) return
    setBusy(true)
    setErr('')
    openScene(panel, c, api, say)
      .catch((e: unknown) => setErr(String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className={s.root}>
      <header className={s.hero}>
        <div>
          <span className={s.eyebrow}>知识库</span>
          <h1 className={s.title}>格物致知</h1>
        </div>
        <p className={s.summary} aria-label="知识库目前为空">
          <span><strong>0</strong> 页知识</span>
          <i />
          <span><strong>0</strong> 篇草稿</span>
          <i />
          <span><strong>0</strong> 篇完成</span>
        </p>
      </header>

      {err && <p className={s.err}>会话没建起来：{err}</p>}

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>知识探索</h2>
            <p className={s.sectionSub}>先添加一份内容，首页会从这里开始生长</p>
          </div>
        </header>
        <div className={s.exploreGrid}>
          {GUIDED_STARTS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={s.exploreCard}
              disabled={busy}
              onClick={() => step(item.say)}
            >
              <span className={s.cardTitle}>{item.icon}<strong>{item.name}</strong></span>
              <span className={s.cardAction}>{item.hint}<IconIncrease size={16} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>知识沉淀</h2>
            <p className={s.sectionSub}>探索过的内容，会在这里形成自己的知识</p>
          </div>
        </header>
        <div className={s.depositGrid}>
          <section className={s.depositColumn}>
            <h3>草稿</h3>
            <p>还没有草稿</p>
          </section>
          <section className={s.depositColumn}>
            <h3>最近更新</h3>
            <p>第一页完成后会出现在这里</p>
          </section>
        </div>
      </section>
    </div>
  )
}
