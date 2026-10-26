import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

// shadcn/ui new-york button, adapted for React 18, the wk prefix and compact toolbars.
export const buttonVariants = cva(
  'wk:inline-flex wk:shrink-0 wk:items-center wk:justify-center wk:gap-1.5 wk:rounded-md wk:border wk:border-solid wk:text-[13px] wk:font-medium wk:whitespace-nowrap wk:outline-none wk:transition-colors wk:focus-visible:ring-2 wk:focus-visible:ring-ring wk:focus-visible:ring-offset-2 wk:disabled:pointer-events-none wk:disabled:opacity-50 wk:[&_svg]:pointer-events-none wk:[&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'wk:border-transparent wk:bg-primary wk:text-primary-foreground wk:hover:bg-primary/90',
        destructive: 'wk:border-transparent wk:bg-destructive wk:text-white wk:hover:bg-destructive/90',
        outline: 'wk:border-border wk:bg-background wk:text-foreground wk:hover:bg-accent',
        secondary: 'wk:border-transparent wk:bg-secondary wk:text-secondary-foreground wk:hover:bg-secondary/80',
        ghost: 'wk:border-transparent wk:bg-transparent wk:text-foreground wk:hover:bg-accent',
        link: 'wk:border-transparent wk:bg-transparent wk:text-primary wk:underline-offset-4 wk:hover:underline',
      },
      size: {
        default: 'wk:h-9 wk:px-3',
        sm: 'wk:h-7 wk:px-2',
        icon: 'wk:size-9 wk:p-0',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'default' },
  },
)

export const Button = React.forwardRef<HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; icon?: React.ReactNode }
>(({ className, variant, size, asChild = false, icon, children, type = 'button', ...props }, ref) => {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp ref={ref} type={type} data-wiki-ui="" data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>{icon}{children}</Comp>
})
Button.displayName = 'Button'
