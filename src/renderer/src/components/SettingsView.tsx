import { useEffect, useRef, useState } from 'react'
import type { AppSettings, RuntimePaths, TestResult } from '@shared/types'
import { CopyButton, Field, SectionTitle, Spinner, Toggle } from './Primitives'
import { Icon } from './Icons'
import { sourceLabel, timeLabel } from '../lib/format'

export function SettingsView({
  state,
  onSave,
  notify,
  onRestartIngress
}: {
  state: import('@shared/types').AppState
  onSave: (settings: AppSettings) => Promise<import('@shared/types').AppState | null>
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
  onRestartIngress: () => Promise<void>
}) {
  const [draft, setDraft] = useState<AppSettings>(state.settings)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showNotionToken, setShowNotionToken] = useState(false)
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false)
  const [notionTest, setNotionTest] = useState<TestResult | null>(null)
  const [testingNotion, setTestingNotion] = useState(false)
  const [embeddingTest, setEmbeddingTest] = useState<TestResult | null>(null)
  const [testingEmbedding, setTestingEmbedding] = useState(false)
  const [paths, setPaths] = useState<RuntimePaths | null>(null)
  const settingsSnapshot = useRef(state.settings)

  useEffect(() => {
    const previous = settingsSnapshot.current
    settingsSnapshot.current = state.settings
    const themeOnly =
      JSON.stringify({ ...previous, theme: 'unchanged' }) ===
      JSON.stringify({ ...state.settings, theme: 'unchanged' })
    if (themeOnly) {
      setDraft((current) => ({ ...current, theme: state.settings.theme }))
      return
    }
    setDraft(state.settings)
    setNotionTest(null)
    setEmbeddingTest(null)
  }, [state.settings])

  useEffect(() => {
    window.api.getRuntimePaths().then(setPaths).catch(() => undefined)
  }, [])

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings)
  const ingress = state.ingress
  const url = 'http://127.0.0.1:' + draft.ingress.port
  const agentForExample = state.agents[0]
  const agentKey = agentForExample ? encodeURIComponent(agentForExample.name) : '需求记录员'

  const curlSnippet =
    'curl -X POST ' +
    url +
    '/v1/agents/' +
    agentKey +
    '/messages \\\n' +
    '  -H "Authorization: Bearer ' +
    draft.ingress.token +
    '" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"content":"登录页改版，周五前完成","source":"codex","title":"登录页改版"}\''

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        agentroles: {
          command: 'node',
          args: [
            paths?.mcpServer ?? '<AgentRoles>/resources/mcp-server.mjs',
            '--url',
            url,
            '--token',
            draft.ingress.token
          ]
        }
      }
    },
    null,
    2
  )

  const cliSnippet =
    'node "' +
    (paths?.cli ?? '<AgentRoles>/resources/agentroles-cli.mjs') +
    '" send --agent "' +
    (agentForExample?.name ?? '需求记录员') +
    '" --content "把登录页改版的截止时间改到周五" --source codex --url ' +
    url +
    ' --token ' +
    draft.ingress.token

  function updateIngress(patch: Partial<AppSettings['ingress']>): void {
    setDraft({ ...draft, ingress: { ...draft.ingress, ...patch } })
  }

  function updateNotion(patch: Partial<AppSettings['notion']>): void {
    setDraft({ ...draft, notion: { ...draft.notion, ...patch } })
  }

  function updateMemory(patch: Partial<AppSettings['memory']>): void {
    setDraft({ ...draft, memory: { ...draft.memory, ...patch } })
  }

  function updateEmbedding(
    patch: Partial<AppSettings['memory']['embedding']>
  ): void {
    setDraft({
      ...draft,
      memory: {
        ...draft.memory,
        embedding: { ...draft.memory.embedding, ...patch }
      }
    })
  }

  function regenerateToken(): void {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    updateIngress({ token })
    notify('info', '已生成新的访问 Token，保存后生效')
  }

  async function save(): Promise<void> {
    setSaving(true)
    const saved = await onSave(draft)
    setSaving(false)
    if (saved) setDraft(saved.settings)
  }

  async function testNotion(): Promise<void> {
    setTestingNotion(true)
    setNotionTest(null)
    try {
      const result = await window.api.testNotion(draft.notion)
      setNotionTest(result)
    } catch (error: any) {
      setNotionTest({ ok: false, message: error?.message ?? String(error) })
    } finally {
      setTestingNotion(false)
    }
  }

  async function testEmbedding(): Promise<void> {
    setTestingEmbedding(true)
    setEmbeddingTest(null)
    try {
      const result = await window.api.testEmbedding(draft.memory.embedding)
      setEmbeddingTest(result)
    } catch (error: any) {
      setEmbeddingTest({ ok: false, message: error?.message ?? String(error) })
    } finally {
      setTestingEmbedding(false)
    }
  }

  return (
    <div className="settings-view">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p>外部 Agent 如何找到你、Notion 写到哪里、记忆如何检索，以及本地工作区的位置。</p>
        </div>
        <div className="panel-head-actions">
          <span className={'dirty-flag' + (dirty ? ' is-dirty' : '')}>
            {dirty ? '有未保存修改' : '已保存'}
          </span>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </header>

      <div className="settings-scroll">
        <section className="settings-card">
          <SectionTitle
            title="外部接入"
            subtitle="把角色变成一个本地服务，让 Codex、Claude Code、DSH 或脚本把消息送进来。只监听 127.0.0.1。"
            action={
              <span className={'status-pill ' + (ingress.running ? 'is-ok' : 'is-bad')}>
                <span className={'status-dot ' + (ingress.running ? 'is-ok' : 'is-bad')} />
                {ingress.running ? '运行中' : ingress.error ? '启动失败' : '未启用'}
              </span>
            }
          />

          {ingress.error ? (
            <div className="test-result is-bad">
              <Icon name="alert" size={15} />
              <span>{ingress.error}</span>
            </div>
          ) : null}

          <div className="inline-card compact">
            <div>
              <h3>启用本地接入服务</h3>
              <p>关闭后，MCP 与 CLI 都无法送达消息，应用内会话不受影响。</p>
            </div>
            <Toggle
              checked={draft.ingress.enabled}
              onChange={(value) => updateIngress({ enabled: value })}
            />
          </div>

          <div className="form-grid">
            <Field label="端口" hint="1024–65535；被占用时保存后会提示。">
              <input
                type="number"
                min={1024}
                max={65535}
                value={draft.ingress.port}
                onChange={(event) => updateIngress({ port: Number(event.target.value) || 43110 })}
              />
            </Field>
            <Field label="访问 Token" hint="外部请求需带 Authorization: Bearer <token>。">
              <div className="secret-input">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={draft.ingress.token}
                  onChange={(event) => updateIngress({ token: event.target.value })}
                  spellCheck={false}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => setShowToken((value) => !value)}>
                  {showToken ? '隐藏' : '显示'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={regenerateToken}>
                  重新生成
                </button>
              </div>
            </Field>
          </div>

          <div className="endpoint-row">
            <span className="endpoint-label">Endpoint</span>
            <code>{url}</code>
            <CopyButton text={url} />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void onRestartIngress()}
              disabled={dirty}
              title={dirty ? '先保存设置，再重启服务' : '重启本地服务'}
            >
              <Icon name="refresh" size={13} />
              重启服务
            </button>
          </div>

          <div className="snippet-grid">
            <div className="snippet">
              <div className="snippet-head">
                <span>cURL</span>
                <CopyButton text={curlSnippet} />
              </div>
              <pre>{curlSnippet}</pre>
            </div>
            <div className="snippet">
              <div className="snippet-head">
                <span>MCP 配置（stdio）</span>
                <CopyButton text={mcpSnippet} />
              </div>
              <pre>{mcpSnippet}</pre>
            </div>
            <div className="snippet snippet-wide">
              <div className="snippet-head">
                <span>命令行</span>
                <CopyButton text={cliSnippet} />
              </div>
              <pre>{cliSnippet}</pre>
            </div>
          </div>

          <p className="settings-hint">
            把上面的 MCP 配置加入 Codex / Claude Code / DSH 的 MCP 配置后，它们就能看到
            <code> agentroles_send_message </code>工具，按角色名投递消息。
          </p>

          {ingress.recent.length > 0 ? (
            <div className="ingress-log">
              <div className="ingress-log-title">最近请求</div>
              {ingress.recent.slice(0, 6).map((record, index) => (
                <div key={index} className="ingress-log-row">
                  <span className={'status-dot ' + (record.ok ? 'is-ok' : 'is-bad')} />
                  <span className="ingress-log-source">{sourceLabel(record.source)}</span>
                  <span className="ingress-log-agent">{record.agent || '—'}</span>
                  <span className="ingress-log-summary">{record.summary}</span>
                  <span className="ingress-log-time">{timeLabel(record.at)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="settings-card">
          <SectionTitle
            title="Notion 集成"
            subtitle="需求记录员等角色通过 Notion Integration 写入任务。记得在 Notion 里把目标数据库「共享」给这个 Integration。"
          />
          <Field label="Integration Token" hint="以 secret_ 或 ntn_ 开头；保存时加密。">
            <div className="secret-input">
              <input
                type={showNotionToken ? 'text' : 'password'}
                value={draft.notion.token}
                onChange={(event) => updateNotion({ token: event.target.value })}
                placeholder="ntn_…"
                spellCheck={false}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowNotionToken((value) => !value)}
              >
                {showNotionToken ? '隐藏' : '显示'}
              </button>
            </div>
          </Field>
          <Field label="默认任务数据库 ID" hint="可粘贴数据库链接，系统会自动提取 32 位 ID。">
            <input
              value={draft.notion.databaseId}
              onChange={(event) => updateNotion({ databaseId: event.target.value })}
              placeholder="https://www.notion.so/… 或 32 位 ID"
              spellCheck={false}
            />
          </Field>
          <div className="test-row">
            <div>
              <h3>连接测试</h3>
              <p>用当前填写的 Token 校验权限；填了数据库 ID 时会一并读取数据库结构。</p>
            </div>
            <button className="btn btn-ghost" disabled={testingNotion} onClick={() => void testNotion()}>
              {testingNotion ? <Spinner size={14} /> : <Icon name="plug" size={15} />}
              {testingNotion ? '测试中…' : '测试 Notion'}
            </button>
          </div>
          {notionTest ? (
            <div className={'test-result ' + (notionTest.ok ? 'is-ok' : 'is-bad')}>
              <Icon name={notionTest.ok ? 'check' : 'alert'} size={15} />
              <span>{notionTest.message}</span>
            </div>
          ) : null}
        </section>

        <section className="settings-card">
          <SectionTitle
            title="记忆检索与提取"
            subtitle="关键词检索使用本地 SQLite FTS5；向量语义检索可选，需要 OpenAI 兼容的 /embeddings 服务。自动提取默认关闭，避免额外模型调用。"
          />

          <div className="inline-card compact">
            <div>
              <h3>向量语义检索</h3>
              <p>
                开启后，记忆内容和用户查询会发送到下面的 Embedding 服务；关闭时
                只在本地做 FTS5 关键词检索，不产生外部请求。
              </p>
            </div>
            <Toggle
              checked={draft.memory.embedding.enabled}
              onChange={(value) => updateEmbedding({ enabled: value })}
            />
          </div>

          {draft.memory.embedding.enabled ? (
            <>
              <div className="form-grid">
                <Field
                  label="Embedding Base URL"
                  hint="需要包含 /v1，例如 https://api.openai.com/v1；请求会发到 <base>/embeddings。"
                >
                  <input
                    value={draft.memory.embedding.baseUrl}
                    onChange={(event) => updateEmbedding({ baseUrl: event.target.value })}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Embedding 模型"
                  hint="例如 text-embedding-3-small；本地服务可用其支持的模型名。"
                >
                  <input
                    value={draft.memory.embedding.model}
                    onChange={(event) => updateEmbedding({ model: event.target.value })}
                    placeholder="text-embedding-3-small"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Embedding API Key"
                  hint="保存时加密；不需要鉴权的本地服务可以留空。"
                  wide
                >
                  <div className="secret-input">
                    <input
                      type={showEmbeddingKey ? 'text' : 'password'}
                      value={draft.memory.embedding.apiKey}
                      onChange={(event) => updateEmbedding({ apiKey: event.target.value })}
                      placeholder="sk-…"
                      spellCheck={false}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowEmbeddingKey((value) => !value)}
                    >
                      {showEmbeddingKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </Field>
              </div>

              <div className="test-row">
                <div>
                  <h3>Embedding 连接测试</h3>
                  <p>用当前配置对一段测试文本生成向量，确认 URL、模型与鉴权可用。</p>
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={testingEmbedding}
                  onClick={() => void testEmbedding()}
                >
                  {testingEmbedding ? <Spinner size={14} /> : <Icon name="plug" size={15} />}
                  {testingEmbedding ? '测试中…' : '测试 Embedding'}
                </button>
              </div>
              {embeddingTest ? (
                <div className={'test-result ' + (embeddingTest.ok ? 'is-ok' : 'is-bad')}>
                  <Icon name={embeddingTest.ok ? 'check' : 'alert'} size={15} />
                  <span>{embeddingTest.message}</span>
                </div>
              ) : null}

              <p className="settings-hint">
                向量存储在本机 SQLite（memory/index.sqlite）；更换模型后旧向量会自动失效并在后台重建。
                首次启用时会为已有记忆批量生成向量，期间关键词检索仍然可用。
              </p>
            </>
          ) : null}

          <div className="inline-card compact">
            <div>
              <h3>对话结束后自动提取记忆</h3>
              <p>
                每轮成功回复后额外调用一次当前角色模型，提取候选记忆。普通候选进入
                「待确认」，只有高置信度偏好才会直接保存。
              </p>
            </div>
            <Toggle
              checked={draft.memory.extractionEnabled}
              onChange={(value) => updateMemory({ extractionEnabled: value })}
            />
          </div>

          {draft.memory.extractionEnabled ? (
            <div className="form-grid">
              <Field
                label="自动保存置信度阈值"
                hint="0-1；仅对 preference 类型生效，达到阈值时跳过待确认。默认 0.85。"
              >
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.memory.autoAcceptConfidence}
                  onChange={(event) =>
                    updateMemory({
                      autoAcceptConfidence: Math.min(
                        1,
                        Math.max(0, Number(event.target.value) || 0)
                      )
                    })
                  }
                />
              </Field>
            </div>
          ) : null}

          <p className="settings-hint">
            SQLite FTS5 索引位于数据目录的 <code>memory/index.sqlite</code>，它是派生数据，
            可随时在「角色 → 记忆」页重建。关闭向量检索不会删除已有记忆。
          </p>
        </section>

        <section className="settings-card">
          <SectionTitle
            title="工作区与数据"
            subtitle="文件与终端技能只能在这个目录内活动。应用配置和会话保存在本机数据目录。"
          />
          <Field label="工作区目录" hint="文件系统技能与终端命令的根目录。">
            <div className="path-input">
              <input
                value={draft.workspaceDir}
                onChange={(event) => setDraft({ ...draft, workspaceDir: event.target.value })}
                spellCheck={false}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  const selected = await window.api.chooseWorkspace()
                  if (selected) setDraft({ ...draft, workspaceDir: selected })
                }}
              >
                <Icon name="folder" size={14} />
                选择
              </button>
            </div>
          </Field>

          <div className="data-row">
            <div>
              <span className="field-label">数据目录</span>
              <code className="muted">{state.dataDir}</code>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void window.api.revealDataDir()}>
              <Icon name="external" size={13} />
              打开
            </button>
          </div>

          <div className="about-row">
            <span className="badge badge-muted">AgentRoles v{state.version}</span>
            <span className="muted">本地优先 · API Key 使用系统安全存储加密</span>
          </div>
        </section>
      </div>
    </div>
  )
}
