import { useEffect, useState, type ReactNode } from 'react'
import { applyDraft, onDraft } from '../lib/sessions'

// 右栏里的一个 DSH 会话：外层用 rightbar 注册拿到的 SessionProvider 包住会话引用，
// 里面渲染本插件声明的会话作用域子插槽 dsh-knowledge-brain.session，由 SessionChat 调 DSH 的 conversation.content 工厂画对话。
// 做法照 ui-subagent/sidebar-chat（子 agent 的侧栏对话）
export const SESSION_SLOT = 'dsh-knowledge-brain.session'

export function SessionPane({ c, sessionId, SessionProvider, renderSlot }: {
  c: any; sessionId: string; SessionProvider: (p: { session?: unknown; children: ReactNode }) => ReactNode; renderSlot: (k: string, o: object) => ReactNode
}) {
  const [ref, setRef] = useState<any>(null)
  useEffect(() => {
    const r = c.get('sessions').retain(sessionId, { source: 'dsh-knowledge-brain' })
    setRef(r)
    // 引用计数：只放一次（release 返回 undefined，别再接着 dispose）
    return () => { try { if (r.release) r.release(); else r[Symbol.dispose]?.() } catch { /* 已释放 */ } }
  }, [c, sessionId])
  if (!ref) return null
  return <SessionProvider session={ref}>{renderSlot(SESSION_SLOT, {})}</SessionProvider>
}

// 子插槽里的组件：会话作用域标准 props（useSession / useConversation / useSessions）+ renderFactorySlot
function FixedChatView(props: any) { return <>{props.renderSlot('conversation.session', { view: 'chat' })}</> }

export function SessionChat({ sessionId, useSession, useConversation, useSessions, renderFactorySlot, inputActions }: any) {
  // 排给这个会话的草稿：取走填进输入框；场景按钮排的（send）接着发送，退路话题只填不发
  useEffect(() => {
    if (!inputActions) return                     // 输入框还没好：草稿留在队列里，等它好了再取
    const apply = () => applyDraft(sessionId, inputActions)
    apply()
    return onDraft(apply)
  }, [sessionId, inputActions])
  const session = useSession((v: any) => v)
  const conversation = useConversation((v: any) => v)
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions((st: any) => st.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views: FixedChatView } })
}
