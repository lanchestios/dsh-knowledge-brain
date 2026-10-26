import { useEffect, useState } from 'react'
import { Button, Input, Popover, PopoverTrigger, PopoverContent, Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '../ui'
import { IconCheckMark, IconChevronsUpDown } from '../../icon'
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
  const [open, setOpen] = useState(false)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
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
  const missing = value && models && !models.some((g) => g.models.some((m) => `${g.id}/${m}` === value))
  const selected = value ? `${value}${missing ? '（不在目录里）' : ''}` : (emptyLabel ?? '默认')
  const pick = (next: string) => { onChange(next); setOpen(false) }
  const item = (id: string, name: string) => <CommandItem key={id} value={id || '__default__'} keywords={[name]} onSelect={() => pick(id)}>
    <span data-wiki-ui="" className="wk:min-w-0 wk:flex-1 wk:break-all">{name}</span>
    {value === id && <IconCheckMark size={14} />}
  </CommandItem>
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open && !disabled} aria-label="选择模型" disabled={disabled}
          className="wk:w-full wk:justify-between wk:font-normal" title={selected}>
          <span data-wiki-ui="" className="wk:min-w-0 wk:truncate">{selected}</span><IconChevronsUpDown size={14} className="wk:text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="选择模型" className="wk:p-0">
        <Command label="模型" onKeyDownCapture={(e) => { if (e.nativeEvent.isComposing && e.key === 'Enter') e.stopPropagation() }}>
          <CommandInput placeholder="搜索模型或服务商…" aria-label="搜索模型" />
          <CommandList>
            <CommandEmpty>没有匹配的模型</CommandEmpty>
            <CommandGroup>{item('', emptyLabel ?? '默认')}</CommandGroup>
            {models === undefined && <div data-wiki-ui="" role="status" className="wk:px-3 wk:py-2 wk:text-xs wk:text-muted-foreground">正在加载模型…</div>}
            {models?.map((g) => <CommandGroup key={g.id} heading={g.id}>
              {g.models.map((m) => item(`${g.id}/${m}`, `${g.id}/${m}`))}
            </CommandGroup>)}
            {missing && <CommandGroup heading="当前配置">{item(value, `${value}（不在目录里）`)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
