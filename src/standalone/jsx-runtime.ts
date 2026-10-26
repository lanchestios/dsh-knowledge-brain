// src/standalone/jsx-runtime.ts
// 独立 IIFE 件的 react/jsx-runtime shim（宿主实例见 src/standalone/react.ts 的说明）
const J = (window as unknown as { __WikiExdJSXRT?: unknown }).__WikiExdJSXRT as Record<string, unknown> | undefined
const D = ((J && (J as { default?: unknown }).default) ?? J) as Record<string, unknown>
export const jsx = D.jsx as (type: unknown, props: unknown, key?: unknown) => unknown
export const jsxs = D.jsxs as (type: unknown, props: unknown, key?: unknown) => unknown
export const Fragment = D.Fragment as unknown
export default D
