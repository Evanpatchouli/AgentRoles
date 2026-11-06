import type { SkillDefinition, ToolContext, ToolSpec } from './types'
import { json, strArg, truncate, withTimeout } from './types'

const NOTION_VERSION = '2022-06-28'
const API = process.env.AGENTROLES_NOTION_BASE || 'https://api.notion.com/v1'

interface NotionProperty {
  id: string
  name: string
  type: string
  status?: { options?: Array<{ name: string }> }
  select?: { options?: Array<{ name: string }> }
  [key: string]: unknown
}

function getToken(ctx: ToolContext): string {
  const agentToken = ctx.agent.skills.notion?.settings?.token?.trim()
  return agentToken || ctx.settings.notion.token.trim()
}

function normalizeDatabaseId(value: string): string {
  const cleaned = value.trim()
  if (!cleaned) return ''
  const compact = cleaned.replace(/-/g, '')
  const match = compact.match(/[0-9a-fA-F]{32}/)
  return match ? match[0] : cleaned
}

function resolveDatabaseId(ctx: ToolContext, override?: string): string {
  const agentDb = ctx.agent.skills.notion?.settings?.databaseId?.trim()
  const db = override?.trim() || agentDb || ctx.settings.notion.databaseId.trim()
  const normalized = normalizeDatabaseId(db)
  if (!normalized) {
    throw new Error(
      '未配置 Notion 数据库 ID。请在「设置 → Notion 集成」填写默认数据库，或在当前角色的 Notion 技能配置里填写 databaseId。'
    )
  }
  return normalized
}

async function notionFetch(
  ctx: ToolContext,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<any> {
  const token = getToken(ctx)
  if (!token) {
    throw new Error(
      '未配置 Notion Integration Token。请在「设置 → Notion 集成」填写，并把这个数据库共享给对应的 Integration。'
    )
  }
  const response = await fetch(API + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      'User-Agent': 'AgentRoles/0.1'
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: withTimeout(ctx.signal, 25000)
  })
  const text = await response.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const message = data?.message || text.slice(0, 400) || '未知错误'
    throw new Error('Notion API ' + response.status + '：' + message)
  }
  if (data?.object === 'error') {
    throw new Error('Notion API 错误：' + (data.message || '未知错误'))
  }
  return data
}

function richText(content: string): Array<Record<string, unknown>> {
  const chunks: Array<Record<string, unknown>> = []
  let remaining = content
  while (remaining.length > 0 && chunks.length < 10) {
    const piece = remaining.slice(0, 2000)
    chunks.push({ type: 'text', text: { content: piece } })
    remaining = remaining.slice(2000)
  }
  if (chunks.length === 0) chunks.push({ type: 'text', text: { content: '' } })
  return chunks
}

function paragraphBlocks(notes: string): Array<Record<string, unknown>> {
  const chunks = notes
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 90)
  return chunks.map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richText(chunk.slice(0, 4000))
    }
  }))
}

function plainText(property: any): string {
  const items = property?.title ?? property?.rich_text ?? []
  if (!Array.isArray(items)) return ''
  return items.map((item: any) => item?.plain_text ?? item?.text?.content ?? '').join('')
}

function plainValue(property: any): string {
  if (!property || typeof property !== 'object') return ''
  switch (property.type) {
    case 'title':
    case 'rich_text':
      return plainText(property)
    case 'select':
      return property.select?.name ?? ''
    case 'status':
      return property.status?.name ?? ''
    case 'multi_select':
      return (property.multi_select ?? []).map((item: any) => item.name).join('、')
    case 'date':
      return property.date?.start ?? ''
    case 'number':
      return property.number === null || property.number === undefined
        ? ''
        : String(property.number)
    case 'checkbox':
      return property.checkbox ? '是' : '否'
    case 'people':
      return (property.people ?? []).map((item: any) => item.name ?? item.id).join('、')
    case 'url':
      return property.url ?? ''
    case 'email':
      return property.email ?? ''
    case 'phone_number':
      return property.phone_number ?? ''
    case 'formula':
      return property.formula?.[property.formula?.type] ?? ''
    case 'relation':
      return (property.relation ?? []).map((item: any) => item.id).join('、')
    default:
      return ''
  }
}

