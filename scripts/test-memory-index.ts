import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultSettings } from '../src/main/defaults'
import { MemoryIndex } from '../src/main/memory/index'
import { MemoryStore } from '../src/main/memory/store'
import type { EmbeddingResult } from '../src/main/memory/embedding'

function fakeEmbed(texts: string[]): EmbeddingResult {
  const vectors = texts.map((text) => {
    const vector = new Float32Array([
      /周报|汇报/.test(text) ? 1 : 0,
      /Notion|任务库/.test(text) ? 1 : 0,
      /部署|发布/.test(text) ? 1 : 0
    ])
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
    return vector.map((value) => value / length)
  })
  return { vectors, model: 'fake-embed', dimensions: 3 }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentroles-index-test-'))
  const settings = defaultSettings(path.join(root, 'workspace'))
  settings.memory.embedding = {
    enabled: true,
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: '',
    model: 'fake-embed'
  }

  const index = await MemoryIndex.open({
    dataDir: root,
    getSettings: () => settings,
    embed: async (_settings, texts) => fakeEmbed(texts),
    logger: (message, error) => console.error('[index-test]', message, error ?? '')
  })
  assert.ok(index, 'MemoryIndex should open with node:sqlite + FTS5')

  const store = new MemoryStore(root, { index })
  const agentId = 'agent-index'

  try {
    const weekly = await store.upsert(agentId, {
      key: 'weekly_report',
      content: '汇报格式：先结论，再风险，最后待确认',
      kind: 'preference',
      tags: ['汇报'],
      pinned: true
    })
    const notion = await store.upsert(agentId, {
      key: 'notion_database',
      content: '项目 A 使用 Notion 任务库',
      kind: 'project',
      tags: ['项目']
    })
    const deploy = await store.upsert(agentId, {
      key: 'deploy_flow',
      content: '部署流程：先构建，再发布',
      kind: 'fact'
    })

    await index.refreshVectors(agentId, await store.list(agentId))
    const status = index.status(agentId)
    assert.equal(status.available, true)
    assert.equal(status.fts, true)
    assert.ok(status.vectors >= 3)

    // 中文 FTS：二元组让「汇报」命中
    const fts = await index.search(agentId, '汇报', 10)
    assert.ok(fts.lexical.some((hit) => hit.id === weekly.id))

    // 语义命中：查询「周报」不在原文中，但向量与「汇报」相近
    const semantic = await index.search(agentId, '周报', 10)
    assert.ok(!semantic.lexical.some((hit) => hit.id === weekly.id))
    assert.ok(semantic.vector.some((hit) => hit.id === weekly.id))

    const hybrid = await store.search(agentId, '周报', [], 5)
    assert.equal(hybrid[0].record.id, weekly.id)
    console.log('[memory-index] FTS5 + vector hybrid search OK')

    // 关闭 embedding 后只保留本地 FTS
    settings.memory.embedding.enabled = false
    const lexicalOnly = await index.search(agentId, '汇报', 10)
    assert.equal(lexicalOnly.vector.length, 0)
    assert.equal(lexicalOnly.embeddingUsed, false)
    assert.ok(lexicalOnly.lexical.some((hit) => hit.id === weekly.id))
    console.log('[memory-index] embedding-disabled fallback OK')

    // 重新启用并重建索引
    settings.memory.embedding.enabled = true
    const rebuilt = await store.reindex(agentId)
    assert.equal(rebuilt.available, true)
    assert.ok(rebuilt.vectors >= 3)

    // 内容更新后 FTS 能命中新词
    await store.upsert(agentId, {
      key: 'notion_database',
      content: 'Notion 数据库已迁移到新的 workspace',
      kind: 'project',
      tags: ['项目']
    })
    await store.reindex(agentId)
    const migrated = await store.search(agentId, '迁移', [], 5)
    assert.ok(migrated.some((hit) => hit.record.key === 'notion_database'))
    console.log('[memory-index] reindex after content update OK')

    // 角色删除后索引数据一并清理
    await store.removeAgent(agentId)
    assert.equal(index.status(agentId).vectors, 0)
    console.log('[memory-index] delete agent cleanup OK')

    console.log('[memory-index] PASS')
  } finally {
    index?.close()
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
