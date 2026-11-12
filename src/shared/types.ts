/**
 * AgentRoles 全应用共享类型。
 * 主进程与渲染进程都从这里取类型，避免 IPC 两端定义漂移。
 */

export type ProviderId = 'openai' | 'anthropic' | 'responses'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface ModelSettings {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface SkillState {
  enabled: boolean
  settings: Record<string, string>
}

export type MemoryScope = 'agent' | 'project' | 'session'

export type MemoryKind = 'profile' | 'preference' | 'fact' | 'project' | 'task'

/** 一条长期记忆。key 在单个角色内唯一，id 用于管理页与详情引用。 */
export interface MemoryRecord {
  id: string
  agentId: string
  scope: MemoryScope
  kind: MemoryKind
  key: string
  content: string
  tags: string[]
  sourceSessionId?: string
  sourceMessageId?: string
  pinned?: boolean
  /** 0-5，越高越优先出现在自动召回中 */
  importance?: number
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  expiresAt?: number
}

export interface MemoryInput {
  /** 传入时按 id 更新；否则按 key 新增或覆盖 */
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

/** 自动提取出来、等待用户确认的记忆候选。确认后才进入正式记忆。 */
export interface MemoryCandidate {
  id: string
  agentId: string
  key: string
  content: string
  kind: MemoryKind
  scope: MemoryScope
  tags: string[]
  /** 0-1，自动提取模型的置信度 */
  confidence: number
  reason?: string
  /** 候选确认后会覆盖同 key 的现有记忆 */
  supersedesKey?: string
  sourceSessionId?: string
  sourceMessageId?: string
  createdAt: number
}

export interface MemoryCandidateInput {
  key: string
  content: string
  kind?: MemoryKind
  scope?: MemoryScope
  tags?: string[]
  confidence?: number
  reason?: string
}

export interface MemoryIndexStatus {
  /** node:sqlite 是否可用 */
  available: boolean
  /** FTS5 是否可用 */
  fts: boolean
  /** 是否启用了向量检索 */
  enabled: boolean
  /** 已建立向量的记录数 */
  vectors: number
  /** 当前向量模型 */
  model: string
  lastError?: string
}

export interface MemorySnapshot {
  agentId: string
  records: MemoryRecord[]
  pending: MemoryCandidate[]
  total: number
  pendingCount: number
  pinned: number
  expired: number
  /** 记录序列化后的近似字节数 */
  bytes: number
  limit: number
  contentLimit: number
  index: MemoryIndexStatus
}

export interface MemoryImportResult {
  imported: number
  updated: number
  skipped: number
  total: number
}

export interface Agent {
  id: string
  name: string
  /** 单字符头像，通常是 emoji；未上传图片时作为兜底 */
  avatar: string
  /** 上传的图片头像（压缩后的 data URL），优先于 avatar 显示 */
  avatarImage?: string
  /** 主题色，用于头像与强调 */
  color: string
  /** 一句话职责，展示在列表和标题区 */
  tagline: string
  /** 角色职责描述，同时作为 system prompt 主体 */
  role: string
  model: ModelSettings
  skills: Record<string, SkillState>
  /** 收到外部消息后是否自动处理 */
  autoRun: boolean
  createdAt: number
  updatedAt: number
}

export interface NotionSettings {
  token: string
  /** 默认任务数据库 */
  databaseId: string
}

export interface IngressSettings {
  enabled: boolean
  port: number
  token: string
}

/** OpenAI 兼容的 /embeddings 配置；关闭时只使用 SQLite FTS5 关键词检索。 */
export interface EmbeddingSettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export interface MemorySettings {
  /** 对话结束后让模型提取候选记忆 */
  extractionEnabled: boolean
  /** 高置信度偏好自动保存的门槛，0-1 */
  autoAcceptConfidence: number
  embedding: EmbeddingSettings
}

export interface AppSettings {
  notion: NotionSettings
  ingress: IngressSettings
  memory: MemorySettings
  /** 技能可读写的本地工作目录 */
  workspaceDir: string
  /** 外观主题：跟随系统 / 浅色 / 深色 */
  theme: ThemeMode
}

export type MessageSource = 'app' | 'http' | 'mcp' | 'cli' | 'system'
export type MessageState = 'pending' | 'running' | 'done' | 'error'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  ok?: boolean
  startedAt?: number
  endedAt?: number
}

export interface Session {
  id: string
  agentId: string
  /** 会话标题：首条用户消息自动生成，重命名后不再自动覆盖 */
  title: string
  createdAt: number
  updatedAt: number
  /** 用户手动重命名过，后续消息不再自动改标题 */
  customTitle?: boolean
  /** 置顶会话在侧边栏中优先显示 */
  pinned?: boolean
  /** 归档会话从默认列表隐藏，但仍可在“已归档”中查看 */
  archived?: boolean
}

export interface SessionPatch {
  title?: string
  pinned?: boolean
  archived?: boolean
}

export interface ChatAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  mime: string
  size: number
  /** 图片、PDF 或二进制文件的数据 URL */
  dataUrl?: string
  /** 文本类文件的内容 */
  text?: string
  truncated?: boolean
}

