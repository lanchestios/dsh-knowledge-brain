import type { WikiApi } from '../api'

// 启动纠偏：DSH 启动的落点是它自己挑的（restoreSelection——存住的选区，或最近工作区里新建的空白会话），
// 跟知识库无关，于是人一开机就停在一个别的目录的空白会话上。这里在启动后认一次落点：空白会话且
// 目录不是库目录，就把主视图切到库工作区的空白会话（connectWorkspace 用 DSH 自己的复用规则）。
// 只认第一次观察到的落点、只动一次：有内容的会话绝不碰，人已经自己切走的也不追。

// 目录比对前抹尾斜杠：配置 vaultDir 常带尾斜杠而会话 cwd 不带（DSH 建会话时规整过）——
// 严格相等会把「已在库目录」误判成落错
const norm = (p: string) => p.replace(/\/+$/, '')

/** 落点判定：wait 还没观察到；correct 空白会话落错目录；leave 其余一概不动 */
export function judgeLanding(sel: { blank: boolean; cwd: string } | null, vaultDir: string): 'wait' | 'correct' | 'leave' {
  if (!sel) return 'wait'
  return sel.blank && norm(sel.cwd) !== norm(vaultDir) ? 'correct' : 'leave'
}

// 主视图当前挂的会话：选区存在 uiWorkspace 私有里读不到，但主视图的会话引用 source 是 'mainView'
// （navigation.ts replaceMain），引用计数按 source 可见（retainInfo）——扫一遍列表就能认出来
function mainViewSession(c: any): { id: string; blank: boolean; cwd: string } | null {
  const sessions = c.get('sessions')
  const { ids, byId } = sessions.list.getSnapshot()
  for (const id of ids) {
    if ((sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0) {
      const s = byId[id]
      return s ? { id, blank: !!s.blank, cwd: s.cwd } : null
    }
  }
  return null
}

/**
 * 挂上启动纠偏，返回拆除函数。观察会话目录与引用计数的变化（落点会话是启动时新建的，
 * 主视图挂上它时引用计数才变）；库没配置好（status 拿不到目录）就不纠，随 DSH 原样。
 * sessions 未就绪时静默不挂（渲染端 entry 激活早于 connection 链，c.get 回 undefined——
 * 这里一抛整个 entry 就判 failed），由 index.tsx 的 c.inject 等服务齐了再挂
 */
export function startupCorrect(c: any, api: WikiApi): () => void {
  if (!c.get('sessions')) return () => {}
  let stop = false
  let vaultDir: string | null = null
  const unsubs: Array<() => void> = []
  const wired = new Set<string>()
  const done = () => { stop = true; unsubs.forEach((u) => u()); unsubs.length = 0 }
  const check = () => {
    if (stop || vaultDir === null) return
    const sel = mainViewSession(c)
    if (judgeLanding(sel, vaultDir) !== 'correct') {
      // 没观察到就继续等；观察到了但不用纠（有内容 / 已在库目录）——这一轮就到此为止
      if (sel) done()
      return
    }
    done()
    ;(async () => {
      const ws = await c.get('workspaces').create({ path: vaultDir })
      const id = await c.get('uiWorkspace').connectWorkspace(ws.workspaceId)
      if (!stop) c.get('uiWorkspace').openSession(id)
    })().catch(() => { /* 纠偏失败（目录建不了 / 会话建不起来）就随 DSH 原样 */ })
  }
  // 会话目录变（建出落点会话）就补盯它的引用计数；引用变（主视图挂上去）就查一次
  const wireList = () => {
    const sessions = c.get('sessions')
    for (const id of sessions.list.getSnapshot().ids) {
      if (wired.has(id)) continue
      wired.add(id)
      unsubs.push(sessions.retainInfo(id).subscribe(check))
    }
  }
  unsubs.push(c.get('sessions').list.subscribe(() => { wireList(); check() }))
  wireList()
  api.status().then((st) => { vaultDir = st.dir; check() }, () => { done() })
  return () => { stop = true; unsubs.forEach((u) => u()); unsubs.length = 0 }
}
