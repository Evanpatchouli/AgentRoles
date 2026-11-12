import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  MemoryCandidate,
  MemoryCandidateInput,
  MemoryImportResult,
  MemoryIndexStatus,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemorySnapshot
} from '@shared/types'
import type { MemoryIndex } from './index'
import { tokenizeSearch } from './text'

export const MEMORY_LIMIT = 200
export const MEMORY_CONTENT_LIMIT = 8000
export const CANDIDATE_LIMIT = 50
const FILE_VERSION = 2
const CANDIDATE_FILE_VERSION = 1
const DAY = 24 * 60 * 60 * 1000

const KINDS: MemoryKind[] = ['profile', 'preference', 'fact', 'project', 'task']
const SCOPES: MemoryScope[] = ['agent', 'project', 'session']

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/
]

export interface MemorySearchHit {
  record: MemoryRecord
  score: number
}

export interface MemoryStoreOptions {
  index?: MemoryIndex
  logger?: (message: string, error?: unknown) => void
}

export interface AddCandidatesResult {
  added: number
  updated: number
  accepted: number
  skipped: number
  pending: number
}

interface MemoryFile {
  version: number
  records: MemoryRecord[]
}

interface CandidateFile {
  version: number
  candidates: MemoryCandidate[]
}

function clampConfidence(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.min(1, Math.max(0, Math.round(number * 100) / 100))
}

function normalizeCandidate(
  raw: unknown,
  agentId: string,
  timestamp: number
): MemoryCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const key = String(item.key ?? '').trim().slice(0, 120)
  const content = String(item.content ?? '').trim().slice(0, MEMORY_CONTENT_LIMIT)
  if (!key || !content || looksLikeSecret(content)) return null
  return {
    id:
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : 'mem_' + randomUUID(),
    agentId,
    key,
    content,
    kind: fallbackKind(item.kind),
    scope: fallbackScope(item.scope),
    tags: normalizeTags(item.tags),
    confidence: clampConfidence(item.confidence),
    ...(typeof item.reason === 'string' && item.reason.trim()
      ? { reason: item.reason.trim().slice(0, 300) }
      : {}),
    ...(typeof item.supersedesKey === 'string' && item.supersedesKey.trim()
      ? { supersedesKey: item.supersedesKey.trim().slice(0, 120) }
      : {}),
    ...(typeof item.sourceSessionId === 'string' && item.sourceSessionId
      ? { sourceSessionId: item.sourceSessionId }
      : {}),
    ...(typeof item.sourceMessageId === 'string' && item.sourceMessageId
      ? { sourceMessageId: item.sourceMessageId }
      : {}),
    createdAt: toTime(item.createdAt, timestamp)
  }
}

