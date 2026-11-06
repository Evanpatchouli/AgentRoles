import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillDefinition, ToolContext } from './types'
import { json, strArg, truncate } from './types'

async function readMemory(ctx: ToolContext): Promise<Record<string, string>> {
  const file = path.join(ctx.dataDir, 'memory', ctx.agent.id + '.json')
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeMemory(ctx: ToolContext, data: Record<string, string>): Promise<void> {
  const dir = path.join(ctx.dataDir, 'memory')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, ctx.agent.id + '.json')
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export const memorySkill: SkillDefinition = {
  id: 'memory',
  name: '长期记忆',
  icon: '◉',
  description: '为这个角色保存跨会话的事实与偏好，例如常用项目、术语、汇报格式。',
  hint: '需要记住跨会话的信息时使用 memory_set；不确定已记住什么时先 memory_list。',
  risk: 'low',
  settings: [],
  tools: [
    {
      name: 'memory_set',
      description: '写入或覆盖一条长期记忆。key 简短唯一，例如 notion_database_id。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '记忆键名' },
          value: { type: 'string', description: '记忆内容' }
        },
        required: ['key', 'value']
      },
      async execute(args, ctx) {
        const key = strArg(args, 'key').trim()
        const value = strArg(args, 'value').trim()
        if (!key) throw new Error('key 不能为空')
        if (value.length > 8000) throw new Error('value 过长（上限 8000 字符）')
        const data = await readMemory(ctx)
        if (Object.keys(data).length >= 200 && !(key in data)) {
          throw new Error('记忆条目已达上限（200 条），请先删除不用的条目')
        }
        data[key] = value
        await writeMemory(ctx, data)
        return json({ ok: true, key })
      }
    },
    {
      name: 'memory_get',
      description: '读取一条或全部长期记忆。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '留空则返回全部记忆' }
        }
      },
      async execute(args, ctx) {
        const data = await readMemory(ctx)
        const key = strArg(args, 'key').trim()
        if (key) {
          return key in data ? json({ key, value: data[key] }) : json({ key, found: false })
        }
        return json(data)
      }
    },
    {
      name: 'memory_list',
      description: '列出所有长期记忆的键名与摘要。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const data = await readMemory(ctx)
        return json(
          Object.entries(data).map(([key, value]) => ({
            key,
            preview: truncate(value, 120)
          }))
        )
      }
    },
    {
      name: 'memory_delete',
      description: '删除一条长期记忆。',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key']
      },
      async execute(args, ctx) {
        const key = strArg(args, 'key').trim()
        const data = await readMemory(ctx)
        delete data[key]
        await writeMemory(ctx, data)
        return json({ ok: true, key })
      }
    }
  ]
}
