import { useEnv } from '../env'
import { useData } from '../lib/nav'
import s from './LarkSessionsView.module.css'

// 知识问答会话记录页（整页，路由 kind='lark'）：设置卡机器人行的「会话」跳进来。问答全程在
// 真实 DSH 会话里（chat→会话映射），每个 chat 当前会话一行＋归档行，「打开」进宿主看全程。
// 顶栏的前进后退就是返回；数据走 larkChats，库变更（onChanged）会重拉。
export function LarkSessionsView({ appId }: { appId: string }) {
  const { api, c } = useEnv()
  const all = useData(() => api.larkChats(), [])
  // 打开一个问答用的 DSH 会话：uiWorkspace 是宿主服务（真实客户端才有），白名单代理上
  // 链上任何一环缺失/抛错都静默——列表照常可看，只是打不开
  const openSession = (id: string) => { try { c?.get?.('uiWorkspace')?.openSession?.(id) } catch { /* 没这项服务就算了 */ } }
  if (!all) return null
  const view = all.find((v) => v.appId === appId)
  return (
    <div className={s.root}>
      <h1 className={s.h1}>会话记录</h1>
      {view && view.chats.length ? (
        <>
          <p className={s.bot}>{view.name || view.appId} · {view.folder} <code className={s.appId}>{view.appId}</code></p>
          <div className={s.list}>
            {view.chats.map((r) => (
              <div key={r.chatId} className={s.chatRow}>
                <div className={s.chatHead}>
                  <span className={s.dim}>{r.chatType === 'group' ? '群聊' : '单聊'}</span>
                  <code className={s.chatId}>{r.chatId}</code>
                  <span className={s.dim}>{new Date(r.lastAt).toLocaleString()}</span>
                </div>
                <div className={s.sessRow}>
                  {r.current
                    ? <>
                        <span className={s.sessTitle}>{r.currentTitle || r.current}</span>
                        <button type="button" className={s.actBtn} onClick={() => openSession(r.current)}>打开</button>
                      </>
                    : <span className={s.dim}>已开新会话，下条消息起用</span>}
                </div>
                {r.past.map((p) => (
                  <div key={p.id} className={s.sessRow}>
                    <span className={`${s.sessTitle} ${s.sessPast}`}>{p.title || p.id}</span>
                    <button type="button" className={s.actBtn} onClick={() => openSession(p.id)}>打开</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : <p className={s.empty}>还没有会话记录；在 Lark 里向这个机器人提问，问答会话会出现在这里</p>}
    </div>
  )
}
