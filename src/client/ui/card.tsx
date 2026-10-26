import * as React from 'react'
import { Slot } from 'radix-ui'
import { cn } from './utils'

export function Card({ asChild, className, ...props }: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp data-wiki-ui="" data-slot="card" className={cn('wk:rounded-lg wk:border wk:border-solid wk:border-border wk:bg-background wk:text-foreground', className)} {...props} />
}