function propertyEntries(database: any): NotionProperty[] {
  return Object.values(database?.properties ?? {}) as NotionProperty[]
}

function pickProperty(
  properties: NotionProperty[],
  preferred: string,
  matcher: RegExp,
  types: string[],
  fallbackToFirstType = true
): NotionProperty | undefined {
  const name = preferred.trim()
  if (name) {
    const hit = properties.find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (hit) return hit
  }
  const byType = properties.find((item) => types.includes(item.type) && matcher.test(item.name))
  if (byType) return byType
  return fallbackToFirstType ? properties.find((item) => types.includes(item.type)) : undefined
}

function optionName(property: NotionProperty, value: string): string | null {
  const options =
    property.type === 'status' ? property.status?.options : property.select?.options
  if (!options || options.length === 0) return value
  const hit = options.find((item) => item.name.toLowerCase() === value.toLowerCase())
  if (hit) return hit.name
  if (property.type === 'select') return value
  return null
}

function buildPropertyValue(property: NotionProperty, value: string): Record<string, unknown> {
  switch (property.type) {
    case 'status': {
      const name = optionName(property, value)
      if (!name) {
        const options = (property.status?.options ?? []).map((item) => item.name).join(' / ')
        throw new Error(
          '状态「' + value + '」不在该数据库的 Status 选项中，可选值：' + (options || '无')
        )
      }
      return { status: { name } }
    }
    case 'select': {
      const name = optionName(property, value)
      return { select: name ? { name } : null }
    }
    case 'multi_select':
      return {
        multi_select: value
          .split(/[,，、]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((name) => ({ name }))
      }
    case 'date':
      return { date: value ? { start: value } : null }
    case 'number': {
      const number = Number(value)
      return { number: Number.isFinite(number) ? number : null }
    }
    case 'title':
      return { title: richText(value) }
    case 'rich_text':
      return { rich_text: richText(value) }
    case 'url':
      return { url: value || null }
    case 'email':
      return { email: value || null }
    case 'checkbox':
      return { checkbox: value === 'true' || value === '是' || value === 'yes' }
    default:
      return { rich_text: richText(value) }
  }
}

function simplifiedProperties(page: any, titleProperty: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, property] of Object.entries(page?.properties ?? {})) {
    const value = plainValue(property)
    if (value) values[name] = value
  }
  const title =
    values[titleProperty] ||
    Object.entries(page?.properties ?? {})
      .filter(([, property]: [string, any]) => property?.type === 'title')
      .map(([, property]: [string, any]) => plainText(property))[0] ||
    ''
  const result: Record<string, string> = { title }
  for (const [key, value] of Object.entries(values)) {
    if (key !== titleProperty) result[key] = value
  }
  return result
}

function compactDatabase(database: any): Record<string, unknown> {
  const properties = propertyEntries(database).map((property) => {
    const options =
      property.type === 'status'
        ? property.status?.options
        : property.type === 'select'
          ? property.select?.options
          : undefined
    return {
      name: property.name,
      type: property.type,
      ...(options ? { options: options.map((item) => item.name) } : {})
    }
  })
  return {
    id: database.id,
    url: database.url,
    title: Array.isArray(database.title)
      ? database.title.map((item: any) => item.plain_text ?? '').join('')
      : '',
    properties
  }
}

async function getDatabase(ctx: ToolContext, databaseId: string): Promise<any> {
  return notionFetch(ctx, '/databases/' + databaseId)
}

function propertyFilter(
  property: NotionProperty,
  value: string
): Record<string, unknown> | null {
  if (property.type === 'title') {
    return { property: property.name, title: { contains: value } }
  }
  if (property.type === 'rich_text') {
    return { property: property.name, rich_text: { contains: value } }
  }
  return null
}

function statusFilter(property: NotionProperty, value: string): Record<string, unknown> | null {
  if (property.type === 'status') {
    return { property: property.name, status: { equals: value } }
  }
  if (property.type === 'select') {
    return { property: property.name, select: { equals: value } }
  }
  return null
}

