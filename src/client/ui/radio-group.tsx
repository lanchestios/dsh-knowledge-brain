import * as React from 'react'
import { RadioGroup as Primitive } from 'radix-ui'
import { cn } from './utils'

export const RadioGroup = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(
  ({ className, ...props }, ref) => <Primitive.Root ref={ref} data-wiki-ui="" className={cn('wk:grid wk:gap-2', className)} {...props} />,
)
RadioGroup.displayName = 'RadioGroup'
// Card option variant: Radix owns roving focus, arrow keys and checked state.
export const RadioGroupItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, ...props }, ref) => <Primitive.Item ref={ref} data-wiki-ui="" className={cn('wk:flex wk:flex-col wk:gap-1 wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-transparent wk:px-3 wk:py-2.5 wk:text-left wk:text-[13px] wk:text-foreground wk:outline-none wk:hover:bg-accent wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:data-[state=checked]:border-primary wk:data-[state=checked]:bg-primary/5 wk:disabled:opacity-50', className)} {...props} />,
)
RadioGroupItem.displayName = 'RadioGroupItem'
