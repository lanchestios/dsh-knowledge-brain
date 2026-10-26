import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const variants = cva('wk:inline-flex wk:items-center wk:rounded-sm wk:border wk:border-solid wk:px-1.5 wk:py-0.5 wk:text-[11px] wk:font-medium wk:leading-none wk:whitespace-nowrap', {
  variants: { tone: {
    outline: 'wk:border-border wk:text-muted-foreground', solid: 'wk:border-transparent wk:bg-foreground wk:text-background',
    neutral: 'wk:border-transparent wk:bg-secondary wk:text-secondary-foreground', quiet: 'wk:border-transparent wk:text-muted-foreground',
    success: 'wk:border-transparent wk:bg-success/10 wk:text-success', info: 'wk:border-transparent wk:bg-primary/10 wk:text-primary',
    warning: 'wk:border-transparent wk:bg-warning/10 wk:text-warning', danger: 'wk:border-transparent wk:bg-destructive/10 wk:text-destructive',
  } }, defaultVariants: { tone: 'outline' },
})
export function Tag({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof variants>) {
  return <span data-wiki-ui="" data-slot="badge" className={cn(variants({ tone }), className)} {...props} />
}
