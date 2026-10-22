import type { DocumentFilter } from './nav'
import type { Document } from '../../core/api'

export const DOCUMENT_LABEL: Record<Document['status'], string> = {
  unprocessed: '未沉淀', cited: '已引用', processing: '沉淀中', done: '完成',
}

const FILTER_STATUS: Partial<Record<DocumentFilter, Document['status']>> = {
  未沉淀: 'unprocessed', 已引用: 'cited', 沉淀中: 'processing', 完成: 'done',
}

// 文档筛选：待沉淀 = 未沉淀 + 沉淀中（口径同 wiki document list --pending）
export const matches = (m: Document, f: DocumentFilter) =>
  f === '全部' || (f === '待沉淀' ? m.status === 'unprocessed' || m.status === 'processing' : m.status === FILTER_STATUS[f])
