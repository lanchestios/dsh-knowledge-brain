import type { ReactElement } from 'react'
import { Tooltip as Primitive } from 'radix-ui'
import { usePortalContainer } from './modal'

export function Tooltip({ label, side = 'top', delayMs = 400, children }: {
  label: string; side?: 'top' | 'right' | 'bottom' | 'left'; delayMs?: number; children: ReactElement
}) {
  const container = usePortalContainer()
  return <Primitive.Provider delayDuration={delayMs}><Primitive.Root>
    <Primitive.Trigger asChild>{children}</Primitive.Trigger>
    <Primitive.Portal container={container ?? undefined}>
      <Primitive.Content data-wiki-ui="" side={side} sideOffset={6} collisionPadding={8}
        className="wk:z-[1300] wk:max-w-72 wk:rounded-md wk:bg-foreground wk:px-2.5 wk:py-1.5 wk:text-xs wk:text-background wk:shadow-md">{label}</Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root></Primitive.Provider>
}