function parseCandidatePayload(
  parsed: unknown,
  agentId: string,
  timestamp: number
): MemoryCandidate[] {
  let rawList: unknown[] = []
  if (Array.isArray(parsed)) rawList = parsed
  else if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>
    if (Array.isArray(object.candidates)) rawList = object.candidates
  }
  const byKey = new Map<string, MemoryCandidate>()
  for (const item of rawList) {
    const candidate = normalizeCandidate(item, agentId, timestamp)
    if (!candidate) continue
    byKey.set(candidate.key, candidate)
  }
  return [...byKey.values()]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function toTime(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clampImportance(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(5, Math.max(0, Math.round(number * 10) / 10))
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

function normalizeKey(value: unknown): string {
  const key = String(value ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
  if (!key) throw new Error('key 不能为空')
  if (key.length > 120) throw new Error('key 过长（上限 120 字符）')
  return key
}

function normalizeContent(value: unknown): string {
  const content = String(value ?? '').trim()
  if (!content) throw new Error('记忆内容不能为空')
  if (content.length > MEMORY_CONTENT_LIMIT) {
    throw new Error('记忆内容过长（上限 ' + MEMORY_CONTENT_LIMIT + ' 字符）')
  }
  return content
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

function assertNoSecret(content: string): void {
  if (looksLikeSecret(content)) {
    throw new Error('记忆内容疑似包含密钥或令牌，已拒绝写入。请改用环境变量或设置页保存密钥。')
  }
}

function fallbackKind(value: unknown): MemoryKind {
  return KINDS.includes(value as MemoryKind) ? (value as MemoryKind) : 'fact'
}

function fallbackScope(value: unknown): MemoryScope {
  return SCOPES.includes(value as MemoryScope) ? (value as MemoryScope) : 'agent'
}

function legacyId(agentId: string, key: string): string {
  return 'mem_' + createHash('sha1').update(agentId + '\0' + key).digest('hex').slice(0, 16)
}

function normalizeRecord(
  raw: unknown,
  agentId: string,
  fallbackKey: string | undefined,
  timestamp: number
): MemoryRecord | null {
  if (typeof raw === 'string') {
    if (!fallbackKey || !raw.trim()) return null
    return {
      id: legacyId(agentId, fallbackKey),
      agentId,
      scope: 'agent',
      kind: 'fact',
      key: fallbackKey,
      content: raw.slice(0, MEMORY_CONTENT_LIMIT),
      tags: [],
      pinned: false,
      importance: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const key = String(item.key ?? fallbackKey ?? '').trim()
  const content = String(item.content ?? item.value ?? '').trim()
  if (!key || !content) return null
  const createdAt = toTime(item.createdAt, timestamp)
  const updatedAt = Math.max(createdAt, toTime(item.updatedAt, createdAt))
  const lastUsedAt = toTime(item.lastUsedAt, 0) || undefined
  const expiresAt = toTime(item.expiresAt, 0) || undefined
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : 'mem_' + randomUUID(),
    agentId,
    scope: fallbackScope(item.scope),
    kind: fallbackKind(item.kind),
    key: key.slice(0, 120),
    content: content.slice(0, MEMORY_CONTENT_LIMIT),
    tags: normalizeTags(item.tags),
    ...(typeof item.sourceSessionId === 'string' && item.sourceSessionId
      ? { sourceSessionId: item.sourceSessionId }
      : {}),
    ...(typeof item.sourceMessageId === 'string' && item.sourceMessageId
      ? { sourceMessageId: item.sourceMessageId }
      : {}),
    ...(item.pinned ? { pinned: true } : {}),
    importance: clampImportance(item.importance),
    createdAt,
    updatedAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
    ...(expiresAt ? { expiresAt } : {})
  }
}

function parsePayload(
  parsed: unknown,
  agentId: string,
  timestamp: number
): MemoryRecord[] {
  let rawList: Array<[string | undefined, unknown]> = []
  if (Array.isArray(parsed)) {
    rawList = parsed.map((item) => [undefined, item])
  } else if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>
    if (
      typeof object.key === 'string' &&
      (typeof object.content === 'string' || typeof object.value === 'string')
    ) {
      rawList = [[undefined, object]]
    } else if (Array.isArray(object.records)) {
      rawList = object.records.map((item) => [undefined, item])
    } else {
      rawList = Object.entries(object)
        .filter(([key]) => !['version', 'agentId', 'exportedAt', 'records'].includes(key))
        .map(([key, value]) => [key, value])
    }
  } else {
    throw new Error('记忆文件格式无法识别')
  }

  const byKey = new Map<string, MemoryRecord>()
  for (const [fallbackKey, item] of rawList) {
    const record = normalizeRecord(item, agentId, fallbackKey, timestamp)
    if (!record) continue
    byKey.set(record.key, record)
  }
  return [...byKey.values()]
}

function scoreRecord(
  record: MemoryRecord,
  tokens: string[],
  now: number,
  boost = 0
): number {
  let score = boost
  if (record.pinned) score += 60
  score += clampImportance(record.importance) * 4
  if (record.kind === 'profile' || record.kind === 'preference') score += 6

  const key = record.key.toLowerCase()
  const content = record.content.toLowerCase()
  const tags = record.tags.map((tag) => tag.toLowerCase())
  for (const token of tokens) {
    if (key.includes(token)) score += 10
    if (tags.some((tag) => tag.includes(token))) score += 7
    if (content.includes(token)) score += 3
  }

  const updatedAge = now - record.updatedAt
  if (updatedAge < 7 * DAY) score += 9
  else if (updatedAge < 30 * DAY) score += 5
  else if (updatedAge > 180 * DAY) score -= 4

  if (record.lastUsedAt) {
    const usedAge = now - record.lastUsedAt
    if (usedAge < 3 * DAY) score += 12
    else if (usedAge < 14 * DAY) score += 6
  }
  return score
}

function isExpired(record: MemoryRecord, now: number): boolean {
  return Boolean(record.expiresAt && record.expiresAt <= now)
}

/**
 * 长期记忆存储。
 *
 * 并发策略：同一个 agentId 的写操作通过进程内 Promise 链串行化；读取不加锁，
 * 因为正式文件只通过 rename 原子替换。临时文件带进程号与随机后缀，避免互相覆盖。
 * 每次写入前保留上一版 .bak，主文件损坏时可回退。
 */
export class MemoryStore {
  private readonly dir: string
  private readonly tails = new Map<string, Promise<void>>()
  private readonly index?: MemoryIndex
  private readonly logger: (message: string, error?: unknown) => void

  constructor(dataDir: string, options: MemoryStoreOptions = {}) {
    this.dir = path.join(dataDir, 'memory')
    this.index = options.index
    this.logger =
      options.logger ??
      ((message, error) => console.error(message, error ?? ''))
  }

  private assertAgentId(agentId: string): void {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(agentId)) {
      throw new Error('非法的角色 ID：' + agentId)
    }
  }

  private fileFor(agentId: string): string {
    this.assertAgentId(agentId)
    return path.join(this.dir, agentId + '.json')
  }

  private candidateFileFor(agentId: string): string {
    this.assertAgentId(agentId)
    return path.join(this.dir, agentId + '.pending.json')
  }

  private async ensureIndex(agentId: string, records: MemoryRecord[]): Promise<void> {
    if (!this.index) return
    try {
      await this.index.ensure(agentId, records)
    } catch (error) {
      this.logger('[memory] 更新检索索引失败', error)
    }
  }

  private withLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(agentId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(agentId, tail)
    void tail.then(() => {
      if (this.tails.get(agentId) === tail) this.tails.delete(agentId)
    })
    return run
  }

  private async load(agentId: string): Promise<MemoryRecord[]> {
    const file = this.fileFor(agentId)
    let lastError: unknown = null
    for (const source of [file, file + '.bak']) {
      let raw: string
      try {
        raw = await fs.readFile(source, 'utf8')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code !== 'ENOENT') lastError = error
        continue
      }
      try {
        const timestamp = (await fs.stat(source)).mtimeMs || Date.now()
        const records = parsePayload(JSON.parse(raw), agentId, timestamp)
        return records.sort((a, b) => a.createdAt - b.createdAt)
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error('读取长期记忆失败：' + file + '（' + message + '）')
    }
    return []
  }

  private async write(agentId: string, records: MemoryRecord[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const file = this.fileFor(agentId)
    try {
      await fs.copyFile(file, file + '.bak')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }
    const tmp =
      file + '.' + process.pid + '.' + randomUUID().slice(0, 8) + '.tmp'
    const payload: MemoryFile = { version: FILE_VERSION, records }
    try {
      await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
      await fs.rename(tmp, file)
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async loadCandidates(agentId: string): Promise<MemoryCandidate[]> {
    const file = this.candidateFileFor(agentId)
    let lastError: unknown = null
    for (const source of [file, file + '.bak']) {
      let raw: string
      try {
        raw = await fs.readFile(source, 'utf8')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code !== 'ENOENT') lastError = error
        continue
      }
      try {
        const timestamp = (await fs.stat(source)).mtimeMs || Date.now()
        const candidates = parseCandidatePayload(
          JSON.parse(raw),
          agentId,
          timestamp
        )
        return candidates.sort((a, b) => b.createdAt - a.createdAt)
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error('读取待确认记忆失败：' + file + '（' + message + '）')
    }
    return []
  }

  private async writeCandidates(
    agentId: string,
    candidates: MemoryCandidate[]
  ): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const file = this.candidateFileFor(agentId)
    try {
      await fs.copyFile(file, file + '.bak')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }
    const tmp =
      file + '.' + process.pid + '.' + randomUUID().slice(0, 8) + '.tmp'
    const payload: CandidateFile = {
      version: CANDIDATE_FILE_VERSION,
      candidates
    }
    try {
      await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
      await fs.rename(tmp, file)
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private rank(
    records: MemoryRecord[],
    query: string,
    tags: string[],
    boosts?: Map<string, number>
  ): MemorySearchHit[] {
    const now = Date.now()
    const tokens = tokenizeSearch(query)
    const wanted = tags.map((tag) => tag.toLowerCase())
    const active = records.filter((record) => !isExpired(record, now))
    const filtered = wanted.length
      ? active.filter((record) =>
          wanted.every((tag) => record.tags.some((item) => item.toLowerCase() === tag))
        )
      : active
    return filtered
      .map((record) => ({
        record,
        score: scoreRecord(record, tokens, now, boosts?.get(record.id) ?? 0)
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(Boolean(b.record.pinned)) - Number(Boolean(a.record.pinned)) ||
          b.record.updatedAt - a.record.updatedAt
      )
  }

  async list(agentId: string): Promise<MemoryRecord[]> {
    const records = await this.load(agentId)
    return clone(records)
  }

  async snapshot(agentId: string): Promise<MemorySnapshot> {
    const records = await this.load(agentId)
    const pending = await this.loadCandidates(agentId)
    const now = Date.now()
    return {
      agentId,
      records: clone(records).sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          b.updatedAt - a.updatedAt
      ),
      pending: clone(pending),
      total: records.length,
      pendingCount: pending.length,
      pinned: records.filter((record) => record.pinned).length,
      expired: records.filter((record) => isExpired(record, now)).length,
      bytes: Buffer.byteLength(JSON.stringify(records), 'utf8'),
      limit: MEMORY_LIMIT,
      contentLimit: MEMORY_CONTENT_LIMIT,
      index: this.index
        ? this.index.status(agentId)
        : { available: false, fts: false, enabled: false, vectors: 0, model: '' }
    }
  }

  /** 所有写操作的唯一入口：在按角色串行化的临界区内读取、修改并原子写回。 */
  async update<T>(
    agentId: string,
    mutator: (records: MemoryRecord[]) => T | Promise<T>
  ): Promise<T> {
    return this.withLock(agentId, async () => {
      const records = await this.load(agentId)
      const before = JSON.stringify(records)
      const result = await mutator(records)
      const after = JSON.stringify(records)
      if (before !== after) {
        await this.write(agentId, records)
        await this.ensureIndex(agentId, records)
      }
      return result
    })
  }

  async upsert(
    agentId: string,
    input: {
      id?: string
      key: string
      content: string
      kind?: MemoryKind
      scope?: MemoryScope
      tags?: string[]
      pinned?: boolean
      importance?: number
      expiresAt?: number | null
      sourceSessionId?: string
      sourceMessageId?: string
    }
  ): Promise<MemoryRecord> {
    const key = normalizeKey(input.key)
    const content = normalizeContent(input.content)
    const now = Date.now()

    return this.update(agentId, (records) => {
      const byId = input.id
        ? records.findIndex((record) => record.id === input.id)
        : -1
      const byKey = records.findIndex((record) => record.key === key)
      const index = byId >= 0 ? byId : byKey
      if (index < 0 && records.length >= MEMORY_LIMIT) {
        throw new Error('记忆条目已达上限（' + MEMORY_LIMIT + ' 条），请先删除不用的条目')
      }
      if (index >= 0 && byKey >= 0 && byKey !== index) {
        throw new Error('已存在相同 key 的记忆：' + key)
      }

      if (index < 0) {
        assertNoSecret(content)
        const record: MemoryRecord = {
          id: 'mem_' + randomUUID(),
          agentId,
          scope: input.scope ?? 'agent',
          kind: input.kind ?? 'fact',
          key,
          content,
          tags: normalizeTags(input.tags),
          pinned: Boolean(input.pinned),
          importance: clampImportance(input.importance),
          createdAt: now,
          updatedAt: now,
          ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
          ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
        }
        records.push(record)
        return clone(record)
      }

      const current = records[index]
      if (content !== current.content) assertNoSecret(content)
      const next: MemoryRecord = {
        ...current,
        key,
        content,
        scope: input.scope ?? current.scope,
        kind: input.kind ?? current.kind,
        tags: input.tags === undefined ? current.tags : normalizeTags(input.tags),
        pinned: input.pinned ?? current.pinned,
        importance:
          input.importance === undefined
            ? clampImportance(current.importance)
            : clampImportance(input.importance),
        updatedAt: now,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        ...(input.expiresAt === null
          ? { expiresAt: undefined }
          : input.expiresAt
            ? { expiresAt: input.expiresAt }
            : {})
      }
      if (!next.expiresAt) delete next.expiresAt
      records[index] = next
      return clone(next)
    })
  }

  async remove(agentId: string, keyOrId: string): Promise<boolean> {
    return this.update(agentId, (records) => {
      const index = records.findIndex(
        (record) => record.id === keyOrId || record.key === keyOrId
      )
      if (index < 0) return false
      records.splice(index, 1)
      return true
    })
  }

  async markUsed(agentId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const wanted = new Set(ids)
    const now = Date.now()
    await this.update(agentId, (records) => {
      for (const record of records) {
        if (wanted.has(record.id)) record.lastUsedAt = now
      }
    })
  }

  async listCandidates(agentId: string): Promise<MemoryCandidate[]> {
    return clone(await this.loadCandidates(agentId))
  }

  /**
   * 写入自动提取的候选。
   * - 高置信度偏好直接进入正式记忆
   * - 其余进入 pending 文件，等待用户在管理页确认
   * - 已存在同 key 的候选会被替换，避免重复堆积
   */
  async addCandidates(
    agentId: string,
    inputs: MemoryCandidateInput[],
    options: {
      autoAcceptConfidence?: number
      sourceSessionId?: string
      sourceMessageId?: string
    } = {}
  ): Promise<AddCandidatesResult> {
    const threshold = clampConfidence(options.autoAcceptConfidence ?? 1)
    const now = Date.now()

    return this.withLock(agentId, async () => {
      const records = await this.load(agentId)
      const candidates = await this.loadCandidates(agentId)
      let added = 0
      let updated = 0
      let accepted = 0
      let skipped = 0
      let recordsChanged = false
      let candidatesChanged = false

      const dropPending = (key: string): boolean => {
        let changed = false
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          if (candidates[index].key === key) {
            candidates.splice(index, 1)
            changed = true
          }
        }
        return changed
      }

      for (const input of inputs) {
        let key: string
        let content: string
        try {
          key = normalizeKey(input.key)
          content = normalizeContent(input.content)
        } catch {
          skipped += 1
          continue
        }
        if (looksLikeSecret(content)) {
          skipped += 1
          continue
        }
        const existing = records.find((record) => record.key === key)
        if (existing && existing.content.trim() === content) {
          skipped += 1
          continue
        }
        const kind = KINDS.includes(input.kind as MemoryKind)
          ? (input.kind as MemoryKind)
          : (existing?.kind ?? 'fact')
        const scope = SCOPES.includes(input.scope as MemoryScope)
          ? (input.scope as MemoryScope)
          : (existing?.scope ?? 'agent')
        const tags =
          input.tags === undefined
            ? (existing?.tags ?? [])
            : normalizeTags(input.tags)
        const confidence = clampConfidence(input.confidence)
        const autoAccept = kind === 'preference' && confidence >= threshold

        if (autoAccept) {
          if (existing) {
            existing.content = content
            existing.kind = kind
            existing.scope = scope
            existing.tags = tags
            existing.updatedAt = now
            delete existing.expiresAt
            if (options.sourceSessionId) existing.sourceSessionId = options.sourceSessionId
            if (options.sourceMessageId) existing.sourceMessageId = options.sourceMessageId
            recordsChanged = true
          } else if (records.length < MEMORY_LIMIT) {
            records.push({
              id: 'mem_' + randomUUID(),
              agentId,
              scope,
              kind,
              key,
              content,
              tags,
              pinned: false,
              importance: 1,
              createdAt: now,
              updatedAt: now,
              ...(options.sourceSessionId
                ? { sourceSessionId: options.sourceSessionId }
                : {}),
              ...(options.sourceMessageId
                ? { sourceMessageId: options.sourceMessageId }
                : {})
            })
            recordsChanged = true
          } else {
            skipped += 1
            continue
          }
          if (dropPending(key)) candidatesChanged = true
          accepted += 1
          continue
        }

        const sameKey = candidates.find((candidate) => candidate.key === key)
        if (sameKey) {
          sameKey.content = content
          sameKey.kind = kind
          sameKey.scope = scope
          sameKey.tags = tags
          sameKey.confidence = confidence
          sameKey.createdAt = now
          sameKey.reason = input.reason?.trim().slice(0, 300) || sameKey.reason
          if (existing) sameKey.supersedesKey = key
          if (options.sourceSessionId) sameKey.sourceSessionId = options.sourceSessionId
          if (options.sourceMessageId) sameKey.sourceMessageId = options.sourceMessageId
          candidatesChanged = true
          updated += 1
          continue
        }

        if (candidates.length >= CANDIDATE_LIMIT) {
          skipped += 1
          continue
        }
        candidates.push({
          id: 'mem_' + randomUUID(),
          agentId,
          key,
          content,
          kind,
          scope,
          tags,
          confidence,
          ...(input.reason?.trim() ? { reason: input.reason.trim().slice(0, 300) } : {}),
          ...(existing ? { supersedesKey: key } : {}),
          ...(options.sourceSessionId
            ? { sourceSessionId: options.sourceSessionId }
            : {}),
          ...(options.sourceMessageId
            ? { sourceMessageId: options.sourceMessageId }
            : {}),
          createdAt: now
        })
        candidatesChanged = true
        added += 1
      }

      if (recordsChanged) {
        await this.write(agentId, records)
        await this.ensureIndex(agentId, records)
      }
      if (candidatesChanged) await this.writeCandidates(agentId, candidates)
      return { added, updated, accepted, skipped, pending: candidates.length }
    })
  }

  async confirmCandidate(
    agentId: string,
    id: string
  ): Promise<MemoryRecord | null> {
    return this.withLock(agentId, async () => {
      const records = await this.load(agentId)
      const candidates = await this.loadCandidates(agentId)
      const index = candidates.findIndex((candidate) => candidate.id === id)
      if (index < 0) return null
      const candidate = candidates[index]
      const now = Date.now()
      let record: MemoryRecord
      const existing = records.find((item) => item.key === candidate.key)
      if (existing) {
        existing.content = candidate.content
        existing.kind = candidate.kind
        existing.scope = candidate.scope
        existing.tags = candidate.tags
        existing.updatedAt = now
        delete existing.expiresAt
        if (candidate.sourceSessionId) existing.sourceSessionId = candidate.sourceSessionId
        if (candidate.sourceMessageId) existing.sourceMessageId = candidate.sourceMessageId
        record = existing
      } else {
        if (records.length >= MEMORY_LIMIT) {
          throw new Error('记忆条目已达上限（' + MEMORY_LIMIT + ' 条），请先删除不用的条目')
        }
        record = {
          id: 'mem_' + randomUUID(),
          agentId,
          scope: candidate.scope,
          kind: candidate.kind,
          key: candidate.key,
          content: candidate.content,
          tags: candidate.tags,
          pinned: false,
          importance: 1,
          createdAt: candidate.createdAt || now,
          updatedAt: now,
          ...(candidate.sourceSessionId
            ? { sourceSessionId: candidate.sourceSessionId }
            : {}),
          ...(candidate.sourceMessageId
            ? { sourceMessageId: candidate.sourceMessageId }
            : {})
        }
        records.push(record)
      }
      candidates.splice(index, 1)
      await this.write(agentId, records)
      await this.writeCandidates(agentId, candidates)
      await this.ensureIndex(agentId, records)
      return clone(record)
    })
  }

  async rejectCandidate(agentId: string, id: string): Promise<boolean> {
    return this.withLock(agentId, async () => {
      const candidates = await this.loadCandidates(agentId)
      const index = candidates.findIndex((candidate) => candidate.id === id)
      if (index < 0) return false
      candidates.splice(index, 1)
      await this.writeCandidates(agentId, candidates)
      return true
    })
  }

  async reindex(agentId: string): Promise<MemoryIndexStatus> {
    if (!this.index) {
      return { available: false, fts: false, enabled: false, vectors: 0, model: '' }
    }
    const records = await this.load(agentId)
    return this.index.reindex(agentId, records)
  }

  indexStatus(agentId: string): MemoryIndexStatus {
    return this.index
      ? this.index.status(agentId)
      : { available: false, fts: false, enabled: false, vectors: 0, model: '' }
  }

  /** FTS5 关键词 + 向量语义命中作为加权项，与置顶、重要度、时间衰减一起排序。 */
  private async ranked(
    agentId: string,
    records: MemoryRecord[],
    query: string,
    tags: string[]
  ): Promise<MemorySearchHit[]> {
    const boosts = new Map<string, number>()
    if (this.index && query.trim()) {
      try {
        await this.index.ensure(agentId, records)
        const result = await this.index.search(agentId, query, 40)
        for (const hit of result.lexical) {
          boosts.set(hit.id, (boosts.get(hit.id) ?? 0) + 30 * hit.score)
        }
        for (const hit of result.vector) {
          boosts.set(
            hit.id,
            (boosts.get(hit.id) ?? 0) + 80 * Math.max(0, Math.min(1, hit.score))
          )
        }
        if (result.error) this.logger('[memory] 混合检索降级', result.error)
      } catch (error) {
        this.logger('[memory] 混合检索失败', error)
      }
    }
    return this.rank(records, query, tags, boosts)
  }

  async search(
    agentId: string,
    query: string,
    tags: string[] = [],
    limit = 10
  ): Promise<MemorySearchHit[]> {
    const records = await this.load(agentId)
    const capped = Math.min(50, Math.max(1, Math.round(limit) || 10))
    return (await this.ranked(agentId, records, query, tags))
      .slice(0, capped)
      .map((hit) => ({ record: clone(hit.record), score: hit.score }))
  }

  /** 每轮对话前自动召回：置顶/核心记忆 + 关键词/语义命中 + 最近使用，返回少量摘要。 */
  async recall(agentId: string, query: string, limit = 8): Promise<MemoryRecord[]> {
    const records = await this.load(agentId)
    const capped = Math.min(20, Math.max(1, Math.round(limit) || 8))
    const picked = (await this.ranked(agentId, records, query, []))
      .slice(0, capped)
      .map((hit) => hit.record)
    await this.markUsed(
      agentId,
      picked.map((record) => record.id)
    )
    return clone(picked)
  }

  async cleanup(agentId: string, unusedDays = 90): Promise<{ removed: number; total: number }> {
    const days = Math.max(0, Math.round(unusedDays) || 0)
    const cutoff = days > 0 ? Date.now() - days * DAY : 0
    return this.update(agentId, (records) => {
      const now = Date.now()
      const kept = records.filter((record) => {
        if (isExpired(record, now)) return false
        if (record.pinned) return true
        if (!cutoff) return true
        const last = Math.max(record.lastUsedAt ?? 0, record.updatedAt)
        return last >= cutoff
      })
      const removed = records.length - kept.length
      records.splice(0, records.length, ...kept)
      return { removed, total: records.length }
    })
  }

  exportPayload(agentId: string): Promise<{ version: number; agentId: string; exportedAt: number; records: MemoryRecord[] }> {
    return this.load(agentId).then((records) => ({
      version: FILE_VERSION,
      agentId,
      exportedAt: Date.now(),
      records: clone(records)
    }))
  }

  async importJson(agentId: string, raw: string): Promise<MemoryImportResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('导入文件不是合法的 JSON')
    }
    const incoming = parsePayload(parsed, agentId, Date.now())
    if (incoming.length === 0) throw new Error('导入文件中没有可用的记忆记录')

    return this.update(agentId, (records) => {
      const now = Date.now()
      let imported = 0
      let updated = 0
      let skipped = 0
      for (const record of incoming) {
        let key: string
        let content: string
        try {
          key = normalizeKey(record.key)
          content = normalizeContent(record.content)
          assertNoSecret(content)
        } catch {
          skipped += 1
          continue
        }
        const existing = records.find((item) => item.key === key)
        if (existing) {
          Object.assign(existing, {
            content,
            kind: record.kind,
            scope: record.scope,
            tags: record.tags,
            pinned: record.pinned,
            importance: record.importance,
            updatedAt: now,
            ...(record.expiresAt ? { expiresAt: record.expiresAt } : {})
          })
          if (!record.expiresAt) delete existing.expiresAt
          updated += 1
          continue
        }
        if (records.length >= MEMORY_LIMIT) {
          skipped += 1
          continue
        }
        records.push({
          ...record,
          id: records.some((item) => item.id === record.id)
            ? 'mem_' + randomUUID()
            : record.id,
          agentId,
          key,
          content,
          updatedAt: now
        })
        imported += 1
      }
      return { imported, updated, skipped, total: records.length }
    })
  }

  async removeAgent(agentId: string): Promise<void> {
    await this.withLock(agentId, async () => {
      const file = this.fileFor(agentId)
      const candidateFile = this.candidateFileFor(agentId)
      await fs.rm(file, { force: true }).catch(() => undefined)
      await fs.rm(file + '.bak', { force: true }).catch(() => undefined)
      await fs.rm(candidateFile, { force: true }).catch(() => undefined)
      await fs.rm(candidateFile + '.bak', { force: true }).catch(() => undefined)
      await this.index?.deleteAgent(agentId).catch(() => undefined)
      let entries: string[] = []
      try {
        entries = await fs.readdir(this.dir)
      } catch {
        return
      }
      const prefixes = [agentId + '.json.', agentId + '.pending.json.']
      await Promise.all(
        entries
          .filter(
            (name) =>
              prefixes.some((prefix) => name.startsWith(prefix)) && name.endsWith('.tmp')
          )
          .map((name) =>
            fs.rm(path.join(this.dir, name), { force: true }).catch(() => undefined)
          )
      )
    })
  }
}
