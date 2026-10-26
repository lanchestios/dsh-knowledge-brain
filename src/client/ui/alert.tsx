import * as React from 'react'
import { cn } from './utils'

export function Alert({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) { return <div role="alert" data-wiki-ui="" className={cn('wk:rounded-md wk:border wk:border-solid wk:border-border wk:px-3 wk:py-2 wk:text-xs wk:leading-relaxed', variant === 'destructive' && 'wk:border-destructive/30 wk:text-destructive', className)} {...props} /> }
