// 库所处阶段（设置卡状态用）：没配库目录 / 正在校验 / 校验失败或打不开 / 可用（降级但开着也算可用）。
// validating 先于 model 判断：重开时 engine 会先清 model 再校验，但别依赖这个顺序。
export type VaultPhase = 'none' | 'validating' | 'failed' | 'ok'

export function vaultPhase(h: { dir(): string; engine: { model: unknown; validating: boolean } }): VaultPhase {
  if (!h.dir()) return 'none'
  if (h.engine.validating) return 'validating'
  if (h.engine.model) return 'ok'
  return 'failed'
}
