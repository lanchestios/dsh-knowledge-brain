import * as React from 'react'
import { Command as Primitive } from 'cmdk'
import { IconSearch } from '../../icon'
import { cn } from './utils'

export const Command = React.forwardRef<React.ElementRef<typeof Primitive>, React.ComponentPropsWithoutRef<typeof Primitive>>(
  ({ className, ...props }, ref) => <Primitive ref={ref} data-wiki-ui="" className={cn('wk:flex wk:w-full wk:flex-col wk:overflow-hidden wk:rounded-md wk:bg-popover wk:text-popover-foreground', className)} {...props} />,
)
Command.displayName = 'Command'

export const CommandInput = React.forwardRef<React.ElementRef<typeof Primitive.Input>, React.ComponentPropsWithoutRef<typeof Primitive.Input>>(
  ({ className, ...props }, ref) => <div data-wiki-ui="" className="wk:flex wk:items-center wk:gap-2 wk:border-0 wk:border-b wk:border-solid wk:border-border wk:px-3">
    <IconSearch size={14} className="wk:shrink-0 wk:text-muted-foreground" />
    <Primitive.Input ref={ref} data-wiki-ui="" className={cn('wk:flex wk:h-10 wk:w-full wk:min-w-0 wk:rounded-none wk:border-0 wk:bg-transparent wk:py-2 wk:text-[13px] wk:text-foreground wk:outline-none wk:placeholder:text-muted-foreground wk:disabled:opacity-50', className)} {...props} />
  </div>,
)
CommandInput.displayName = 'CommandInput'

export const CommandList = React.forwardRef<React.ElementRef<typeof Primitive.List>, React.ComponentPropsWithoutRef<typeof Primitive.List>>(
  ({ className, ...props }, ref) => <Primitive.List ref={ref} data-wiki-ui="" className={cn('wk:max-h-[min(300px,calc(var(--radix-popover-content-available-height)_-_44px))] wk:overflow-x-hidden wk:overflow-y-auto wk:overscroll-contain wk:p-1', className)} {...props} />,
)
CommandList.displayName = 'CommandList'

export const CommandEmpty = React.forwardRef<React.ElementRef<typeof Primitive.Empty>, React.ComponentPropsWithoutRef<typeof Primitive.Empty>>(
  ({ className, ...props }, ref) => <Primitive.Empty ref={ref} data-wiki-ui="" className={cn('wk:py-6 wk:text-center wk:text-[13px] wk:text-muted-foreground', className)} {...props} />,
)
CommandEmpty.displayName = 'CommandEmpty'

export const CommandGroup = React.forwardRef<React.ElementRef<typeof Primitive.Group>, React.ComponentPropsWithoutRef<typeof Primitive.Group>>(
  ({ className, ...props }, ref) => <Primitive.Group ref={ref} data-wiki-ui="" className={cn('wk:overflow-hidden wk:text-foreground wk:[&_[cmdk-group-heading]]:px-2 wk:[&_[cmdk-group-heading]]:py-1.5 wk:[&_[cmdk-group-heading]]:text-xs wk:[&_[cmdk-group-heading]]:font-medium wk:[&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />,
)
CommandGroup.displayName = 'CommandGroup'

export const CommandItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, ...props }, ref) => <Primitive.Item ref={ref} data-wiki-ui="" className={cn('wk:relative wk:flex wk:cursor-default wk:select-none wk:items-center wk:gap-2 wk:rounded-sm wk:px-2 wk:py-2 wk:text-[13px] wk:outline-none wk:data-[selected=true]:bg-accent wk:data-[disabled=true]:pointer-events-none wk:data-[disabled=true]:opacity-50', className)} {...props} />,
)
CommandItem.displayName = 'CommandItem'
