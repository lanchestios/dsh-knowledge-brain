import { createContext, useContext } from 'react'
import type { PanelState } from '../reader/panel'

// 面板状态 ctx：阅读器正文树里要动右栏 / 面板状态的组件（空库引导要把会话挂上右栏）从这里拿，
// 不从 ReaderPage 经 Main 一层层透传——与 NavProvider / PageCtx 同一套做法
const Ctx = createContext<PanelState | null>(null)
export const PanelProvider = Ctx.Provider
export function usePanel(): PanelState {
  const p = useContext(Ctx)
  if (!p) throw new Error('usePanel 必须在 PanelProvider 内')
  return p
}
