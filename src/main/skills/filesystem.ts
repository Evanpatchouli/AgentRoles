import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillDefinition, ToolContext } from './types'
import { json, strArg, truncate } from './types'

function workspaceRoot(ctx: ToolContext): string {
  const sub = (ctx.agent.skills.filesystem?.settings.subdir ?? '').trim()
  const root = sub ? path.join(ctx.workspaceDir, sub) : ctx.workspaceDir
  return path.resolve(root)
}

function safeResolve(ctx: ToolContext, target: string): string {
  const root = workspaceRoot(ctx)
  const resolved = path.resolve(root, target || '.')
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('路径越界：只能访问工作目录内的文件（' + root + '）')
  }
  return resolved
}

export const filesystemSkill: SkillDefinition = {
  id: 'filesystem',
  name: '本地文件',
  icon: '▤',
  description: '在工作区目录内读写文本文件，用于保存需求草稿、会议记录、导出报告等。',
  hint: '读写文件前先确认路径；删除操作不提供工具，需要用户手动处理。所有路径都相对于工作区。',
  risk: 'medium',
  settings: [
    {
      key: 'subdir',
      label: '子目录',
      placeholder: '可选，例如 recorder',
      help: '相对全局工作区目录；留空则直接使用工作区根目录。'
    }
  ],
  tools: [
    {
      name: 'fs_list',
      description: '列出工作区某个目录下的文件与子目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径，留空为工作区根目录' }
        }
      },
      async execute(args, ctx) {
        const target = safeResolve(ctx, strArg(args, 'path'))
        const entries = await fs.readdir(target, { withFileTypes: true })
        const items = []
        for (const entry of entries.slice(0, 300)) {
          if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue
          const info = await fs.stat(path.join(target, entry.name)).catch(() => null)
          items.push({
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size: info?.size ?? 0,
            modified: info?.mtime?.toISOString() ?? ''
          })
        }
        return json({ root: workspaceRoot(ctx), path: target, entries: items })
      }
    },
    {
      name: 'fs_read',
      description: '读取工作区内一个文本文件的内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径' },
          offset: { type: 'number', description: '起始行号（从 1 开始，可选）' },
          limit: { type: 'number', description: '最多读取行数（可选，默认 400）' }
        },
        required: ['path']
      },
      async execute(args, ctx) {
        const target = safeResolve(ctx, strArg(args, 'path'))
        const raw = await fs.readFile(target)
        if (raw.includes(0)) throw new Error('这是一个二进制文件，无法按文本读取')
        const text = raw.toString('utf8')
        const offset = Math.max(1, Number(args.offset) || 1)
        const limit = Math.min(2000, Math.max(1, Number(args.limit) || 400))
        const lines = text.split(/\r?\n/)
        const slice = lines.slice(offset - 1, offset - 1 + limit)
        return json({
          path: target,
          totalLines: lines.length,
          offset,
          content: truncate(slice.join('\n'), 60000)
        })
      }
    },
    {
      name: 'fs_write',
      description: '写入文本文件（覆盖同名文件，自动创建父目录）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      },
      async execute(args, ctx) {
        const target = safeResolve(ctx, strArg(args, 'path'))
        const content = strArg(args, 'content')
        if (content.length > 800000) throw new Error('内容过长（上限约 800KB）')
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, content, 'utf8')
        return json({ ok: true, path: target, bytes: Buffer.byteLength(content) })
      }
    },
    {
      name: 'fs_append',
      description: '在文本文件末尾追加内容（文件不存在时创建）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '追加内容' }
        },
        required: ['path', 'content']
      },
      async execute(args, ctx) {
        const target = safeResolve(ctx, strArg(args, 'path'))
        const content = strArg(args, 'content')
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.appendFile(target, content, 'utf8')
        return json({ ok: true, path: target, bytes: Buffer.byteLength(content) })
      }
    }
  ]
}