function taskTools(): ToolSpec[] {
  return [
    {
      name: 'notion_create_task',
      description:
        '在当前角色的 Notion 任务数据库中新建一条任务。会自动识别标题、状态、优先级、截止日期属性，并把备注写进任务正文。创建前不需要先读取数据库结构。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务标题，短而具体' },
          status: { type: 'string', description: '状态值，需与数据库已有选项一致（可选）' },
          priority: { type: 'string', description: '优先级（可选）' },
          due_date: {
            type: 'string',
            description: '截止日期，ISO 格式，例如 2026-11-20（可选）'
          },
          notes: {
            type: 'string',
            description: '任务背景、验收标准、来源等正文；支持换行与空行分段（可选）'
          },
          database_id: {
            type: 'string',
            description: '覆盖默认数据库 ID（可选，通常不需要）'
          }
        },
        required: ['title']
      },
      async execute(args, ctx) {
        const databaseId = resolveDatabaseId(ctx, strArg(args, 'database_id'))
        const title = strArg(args, 'title').trim()
        if (!title) throw new Error('title 不能为空')
        const database = await getDatabase(ctx, databaseId)
        const properties = propertyEntries(database)
        const settings = ctx.agent.skills.notion?.settings ?? {}
        const warnings: string[] = []
        const payload: Record<string, unknown> = {}

        const titleProperty = pickProperty(
          properties,
          settings.titleProperty ?? '',
          /title|名称|标题/i,
          ['title']
        )
        if (!titleProperty) throw new Error('该数据库没有 title 类型属性，无法创建任务')
        payload[titleProperty.name] = buildPropertyValue(titleProperty, title)

        const statusValue = strArg(args, 'status').trim()
        if (statusValue) {
          const statusProperty = pickProperty(
            properties,
            settings.statusProperty ?? '',
            /status|状态|stage|阶段/i,
            ['status', 'select'],
            false
          )
          if (statusProperty) {
            try {
              payload[statusProperty.name] = buildPropertyValue(statusProperty, statusValue)
            } catch (error) {
              warnings.push(String(error instanceof Error ? error.message : error))
            }
          } else {
            warnings.push('数据库里没有找到 status/select 类型的状态属性，已跳过状态')
          }
        }

        const priorityValue = strArg(args, 'priority').trim()
        if (priorityValue) {
          const priorityProperty = pickProperty(
            properties,
            settings.priorityProperty ?? '',
            /priority|优先级|importance/i,
            ['status', 'select'],
            false
          )
          if (priorityProperty) {
            try {
              payload[priorityProperty.name] = buildPropertyValue(priorityProperty, priorityValue)
            } catch (error) {
              warnings.push(String(error instanceof Error ? error.message : error))
            }
          } else {
            warnings.push('数据库里没有找到优先级属性，已跳过')
          }
        }

        const dueValue = strArg(args, 'due_date').trim()
        if (dueValue) {
          const dueProperty = pickProperty(
            properties,
            settings.dueProperty ?? '',
            /due|deadline|截止|到期/i,
            ['date'],
            false
          )
          if (dueProperty) payload[dueProperty.name] = buildPropertyValue(dueProperty, dueValue)
          else warnings.push('数据库里没有找到 date 类型的截止日期属性，已跳过')
        }

        const notes = strArg(args, 'notes').trim()
        const page = await notionFetch(ctx, '/pages', {
          method: 'POST',
          body: {
            parent: { database_id: databaseId },
            properties: payload,
            ...(notes ? { children: paragraphBlocks(notes) } : {})
          }
        })
        return json({
          ok: true,
          id: page.id,
          url: page.url,
          title,
          warnings: warnings.length ? warnings : undefined
        })
      }
    },
    {
      name: 'notion_update_task',
      description:
        '更新一条已存在的 Notion 任务：修改状态、优先级、截止日期、标题，或向任务正文追加备注。传 page_id（任务页面的 id 或 URL 中的 id）。',
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: '任务页面 id，或包含 id 的 Notion URL' },
          status: { type: 'string', description: '新状态（可选）' },
          priority: { type: 'string', description: '新优先级（可选）' },
          due_date: { type: 'string', description: '新的截止日期（可选）' },
          title: { type: 'string', description: '新的标题（可选）' },
          notes: { type: 'string', description: '追加到任务正文的说明（可选）' }
        },
        required: ['page_id']
      },
      async execute(args, ctx) {
        const pageId = normalizeDatabaseId(strArg(args, 'page_id'))
        if (!pageId) throw new Error('page_id 不能为空')
        const page = await notionFetch(ctx, '/pages/' + pageId)
        const databaseId =
          page?.parent?.database_id ??
          (page?.parent?.type === 'database_id' ? page.parent.database_id : '')
        if (!databaseId) throw new Error('无法从该页面解析出所属数据库，可能不是数据库中的任务')
        const database = await getDatabase(ctx, databaseId)
        const properties = propertyEntries(database)
        const settings = ctx.agent.skills.notion?.settings ?? {}
        const payload: Record<string, unknown> = {}
        const warnings: string[] = []

        const titleValue = strArg(args, 'title').trim()
        if (titleValue) {
          const titleProperty = pickProperty(
            properties,
            settings.titleProperty ?? '',
            /title|名称|标题/i,
            ['title']
          )
          if (titleProperty) payload[titleProperty.name] = buildPropertyValue(titleProperty, titleValue)
        }

        const statusValue = strArg(args, 'status').trim()
        if (statusValue) {
          const statusProperty = pickProperty(
            properties,
            settings.statusProperty ?? '',
            /status|状态|stage|阶段/i,
            ['status', 'select'],
            false
          )
          if (statusProperty) {
            try {
              payload[statusProperty.name] = buildPropertyValue(statusProperty, statusValue)
            } catch (error) {
              throw new Error(String(error instanceof Error ? error.message : error))
            }
          } else {
            warnings.push('数据库里没有找到状态属性')
          }
        }

        const priorityValue = strArg(args, 'priority').trim()
        if (priorityValue) {
          const priorityProperty = pickProperty(
            properties,
            settings.priorityProperty ?? '',
            /priority|优先级|importance/i,
            ['status', 'select'],
            false
          )
          if (priorityProperty) {
            try {
              payload[priorityProperty.name] = buildPropertyValue(priorityProperty, priorityValue)
            } catch (error) {
              warnings.push(String(error instanceof Error ? error.message : error))
            }
          }
        }

        const dueValue = strArg(args, 'due_date').trim()
        if (dueValue) {
          const dueProperty = pickProperty(
            properties,
            settings.dueProperty ?? '',
            /due|deadline|截止|到期/i,
            ['date'],
            false
          )
          if (dueProperty) payload[dueProperty.name] = buildPropertyValue(dueProperty, dueValue)
        }

        let updated: any = page
        if (Object.keys(payload).length > 0) {
          updated = await notionFetch(ctx, '/pages/' + pageId, {
            method: 'PATCH',
            body: { properties: payload }
          })
        }

        const notes = strArg(args, 'notes').trim()
        if (notes) {
          await notionFetch(ctx, '/blocks/' + pageId + '/children', {
            method: 'PATCH',
            body: { children: paragraphBlocks(notes) }
          })
        }

        return json({
          ok: true,
          id: pageId,
          url: updated.url ?? page.url,
          warnings: warnings.length ? warnings : undefined
        })
      }
    },
    {
      name: 'notion_find_task',
      description:
        '按标题关键词或状态查找任务，返回任务 id、标题、状态、优先级和链接。更新任务前先用它定位目标。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '标题关键词（可选）' },
          status: { type: 'string', description: '按状态精确过滤（可选）' },
          database_id: { type: 'string', description: '覆盖默认数据库（可选）' },
          page_size: { type: 'number', description: '返回数量，默认 15，最大 50' }
        }
      },
      async execute(args, ctx) {
        const databaseId = resolveDatabaseId(ctx, strArg(args, 'database_id'))
        const database = await getDatabase(ctx, databaseId)
        const properties = propertyEntries(database)
        const settings = ctx.agent.skills.notion?.settings ?? {}
        const titleProperty = pickProperty(
          properties,
          settings.titleProperty ?? '',
          /title|名称|标题/i,
          ['title']
        )
        const statusProperty = pickProperty(
          properties,
          settings.statusProperty ?? '',
          /status|状态|stage|阶段/i,
          ['status', 'select']
        )
        const filters: Array<Record<string, unknown>> = []
        const query = strArg(args, 'query').trim()
        const status = strArg(args, 'status').trim()
        if (query && titleProperty) {
          const filter = propertyFilter(titleProperty, query)
          if (filter) filters.push(filter)
        }
        if (status && statusProperty) {
          const filter = statusFilter(statusProperty, status)
          if (filter) filters.push(filter)
        }
        const size = Math.min(50, Math.max(1, Number(args.page_size) || 15))
        const result = await notionFetch(ctx, '/databases/' + databaseId + '/query', {
          method: 'POST',
          body: {
            page_size: size,
            ...(filters.length ? { filter: { and: filters } } : {}),
            sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
          }
        })
        const tasks = (result.results ?? []).map((page: any) => ({
          id: page.id,
          url: page.url,
          ...simplifiedProperties(page, titleProperty?.name ?? '')
        }))
        return json({ count: tasks.length, hasMore: result.has_more ?? false, tasks })
      }
    }
  ]
}

