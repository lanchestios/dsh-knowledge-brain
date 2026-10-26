import * as React from 'react'
import { Checkbox as Primitive } from 'radix-ui'
import { IconCheckMark } from '../../icon'
import { cn } from './utils'

export const Checkbox = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(
  ({ className, ...props }, ref) => <Primitive.Root ref={ref} data-wiki-ui="" className={cn('wk:inline-flex wk:size-4 wk:shrink-0 wk:items-center wk:justify-center wk:rounded-sm wk:border wk:border-solid wk:border-border wk:bg-background wk:p-0 wk:align-middle wk:text-primary-foreground wk:outline-none wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:data-[state=checked]:border-primary wk:data-[state=checked]:bg-primary wk:data-[state=indeterminate]:border-primary wk:data-[state=indeterminate]:bg-primary wk:disabled:opacity-50', className)} {...props}>
    <Primitive.Indicator className="wk:flex wk:items-center wk:justify-center">{props.checked === 'indeterminate' ? <span className="wk:h-0.5 wk:w-2 wk:bg-current" /> : <IconCheckMark size={12} />}</Primitive.Indicator>
  </Primitive.Root>,
)
Checkbox.displayName = 'Checkbox'
