import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { MemoryRecord } from '@shared/types'
import { MEMORY_LIMIT, MemoryStore } from '../src/main/memory/store'
import { parseExtractionResponse } from '../src/main/memory/extract'

function record(
  agent: string,
  key: string,
  content: string,
  overrides: Partial<MemoryRecord> = {}
): MemoryRecord {
  const now = Date.now()
  return {
    id: 'mem_' + randomUUID(),
    agentId: agent,
    scope: 'agent',
    kind: 'fact',
    key,
    content,
    tags: [],
    pinned: false,
    importance: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentroles-memory-test-'))
  const store = new MemoryStore(root)
  const agentId = 'agent-test'

  function memoryFile(id: string): string {
    return path.join(root, 'memory', id + '.json')
  }

  async function tmpFiles(id: string): Promise<string[]> {
    const entries = await fs.readdir(path.join(root, 'memory'))
    return entries.filter((name) => name.startsWith(id + '.json.') && name.endsWith('.tmp'))
  }

  try {
    // 1. 空目录读取
    const empty = await store.snapshot(agentId)
    assert.equal(empty.total, 0)
    assert.equal(empty.records.length, 0)

    // 2. 基本写入：版本 2 结构 + 唯一 tmp + .bak
    const first = await store.upsert(agentId, {
      key: 'project',
      content: 'AgentRoles 项目',
      kind: 'project',
      tags: ['项目', '桌面端'],
      pinned: true,
      importance: 4
    })
    assert.equal(first.key, 'project')
    assert.equal(first.agentId, agentId)
    const file = JSON.parse(await fs.readFile(memoryFile(agentId), 'utf8'))
    assert.equal(file.version, 2)
    assert.equal(file.records.length, 1)
    assert.equal(file.records[0].content, 'AgentRoles 项目')

    await store.upsert(agentId, { key: 'format', content: '先结论，再风险' })
    const stat = await fs.stat(memoryFile(agentId))
    const bakStat = await fs.stat(memoryFile(agentId) + '.bak')
    assert.ok(bakStat.size > 0)
    assert.ok(stat.size > 0)
    assert.deepEqual(await tmpFiles(agentId), [])
    console.log('[memory] write format + backup OK')

    // 3. 并发写入不同 key：不能丢更新
    const concurrent = Array.from({ length: 40 }, (_, index) =>
      store.upsert(agentId, {
        key: 'concurrent_' + index,
        content: '并发内容 ' + index
      })
    )
    await Promise.all(concurrent)
    let records = await store.list(agentId)
    assert.equal(records.filter((item) => item.key.startsWith('concurrent_')).length, 40)
    assert.equal(records.length, 42)
    assert.deepEqual(await tmpFiles(agentId), [])
    const parsed = JSON.parse(await fs.readFile(memoryFile(agentId), 'utf8'))
    assert.equal(parsed.records.length, 42)
    console.log('[memory] concurrent upsert keeps all 40 keys OK')

    // 4. 并发写同一个 key：只保留一条
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.upsert(agentId, { key: 'same_key', content: '版本 ' + index })
      )
    )
    records = await store.list(agentId)
    assert.equal(records.filter((item) => item.key === 'same_key').length, 1)
    console.log('[memory] concurrent same-key upsert stays singular OK')

    // 5. 搜索、排序与 lastUsedAt
    await store.upsert(agentId, {
      key: 'weekly_report',
      content: '汇报格式：先结论，再风险，最后待确认',
      kind: 'preference',
      tags: ['汇报', '格式'],
      importance: 3
    })
    const hits = await store.search(agentId, '汇报 格式', ['汇报'])
    assert.ok(hits.length >= 1)
    assert.equal(hits[0].record.key, 'weekly_report')

    const recalled = await store.recall(agentId, '这次的周报怎么写', 8)
    assert.ok(recalled.some((item) => item.key === 'weekly_report'))
    assert.ok(recalled.some((item) => item.key === 'project'))
    assert.ok(recalled.length <= 8)
    await new Promise((resolve) => setTimeout(resolve, 20))
    records = await store.list(agentId)
    assert.ok(records.find((item) => item.key === 'project')?.lastUsedAt)
    console.log('[memory] search + recall + lastUsedAt OK')

    // 6. 过期记录不召回，并在清理时删除
    const expiredAt = Date.now() - 1000
    await store.upsert(agentId, {
      key: 'expired_cache',
      content: '本周临时项目代号',
      expiresAt: expiredAt
    })
    const recalled2 = await store.recall(agentId, '临时项目代号', 10)
    assert.ok(!recalled2.some((item) => item.key === 'expired_cache'))
    assert.equal((await store.snapshot(agentId)).expired, 1)

    // 7. 清理：过期删除，非核心陈旧删除，核心保留
    const staleAt = Date.now() - 120 * 24 * 60 * 60 * 1000
    await store.update(agentId, (list) => {
      list.push(
        record(agentId, 'stale_old', '很久以前的内容', {
          createdAt: staleAt,
          updatedAt: staleAt
        }),
        record(agentId, 'stale_pinned', '很久以前的核心内容', {
          createdAt: staleAt,
          updatedAt: staleAt,
          pinned: true
        })
      )
    })
    const cleaned = await store.cleanup(agentId, 90)
    assert.ok(cleaned.removed >= 2)
    records = await store.list(agentId)
    assert.ok(!records.some((item) => item.key === 'expired_cache'))
    assert.ok(!records.some((item) => item.key === 'stale_old'))
    assert.ok(records.some((item) => item.key === 'stale_pinned'))
    console.log('[memory] expiry + cleanup keeps pinned OK')

    // 8. 主文件损坏时从 .bak 恢复
    await fs.writeFile(memoryFile(agentId), '{ broken json', 'utf8')
    const recovered = await store.list(agentId)
    assert.ok(recovered.length > 0)
    assert.ok(recovered.some((item) => item.key === 'project'))
    await store.upsert(agentId, { key: 'after_recovery', content: '恢复后仍可写入' })
    assert.ok((await store.list(agentId)).some((item) => item.key === 'after_recovery'))
    console.log('[memory] corrupt main file falls back to .bak OK')

    // 9. 旧版 { key: value } 自动迁移
    const legacyAgent = 'agent-legacy'
    await fs.mkdir(path.join(root, 'memory'), { recursive: true })
    await fs.writeFile(
      memoryFile(legacyAgent),
      JSON.stringify({ old_key: '旧值', another: '第二条' }, null, 2),
      'utf8'
    )
    const legacy = await store.list(legacyAgent)
    assert.equal(legacy.length, 2)
    assert.equal(legacy.find((item) => item.key === 'old_key')?.content, '旧值')
    assert.ok(legacy.every((item) => item.id.startsWith('mem_')))
    await store.upsert(legacyAgent, { key: 'new_key', content: '新值' })
    const migrated = JSON.parse(await fs.readFile(memoryFile(legacyAgent), 'utf8'))
    assert.equal(migrated.version, 2)
    assert.equal(migrated.records.length, 3)
    console.log('[memory] legacy map migration OK')

    // 10. 导入导出
    const exported = await store.exportPayload(legacyAgent)
    assert.equal(exported.version, 2)
    assert.equal(exported.records.length, 3)
    const importAgent = 'agent-import'
    const imported = await store.importJson(importAgent, JSON.stringify(exported))
    assert.equal(imported.imported, 3)
    assert.equal((await store.list(importAgent)).length, 3)
    const merged = await store.importJson(importAgent, JSON.stringify(exported))
    assert.equal(merged.updated, 3)
    assert.equal((await store.list(importAgent)).length, 3)
    const singleAgent = 'agent-single'
    const single = await store.importJson(
      singleAgent,
      JSON.stringify({ key: 'solo', content: '单条记录导入' })
    )
    assert.equal(single.imported, 1)
    assert.equal((await store.list(singleAgent))[0].content, '单条记录导入')
    console.log('[memory] import + export merge OK')

    // 11. 容量上限
    const capAgent = 'agent-cap'
    await store.update(capAgent, (list) => {
      for (let index = 0; index < MEMORY_LIMIT; index += 1) {
        list.push(record(capAgent, 'key_' + index, '内容 ' + index))
      }
    })
    await assert.rejects(
      store.upsert(capAgent, { key: 'one_more', content: '超限' }),
      /上限/
    )
    await store.upsert(capAgent, { key: 'key_0', content: '覆盖已有 key 不受上限影响' })
    console.log('[memory] capacity limit OK')

    // 12. 密钥拒绝
    await assert.rejects(
      store.upsert(agentId, {
        key: 'leaked_key',
        content: 'key is sk-' + 'a'.repeat(32)
      }),
      /疑似包含密钥/
    )
    console.log('[memory] secret detection OK')

    // 13. 待确认候选：高置信度偏好自动保存，其余进入 pending
    const pendingAgent = 'agent-pending'
    const added = await store.addCandidates(
      pendingAgent,
      [
        {
          key: 'pref',
          content: '先结论，再风险',
          kind: 'preference',
          confidence: 0.9
        },
        {
          key: 'project_fact',
          content: '项目 A 使用 Notion 数据库',
          kind: 'fact',
          confidence: 0.55,
          reason: '长期项目背景',
          tags: ['项目']
        }
      ],
      { autoAcceptConfidence: 0.85, sourceSessionId: 'session-1' }
    )
    assert.equal(added.accepted, 1)
    assert.equal(added.added, 1)
    assert.equal(added.pending, 1)
    let snapshot = await store.snapshot(pendingAgent)
    assert.equal(snapshot.total, 1)
    assert.equal(snapshot.pendingCount, 1)
    assert.equal(snapshot.pending[0].key, 'project_fact')
    assert.equal(snapshot.pending[0].sourceSessionId, 'session-1')
    assert.equal(snapshot.index.available, false)

    const confirmed = await store.confirmCandidate(pendingAgent, snapshot.pending[0].id)
    assert.ok(confirmed)
    snapshot = await store.snapshot(pendingAgent)
    assert.equal(snapshot.total, 2)
    assert.equal(snapshot.pendingCount, 0)

    await store.addCandidates(pendingAgent, [
      {
        key: 'pref',
        content: '新的汇报偏好',
        kind: 'preference',
        confidence: 0.2
      }
    ])
    let candidates = await store.listCandidates(pendingAgent)
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].supersedesKey, 'pref')
    const updated = await store.confirmCandidate(pendingAgent, candidates[0].id)
    assert.equal(updated?.content, '新的汇报偏好')
    assert.equal(
      (await store.list(pendingAgent)).filter((item) => item.key === 'pref').length,
      1
    )

    await store.addCandidates(pendingAgent, [
      { key: 'temp', content: '临时候选', confidence: 0.2 }
    ])
    candidates = await store.listCandidates(pendingAgent)
    assert.equal(candidates.length, 1)
    assert.equal(await store.rejectCandidate(pendingAgent, candidates[0].id), true)
    assert.equal((await store.listCandidates(pendingAgent)).length, 0)

    const duplicate = await store.addCandidates(pendingAgent, [
      {
        key: 'pref',
        content: '新的汇报偏好',
        kind: 'preference',
        confidence: 0.2
      }
    ])
    assert.equal(duplicate.added, 0)
    assert.equal(duplicate.skipped, 1)
    const secretCandidate = await store.addCandidates(pendingAgent, [
      { key: 'leak', content: 'sk-' + 'a'.repeat(32), confidence: 0.9 }
    ])
    assert.equal(secretCandidate.skipped, 1)
    console.log('[memory] pending candidates + auto accept OK')

    // 14. 提取结果解析
    const extracted = parseExtractionResponse(
      '说明文字\n' +
        '\`\`\`json\n' +
        '[{"key":"style","content":"先说结论","kind":"preference","tags":["汇报"],"confidence":0.92,"reason":"稳定偏好"}]\n' +
        '\`\`\`'
    )
    assert.equal(extracted.length, 1)
    assert.equal(extracted[0].kind, 'preference')
    assert.ok(extracted[0]!.tags?.includes('汇报'))
    assert.equal(parseExtractionResponse('[]').length, 0)
    assert.equal(
      parseExtractionResponse(
        '[{"key":"leak","content":"sk-' + 'a'.repeat(32) + '","confidence":0.9}]'
      ).length,
      0
    )
    console.log('[memory] extraction response parsing OK')

    // 15. 删除角色清理主文件、备份与临时文件
    await store.removeAgent(legacyAgent)
    await store.removeAgent(pendingAgent)
    await assert.rejects(fs.stat(memoryFile(legacyAgent)))
    await assert.rejects(fs.stat(memoryFile(legacyAgent) + '.bak'))
    await assert.rejects(fs.stat(path.join(root, 'memory', pendingAgent + '.pending.json')))
    console.log('[memory] removeAgent cleanup OK')

    console.log('[memory] PASS')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
