import { createContext, useContext } from 'react'
import type { ChapterData, PageResult, RawResult } from '../../core/api'

// 当前路由是页时的数据，中栏与右栏共用一份
export const PageCtx = createContext<PageResult | undefined>(undefined)
export const usePage = () => useContext(PageCtx)

// 当前路由是文档时的数据（右栏的文章目录要用）
export const RawCtx = createContext<RawResult | undefined>(undefined)
export const useRaw = () => useContext(RawCtx)

// 当前路由是一章时的数据，中栏原文与右栏「属性」共用一份
export const ChapterCtx = createContext<ChapterData | undefined>(undefined)
export const useChapter = () => useContext(ChapterCtx)
