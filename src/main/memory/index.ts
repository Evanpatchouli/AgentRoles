import fs from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings, MemoryIndexStatus, MemoryRecord } from '@shared/types'
import {
  embedTexts,
  embeddingConfigured,
  type EmbeddingResult
} from './embedding'
import { buildSearchText, hashText, tokenizeSearch } from './text'

export interface MemoryIndexOptions {
  dataDir: string
  getSettings: () => AppSettings
  embed?: (
    settings: AppSettings['memory']['embedding'],
    texts: string[],
    signal?: AbortSignal
  ) => Promise<EmbeddingResult>
  logger?: (message: string, error?: unknown) => void
}

export interface MemoryIndexHit {
  id: string
  score: number
}

export interface MemoryIndexSearchResult {
  lexical: MemoryIndexHit[]
  vector: MemoryIndexHit[]
  embeddingUsed: boolean
  error?: string
}

const VECTOR_BATCH = 32
const QUERY_CACHE_LIMIT = 64
const QUERY_CACHE_TTL = 10 * 60 * 1000

function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  if (sum <= 0) return vector
  const scale = 1 / Math.sqrt(sum)
  const output = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1) {
    output[index] = vector[index] * scale
  }
  return output
}

function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index]
  return sum
}

/** SQLite BLOB 的 byteOffset 不保证 4 字节对齐，用 DataView 安全读取。 */
function readVector(bytes: Uint8Array, dimensions: number): Float32Array {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vector = new Float32Array(dimensions)
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = data.getFloat32(index * 4, true)
  }
  return vector
}

function vectorText(record: MemoryRecord): string {
  return [record.key, record.content, record.tags.join(' ')].join('\n').slice(0, 20000)
}

/** 将 Base URL 纳入向量版本键，换服务端点但复用模型名时也会重建向量。 */
function embeddingKey(settings: AppSettings['memory']['embedding']): string {
  return (
    String(settings.baseUrl ?? '').trim().replace(/\/+$/, '') +
    '|' +
    String(settings.model ?? '').trim()
  )
}

function signatureOf(records: MemoryRecord[]): string {
  return hashText(
    records
      .map(
        (record) =>
          record.id +
          ':' +
          record.updatedAt +
          ':' +
          hashText(record.key + '\0' + record.content + '\0' + record.tags.join(','))
      )
      .sort()
      .join('|')
  )
}

/**
 * SQLite 索引：
 * - FTS5 关键词检索（中文补充二元组）
 * - 向量以 Float32Array BLOB 存储，检索时在 Node 侧做余弦相似度
 *
 * 记忆 JSON 仍是唯一事实来源；索引是派生数据，可随时重建。
 */
export class MemoryIndex {
  private readonly db: DatabaseSync
  private readonly getSettings: () => AppSettings
  private readonly embed: NonNullable<MemoryIndexOptions['embed']>
  private readonly logger: NonNullable<MemoryIndexOptions['logger']>
  private readonly indexTails = new Map<string, Promise<void>>()
  private readonly vectorTails = new Map<string, Promise<void>>()
  private readonly errors = new Map<string, string>()
  private readonly queryCache = new Map<
    string,
    { vector: Float32Array; model: string; at: number }
  >()
  private embeddingCooldownUntil = 0
  private ftsAvailable = false

  private constructor(db: DatabaseSync, options: MemoryIndexOptions) {
    this.db = db
    this.getSettings = options.getSettings
    this.embed = options.embed ?? embedTexts
    this.logger =
      options.logger ??
      ((message, error) => console.error(message, error ?? ''))
    this.initSchema()
  }

  static async open(options: MemoryIndexOptions): Promise<MemoryIndex | null> {
    let sqlite: typeof import('node:sqlite')
    try {
      sqlite = await import('node:sqlite')
    } catch (error) {
      options.logger?.('[memory] node:sqlite 不可用，回退到内存检索', error)
      return null
    }
    try {
      await fs.mkdir(path.join(options.dataDir, 'memory'), { recursive: true })
      const file = path.join(options.dataDir, 'memory', 'index.sqlite')
      const db = new sqlite.DatabaseSync(file)
      return new MemoryIndex(db, options)
    } catch (error) {
      options.logger?.('[memory] 打开 SQLite 索引失败，回退到内存检索', error)
      return null
    }
  }