function genericTools(): ToolSpec[] {
  return [
    {
      name: 'notion_get_database',
      description:
        '读取 Notion 数据库的结构（属性名、类型、可选项）。在需要精细控制属性时使用。',
      parameters: {
        type: 'object',
        properties: {
          database_id: { type: 'string', description: '数据库 id，留空使用默认数据库' }
        }
      },
      async execute(args, ctx) {
        const databaseId = resolveDatabaseId(ctx, strArg(args, 'database_id'))
        const database = await getDatabase(ctx, databaseId)
        return json(compactDatabase(database))
      }
    },
    {
      name: 'notion_query_database',
      description: '用原生 Notion 过滤条件查询数据库，返回简化后的页面列表。',
      parameters: {
        type: 'object',
        properties: {
          database_id: { type: 'string', description: '数据库 id，留空使用默认数据库' },
          filter: { type: 'object', description: 'Notion filter 对象' },
          sorts: { type: 'array', description: 'Notion sorts 数组' },
          page_size: { type: 'number', description: '默认 20，最大 100' }
        }
      },
      async execute(args, ctx) {
        const databaseId = resolveDatabaseId(ctx, strArg(args, 'database_id'))
        const database = await getDatabase(ctx, databaseId)
        const titleProperty = pickProperty(
          propertyEntries(database),
          ctx.agent.skills.notion?.settings?.titleProperty ?? '',
          /title|名称|标题/i,
          ['title']
        )
        const size = Math.min(100, Math.max(1, Number(args.page_size) || 20))
        const usingFilter = args.filter && typeof args.filter === 'object' ? args.filter : undefined
        const usingSorts = Array.isArray(args.sorts) ? args.sorts : undefined
        const result = await notionFetch(ctx, '/databases/' + databaseId + '/query', {
          method: 'POST',
          body: {
            page_size: size,
            ...(usingFilter ? { filter: usingFilter } : {}),
            ...(usingSorts ? { sorts: usingSorts } : {})
          }
        })
        return json({
          count: result.results?.length ?? 0,
          hasMore: result.has_more ?? false,
          pages: (result.results ?? []).map((page: any) => ({
            id: page.id,
            url: page.url,
            ...simplifiedProperties(page, titleProperty?.name ?? '')
          }))
        })
      }
    },
    {
      name: 'notion_create_page',
      description: '在数据库中以原生 properties 对象创建页面。属性写法必须符合数据库结构。',
      parameters: {
        type: 'object',
        properties: {
          database_id: { type: 'string' },
          properties: { type: 'object', description: 'Notion properties 对象' },
          children: { type: 'array', description: '可选的页面块数组' }
        },
        required: ['properties']
      },
      async execute(args, ctx) {
        const databaseId = resolveDatabaseId(ctx, strArg(args, 'database_id'))
        if (!args.properties || typeof args.properties !== 'object') {
          throw new Error('properties 必须是对象')
        }
        const page = await notionFetch(ctx, '/pages', {
          method: 'POST',
          body: {
            parent: { database_id: databaseId },
            properties: args.properties,
            ...(Array.isArray(args.children) ? { children: args.children.slice(0, 100) } : {})
          }
        })
        return json({ ok: true, id: page.id, url: page.url })
      }
    },
    {
      name: 'notion_update_page',
      description: '以原生 properties 对象更新页面属性。',
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string' },
          properties: { type: 'object' },
          archived: { type: 'boolean', description: '设为 true 可归档页面（慎用）' }
        },
        required: ['page_id']
      },
      async execute(args, ctx) {
        const pageId = normalizeDatabaseId(strArg(args, 'page_id'))
        const body: Record<string, unknown> = {}
        if (args.properties && typeof args.properties === 'object') body.properties = args.properties
        if (typeof args.archived === 'boolean') body.archived = args.archived
        if (Object.keys(body).length === 0) throw new Error('至少提供 properties 或 archived')
        const page = await notionFetch(ctx, '/pages/' + pageId, { method: 'PATCH', body })
        return json({ ok: true, id: page.id, url: page.url })
      }
    },
    {
      name: 'notion_get_page',
      description: '读取一个页面及其正文块（前 100 个），用于了解任务详情或历史记录。',
      parameters: {
        type: 'object',
        properties: { page_id: { type: 'string' } },
        required: ['page_id']
      },
      async execute(args, ctx) {
        const pageId = normalizeDatabaseId(strArg(args, 'page_id'))
        const page = await notionFetch(ctx, '/pages/' + pageId)
        const blocks = await notionFetch(ctx, '/blocks/' + pageId + '/children?page_size=100')
        const simplified = (blocks.results ?? []).map((block: any) => {
          const type = block.type
          const value = block[type]
          const text = Array.isArray(value?.rich_text)
            ? value.rich_text.map((item: any) => item.plain_text ?? '').join('')
            : ''
          return { id: block.id, type, text }
        })
        return json({
          id: page.id,
          url: page.url,
          properties: simplifiedProperties(
            page,
            ctx.agent.skills.notion?.settings?.titleProperty ?? ''
          ),
          blocks: simplified
        })
      }
    },
    {
      name: 'notion_search',
      description: '在 Notion 工作区内搜索页面或数据库，返回 id、标题、类型与链接。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词' },
          page_size: { type: 'number', description: '默认 10，最大 25' }
        },
        required: ['query']
      },
      async execute(args, ctx) {
        const result = await notionFetch(ctx, '/search', {
          method: 'POST',
          body: {
            query: strArg(args, 'query'),
            page_size: Math.min(25, Math.max(1, Number(args.page_size) || 10))
          }
        })
        const items = (result.results ?? []).map((item: any) => ({
          id: item.id,
          type: item.object,
          title:
            item.object === 'database'
              ? (item.title ?? []).map((part: any) => part.plain_text ?? '').join('')
              : plainText(item.properties?.title),
          url: item.url
        }))
        return json({ count: items.length, items })
      }
    }
  ]
}