export interface ChatMessage {
  id: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
  reasoning?: string
  toolCalls?: ToolCall[]
  state: MessageState
  /** app | http | mcp | cli | codex | claude-code | dsh … */
  source?: string
  meta?: {
    title?: string
    sender?: string
    externalId?: string
    [key: string]: unknown
  }
  createdAt: number
  runId?: string
}

export interface AgentRuntimeState {
  running: boolean
  queued: number
}

export interface IngressRecord {
  at: number
  source: string
  agent: string
  ok: boolean
  summary: string
}

export interface IngressInfo {
  running: boolean
  port: number
  token: string
  url: string
  recent: IngressRecord[]
  error?: string
}

export interface SkillField {
  key: string
  label: string
  placeholder?: string
  help?: string
  secret?: boolean
  multiline?: boolean
}

export interface SkillMeta {
  id: string
  name: string
  icon: string
  description: string
  risk?: 'low' | 'medium' | 'high'
  settings: SkillField[]
  toolNames: string[]
}

// 发布新版本时同步更新这里的最新发布时间
export const APP_RELEASE_DATE = '2026-11-07'
export const APP_FEEDBACK_URL = 'https://github.com/Evanpatchouli/AgentRoles/issues'
export const APP_DOCS_URL = 'https://github.com/Evanpatchouli/AgentRoles/tree/main/docs'
export const APP_INTRO =
  'AgentRoles 是一个本地优先的多角色 Agent 工作台，为每个角色配置独立职责、模型、技能与多会话，并通过 HTTP / MCP / CLI 接住来自其他 Agent 与工具的消息。'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  publishedAt: string
  releaseName?: string
  releaseUrl: string
  downloadUrl: string
  notes?: string
  hasUpdate: boolean
}

export interface UpdateCheckResult {
  ok: boolean
  /** 仓库尚未发布任何 Release */
  noRelease?: boolean
  message?: string
  info?: UpdateInfo
}

export interface ReleaseNote {
  version: string
  name: string
  publishedAt: string
  body: string
  htmlUrl: string
  prerelease: boolean
}

export interface WhatsNewData {
  currentVersion: string
  releases: ReleaseNote[]
  source: 'github' | 'cache' | 'bundled'
  fetchedAt: number
}

export interface AppState {
  agents: Agent[]
  sessions: Session[]
  settings: AppSettings
  ingress: IngressInfo
  skills: SkillMeta[]
  running: Record<string, AgentRuntimeState>
  version: string
  releaseDate: string
  dataDir: string
}

export interface SendResult {
  ok: boolean
  error?: string
  message?: ChatMessage
}

export interface StartRunResult {
  ok: boolean
  error?: string
}