  private initSchema(): void {
    this.db.exec(
      'PRAGMA journal_mode = WAL;' +
        'PRAGMA synchronous = NORMAL;' +
        'CREATE TABLE IF NOT EXISTS memory_index_meta (' +
        '  agent_id TEXT PRIMARY KEY,' +
        '  signature TEXT NOT NULL,' +
        '  record_count INTEGER NOT NULL,' +
        '  updated_at INTEGER NOT NULL' +
        ');' +
        'CREATE TABLE IF NOT EXISTS memory_index (' +
        '  agent_id TEXT NOT NULL,' +
        '  record_id TEXT NOT NULL,' +
        '  key TEXT NOT NULL,' +
        '  content TEXT NOT NULL,' +
        '  tags TEXT NOT NULL,' +
        '  updated_at INTEGER NOT NULL,' +
        '  PRIMARY KEY (agent_id, record_id)' +
        ');' +
        'CREATE TABLE IF NOT EXISTS memory_vectors (' +
        '  agent_id TEXT NOT NULL,' +
        '  record_id TEXT NOT NULL,' +
        '  model TEXT NOT NULL,' +
        '  content_hash TEXT NOT NULL,' +
        '  dim INTEGER NOT NULL,' +
        '  vector BLOB NOT NULL,' +
        '  updated_at INTEGER NOT NULL,' +
        '  PRIMARY KEY (agent_id, record_id)' +
        ');'
    )
    try {
      this.db.exec(
        'CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(' +
          'agent_id UNINDEXED,' +
          'record_id UNINDEXED,' +
          'search_text,' +
          "tokenize = 'unicode61'" +
          ');'
      )
      this.ftsAvailable = true
    } catch (error) {
      this.ftsAvailable = false
      this.logger?.('[memory] FTS5 不可用，关键词检索将回退到内存', error)
    }
  }

