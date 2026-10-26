import * as React from 'react'
import { cn } from './utils'

export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => <div data-wiki-ui="" className="wk:relative wk:w-full wk:overflow-x-auto"><table ref={ref} data-wiki-ui="" className={cn('wk:w-full wk:border-collapse wk:text-sm', className)} {...props} /></div>,
)
Table.displayName = 'Table'
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead className={cn('wk:[&_tr]:border-b', className)} {...props} /> }
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody className={cn('wk:[&_tr:last-child]:border-0', className)} {...props} /> }
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) { return <tr className={cn('wk:border-0 wk:border-b wk:border-solid wk:border-border wk:transition-colors wk:hover:bg-accent', className)} {...props} /> }
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th className={cn('wk:h-9 wk:px-2.5 wk:truncate wk:text-left wk:align-middle wk:text-xs wk:font-medium wk:text-muted-foreground', className)} {...props} /> }
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td className={cn('wk:h-10 wk:px-2.5 wk:py-1.5 wk:truncate wk:align-middle', className)} {...props} /> }