export type AgentEvent =
  | {
      type: 'agent_state'
      agentId: string
      sessionId: string
      running: boolean
      queued: number
    }
  | { type: 'message_added'; agentId: string; sessionId: string; message: ChatMessage }
  | {
      type: 'message_delta'
      agentId: string
      sessionId: string
      messageId: string
      text: string
      reasoning?: string
    }
  | {
      type: 'tool_started'
      agentId: string
      sessionId: string
      messageId: string
      call: ToolCall
    }
  | {
      type: 'tool_finished'
      agentId: string
      sessionId: string
      messageId: string
      callId: string
      result: string
      ok: boolean
      endedAt: number
    }
  | { type: 'message_updated'; agentId: string; sessionId: string; message: ChatMessage }
  | {
      type: 'session_updated'
      agentId: string
      session: Session
    }
  | { type: 'run_start'; agentId: string; sessionId: string; runId: string }
  | {
      type: 'run_end'
      agentId: string
      sessionId: string
      runId: string
      error?: string
    }
  | {
      type: 'memory_updated'
      agentId: string
      pending: number
      /** 本次新增的待确认候选数 */
      added: number
      /** 本次替换已有待确认候选的数量 */
      updated: number
      /** 本次按高置信度自动保存的数量 */
      accepted: number
    }

export interface TestResult {
  ok: boolean
  message: string
  latencyMs?: number
  detail?: string
}

export interface ModelListResult {
  ok: boolean
  models: string[]
  message?: string
  latencyMs?: number
}

export interface RuntimePaths {
  mcpServer: string
  cli: string
  dataDir: string
}

export interface AgentRolesApi {
  getState(): Promise<AppState>
  getMessages(sessionId: string): Promise<ChatMessage[]>
  getInbox(): Promise<ChatMessage[]>
  createAgent(): Promise<{ agent: Agent; session: Session }>
  saveAgent(agent: Agent): Promise<Agent>
  deleteAgent(id: string): Promise<{ ok: boolean }>
  listMemories(agentId: string): Promise<MemorySnapshot>
  saveMemory(agentId: string, input: MemoryInput): Promise<MemoryRecord>
  deleteMemory(agentId: string, id: string): Promise<{ ok: boolean }>
  confirmMemoryCandidate(agentId: string, id: string): Promise<MemoryRecord | null>
  rejectMemoryCandidate(agentId: string, id: string): Promise<{ ok: boolean }>
  reindexMemories(agentId: string): Promise<MemoryIndexStatus>
  cleanupMemories(
    agentId: string,
    unusedDays: number
  ): Promise<{ removed: number; total: number }>
  exportMemories(
    agentId: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string }>
  importMemories(agentId: string): Promise<MemoryImportResult & { canceled?: boolean }>
  createSession(agentId: string): Promise<Session>
  updateSession(sessionId: string, patch: SessionPatch): Promise<Session>
  newWindow(): Promise<void>
  closeWindow(): Promise<void>
  zoomWindow(direction: 'in' | 'out'): Promise<void>
  toggleFullscreen(): Promise<void>
  checkForUpdates(): Promise<UpdateCheckResult>
  getWhatsNew(force?: boolean): Promise<WhatsNewData>
  sendMessage(
    sessionId: string,
    content: string,
    attachments?: ChatAttachment[]
  ): Promise<SendResult>
  processMessage(sessionId: string, messageId: string): Promise<StartRunResult>
  stopSession(sessionId: string): Promise<{ ok: boolean }>
  clearMessages(sessionId: string): Promise<{ ok: boolean }>
  saveSettings(settings: AppSettings): Promise<AppState>
  setTheme(theme: ThemeMode): Promise<AppSettings>
  testModel(model: ModelSettings): Promise<TestResult>
  listModels(model: ModelSettings): Promise<ModelListResult>
  testNotion(notion: NotionSettings): Promise<TestResult>
  testEmbedding(embedding: EmbeddingSettings): Promise<TestResult>
  chooseWorkspace(): Promise<string | null>
  restartIngress(): Promise<IngressInfo>
  copyText(text: string): Promise<void>
  openExternal(url: string): Promise<void>
  revealDataDir(): Promise<void>
  getRuntimePaths(): Promise<RuntimePaths>
  onAgentEvent(listener: (event: AgentEvent) => void): () => void
}