  private withLock<T>(
    tails: Map<string, Promise<void>>,
    agentId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = tails.get(agentId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    tails.set(agentId, tail)
    void tail.then(() => {
      if (tails.get(agentId) === tail) tails.delete(agentId)
    })
    return run
  }

  /** 确保 FTS 索引与当前 JSON 记录一致；向量在后台补齐，不阻塞写入。 */
  async ensure(agentId: string, records: MemoryRecord[], force = false): Promise<void> {
    await this.withLock(this.indexTails, agentId, async () => {
      const signature = signatureOf(records)
      const meta = this.db
        .prepare('SELECT signature FROM memory_index_meta WHERE agent_id = ?')
        .get(agentId) as { signature?: string } | undefined
      if (!force && meta?.signature === signature) return

      this.db.exec('BEGIN')
      try {
        if (this.ftsAvailable) {
          this.db.prepare('DELETE FROM memory_fts WHERE agent_id = ?').run(agentId)
        }
        this.db.prepare('DELETE FROM memory_index WHERE agent_id = ?').run(agentId)
        const insertRecord = this.db.prepare(
          'INSERT INTO memory_index (agent_id, record_id, key, content, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        const insertFts = this.ftsAvailable
          ? this.db.prepare(
              'INSERT INTO memory_fts (agent_id, record_id, search_text) VALUES (?, ?, ?)'
            )
          : null
        for (const record of records) {
          insertRecord.run(
            agentId,
            record.id,
            record.key,
            record.content,
            record.tags.join(','),
            record.updatedAt
          )
          insertFts?.run(agentId, record.id, buildSearchText(record))
        }
        this.db
          .prepare(
            'INSERT INTO memory_index_meta (agent_id, signature, record_count, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET signature = excluded.signature, record_count = excluded.record_count, updated_at = excluded.updated_at'
          )
          .run(agentId, signature, records.length, Date.now())
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })

    if (embeddingConfigured(this.getSettings().memory.embedding)) {
      void this.refreshVectors(agentId, records)
    }
  }

  /** 只对新增/内容变化/模型变化的记录建立向量。失败只记录，不影响记忆读写。 */
  async refreshVectors(agentId: string, records: MemoryRecord[]): Promise<void> {
    const settings = this.getSettings().memory.embedding
    if (!embeddingConfigured(settings)) return
    if (Date.now() < this.embeddingCooldownUntil) return
    const modelKey = embeddingKey(settings)
    await this.withLock(this.vectorTails, agentId, async () => {
      try {
        const existing = this.db
          .prepare(
            'SELECT record_id, model, content_hash FROM memory_vectors WHERE agent_id = ?'
          )
          .all(agentId) as Array<{
          record_id: string
          model: string
          content_hash: string
        }>
        const current = new Map(existing.map((row) => [row.record_id, row]))
        const now = Date.now()
        const embeddable = records.filter(
          (record) => !record.expiresAt || record.expiresAt > now
        )
        const stale = embeddable.filter((record) => {
          const row = current.get(record.id)
          return (
            !row ||
            row.model !== modelKey ||
            row.content_hash !== hashText(vectorText(record))
          )
        })
        const keep = new Set(embeddable.map((record) => record.id))
        const remove = existing
          .map((row) => row.record_id)
          .filter((id) => !keep.has(id))
        if (remove.length) {
          const del = this.db.prepare(
            'DELETE FROM memory_vectors WHERE agent_id = ? AND record_id = ?'
          )
          this.db.exec('BEGIN')
          try {
            for (const id of remove) del.run(agentId, id)
            this.db.exec('COMMIT')
          } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
          }
        }
        if (stale.length === 0) {
          this.errors.delete(agentId)
          return
        }

        for (let offset = 0; offset < stale.length; offset += VECTOR_BATCH) {
          const batch = stale.slice(offset, offset + VECTOR_BATCH)
          const result = await this.embed(
            settings,
            batch.map((record) => vectorText(record))
          )
          const upsert = this.db.prepare(
            'INSERT INTO memory_vectors (agent_id, record_id, model, content_hash, dim, vector, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id, record_id) DO UPDATE SET model = excluded.model, content_hash = excluded.content_hash, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at'
          )
          this.db.exec('BEGIN')
          try {
            for (let index = 0; index < batch.length; index += 1) {
              const vector = normalizeVector(result.vectors[index])
              upsert.run(
                agentId,
                batch[index].id,
                modelKey,
                hashText(vectorText(batch[index])),
                vector.length,
                new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
                Date.now()
              )
            }
            this.db.exec('COMMIT')
          } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
          }
        }
        this.errors.delete(agentId)
        this.embeddingCooldownUntil = 0
      } catch (error: any) {
        this.errors.set(
          agentId,
          error?.message ?? String(error ?? 'Embedding 失败')
        )
        this.embeddingCooldownUntil = Date.now() + 30000
        this.logger?.('[memory] 向量索引失败', error)
      }
    })
  }

  private embeddingForQuery(
    query: string
  ): { vector: Float32Array; model: string } | null {
    const settings = this.getSettings().memory.embedding
    if (!embeddingConfigured(settings)) return null
    const cacheKey = embeddingKey(settings) + '\0' + query.trim().toLowerCase()
    const cached = this.queryCache.get(cacheKey)
    if (cached && Date.now() - cached.at < QUERY_CACHE_TTL) {
      this.queryCache.delete(cacheKey)
      this.queryCache.set(cacheKey, cached)
      return { vector: cached.vector, model: cached.model }
    }
    return null
  }

  private rememberQuery(query: string, vector: Float32Array, model: string): void {
    const cacheKey = model + '\0' + query.trim().toLowerCase()
    this.queryCache.set(cacheKey, { vector, model, at: Date.now() })
    if (this.queryCache.size > QUERY_CACHE_LIMIT) {
      const oldest = this.queryCache.keys().next().value
      if (oldest) this.queryCache.delete(oldest)
    }
  }

  async search(
    agentId: string,
    query: string,
    limit: number
  ): Promise<MemoryIndexSearchResult> {
    const lexical: MemoryIndexHit[] = []
    const vector: MemoryIndexHit[] = []
    let embeddingUsed = false
    let error: string | undefined

    const tokens = tokenizeSearch(query)
    if (this.ftsAvailable && tokens.length > 0) {
      const match = tokens
        .map((token) => '"' + token.replace(/"/g, '') + '"')
        .join(' OR ')
      try {
        const rows = this.db
          .prepare(
            'SELECT record_id, bm25(memory_fts) AS score FROM memory_fts WHERE memory_fts MATCH ? AND agent_id = ? ORDER BY score LIMIT ?'
          )
          .all(match, agentId, Math.max(1, limit)) as Array<{
          record_id: string
          score: number
        }>
        rows.forEach((row, index) => {
          lexical.push({
            id: row.record_id,
            score: (rows.length - index) / Math.max(1, rows.length)
          })
        })
      } catch (caught: any) {
        error = caught?.message ?? String(caught)
        this.logger?.('[memory] FTS 查询失败', caught)
      }
    }

    const settings = this.getSettings().memory.embedding
    if (embeddingConfigured(settings)) {
      try {
        const modelKey = embeddingKey(settings)
        const countRow = this.db
          .prepare(
            'SELECT COUNT(*) AS count FROM memory_vectors WHERE agent_id = ? AND model = ?'
          )
          .get(agentId, modelKey) as { count?: number } | undefined
        if (!Number(countRow?.count)) return { lexical, vector, embeddingUsed, error }
        let queryVector = this.embeddingForQuery(query)?.vector
        if (!queryVector) {
          if (Date.now() < this.embeddingCooldownUntil) {
            return { lexical, vector, embeddingUsed, error }
          }
          const result = await this.embed(
            settings,
            [query],
            AbortSignal.timeout(8000)
          )
          queryVector = normalizeVector(result.vectors[0])
          this.rememberQuery(query, queryVector, modelKey)
          embeddingUsed = true
          this.embeddingCooldownUntil = 0
          this.errors.delete(agentId)
        }
        const rows = this.db
          .prepare(
            'SELECT record_id, dim, vector FROM memory_vectors WHERE agent_id = ? AND model = ?'
          )
          .all(agentId, modelKey) as Array<{
          record_id: string
          dim: number
          vector: Uint8Array
        }>
        for (const row of rows) {
          if (!row.vector || row.vector.byteLength < row.dim * 4) continue
          if (row.dim !== queryVector.length) continue
          const view = readVector(row.vector, row.dim)
          const similarity = dot(queryVector, view)
          if (similarity > 0) {
            vector.push({ id: row.record_id, score: similarity })
          }
        }
        vector.sort((a, b) => b.score - a.score)
        vector.splice(Math.max(1, limit))
      } catch (caught: any) {
        const message = caught?.message ?? String(caught)
        error = message
        this.errors.set(agentId, message)
        this.embeddingCooldownUntil = Date.now() + 30000
        this.logger?.('[memory] 向量查询失败', caught)
      }
    }

    return { lexical, vector, embeddingUsed, error }
  }

  async reindex(agentId: string, records: MemoryRecord[]): Promise<MemoryIndexStatus> {
    await this.ensure(agentId, records, true)
    await this.refreshVectors(agentId, records)
    return this.status(agentId)
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.withLock(this.indexTails, agentId, async () => {
      await this.withLock(this.vectorTails, agentId, async () => {
        for (const table of ['memory_index', 'memory_vectors', 'memory_index_meta']) {
          this.db.prepare('DELETE FROM ' + table + ' WHERE agent_id = ?').run(agentId)
        }
        if (this.ftsAvailable) {
          this.db.prepare('DELETE FROM memory_fts WHERE agent_id = ?').run(agentId)
        }
        this.errors.delete(agentId)
      })
    })
  }

  status(agentId: string): MemoryIndexStatus {
    let vectors = 0
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM memory_vectors WHERE agent_id = ?')
        .get(agentId) as { count?: number } | undefined
      vectors = Number(row?.count) || 0
    } catch {
      /* ignore */
    }
    return {
      available: true,
      fts: this.ftsAvailable,
      enabled: Boolean(this.getSettings().memory.embedding.enabled),
      vectors,
      model: this.getSettings().memory.embedding.model || '',
      ...(this.errors.get(agentId) ? { lastError: this.errors.get(agentId) } : {})
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* ignore */
    }
  }
}
