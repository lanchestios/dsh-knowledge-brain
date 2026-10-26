// src/standalone/react.ts
// 独立 IIFE 件的 react shim：不打包 react，运行期从宿主（__WikiExdReact，由编辑器包的
// loadExcalidrawLib 在注入 script 前塞好）拿。default 兼容命名空间/直接导出两种形态。
const R = (window as unknown as { __WikiExdReact?: unknown }).__WikiExdReact as Record<string, unknown> | undefined
const D = ((R && (R as { default?: unknown }).default) ?? R) as Record<string, unknown>
export default D
// 用到的 named 导出一次性解构（excalidraw 侧的消费面）
export const {
  memo, forwardRef, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo,
  createContext, useContext, createElement, cloneElement, isValidElement, Children,
  Fragment, StrictMode, Suspense, lazy, startTransition, useId, useReducer,
  useSyncExternalStore, useTransition, useDeferredValue, useImperativeHandle, useDebugValue,
  version,
} = D
