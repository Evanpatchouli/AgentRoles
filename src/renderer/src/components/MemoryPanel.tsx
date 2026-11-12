import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Agent,
  MemoryCandidate,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemorySnapshot
} from '@shared/types'
import { Icon } from './Icons'
import { ConfirmDialog, Toggle } from './Primitives'

const KIND_OPTIONS: Array<{ id: MemoryKind; label: string }> = [
  { id: 'profile', label: '身份' },
  { id: 'preference', label: '偏好' },
  { id: 'fact', label: '事实' },
  { id: 'project', label: '项目' },
  { id: 'task', label: '任务' }
]

const SCOPE_OPTIONS: Array<{ id: MemoryScope; label: string }> = [
  { id: 'agent', label: '角色' },
  { id: 'project', label: '项目' },
  { id: 'session', label: '会话' }
]

const KIND_LABEL: Record<MemoryKind, string> = {
  profile: '身份',
  preference: '偏好',
  fact: '事实',
  project: '项目',
  task: '任务'
}

const KIND_CLASS: Record<MemoryKind, string> = {
  profile: 'badge-ok',
  preference: 'badge-ok',
  fact: 'badge-muted',
  project: 'badge-warn',
  task: 'badge-muted'
}

const SCOPE_LABEL: Record<MemoryScope, string> = {
  agent: '角色',
  project: '项目',
  session: '会话'
}

interface Draft {
  id?: string
  key: string
  content: string
  kind: MemoryKind
  scope: MemoryScope
  tags: string
  pinned: boolean
  importance: number
  expiresAt: string
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<void>
}

function emptyDraft(): Draft {
  return {
    key: '',
    content: '',
    kind: 'fact',
    scope: 'agent',
    tags: '',
    pinned: false,
    importance: 1,
    expiresAt: ''
  }
}

