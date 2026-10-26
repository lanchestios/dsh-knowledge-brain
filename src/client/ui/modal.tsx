import { createContext, useContext, useRef, useState, type KeyboardEventHandler, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { IconClose } from '../../icon'
import { cn } from './utils'

// Nested pickers portal inside the dialog so Radix's focus trap and aria-hidden
// boundaries include them. The centered content uses no transform/containing block.
const PortalContainer = createContext<HTMLElement | null>(null)
export const usePortalContainer = () => useContext(PortalContainer)

export function Modal({ open, onClose, title, description, children, footer, className, contentClassName, headless = false, closeLabel = '关闭', onKeyDownCapture }: {
  open: boolean; onClose(): void; title: string; description?: string; children?: ReactNode; footer?: ReactNode
  className?: string; contentClassName?: string; headless?: boolean; closeLabel?: string
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  // Capture before children mount: React autoFocus runs before Radix's
  // onOpenAutoFocus and would otherwise make us remember a soon-removed input.
  if (open && !wasOpen.current && typeof document !== 'undefined') returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  wasOpen.current = open
  return <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay data-wiki-ui="" className="wk:fixed wk:inset-0 wk:z-[1000] wk:bg-black/40" />
      <Dialog.Content ref={setContainer} data-wiki-ui="" data-wiki-dialog="" aria-modal="true" {...(!description ? { 'aria-describedby': undefined } : {})}
        onKeyDownCapture={onKeyDownCapture}
        onEscapeKeyDown={(e) => { if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || e.repeat || (e.target instanceof Element && e.target.closest('[data-wiki-picker-open]'))) e.preventDefault() }}
        onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus.current?.focus() }}
        className={cn('wk:fixed wk:inset-0 wk:z-[1001] wk:m-auto wk:flex wk:h-fit wk:max-h-[85dvh] wk:w-[min(560px,calc(100vw-32px))] wk:max-w-[calc(100vw-32px)] wk:flex-col wk:overflow-y-auto wk:rounded-xl wk:border wk:border-solid wk:border-border wk:bg-background wk:text-foreground wk:shadow-lg wk:outline-none', className)}>
        <PortalContainer.Provider value={container}>
          <div className={headless ? 'wk:sr-only' : 'wk:flex wk:items-start wk:justify-between wk:gap-4 wk:px-5 wk:pt-5 wk:pb-3'}>
            <div><Dialog.Title className="wk:m-0 wk:text-base wk:font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="wk:mt-1 wk:text-sm wk:text-muted-foreground">{description}</Dialog.Description>}</div>
            {!headless && <Dialog.Close aria-label={closeLabel} className="wk:rounded-sm wk:border-0 wk:bg-transparent wk:p-1 wk:text-muted-foreground wk:outline-none wk:hover:text-foreground wk:focus-visible:ring-2 wk:focus-visible:ring-ring"><IconClose size={16} /></Dialog.Close>}
          </div>
          {headless ? children : <div className={cn('wk:min-h-0 wk:px-5 wk:pb-5', contentClassName)}>{children}</div>}
          {footer && <div className="wk:flex wk:flex-wrap wk:justify-end wk:gap-2 wk:border-0 wk:border-t wk:border-solid wk:border-border wk:px-5 wk:py-3">{footer}</div>}
        </PortalContainer.Provider>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
