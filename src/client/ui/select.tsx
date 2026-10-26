import * as React from 'react'
import { Select as Primitive } from 'radix-ui'
import { IconCheckMark, IconMoreDown } from '../../icon'
import { usePortalContainer } from './modal'
import { cn } from './utils'

export const Select = Primitive.Root
export const SelectValue = Primitive.Value
export const SelectTrigger = React.forwardRef<React.ElementRef<typeof Primitive.Trigger>, React.ComponentPropsWithoutRef<typeof Primitive.Trigger>>(
  ({ className, children, ...props }, ref) => <Primitive.Trigger ref={ref} data-wiki-ui="" className={cn('wk:inline-flex wk:h-7 wk:items-center wk:justify-between wk:gap-2 wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-background wk:px-2 wk:text-xs wk:text-foreground wk:outline-none wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:disabled:opacity-50', className)} {...props}>{children}<Primitive.Icon asChild><IconMoreDown size={12} /></Primitive.Icon></Primitive.Trigger>,
)
SelectTrigger.displayName = 'SelectTrigger'
export const SelectContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, children, ...props }, ref) => {
    const container = usePortalContainer()
    return <Primitive.Portal container={container ?? undefined}><Primitive.Content ref={ref} data-slot="select-content" data-wiki-ui="" position="popper" sideOffset={4} collisionPadding={8}
      className={cn('wk:z-[1200] wk:max-h-[var(--radix-select-content-available-height)] wk:min-w-[var(--radix-select-trigger-width)] wk:overflow-hidden wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-popover wk:p-1 wk:text-popover-foreground wk:shadow-md', className)} {...props}>
      <Primitive.ScrollUpButton className="wk:flex wk:h-5 wk:items-center wk:justify-center"><IconMoreDown size={12} className="wk:rotate-180" /></Primitive.ScrollUpButton>
      <Primitive.Viewport>{children}</Primitive.Viewport>
      <Primitive.ScrollDownButton className="wk:flex wk:h-5 wk:items-center wk:justify-center"><IconMoreDown size={12} /></Primitive.ScrollDownButton>
    </Primitive.Content></Primitive.Portal>
  },
)
SelectContent.displayName = 'SelectContent'
export const SelectItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, children, ...props }, ref) => <Primitive.Item ref={ref} data-wiki-ui="" className={cn('wk:relative wk:flex wk:cursor-default wk:select-none wk:items-center wk:rounded-sm wk:py-1.5 wk:pr-8 wk:pl-2 wk:text-xs wk:outline-none wk:data-[highlighted]:bg-accent wk:data-[disabled]:opacity-50', className)} {...props}>
    <Primitive.ItemText>{children}</Primitive.ItemText><Primitive.ItemIndicator className="wk:absolute wk:right-2"><IconCheckMark size={12} /></Primitive.ItemIndicator>
  </Primitive.Item>,
)
SelectItem.displayName = 'SelectItem'
