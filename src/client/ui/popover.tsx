import * as React from 'react'
import { Popover as Primitive } from 'radix-ui'
import { usePortalContainer } from './modal'
import { cn } from './utils'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger

// shadcn/ui Popover. Keep nested surfaces inside their dialog's focus boundary.
export const PopoverContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, align = 'start', sideOffset = 4, onEscapeKeyDown, ...props }, ref) => {
    const container = usePortalContainer()
    return <Primitive.Portal container={container ?? undefined}>
      <Primitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={12} data-wiki-ui="" data-wiki-picker-open="" data-slot="popover-content"
        onEscapeKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || e.repeat) { e.preventDefault(); return }
          onEscapeKeyDown?.(e)
          e.stopPropagation()
        }}
        className={cn('wk:z-[1200] wk:w-[var(--radix-popover-trigger-width)] wk:max-w-[calc(100vw-24px)] wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-popover wk:p-1 wk:text-popover-foreground wk:shadow-md wk:outline-none', className)} {...props} />
    </Primitive.Portal>
  },
)
PopoverContent.displayName = 'PopoverContent'
