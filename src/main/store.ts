import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  Agent,
  AppSettings,
  ChatMessage,
  Session,
  SessionPatch,
  SkillState,
  ThemeMode
} from '@shared/types'
import { createAgent, createRecorderAgent, defaultSettings } from './defaults'

const CONFIG_VERSION = 1
const SESSIONS_VERSION = 1

interface PersistedConfig {
  version: number
  agents: Agent[]
  settings: AppSettings
}

interface PersistedSessions {
  version: number
  sessions: Session[]
}

function seal(value: string): string {
  if (!value) return ''
  if (value.startsWith('enc:')) return value
  try {
    if (!safeStorage.isEncryptionAvailable()) return value
    return 'enc:' + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

function unseal(value: string): string {
  if (!value || !value.startsWith('enc:')) return value ?? ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  } catch {
    return ''
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function deriveSessionTitle(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '新会话'
  return text.length > 28 ? text.slice(0, 28) + '…' : text
}

export interface StoreOptions {
  skillDefaults: Record<string, SkillState>
}

export class Store {
  readonly dataDir: string
  readonly configPath: string
  private readonly sessionsPath: string
  private readonly messagesDir: string
  private readonly skillDefaults: Record<string, SkillState>
  private config: PersistedConfig
  private sessions: Session[] = []
  private messages = new Map<string, ChatMessage[]>()
  private saveTimers = new Map<string, NodeJS.Timeout>()
  private sessionsSaveTimer: NodeJS.Timeout | null = null
  private listeners = new Set<() => void>()

  constructor(options: StoreOptions) {
    this.dataDir = app.getPath('userData')
    this.configPath = path.join(this.dataDir, 'config.json')
    this.sessionsPath = path.join(this.dataDir, 'sessions.json')
    this.messagesDir = path.join(this.dataDir, 'messages')
    this.skillDefaults = options.skillDefaults
    this.config = {
      version: CONFIG_VERSION,
      agents: [],
      settings: defaultSettings(path.join(app.getPath('documents'), 'AgentRoles Workspace'))
    }
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.messagesDir, { recursive: true })
    await fsp.mkdir(this.config.settings.workspaceDir, { recursive: true }).catch(() => undefined)

    let loaded = false
    try {
      const raw = await fsp.readFile(this.configPath, 'utf8')
      this.config = this.normalize(JSON.parse(raw) as PersistedConfig)
      loaded = true
    } catch {
      loaded = false
    }

    if (!loaded) {
      this.config.agents = [createRecorderAgent(Object.keys(this.skillDefaults))]
    }

    await this.loadSessions()
    await this.ensureSessions()
    await this.persistConfig()
    await this.persistSessions()
    await fsp
      .mkdir(this.config.settings.workspaceDir, { recursive: true })
      .catch(() => undefined)
  }

  private normalize(parsed: PersistedConfig): PersistedConfig {
    const base = defaultSettings(
      parsed?.settings?.workspaceDir ||
        path.join(app.getPath('documents'), 'AgentRoles Workspace')
    )
    const settings: AppSettings = {
      ...base,
      ...(parsed.settings ?? {}),
      notion: { ...base.notion, ...(parsed.settings?.notion ?? {}) },
      ingress: { ...base.ingress, ...(parsed.settings?.ingress ?? {}) },
      memory: {
        ...base.memory,
        ...(parsed.settings?.memory ?? {}),
        embedding: {
          ...base.memory.embedding,
          ...(parsed.settings?.memory?.embedding ?? {})
        }
      }
    }
    settings.notion.token = unseal(settings.notion.token)
    settings.ingress.token =
      settings.ingress.token && !settings.ingress.token.startsWith('enc:')
        ? unseal(settings.ingress.token)
        : base.ingress.token
    settings.memory.extractionEnabled = Boolean(settings.memory.extractionEnabled)
    const confidence = Number(settings.memory.autoAcceptConfidence)
    settings.memory.autoAcceptConfidence = Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : base.memory.autoAcceptConfidence
    settings.memory.embedding.enabled = Boolean(settings.memory.embedding.enabled)
    settings.memory.embedding.baseUrl =
      String(settings.memory.embedding.baseUrl ?? '').trim() || base.memory.embedding.baseUrl
    settings.memory.embedding.model =
      String(settings.memory.embedding.model ?? '').trim() || base.memory.embedding.model
    settings.memory.embedding.apiKey = unseal(
      String(settings.memory.embedding.apiKey ?? '')
    )
    if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system'

    const agents = (parsed.agents ?? []).map((agent) => {
      const skills: Record<string, SkillState> = {}
      for (const [id, fallback] of Object.entries(this.skillDefaults)) {
        skills[id] = { ...fallback, settings: { ...fallback.settings } }
      }
      for (const [id, state] of Object.entries(agent.skills ?? {})) {
        skills[id] = {
          enabled: state.enabled,
          settings: { ...(skills[id]?.settings ?? {}), ...(state.settings ?? {}) }
        }
      }
      if (skills.notion?.settings.token) {
        skills.notion.settings.token = unseal(skills.notion.settings.token)
      }
      return {
        ...agent,
        skills,
        model: { ...agent.model, apiKey: unseal(agent.model?.apiKey ?? '') }
      } satisfies Agent
    })

    return { version: CONFIG_VERSION, agents, settings }
  }

  private async loadSessions(): Promise<void> {
    try {
      const raw = await fsp.readFile(this.sessionsPath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedSessions
      const agentIds = new Set(this.config.agents.map((agent) => agent.id))
      const seen = new Set<string>()
      this.sessions = (parsed.sessions ?? [])
        .filter((session) => {
          if (!session?.id || !session.agentId || !agentIds.has(session.agentId)) return false
          if (seen.has(session.id)) return false
          seen.add(session.id)
          return true
        })
        .map((session) => ({
          id: session.id,
          agentId: session.agentId,
          title: session.title || '新会话',
          createdAt: Number(session.createdAt) || Date.now(),
          updatedAt: Number(session.updatedAt) || Number(session.createdAt) || Date.now(),
          customTitle: Boolean(session.customTitle),
          pinned: Boolean(session.pinned),
          archived: Boolean(session.archived)
        }))
    } catch {
      this.sessions = []
    }
  }

  private async ensureSessions(): Promise<void> {
    const now = Date.now()
    let changed = false
    for (const agent of this.config.agents) {
      let list = this.sessions.filter((session) => session.agentId === agent.id)
      if (list.length === 0) {
        const file = path.join(this.messagesDir, agent.id + '.json')
        let updatedAt = now
        try {
          updatedAt = (await fsp.stat(file)).mtimeMs || now
        } catch {
          /* no legacy history */
        }
        const session: Session = {
          id: agent.id,
          agentId: agent.id,
          title: '默认会话',
          createdAt: updatedAt,
          updatedAt
        }
        this.sessions.push(session)
        list = [session]
        changed = true
      }
      for (const session of list) {
        if (
          !session.customTitle &&
          (session.title === '默认会话' || session.title === '新会话')
        ) {
          const hydrated = this.hydrateSessionTitle(session)
          if (hydrated) changed = true
        }
      }
      // 防止异常数据把所有会话都归档；至少保留一个可见会话
      if (list.every((session) => session.archived)) {
        const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (latest) {
          latest.archived = false
          changed = true
        }
      }
    }
    if (changed) await this.persistSessions()
  }

  /** 首次从旧版本升级时，从已有的第一条用户消息中恢复会话标题 */
  private hydrateSessionTitle(session: Session): boolean {
    if (session.customTitle) return false
    try {
      const raw = fs.readFileSync(path.join(this.messagesDir, session.id + '.json'), 'utf8')
      const list = JSON.parse(raw) as ChatMessage[]
      if (!Array.isArray(list) || list.length === 0) return false
      const firstUser = list.find((message) => message.role === 'user' && message.content)
      if (!firstUser) return false
      const titleHint =
        typeof firstUser.meta?.title === 'string' && firstUser.meta.title.trim()
          ? firstUser.meta.title
          : firstUser.content
      session.title = deriveSessionTitle(titleHint)
      const last = list[list.length - 1]
      session.updatedAt = Math.max(session.updatedAt, Number(last?.createdAt) || 0)
      return true
    } catch {
      return false
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  }

  getAgents(): Agent[] {
    return clone(this.config.agents)
  }

  getAgent(id: string): Agent | undefined {
    const agent = this.config.agents.find((item) => item.id === id)
    return agent ? clone(agent) : undefined
  }

  findAgent(idOrName: string): Agent | undefined {
    const value = idOrName.trim()
    const exact = this.config.agents.find((item) => item.id === value)
    if (exact) return clone(exact)
    const byName = this.config.agents.find(
      (item) => item.name.toLowerCase() === value.toLowerCase()
    )
    return byName ? clone(byName) : undefined
  }

  getSettings(): AppSettings {
    return clone(this.config.settings)
  }

  getAllSessions(): Session[] {
    return clone(this.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSessions(agentId: string): Session[] {
    return this.getAllSessions().filter((session) => session.agentId === agentId)
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.find((item) => item.id === sessionId)
    return session ? clone(session) : undefined
  }

  getDefaultSession(agentId: string): Session | undefined {
    const all = this.sessions.filter((session) => session.agentId === agentId)
    const list = all
      .filter((session) => !session.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const fixed = list.find((session) => session.id === agentId)
    return clone(fixed ?? list[0] ?? all.sort((a, b) => b.updatedAt - a.updatedAt)[0])
  }

  findSession(agentId: string, idOrTitle: string): Session | undefined {
    const value = idOrTitle.trim()
    const list = this.sessions.filter(
      (session) => session.agentId === agentId && !session.archived
    )
    const exact = list.find((session) => session.id === value)
    if (exact) return clone(exact)
    const byTitle = list.find(
      (session) => session.title.toLowerCase() === value.toLowerCase()
    )
    return byTitle ? clone(byTitle) : undefined
  }

  async createSession(agentId: string, title = '新会话'): Promise<Session> {
    if (!this.getAgent(agentId)) throw new Error('角色不存在')
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      agentId,
      title,
      createdAt: now,
      updatedAt: now,
      customTitle: false,
      pinned: false,
      archived: false
    }
    this.sessions.push(session)
    await this.persistSessions()
    return clone(session)
  }

  async updateSession(sessionId: string, patch: SessionPatch): Promise<Session> {
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error('会话不存在')

    if (patch.title !== undefined) {
      const title = patch.title.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (!title) throw new Error('会话标题不能为空')
      session.title = title
      session.customTitle = true
    }

    if (patch.pinned !== undefined) {
      session.pinned = Boolean(patch.pinned)
    }

    if (patch.archived !== undefined) {
      const archived = Boolean(patch.archived)
      if (archived && !session.archived) {
        const activeCount = this.sessions.filter(
          (item) => item.agentId === session.agentId && !item.archived
        ).length
        if (activeCount <= 1) throw new Error('至少保留一个未归档会话')
      }
      session.archived = archived
    }

    await this.persistSessions()
    return clone(session)
  }

  private touchSession(sessionId: string, content?: string): void {
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session) return
    session.updatedAt = Date.now()
    if (
      content &&
      !session.customTitle &&
      (session.title === '新会话' || session.title === '默认会话')
    ) {
      const title = deriveSessionTitle(content)
      if (title) session.title = title
    }
    this.schedulePersistSessions()
  }

  async saveAgent(agent: Agent): Promise<Agent> {
    const next: Agent = { ...clone(agent), updatedAt: Date.now() }
    const index = this.config.agents.findIndex((item) => item.id === next.id)
    if (index >= 0) this.config.agents[index] = next
    else this.config.agents.push(next)
    if (!this.sessions.some((session) => session.agentId === next.id)) {
      await this.createSession(next.id, '新会话')
    }
    await this.persistConfig()
    this.emitChange()
    return clone(next)
  }

  async deleteAgent(id: string): Promise<void> {
    this.config.agents = this.config.agents.filter((item) => item.id !== id)
    const sessions = this.sessions.filter((session) => session.agentId === id)
    this.sessions = this.sessions.filter((session) => session.agentId !== id)
    for (const session of sessions) {
      this.messages.delete(session.id)
      await fsp
        .rm(path.join(this.messagesDir, session.id + '.json'), { force: true })
        .catch(() => undefined)
    }
    await fsp
      .rm(path.join(this.messagesDir, id + '.json'), { force: true })
      .catch(() => undefined)
    await this.persistConfig()
    await this.persistSessions()
    this.emitChange()
  }

  async createAgent(): Promise<Agent> {
    const agent = createAgent({}, Object.keys(this.skillDefaults))
    agent.skills = {}
    for (const [id, state] of Object.entries(this.skillDefaults)) {
      agent.skills[id] = { ...state, settings: { ...state.settings } }
    }
    this.config.agents.push(agent)
    await this.createSession(agent.id, '新会话')
    await this.persistConfig()
    this.emitChange()
    return clone(agent)
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.config.settings = clone(settings)
    await this.persistConfig()
    this.emitChange()
    return clone(this.config.settings)
  }

  async saveTheme(theme: ThemeMode): Promise<AppSettings> {
    this.config.settings.theme = theme
    await this.persistConfig()
    return clone(this.config.settings)
  }

  private async persistConfig(): Promise<void> {
    const snapshot = clone(this.config)
    snapshot.settings.notion.token = seal(snapshot.settings.notion.token)
    snapshot.settings.ingress.token = seal(snapshot.settings.ingress.token)
    snapshot.settings.memory.embedding.apiKey = seal(
      snapshot.settings.memory.embedding.apiKey
    )
    for (const agent of snapshot.agents) {
      agent.model.apiKey = seal(agent.model.apiKey ?? '')
      if (agent.skills?.notion?.settings?.token) {
        agent.skills.notion.settings.token = seal(agent.skills.notion.settings.token)
      }
    }
    const tmp = this.configPath + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
    await fsp.rename(tmp, this.configPath)
  }

  private schedulePersistSessions(): void {
    if (this.sessionsSaveTimer) clearTimeout(this.sessionsSaveTimer)
    this.sessionsSaveTimer = setTimeout(() => {
      this.sessionsSaveTimer = null
      void this.persistSessions()
    }, 250)
  }

  private async persistSessions(): Promise<void> {
    const payload: PersistedSessions = { version: SESSIONS_VERSION, sessions: this.sessions }
    const tmp = this.sessionsPath + '.tmp'
    try {
      await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
      await fsp.rename(tmp, this.sessionsPath)
    } catch (error) {
      console.error('[store] 保存会话列表失败', error)
    }
  }

  getInbox(limit = 80): ChatMessage[] {
    const items: ChatMessage[] = []
    for (const session of this.sessions) {
      for (const message of this.getMessages(session.id)) {
        if (message.role === 'user' && message.source && message.source !== 'app') {
          items.push(message)
        }
      }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  getMessages(sessionId: string): ChatMessage[] {
    const cached = this.messages.get(sessionId)
    if (cached) return cached
    const session = this.sessions.find((item) => item.id === sessionId)
    if (!session) {
      this.messages.set(sessionId, [])
      return this.messages.get(sessionId)!
    }
    const file = path.join(this.messagesDir, sessionId + '.json')
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw) as ChatMessage[]
      const list = Array.isArray(parsed) ? parsed : []
      for (const message of list) {
        message.sessionId = message.sessionId || sessionId
        message.agentId = message.agentId || session.agentId
        if (message.state === 'running') {
          message.state = 'error'
          message.content =
            message.content ||
            '（应用在运行过程中退出，本轮回复未完成。可重新发送消息继续。）'
        }
      }
      this.messages.set(sessionId, list)
      return list
    } catch {
      this.messages.set(sessionId, [])
      return this.messages.get(sessionId)!
    }
  }

  appendMessage(message: ChatMessage): void {
    const list = this.getMessages(message.sessionId)
    list.push(message)
    const titleHint =
      message.role === 'user'
        ? typeof message.meta?.title === 'string' && message.meta.title.trim()
          ? message.meta.title
          : message.content || message.attachments?.[0]?.name || ''
        : undefined
    this.touchSession(message.sessionId, titleHint)
    this.schedulePersistMessages(message.sessionId)
  }

  updateMessage(sessionId: string, message: ChatMessage): void {
    const list = this.getMessages(sessionId)
    message.sessionId = sessionId
    const index = list.findIndex((item) => item.id === message.id)
    if (index >= 0) list[index] = message
    else list.push(message)
    this.touchSession(sessionId)
    this.schedulePersistMessages(sessionId)
  }

  patchMessage(
    sessionId: string,
    messageId: string,
    patch: Partial<ChatMessage>
  ): ChatMessage | undefined {
    const list = this.getMessages(sessionId)
    const message = list.find((item) => item.id === messageId)
    if (!message) return undefined
    Object.assign(message, patch)
    this.schedulePersistMessages(sessionId)
    return message
  }

  private schedulePersistMessages(sessionId: string): void {
    const existing = this.saveTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.saveTimers.delete(sessionId)
      void this.persistMessages(sessionId)
    }, 350)
    this.saveTimers.set(sessionId, timer)
  }

  async persistMessages(sessionId: string): Promise<void> {
    const list = this.messages.get(sessionId)
    if (!list) return
    const file = path.join(this.messagesDir, sessionId + '.json')
    const tmp = file + '.tmp'
    try {
      await fsp.writeFile(tmp, JSON.stringify(list), 'utf8')
      await fsp.rename(tmp, file)
    } catch (error) {
      console.error('[store] 保存会话消息失败', error)
    }
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.messages.set(sessionId, [])
    await this.persistMessages(sessionId)
  }

  async flush(): Promise<void> {
    for (const timer of this.saveTimers.values()) clearTimeout(timer)
    this.saveTimers.clear()
    if (this.sessionsSaveTimer) {
      clearTimeout(this.sessionsSaveTimer)
      this.sessionsSaveTimer = null
    }
    await Promise.all([...this.messages.keys()].map((id) => this.persistMessages(id)))
    await this.persistSessions()
  }
}
