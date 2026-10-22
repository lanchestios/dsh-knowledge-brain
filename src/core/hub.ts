import { VaultEngine, type HubEvent } from './vault/engine'
import type { Model } from './model'

// 插件各部分共用的库句柄：转发引擎的模型与错误态、维护变更订阅（载荷版）
export class Hub {
  readonly engine: VaultEngine
  private listeners = new Set<(ev: HubEvent) => void>()

  constructor(readonly dir: () => string) {
    this.engine = new VaultEngine(dir, (ev) => this.emit(ev))
  }

  model(): Model {
    if (!this.engine.model) {
      if (this.engine.validating) throw new Error('正在校验知识库，稍等再试')
      throw new Error(this.engine.error ?? `库未打开：${this.dir()}；到 设置 → 插件 → 格物致知 新建或打开一个知识库`)
    }
    return this.engine.model
  }

  onChanged(cb: (ev: HubEvent) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }

  reopen() {
    try { this.engine.open({ validate: true }) } catch (e) { console.error('[dsh-knowledge-brain] 打开库失败', e) }
    this.emit({ kind: 'structural' })
  }

  // 场景文件被直接重写（rpc saveExcalidraw，不经引擎）：按 patch 事件广播，
  // id 用资产路径——旧客户端 touches 只做 includes(页路径)，未知 id 天然忽略，协议兼容
  assetChanged(rel: string) { this.emit({ kind: 'patch', ids: [rel], flags: {} }) }

  private emit(ev: HubEvent) { for (const l of this.listeners) { try { l(ev) } catch (e) { console.error('[dsh-knowledge-brain] 变更回调出错', e) } } }
}
