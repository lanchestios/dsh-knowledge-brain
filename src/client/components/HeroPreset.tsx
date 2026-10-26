import { Button } from '../ui'
import { useEffect, useState } from 'react'
import { useEnv } from '../env'
import { FIRST_STEPS } from '../lib/launch'
import { sameDir } from '../lib/sessions'

// Tailwind recipes for this surface.
const s: Record<string, string> = {
  "wrap": "wk:flex wk:items-center wk:gap-[6px] wk:flex-wrap wk:ml-2",
  "chip": "wk:h-[26px] wk:py-0 wk:px-3 wk:rounded-full wk:[border:1px_solid_var(--wk-alias-border-l2)] wk:bg-[var(--wk-alias-bg-layer-1)] wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground wk:cursor-pointer wk:[&:hover]:border-primary wk:[&:hover]:text-primary wk:[&:active]:[transform:scale(.97)]",
}

// 会话欢迎页（DSH hero）里的快捷开始：挂进 conversation.content 工厂的 conversation.hero.options
// （session 作用域，只在空白欢迎相位、新会话行里渲染），
// cwd 是库目录的会话才露面（原生聊天里非库会话不出）。点一枚把这句搭好的话填进输入框
// （只填不发）——跟启动台第一步卡共用 FIRST_STEPS 一份
export function HeroPreset(props: any) {
  // 没会话或输入框没好就不出。
  // props 可能缺（照 InputBar 的 live 判法），hooks 挪进确定有会话的子组件里调
  if (props.sessionId === undefined || !props.inputActions) return null
  return <VaultChips {...props} />
}

function VaultChips({ sessionId, useSessions, inputActions }: any) {
  const { api } = useEnv()
  const [dir, setDir] = useState('')
  useEffect(() => {
    let live = true
    api.status().then((st: { dir: string }) => { if (live) setDir(st.dir) }).catch(() => {})
    return () => { live = false }
  }, [api])
  const cwd = useSessions((st: any) => st.byId[sessionId]?.cwd)
  // 库目录常带尾斜杠、会话 cwd 被宿主规整成不带：严格相等永远对不上，chip 一直不出
  if (!dir || !sameDir(cwd, dir)) return null
  return (
    <div data-wiki-ui="" className={s.wrap}>
      {FIRST_STEPS.map((f) => (
        <Button size="sm" key={f.name} className={s.chip} onClick={() => inputActions.setDraft(f.say)}>{f.name}</Button>
      ))}
    </div>
  )
}