export const notionSkill: SkillDefinition = {
  id: 'notion',
  name: 'Notion 任务库',
  icon: 'N',
  description:
    '把需求与任务写进 Notion：建任务、改状态、查任务、追加进展。默认数据库可在全局设置里配置。',
  hint:
    '记录需求优先用 notion_create_task；定位已有任务用 notion_find_task；改状态用 notion_update_task。任务链接要回传给用户。状态值必须来自数据库已有选项。',
  risk: 'medium',
  settings: [
    {
      key: 'databaseId',
      label: '任务数据库 ID',
      placeholder: '留空则使用全局默认数据库',
      help: '数据库页面链接中 32 位 id；需先把这个数据库共享给 Integration。'
    },
    {
      key: 'titleProperty',
      label: '标题属性名',
      placeholder: '留空自动识别'
    },
    {
      key: 'statusProperty',
      label: '状态属性名',
      placeholder: '留空自动识别'
    },
    {
      key: 'priorityProperty',
      label: '优先级属性名',
      placeholder: '留空自动识别'
    },
    {
      key: 'dueProperty',
      label: '截止日期属性名',
      placeholder: '留空自动识别'
    },
    {
      key: 'token',
      label: '独立 Token',
      placeholder: '留空则使用全局 Notion Token',
      secret: true,
      help: '如果这个角色需要使用另一个 Notion Integration，可在这里覆盖。'
    }
  ],
  tools: [...taskTools(), ...genericTools()]
}
