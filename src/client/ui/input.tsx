import * as React from 'react'
import { cn } from './utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => <input ref={ref} type={type} data-wiki-ui="" data-slot="input"
    className={cn('wk:flex wk:h-9 wk:w-full wk:min-w-0 wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-background wk:px-3 wk:py-1 wk:text-[13px] wk:text-foreground wk:outline-none wk:placeholder:text-muted-foreground wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:disabled:cursor-not-allowed wk:disabled:opacity-50', className)} {...props} />,
)
Input.displayName = 'Input'
