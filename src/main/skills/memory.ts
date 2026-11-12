import type { MemoryKind, MemoryRecord, MemoryScope } from '@shared/types'
import type { SkillDefinition } from './types'
import { json, strArg } from './types'

const KIND_VALUES: MemoryKind[] = ['profile', 'preference', 'fact', 'project', 'task']
const SCOPE_VALUES: MemoryScope[] = ['agent', 'project', 'session']

function preview(content: string, max = 140): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, max)
}

function parseKind(value: unknown): MemoryKind | undefined {
  return KIND_VALUES.includes(value as MemoryKind) ? (value as MemoryKind) : undefined
}

function parseScope(value: unknown): MemoryScope | undefined {
  return SCOPE_VALUES.includes(value as MemoryScope) ? (value as MemoryScope) : undefined
}

function parseTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(',')
        .map((item) => item.trim())
  return list.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function parseImportance(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parseExpires(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  const parsed = Date.parse(String(value))
  if (Number.isFinite(parsed)) return parsed
  throw new Error('expiresAt 需要是时间戳或可解析的日期')
}

function summary(record: MemoryRecord): Record<string, unknown> {
  return {
    id: record.id,
    key: record.key,
    kind: record.kind,
    scope: record.scope,
    tags: record.tags,
    pinned: Boolean(record.pinned),
    importance: record.importance ?? 1,
    preview: preview(record.content),
    updatedAt: record.updatedAt,
    ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {})
  }
}

function sortRecords(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
  )
}

export const memorySkill: SkillDefinition = {
  id: 'memory',
  name: '长期记忆',
  icon: '◉',
  description:
    '为这个角色保存跨会话的事实与偏好，例如常用项目、术语、汇报格式。每轮对话会自动召回少量核心记忆。',
  hint:
    '需要记住跨会话的信息时使用 memory_set；不确定已记住什么时先 memory_search 或 memory_list；需要完整内容时用 memory_get。',
  risk: 'low',
  settings: [],
  tools: [
    {
      name: 'memory_set',
      description:
        '写入或覆盖一条长期记忆。key 简短唯一，例如 notion_database_id。同一 key 会更新原记录而不是新增。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '记忆键名，同一角色内唯一' },
          content: { type: 'string', description: '记忆内容，上限 8000 字符' },
          kind: {
            type: 'string',
            enum: KIND_VALUES,
            description: 'profile 身份 / preference 偏好 / fact 事实 / project 项目 / task 任务'
          },
          scope: {
            type: 'string',
            enum: SCOPE_VALUES,
            description: '记忆作用域，默认 agent'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '可选标签，用于检索和筛选'
          },
          pinned: { type: 'boolean', description: '置顶为核心记忆，每轮都会优先注入' },
          importance: { type: 'number', description: '重要度 0-5，默认 1' },
          expiresAt: {
            type: 'string',
            description: '可选过期时间，ISO 日期或毫秒时间戳；到期后不再召回'
          }
        },
        required: ['key', 'content']
      },
      async execute(args, ctx) {
        const key = strArg(args, 'key')
        const content = strArg(args, 'content') || strArg(args, 'value')
        const record = await ctx.memory.upsert(ctx.agent.id, {
          key,
          content,
          kind: parseKind(args.kind),
          scope: parseScope(args.scope),
          tags: parseTags(args.tags),
          pinned: args.pinned === undefined ? undefined : Boolean(args.pinned),
          importance: parseImportance(args.importance),
          expiresAt: parseExpires(args.expiresAt),
          sourceSessionId: ctx.sessionId,
          sourceMessageId: ctx.sourceMessageId
        })
        return json({
          ok: true,
          id: record.id,
          key: record.key,
          kind: record.kind,
          pinned: Boolean(record.pinned),
          updatedAt: record.updatedAt
        })
      }
    },
    {
      name: 'memory_search',
      description:
        '按关键词、标签或语义搜索长期记忆，返回摘要和 id。记忆较多时先搜索，不要直接读取全部。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，可为空（按置顶、重要度和更新时间排序）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '只返回同时带有这些标签的记录'
          },
          limit: { type: 'number', description: '返回条数，默认 10，最大 50' }
        }
      },
      async execute(args, ctx) {
        const query = strArg(args, 'query').trim()
        const tags = parseTags(args.tags) ?? []
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 10))
        const hits = await ctx.memory.search(ctx.agent.id, query, tags, limit)
        return json({
          query,
          tags,
          total: hits.length,
          items: hits.map((hit) => ({ ...summary(hit.record), score: Math.round(hit.score) }))
        })
      }
    },
    {
      name: 'memory_get',
      description:
        '读取一条记忆的完整内容（key 或 id）；不传 key 时按页返回摘要列表，避免一次输出过多内容。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '记忆 key 或 id；留空则分页列出' },
          limit: { type: 'number', description: '分页大小，默认 20，最大 50' },
          offset: { type: 'number', description: '分页偏移，默认 0' }
        }
      },
      async execute(args, ctx) {
        const key = strArg(args, 'key').trim()
        if (key) {
          const records = await ctx.memory.list(ctx.agent.id)
          const record = records.find((item) => item.id === key || item.key === key)
          if (!record) return json({ key, found: false })
          await ctx.memory.markUsed(ctx.agent.id, [record.id]).catch(() => undefined)
          return json({ found: true, record })
        }

        const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
        const offset = Math.max(0, Math.round(Number(args.offset) || 0))
        const records = sortRecords(await ctx.memory.list(ctx.agent.id))
        const items = records.slice(offset, offset + limit).map(summary)
        return json({
          total: records.length,
          offset,
          limit,
          hasMore: offset + items.length < records.length,
          items
        })
      }
    },
    {
      name: 'memory_list',
      description: '分页列出长期记忆的键名与摘要。记忆多时优先用 memory_search。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '分页大小，默认 20，最大 50' },
          offset: { type: 'number', description: '分页偏移，默认 0' }
        }
      },
      async execute(args, ctx) {
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
        const offset = Math.max(0, Math.round(Number(args.offset) || 0))
        const records = sortRecords(await ctx.memory.list(ctx.agent.id))
        const items = records.slice(offset, offset + limit).map(summary)
        return json({
          total: records.length,
          offset,
          limit,
          hasMore: offset + items.length < records.length,
          items
        })
      }
    },
    {
      name: 'memory_delete',
      description: '删除一条长期记忆，参数可以是 key 或 id。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '记忆 key 或 id' }
        },
        required: ['key']
      },
      async execute(args, ctx) {
        const key = strArg(args, 'key').trim()
        if (!key) throw new Error('key 不能为空')
        const removed = await ctx.memory.remove(ctx.agent.id, key)
        return json({ ok: removed, key })
      }
    }
  ]
}
