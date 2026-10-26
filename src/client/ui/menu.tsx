import { useRef, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { usePortalContainer } from './modal'

type Item = { id: string; label: ReactNode; disabled?: boolean }

export function Menu({ open, onClose, onSelect, items, getAnchorRect }: {
  open: boolean; onClose(): void; onSelect(id: string): void; items: Item[]
  getAnchorRect(): DOMRect | null
}) {
  const container = usePortalContainer()
  const previousFocus = useRef<HTMLElement | null>(null)
  const at = open ? getAnchorRect() : null
  return <DropdownMenu.Root open={open} modal={false} onOpenChange={(v) => { if (!v) onClose() }}>
    <DropdownMenu.Trigger tabIndex={-1} aria-label="操作菜单" data-wiki-ui=""
      style={{ position: 'fixed', left: at?.left ?? 0, top: at?.top ?? 0, width: 0, height: 0, padding: 0, border: 0, overflow: 'hidden', pointerEvents: 'none' }} />
    <DropdownMenu.Portal container={container ?? undefined}>
      <DropdownMenu.Content data-wiki-ui="" side="bottom" align="start" sideOffset={2} collisionPadding={8}
        onFocusCapture={(e) => { if (!previousFocus.current && e.relatedTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget)) previousFocus.current = e.relatedTarget }}
        onCloseAutoFocus={(e) => { e.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); previousFocus.current = null }}
        className="wk:z-[1200] wk:min-w-36 wk:rounded-md wk:border wk:border-solid wk:border-border wk:bg-popover wk:p-1 wk:text-popover-foreground wk:shadow-md wk:outline-none">
        {items.map((item) => <DropdownMenu.Item key={item.id} disabled={item.disabled}
          onSelect={() => { onSelect(item.id); onClose() }}
          className="wk:relative wk:flex wk:cursor-default wk:select-none wk:items-center wk:rounded-sm wk:px-2 wk:py-1.5 wk:text-[13px] wk:outline-none wk:data-[highlighted]:bg-accent wk:data-[disabled]:pointer-events-none wk:data-[disabled]:opacity-50">{item.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
