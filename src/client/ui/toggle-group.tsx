import * as React from 'react'
import { ToggleGroup as Primitive } from 'radix-ui'
import { cn } from './utils'

export const ToggleGroup = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(
  ({ className, ...props }, ref) => <Primitive.Root ref={ref} data-wiki-ui="" className={cn('wk:flex wk:flex-wrap wk:items-center wk:gap-1', className)} {...props} />,
)
ToggleGroup.displayName = 'ToggleGroup'
export const ToggleGroupItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, ...props }, ref) => <Primitive.Item ref={ref} data-wiki-ui="" className={cn('wk:inline-flex wk:h-7 wk:items-center wk:justify-center wk:gap-1.5 wk:rounded-md wk:border-0 wk:bg-transparent wk:px-2 wk:text-xs wk:text-muted-foreground wk:outline-none wk:hover:bg-accent wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:data-[state=on]:bg-secondary wk:data-[state=on]:text-foreground wk:disabled:opacity-50', className)} {...props} />,
)
ToggleGroupItem.displayName = 'ToggleGroupItem'
