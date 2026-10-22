import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { ChatSessions, type ChatsMap } from '../lark/chats.js'

// 名字只许 [a-z0-9_]；schema 不许接受 null（DSH storage 约定）
// 域名沿用改名前的 dsh_knowledge_vault_*：已存的会话映射按域名取，改了就丢
// 一章 / 一份文档或听录的专属会话：key = `book:<书>/<章>` 或 `raw:<路径>`；首页常驻助手：key = `vault:home` → DSH sessionId
const sessionsSpec = defineDomain({
  name: 'dsh_knowledge_vault_sessions', version: 1,
  global: { schema: z.object({ map: z.record(z.string(), z.string()) }), initial: { map: {} } },
  tables: {},
})

// Lark 问答的 chat→DSH 会话映射：appId → chatId → {current, past[], lastAt, chatType}
const larkChatsSpec = defineDomain({
  name: 'dsh_knowledge_vault_lark_chats', version: 1,
  global: {
    schema: z.object({
      map: z.record(z.string(), z.record(z.string(), z.object({
        current: z.string(),
        currentTitle: z.string(),
        past: z.array(z.object({ id: z.string(), title: z.string() })),
        lastAt: z.number(),
        chatType: z.string(),
      }))),
    }),
    initial: { map: {} },
  },
  tables: {},
})

export async function openLarkChats(ctx: Context): Promise<ChatSessions> {
  const domain = await (ctx as any).storageDomain.open(larkChatsSpec)
  ctx.effect(() => () => domain.close(), 'dsh-knowledge-brain.lark-chats')
  const load = (): ChatsMap => domain.global.get().map
  return new ChatSessions({
    load,
    save: (m) => { void domain.global.set({ map: m as any }).catch(() => {}) },   // 落盘失败只吞：丢一次 touch 无伤，下一跳全量重写
  })
}

export interface SessionMap { get(key: string): string | null; set(key: string, id: string): Promise<void> }

export async function openSessions(ctx: Context): Promise<SessionMap> {
  const domain = await (ctx as any).storageDomain.open(sessionsSpec)
  ctx.effect(() => () => domain.close(), 'dsh-knowledge-brain.sessions')
  return {
    get: (key) => domain.global.get().map[key] ?? null,
    set: async (key, id) => { await domain.global.set({ map: { ...domain.global.get().map, [key]: id } }) },
  }
}
