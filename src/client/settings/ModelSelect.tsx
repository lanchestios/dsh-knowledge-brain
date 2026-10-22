import { useEffect, useState } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEnv } from '../env'

// 模型选择器（知识问答的机器人模型、知识听录的提炼模型共用）：目录与官方选择器同源
// （remote.session.modelCatalog，provider 分组）；undefined=加载中，null=拿不到（退回文本输入，
// 编辑能力不丢）。目录里没有的已存值照旧显示，不会被偷偷清掉。
export function ModelSelect({ value, onChange, disabled, emptyLabel, fallbackPlaceholder }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  emptyLabel?: string
  fallbackPlaceholder?: string
}) {
  const { c } = useEnv()
  const [models, setModels] = useState<{ id: string; models: string[] }[] | null | undefined>(undefined)

  // 模型目录走官方同源 RPC remote.session.modelCatalog（点分服务名，与官方选择组件的 inject 一致）。
  // 客户端把插件 ctx 包成白名单代理，链上任何一环都可能缺/抛/回非 thenable——挂载期绝不能炸：
  // 整条链包进 try，结果用 Promise.resolve 兜住，拿不到就退回文本输入（models=null）
  useEffect(() => {
    let dead = false
    const fallback = () => { if (!dead) setModels(null) }
    try {
      const call = c?.get?.('remote.session')?.modelCatalog?.()
      Promise.resolve(call).then((r: any) => {
        if (dead) return
        setModels(r?.ok
          ? ((r.value?.groups ?? []).map((g: any) => ({ id: String(g.id), models: (g.models ?? []).map((m: any) => String(m.id)) })))
          : null)
      }, fallback)
    } catch { fallback() }
    return () => { dead = true }
  }, [c])

  if (models === null) {
    return <Input value={value} placeholder={fallbackPlaceholder ?? 'provider/model，默认用宿主模型'} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? '默认'}</option>
      {models?.map((g) => (
        <optgroup key={g.id} label={g.id}>
          {g.models.map((m) => <option key={m} value={`${g.id}/${m}`}>{m}</option>)}
        </optgroup>
      ))}
      {/* 目录里没有的已存值照旧显示，不会被偷偷清掉 */}
      {value && !(models ?? []).some((g) => g.models.some((m) => `${g.id}/${m}` === value)) && (
        <option value={value}>{value}（不在目录里）</option>
      )}
    </select>
  )
}