function formatTime(value?: number): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function dateValue(timestamp?: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function parseDateValue(value: string): number | null {
  if (!value) return null
  const parsed = new Date(value + 'T23:59:59').getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function toDraft(record: MemoryRecord): Draft {
  return {
    id: record.id,
    key: record.key,
    content: record.content,
    kind: record.kind,
    scope: record.scope,
    tags: record.tags.join(', '),
    pinned: Boolean(record.pinned),
    importance: record.importance ?? 1,
    expiresAt: dateValue(record.expiresAt)
  }
}

export function MemoryPanel({
  agent,
  notify
}: {
  agent: Agent
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | MemoryKind>('all')
  const [tag, setTag] = useState('all')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await window.api.listMemories(agent.id)
      setSnapshot(next)
      setError('')
    } catch (caught: any) {
      setError(caught?.message ?? String(caught))
    } finally {
      setLoading(false)
    }
  }, [agent.id])

  useEffect(() => {
    setLoading(true)
    setSnapshot(null)
    setDraft(null)
    setQuery('')
    setKind('all')
    setTag('all')
    setPinnedOnly(false)
    setExpanded(new Set())
    void load()
  }, [load])

  useEffect(() => {
    return window.api.onAgentEvent((event) => {
      if (event.type === 'memory_updated' && event.agentId === agent.id) {
        void load()
      }
    })
  }, [agent.id, load])

  const activeRecords = useMemo(
    () => (snapshot ? snapshot.records.filter((record) => !record.expiresAt || record.expiresAt > Date.now()) : []),
    [snapshot]
  )

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const record of snapshot?.records ?? []) {
      for (const item of record.tags) tags.add(item)
    }
    return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [snapshot])

  const records = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (snapshot?.records ?? []).filter((record) => {
      if (pinnedOnly && !record.pinned) return false
      if (kind !== 'all' && record.kind !== kind) return false
      if (tag !== 'all' && !record.tags.includes(tag)) return false
      if (!needle) return true
      return (
        record.key.toLowerCase().includes(needle) ||
        record.content.toLowerCase().includes(needle) ||
        record.tags.some((item) => item.toLowerCase().includes(needle))
      )
    })
  }, [snapshot, query, kind, tag, pinnedOnly])

  const pending = snapshot?.pending ?? []

  const confirmCandidate = async (candidate: MemoryCandidate): Promise<void> => {
    try {
      const record = await window.api.confirmMemoryCandidate(agent.id, candidate.id)
      await load()
      notify(
        record ? 'success' : 'info',
        record ? '已确认「' + candidate.key + '」' : '候选已不存在，列表已刷新'
      )
    } catch (caught: any) {
      notify('error', '确认记忆失败：' + (caught?.message ?? String(caught)))
    }
  }

  const rejectCandidate = async (candidate: MemoryCandidate): Promise<void> => {
    try {
      await window.api.rejectMemoryCandidate(agent.id, candidate.id)
      await load()
      notify('info', '已忽略「' + candidate.key + '」')
    } catch (caught: any) {
      notify('error', '忽略候选失败：' + (caught?.message ?? String(caught)))
    }
  }

  const confirmAll = async (): Promise<void> => {
    const list = [...pending]
    if (list.length === 0) return
    let confirmed = 0
    try {
      for (const candidate of list) {
        await window.api.confirmMemoryCandidate(agent.id, candidate.id)
        confirmed += 1
      }
      notify('success', '已确认 ' + confirmed + ' 条候选记忆')
    } catch (caught: any) {
      notify(
        'error',
        '确认到第 ' +
          (confirmed + 1) +
          ' 条时失败：' +
          (caught?.message ?? String(caught))
      )
    } finally {
      await load()
    }
  }

  const reindex = async (): Promise<void> => {
    setReindexing(true)
    try {
      const status = await window.api.reindexMemories(agent.id)
      await load()
      notify(
        status.available ? 'success' : 'info',
        status.available
          ? '索引已重建：FTS ' +
            (status.fts ? '可用' : '不可用') +
            (status.enabled
              ? '，向量 ' + status.vectors + ' 条'
              : '，向量检索未启用')
          : 'SQLite 索引不可用，已回退到内存检索'
      )
    } catch (caught: any) {
      notify('error', '重建索引失败：' + (caught?.message ?? String(caught)))
    } finally {
      setReindexing(false)
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    if (!draft.key.trim()) {
      notify('error', '记忆 key 不能为空')
      return
    }
    if (!draft.content.trim()) {
      notify('error', '记忆内容不能为空')
      return
    }
    setSaving(true)
    try {
      await window.api.saveMemory(agent.id, {
        id: draft.id,
        key: draft.key.trim(),
        content: draft.content,
        kind: draft.kind,
        scope: draft.scope,
        tags: draft.tags
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        pinned: draft.pinned,
        importance: draft.importance,
        expiresAt: parseDateValue(draft.expiresAt)
      })
      setDraft(null)
      await load()
      notify('success', '记忆已保存')
    } catch (caught: any) {
      notify('error', '保存记忆失败：' + (caught?.message ?? String(caught)))
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async (record: MemoryRecord): Promise<void> => {
    try {
      await window.api.saveMemory(agent.id, {
        id: record.id,
        key: record.key,
        content: record.content,
        kind: record.kind,
        scope: record.scope,
        tags: record.tags,
        pinned: !record.pinned,
        importance: record.importance ?? 1,
        expiresAt: record.expiresAt ?? null
      })
      await load()
      notify('success', record.pinned ? '已取消核心记忆' : '已置顶为核心记忆')
    } catch (caught: any) {
      notify('error', '更新置顶失败：' + (caught?.message ?? String(caught)))
    }
  }

  const requestDelete = (record: MemoryRecord): void => {
    setConfirm({
      title: '删除记忆「' + record.key + '」？',
      message: '删除后无法恢复。如果这个角色正在多会话并行运行，删除会立即对其他会话生效。',
      confirmLabel: '删除记忆',
      danger: true,
      action: async () => {
        await window.api.deleteMemory(agent.id, record.id)
        await load()
        notify('success', '记忆已删除')
      }
    })
  }

  const requestCleanup = (): void => {
    setConfirm({
      title: '清理过期与长期未使用的记忆？',
      message: '将删除已经过期、以及 90 天内没有更新或使用过的非核心记忆。核心记忆会被保留。',
      confirmLabel: '开始清理',
      action: async () => {
        const result = await window.api.cleanupMemories(agent.id, 90)
        await load()
        notify(
          result.removed > 0 ? 'success' : 'info',
          result.removed > 0
            ? '已清理 ' + result.removed + ' 条，剩余 ' + result.total + ' 条'
            : '没有需要清理的记忆'
        )
      }
    })
  }

  const exportMemories = async (): Promise<void> => {
    try {
      const result = await window.api.exportMemories(agent.id)
      if (result.canceled) return
      notify('success', '已导出到 ' + (result.path ?? '所选文件'))
    } catch (caught: any) {
      notify('error', '导出失败：' + (caught?.message ?? String(caught)))
    }
  }

  const importMemories = async (): Promise<void> => {
    try {
      const result = await window.api.importMemories(agent.id)
      if (result.canceled) return
      await load()
      notify(
        result.imported + result.updated > 0 ? 'success' : 'info',
        '导入完成：新增 ' +
          result.imported +
          ' 条，更新 ' +
          result.updated +
          ' 条' +
          (result.skipped > 0 ? '，跳过 ' + result.skipped + ' 条' : '')
      )
    } catch (caught: any) {
      notify('error', '导入失败：' + (caught?.message ?? String(caught)))
    }
  }

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="panel memory-panel">
      <div className="panel-head">
        <div>
          <h2>长期记忆</h2>
          <p>
            这里是「{agent.name}」跨会话保存的事实与偏好。每轮对话会自动召回少量核心记忆，
            其余内容由模型按需搜索。记忆只是数据，不会被当作系统指令执行。
          </p>
        </div>
        <div className="panel-head-actions">
          <button
            className="btn btn-ghost"
            title="导入已确认记忆，按 key 合并"
            onClick={() => void importMemories()}
          >
            <Icon name="file" size={14} />
            导入
          </button>
          <button
            className="btn btn-ghost"
            title="导出已确认记忆（不含待确认候选）"
            onClick={() => void exportMemories()}
          >
            <Icon name="external" size={14} />
            导出
          </button>
          <button className="btn btn-primary" onClick={() => setDraft(emptyDraft())}>
            <Icon name="plus" size={15} />
            新增记忆
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        {snapshot ? (
          <div className="memory-stats">
            <span>
              <strong>{snapshot.total}</strong> / {snapshot.limit} 条
            </span>
            <span>
              <strong>{snapshot.pinned}</strong> 条核心
            </span>
            <span>
              <strong>{activeRecords.length}</strong> 条生效
            </span>
            <span>
              <strong>{formatBytes(snapshot.bytes)}</strong> 占用
            </span>
            <span>
              <strong>{snapshot.pendingCount}</strong> 条待确认
            </span>
            {snapshot.expired > 0 ? (
              <span className="is-warn">{snapshot.expired} 条已过期</span>
            ) : null}
            <span
              className="memory-index-badge"
              title={
                snapshot.index.available
                  ? 'SQLite FTS5 索引' +
                    (snapshot.index.vectors > 0
                      ? '，已建立 ' + snapshot.index.vectors + ' 条向量'
                      : '，尚未建立向量') +
                    (snapshot.index.lastError ? '；最近一次向量请求失败：' + snapshot.index.lastError : '')
                  : 'SQLite 索引不可用，当前使用内存检索'
              }
            >
              {snapshot.index.available
                ? snapshot.index.fts
                  ? 'FTS5'
                  : 'SQLite'
                : '内存检索'}
              {snapshot.index.enabled && snapshot.index.vectors > 0
                ? ' · ' + snapshot.index.vectors + ' 向量'
                : ''}
              {snapshot.index.enabled && snapshot.index.lastError ? ' · 向量降级' : ''}
            </span>
          </div>
        ) : null}

        <div className="memory-toolbar">
          <label className="memory-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 key、内容或标签…"
              spellCheck={false}
            />
            {query ? (
              <button
                className="icon-btn"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
              >
                <Icon name="x" size={13} />
              </button>
            ) : null}
          </label>
          <select
            className="memory-filter-select"
            value={kind}
            onChange={(event) => setKind(event.target.value as 'all' | MemoryKind)}
            aria-label="按类型筛选"
          >
            <option value="all">全部类型</option>
            {KIND_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {allTags.length > 0 ? (
            <select
              className="memory-filter-select"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              aria-label="按标签筛选"
            >
              <option value="all">全部标签</option>
              {allTags.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          ) : null}
          <button
            className={'memory-filter' + (pinnedOnly ? ' is-active' : '')}
            onClick={() => setPinnedOnly((prev) => !prev)}
            aria-pressed={pinnedOnly}
          >
            <Icon name="pin" size={13} />
            只看核心
          </button>
          <span className="memory-toolbar-spacer" />
          <button className="link-btn" disabled={reindexing} onClick={() => void reindex()}>
            {reindexing ? '重建索引中…' : '重建索引'}
          </button>
          <button className="link-btn" onClick={requestCleanup}>
            清理过期与 90 天未使用
          </button>
        </div>

        {pending.length > 0 ? (
          <div className="memory-pending">
            <div className="memory-pending-head">
              <div>
                <h3>
                  待确认记忆
                  <span className="badge badge-warn">{pending.length}</span>
                </h3>
                <p>
                  这些条目由对话结束后的自动提取生成，确认后才会参与召回。
                  与现有记忆同 key 的候选会覆盖旧值。
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => void confirmAll()}>
                <Icon name="check" size={13} />
                全部确认
              </button>
            </div>
            <div className="memory-pending-list">
              {pending.map((candidate) => {
                const candidateLong = candidate.content.length > 220
                const candidateExpanded = expanded.has(candidate.id)
                return (
                <article key={candidate.id} className="memory-candidate">
                  <div className="memory-card-head">
                    <div className="memory-card-title">
                      <span className="badge badge-muted">自动提取</span>
                      <span className={'badge ' + KIND_CLASS[candidate.kind]}>
                        {KIND_LABEL[candidate.kind]}
                      </span>
                      <code className="memory-key">{candidate.key}</code>
                      <span className="badge badge-muted">
                        置信度 {Math.round(candidate.confidence * 100)}%
                      </span>
                    </div>
                    <div className="memory-candidate-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => void confirmCandidate(candidate)}
                      >
                        确认保存
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void rejectCandidate(candidate)}
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                  <p
                    className={
                      'memory-content' +
                      (candidateLong && !candidateExpanded ? ' is-clamped' : '')
                    }
                  >
                    {candidate.content}
                  </p>
                  {candidateLong ? (
                    <button
                      className="link-btn"
                      onClick={() => toggleExpanded(candidate.id)}
                    >
                      {candidateExpanded ? '收起' : '展开全文'}
                    </button>
                  ) : null}
                  {candidate.reason ? (
                    <p className="memory-candidate-reason">理由：{candidate.reason}</p>
                  ) : null}
                  <div className="memory-meta">
                    <span>作用域 {SCOPE_LABEL[candidate.scope]}</span>
                    <span>提取 {formatTime(candidate.createdAt)}</span>
                    {candidate.supersedesKey ? (
                      <span>确认后覆盖 {candidate.supersedesKey}</span>
                    ) : null}
                    {candidate.sourceSessionId ? (
                      <span className="mono" title={candidate.sourceSessionId}>
                        来源会话 {candidate.sourceSessionId.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>
                  {candidate.tags.length > 0 ? (
                    <div className="memory-tags">
                      {candidate.tags.map((item) => (
                        <span key={item} className="memory-tag">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
                )
              })}
            </div>
          </div>
        ) : null}

        {draft ? (
          <div className="memory-editor">
            <div className="memory-editor-head">
              <h3>{draft.id ? '编辑记忆' : '新增记忆'}</h3>
              <span className="muted">{draft.id ? 'memory:' + draft.id : '保存后自动生成 id'}</span>
            </div>
            <div className="memory-editor-grid">
              <label className="field">
                <span className="field-label">Key</span>
                <input
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                  placeholder="例如 reporting_format"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field-label">类型</span>
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({ ...draft, kind: event.target.value as MemoryKind })
                  }
                >
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">作用域</span>
                <select
                  value={draft.scope}
                  onChange={(event) =>
                    setDraft({ ...draft, scope: event.target.value as MemoryScope })
                  }
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">标签</span>
                <input
                  value={draft.tags}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  placeholder="逗号分隔，例如 汇报, 格式"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field-label">重要度（0-5）</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={draft.importance}
                  onChange={(event) =>
                    setDraft({ ...draft, importance: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">过期时间</span>
                <input
                  type="date"
                  value={draft.expiresAt}
                  onChange={(event) =>
                    setDraft({ ...draft, expiresAt: event.target.value })
                  }
                />
              </label>
              <div className="field memory-pin-field">
                <span className="field-label">置顶为核心记忆</span>
                <span className="memory-pin-row">
                  <Toggle
                    checked={draft.pinned}
                    onChange={(value) => setDraft({ ...draft, pinned: value })}
                  />
                  <span className="muted">每轮对话都会优先注入</span>
                </span>
              </div>
              <label className="field field-wide">
                <span className="field-label">内容</span>
                <textarea
                  rows={6}
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  placeholder="写清楚、可复用的事实或偏好。不要保存 API Key、Token 或密码。"
                  spellCheck={false}
                />
                <span className="field-hint">
                  {draft.content.length} / {snapshot?.contentLimit ?? 8000} 字符
                </span>
              </label>
            </div>
            <div className="memory-editor-actions">
              <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void saveDraft()}
              >
                {saving ? '保存中…' : '保存记忆'}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? <div className="memory-empty">正在读取记忆…</div> : null}
        {!loading && error ? (
          <div className="panel-note memory-error">
            <Icon name="alert" size={15} />
            {error}
          </div>
        ) : null}
        {!loading && !error && records.length === 0 ? (
          <div className="memory-empty">
            <Icon name="memory" size={30} />
            <strong>
              {snapshot?.records.length
                ? '没有匹配的记忆'
                : (snapshot?.pendingCount ?? 0) > 0
                  ? '还没有已确认的记忆'
                  : '还没有长期记忆'}
            </strong>
            <span className="muted">
              {snapshot?.records.length
                ? '换个关键词或清除筛选条件试试。'
                : (snapshot?.pendingCount ?? 0) > 0
                  ? '先确认或忽略上方候选；确认后才会参与召回。'
                  : '模型可以在对话里用 memory_set 保存，你也可以手动新增。'}
            </span>
          </div>
        ) : null}

        <div className="memory-list">
          {records.map((record) => {
            const expired = Boolean(record.expiresAt && record.expiresAt <= Date.now())
            const isLong = record.content.length > 220
            const isExpanded = expanded.has(record.id)
            return (
              <article
                key={record.id}
                className={
                  'memory-card' +
                  (record.pinned ? ' is-pinned' : '') +
                  (expired ? ' is-expired' : '')
                }
              >
                <div className="memory-card-head">
                  <div className="memory-card-title">
                    <span className={'badge ' + KIND_CLASS[record.kind]}>
                      {KIND_LABEL[record.kind]}
                    </span>
                    <code className="memory-key">{record.key}</code>
                    {record.pinned ? (
                      <span className="badge badge-ok memory-pin-badge">
                        <Icon name="pin" size={11} />
                        核心
                      </span>
                    ) : null}
                    {expired ? <span className="badge badge-warn">已过期</span> : null}
                  </div>
                  <div className="memory-card-actions">
                    <button
                      className="icon-btn"
                      title={record.pinned ? '取消核心记忆' : '置顶为核心记忆'}
                      aria-label={record.pinned ? '取消核心记忆' : '置顶为核心记忆'}
                      onClick={() => void togglePin(record)}
                    >
                      <Icon name={record.pinned ? 'pinOff' : 'pin'} size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="编辑"
                      aria-label="编辑"
                      onClick={() => setDraft(toDraft(record))}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="删除"
                      aria-label="删除"
                      onClick={() => requestDelete(record)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>

                <p className={'memory-content' + (isLong && !isExpanded ? ' is-clamped' : '')}>
                  {record.content}
                </p>
                {isLong ? (
                  <button className="link-btn" onClick={() => toggleExpanded(record.id)}>
                    {isExpanded ? '收起' : '展开全文'}
                  </button>
                ) : null}

                {record.tags.length > 0 ? (
                  <div className="memory-tags">
                    {record.tags.map((item) => (
                      <span key={item} className="memory-tag">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="memory-meta">
                  <span>作用域 {SCOPE_LABEL[record.scope]}</span>
                  <span>创建 {formatTime(record.createdAt)}</span>
                  <span>更新 {formatTime(record.updatedAt)}</span>
                  <span>使用 {formatTime(record.lastUsedAt)}</span>
                  {record.expiresAt ? <span>到期 {formatTime(record.expiresAt)}</span> : null}
                  {record.sourceSessionId ? (
                    <span className="mono" title={record.sourceSessionId}>
                      来源会话 {record.sourceSessionId.slice(0, 8)}
                    </span>
                  ) : null}
                  <span>{record.content.length} 字符</span>
                </div>
              </article>
            )
          })}
        </div>

        <div className="panel-note">
          <Icon name="alert" size={15} />
          记忆来自模型写入、外部消息或手动编辑，属于外部可影响的数据，不会被当作系统指令执行。
          界面不会阻止模型把误判写进记忆，请定期检查并清理。
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action
          setConfirm(null)
          if (action) {
            action().catch((caught: any) => {
              notify('error', caught?.message ?? String(caught))
            })
          }
        }}
      />
    </div>
  )
}
