import * as React from 'react'
import { Button } from './button'
import { Slot } from 'radix-ui'
import { IconMoreRight } from '../../icon'
import { cn } from './utils'

export function Breadcrumb(props: React.ComponentProps<'nav'>) { return <nav aria-label="面包屑" {...props} /> }
export function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) { return <ol className={cn('wk:m-0 wk:flex wk:min-w-0 wk:list-none wk:items-center wk:gap-1 wk:overflow-hidden wk:p-0 wk:text-xs wk:text-muted-foreground', className)} {...props} /> }
export function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) { return <li className={cn('wk:inline-flex wk:min-w-0 wk:items-center wk:gap-1', className)} {...props} /> }
export function BreadcrumbLink({ asChild, className, ...props }: React.ComponentProps<'a'> & { asChild?: boolean }) { const Comp = asChild ? Slot.Root : 'a'; return <Comp className={cn('wk:truncate wk:rounded-sm wk:hover:text-foreground wk:focus-visible:outline-2 wk:focus-visible:outline-ring', className)} {...props} /> }
export function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) { return <span aria-current="page" className={cn('wk:truncate wk:text-foreground', className)} {...props} /> }
export function BreadcrumbSeparator({ children, ...props }: React.ComponentProps<'li'>) { return <li role="presentation" aria-hidden="true" className="wk:shrink-0" {...props}>{children ?? <IconMoreRight size={12} />}</li> }

export function BreadcrumbTrail({ items, label = '面包屑' }: { items: { label: React.ReactNode; title?: string; onClick?: () => void }[]; label?: string }) {
  return <Breadcrumb aria-label={label} className="wk:min-w-0 wk:overflow-hidden"><BreadcrumbList>
    {items.map((item, i) => <React.Fragment key={i}>
      {i > 0 && <BreadcrumbSeparator />}
      <BreadcrumbItem className={i === items.length - 1 ? 'wk:flex-1' : 'wk:shrink'}>
        {item.onClick ? <BreadcrumbLink asChild><Button size="sm" className="wk:h-auto wk:min-w-0 wk:shrink wk:px-1 wk:py-0.5 wk:text-xs wk:font-normal" onClick={item.onClick} title={item.title}>{item.label}</Button></BreadcrumbLink>
          : <BreadcrumbPage title={item.title}>{item.label}</BreadcrumbPage>}
      </BreadcrumbItem>
    </React.Fragment>)}
  </BreadcrumbList></Breadcrumb>
}
