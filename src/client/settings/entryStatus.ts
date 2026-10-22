// 设置卡（知识问答 / MCP 服务）一张卡只显示一个状态：按优先级自上而下，第一条命中即是。
// 库没就绪时显示库的阶段，而不是「文件夹不存在」「已连接」这类此刻并不成立的话。
export type Phase = 'none' | 'validating' | 'failed' | 'ok'
export type Tone = 'draft' | 'loading' | 'warn' | 'err' | 'off' | 'ok'
export interface EntryStatus { tone: Tone; text: string; loading?: true }

/** 前五行两种卡共用：未保存 → 库阶段 → 文件夹；都过了返回 null */
function common(phase: Phase, saved: { folderExists: boolean } | undefined): EntryStatus | null {
  if (!saved) return { tone: 'draft', text: '保存中…' }
  if (phase === 'none') return { tone: 'warn', text: '知识库未初始化' }
  if (phase === 'validating') return { tone: 'loading', text: '知识库校验中', loading: true }
  if (phase === 'failed') return { tone: 'warn', text: '知识库校验失败' }
  if (!saved.folderExists) return { tone: 'err', text: '知识库不存在该文件夹' }
  return null
}

const OK: EntryStatus = { tone: 'ok', text: '已连接' }

/** saved = 已存状态里对应的那条（undefined = 还没存上） */
export function mcpEntryStatus(phase: Phase, saved: { folderExists: boolean } | undefined): EntryStatus {
  return common(phase, saved) ?? { ...OK }
}

export function larkEntryStatus(phase: Phase, saved: { folderExists: boolean; connected: boolean; botReady: boolean } | undefined): EntryStatus {
  const c = common(phase, saved)
  if (c) return c
  if (!saved!.connected) return { tone: 'off', text: '未连接' }
  if (!saved!.botReady) return { tone: 'warn', text: '群聊暂不可用' }
  return { ...OK }
}
