// src/standalone/react-dom.ts
// 独立 IIFE 件的 react-dom shim（宿主实例见 src/standalone/react.ts 的说明）
const R = (window as unknown as { __WikiExdReactDOM?: unknown }).__WikiExdReactDOM as Record<string, unknown> | undefined
const D = ((R && (R as { default?: unknown }).default) ?? R) as Record<string, unknown>
export default D
export const { createPortal, flushSync, unstable_batchedUpdates } = D
