import type { MemoryCandidateInput, MemoryKind, MemoryScope, ModelSettings } from '@shared/types'
import { streamChat } from '../engine/llm'
import { looksLikeSecret } from './store'

const KINDS: MemoryKind[] = ['profile', 'preference', 'fact', 'project', 'task']
const SCOPES: MemoryScope[] = ['agent', 'project', 'session']
const MAX_CANDIDATES = 8

export const EXTRACTION_SYSTEM_PROMPT = `你是长期记忆提取器。阅读对话，提取值得跨会话保存的稳定信息。

只提取：
- 用户稳定的偏好、汇报格式、沟通习惯
- 角色身份、职责边界
- 长期项目背景、关键 ID、术语
- 持续多轮的任务状态

不要提取：
- 一次性指令、临时状态、寒暄
- API Key、Token、密码等密钥
- 第三方隐私或与工作无关的个人信息

只返回 JSON 数组，不要 Markdown 代码块。每项格式：
{"key":"简短唯一键","content":"可复用的事实或偏好","kind":"profile|preference|fact|project|task","scope":"agent|project|session","tags":["标签"],"confidence":0.0,"reason":"为什么值得记住"}

没有可保存内容时返回 []。最多 ${MAX_CANDIDATES} 条。`

function clampConfidence(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.min(1, Math.max(0, Math.round(number * 100) / 100))
}

function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const output: string[] = []
  for (const item of raw) {
    const tag = String(item ?? '').trim().slice(0, 32)
    if (!tag) continue
    if (!output.includes(tag)) output.push(tag)
    if (output.length >= 12) break
  }
  return output
}

function parseJsonArray(text: string): unknown[] {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') {
      const object = parsed as Record<string, unknown>
      for (const key of ['candidates', 'memories', 'items']) {
        if (Array.isArray(object[key])) return object[key]
      }
    }
  } catch {
    /* fall through to bracket extraction */
  }
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* ignore */
    }
  }
  throw new Error('记忆提取结果不是合法的 JSON 数组')
}

export function parseExtractionResponse(text: string): MemoryCandidateInput[] {
  const raw = parseJsonArray(text)
  const output: MemoryCandidateInput[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    const key = String(value.key ?? '').trim().slice(0, 120)
    const content = String(value.content ?? '').trim().slice(0, 8000)
    if (!key || !content || looksLikeSecret(content)) continue
    if (seen.has(key)) continue
    seen.add(key)
    const kind = KINDS.includes(value.kind as MemoryKind)
      ? (value.kind as MemoryKind)
      : 'fact'
    const scope = SCOPES.includes(value.scope as MemoryScope)
      ? (value.scope as MemoryScope)
      : 'agent'
    output.push({
      key,
      content,
      kind,
      scope,
      tags: normalizeTags(value.tags),
      confidence: clampConfidence(value.confidence),
      ...(typeof value.reason === 'string' && value.reason.trim()
        ? { reason: value.reason.trim().slice(0, 300) }
        : {})
    })
    if (output.length >= MAX_CANDIDATES) break
  }
  return output
}

export async function extractMemoryCandidates(options: {
  model: ModelSettings
  transcript: string
  signal: AbortSignal
}): Promise<MemoryCandidateInput[]> {
  const result = await streamChat({
    model: options.model,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: options.transcript }],
    tools: [],
    signal: options.signal,
    handlers: { onText: () => undefined }
  })
  return parseExtractionResponse(result.text)
}
