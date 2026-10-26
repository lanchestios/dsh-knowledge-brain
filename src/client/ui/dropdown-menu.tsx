import * as React from 'react'
import { DropdownMenu as Primitive } from 'radix-ui'
import { usePortalContainer } from './modal'
import { cn } from './utils'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => {
    const container = usePortalContainer()
    return <Primitive.Portal container={container ?? undefined}>
      <Primitive.Content ref={ref} data-wiki-ui="" data-slot="dropdown-menu-content" sideOffset={sideOffset} collisionPadding={8}
        className={cn('wk:z-[1200] wk:min-w-40 wk:max-w-[calc(100vw-24px)] wk:max-h-[var(--radix-dropdown-menu-content-available-height)] wk:overflow-y-auto wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-popover wk:p-1 wk:text-popover-foreground wk:shadow-md wk:outline-none', className)} {...props} />
    </Primitive.Portal>
  },
)
DropdownMenuContent.displayName = 'DropdownMenuContent'
export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, ...props }, ref) => <Primitive.Item ref={ref} data-wiki-ui="" className={cn('wk:relative wk:flex wk:min-w-0 wk:cursor-default wk:select-none wk:items-center wk:gap-2 wk:rounded-sm wk:px-2 wk:py-1.5 wk:text-xs wk:outline-none wk:data-[highlighted]:bg-accent wk:data-[disabled]:pointer-events-none wk:data-[disabled]:opacity-50', className)} {...props} />,
)
DropdownMenuItem.displayName = 'DropdownMenuItem'
