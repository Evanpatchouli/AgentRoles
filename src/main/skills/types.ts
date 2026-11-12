import type { Agent, AppSettings, SkillField } from '@shared/types'
import type { MemoryStore } from '../memory/store'

export interface ToolContext {
  agent: Agent
  settings: AppSettings
  dataDir: string
  workspaceDir: string
  signal: AbortSignal
  /** 共享的长期记忆存储，所有写入都在其中按角色串行化 */
  memory: MemoryStore
  /** 当前会话，用于记录记忆来源 */
  sessionId?: string
  /** 触发本轮运行的用户消息，用于记录记忆来源 */
  sourceMessageId?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

export interface SkillDefinition {
  id: string
  name: string
  icon: string
  description: string
  hint?: string
  risk?: 'low' | 'medium' | 'high'
  settings: SkillField[]
  tools: ToolSpec[]
}

export function json(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function strArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  return String(value)
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '\n…（已截断，原长度 ' + text.length + ' 字符）'
}

/** 在可中止信号上叠加超时 */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)])
}
