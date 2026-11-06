import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  Agent,
  AppSettings,
  AppState,
  IngressInfo,
  ModelListResult,
  ModelSettings,
  NotionSettings,
  RuntimePaths,
  SessionPatch,
  TestResult,
  ThemeMode
} from '@shared/types'
import type { Store } from './store'
import type { AgentManager } from './engine/runner'
import type { IngressServer } from './ingress/server'
import { streamChat } from './engine/llm'
import { listModelsForProvider } from './engine/models'
import { checkForUpdates } from './update'

interface IpcDeps {
  store: Store
  manager: AgentManager
  ingress: IngressServer
  restartIngress: () => Promise<IngressInfo>
  getState: () => AppState
  applyTheme: (theme: ThemeMode) => void
  openWindow: () => void
}

function normalizeWorkspace(value: string): string {
  return path.resolve(value.trim())
}

async function testNotion(notion: NotionSettings): Promise<TestResult> {
  const token = notion.token.trim()
  if (!token) return { ok: false, message: '请先填写 Notion Integration Token' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const headers = {
    Authorization: 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'User-Agent': 'AgentRoles/0.1'
  }
  try {
    if (notion.databaseId.trim()) {
      const compact = notion.databaseId.replace(/-/g, '')
      const match = compact.match(/[0-9a-fA-F]{32}/)
      const databaseId = match ? match[0] : notion.databaseId.trim()
      const response = await fetch('https://api.notion.com/v1/databases/' + databaseId, {
        headers,
        signal: controller.signal
      })
      const text = await response.text()
      let data: any = null
      try {
        data = JSON.parse(text)
      } catch {
        /* ignore */
      }
      if (!response.ok) {
        return {
          ok: false,
          message:
            '连接失败（HTTP ' + response.status + '）：' +
            (data?.message || text.slice(0, 200))
        }
      }
      const title = Array.isArray(data?.title)
        ? data.title.map((item: any) => item.plain_text ?? '').join('')
        : ''
      const count = Object.keys(data?.properties ?? {}).length
      return {
        ok: true,
        message: '已连接数据库「' + (title || '未命名') + '」，共 ' + count + ' 个属性',
        detail: databaseId
      }
    }
    const response = await fetch('https://api.notion.com/v1/users/me', {
      headers,
      signal: controller.signal
    })
    const text = await response.text()
    let data: any = null
    try {
      data = JSON.parse(text)
    } catch {
      /* ignore */
    }
    if (!response.ok) {
      return {
        ok: false,
        message:
          '连接失败（HTTP ' + response.status + '）：' +
          (data?.message || text.slice(0, 200))
      }
    }
    const name = data?.name || data?.bot?.owner?.user?.name || 'Notion Integration'
    return {
      ok: true,
      message: 'Token 有效（' + name + '）。填写数据库 ID 后可进一步校验数据库权限。'
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return { ok: false, message: '连接超时（20 秒）' }
    return { ok: false, message: '连接失败：' + (error?.message ?? String(error)) }
  } finally {
    clearTimeout(timer)
  }
}

async function testModel(model: ModelSettings): Promise<TestResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const result = await streamChat({
      model,
      system: '你是连接测试助手。',
      messages: [{ role: 'user', content: '请只回复：连接正常' }],
      tools: [],
      signal: controller.signal,
      handlers: { onText: () => undefined }
    })
    const reply = result.text.trim()
    return {
      ok: true,
      message: reply ? '连接成功，模型回复：' + reply.slice(0, 80) : '连接成功（模型返回了空文本）',
      latencyMs: Date.now() - started
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { ok: false, message: '连接超时（30 秒）' }
    }
    return { ok: false, message: error?.message ?? String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function runtimePaths(): RuntimePaths {
  const dir = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources')
  return {
    mcpServer: path.join(dir, 'mcp-server.mjs'),
    cli: path.join(dir, 'agentroles-cli.mjs'),
    dataDir: app.getPath('userData')
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { store, manager, ingress } = deps

  ipcMain.handle('app:state', () => deps.getState())

  ipcMain.handle('updates:check', () => checkForUpdates(app.getVersion()))

  ipcMain.handle('window:new', () => {
    deps.openWindow()
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:zoom', (event, direction: 'in' | 'out') => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || (direction !== 'in' && direction !== 'out')) return
    const current = window.webContents.getZoomFactor()
    const next = current + (direction === 'in' ? 0.1 : -0.1)
    window.webContents.setZoomFactor(Number(Math.min(2, Math.max(0.5, next)).toFixed(2)))
  })

  ipcMain.handle('window:fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.setFullScreen(!window.isFullScreen())
  })

  ipcMain.handle('messages:list', (_event, sessionId: string) => {
    return store.getMessages(sessionId)
  })

  ipcMain.handle('inbox:list', () => store.getInbox())

  ipcMain.handle('agents:create', async () => {
    const agent = await store.createAgent()
    const session = store.getSessions(agent.id)[0]
    return { agent, session }
  })

  ipcMain.handle('sessions:create', async (_event, agentId: string) => {
    return store.createSession(agentId)
  })

  ipcMain.handle(
    'sessions:update',
    async (_event, sessionId: string, patch: SessionPatch) => {
      return store.updateSession(sessionId, patch ?? {})
    }
  )

  ipcMain.handle('agents:save', async (_event, input: Agent) => {
    if (!input?.id) throw new Error('缺少角色 id')
    if (!input.name?.trim()) throw new Error('角色名称不能为空')
    if (!input.model?.baseUrl?.trim()) throw new Error('模型 Base URL 不能为空')
    if (!input.model?.model?.trim()) throw new Error('模型名称不能为空')
    const agent: Agent = structuredClone(input)
    agent.name = agent.name.trim()
    agent.tagline = (agent.tagline ?? '').trim()
    agent.role = agent.role ?? ''
    agent.model.baseUrl = agent.model.baseUrl.trim()
    agent.model.model = agent.model.model.trim()
    agent.model.apiKey = agent.model.apiKey ?? ''
    return store.saveAgent(agent)
  })

  ipcMain.handle('agents:delete', async (_event, agentId: string) => {
    await manager.stopAgent(agentId)
    manager.forgetAgent(agentId)
    await store.deleteAgent(agentId)
    return { ok: true }
  })

  ipcMain.handle('messages:send', async (_event, sessionId: string, content: string) => {
    return manager.sendFromApp(sessionId, content)
  })

  ipcMain.handle('messages:process', async (_event, sessionId: string, messageId: string) => {
    return manager.processMessage(sessionId, messageId)
  })

  ipcMain.handle('sessions:stop', async (_event, sessionId: string) => {
    return manager.stop(sessionId)
  })

  ipcMain.handle('messages:clear', async (_event, sessionId: string) => {
    await manager.stop(sessionId)
    await store.clearMessages(sessionId)
    return { ok: true }
  })

  ipcMain.handle('settings:save', async (_event, input: AppSettings) => {
    const settings: AppSettings = {
      ...structuredClone(input),
      workspaceDir: normalizeWorkspace(input.workspaceDir || store.getSettings().workspaceDir),
      notion: {
        token: (input.notion?.token ?? '').trim(),
        databaseId: (input.notion?.databaseId ?? '').trim()
      },
      ingress: {
        enabled: Boolean(input.ingress?.enabled),
        port: Math.min(65535, Math.max(1024, Number(input.ingress?.port) || 43110)),
        token: (input.ingress?.token ?? '').trim() || randomBytes(16).toString('hex')
      },
      theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system'
    }
    await fs.mkdir(settings.workspaceDir, { recursive: true }).catch(() => undefined)
    await store.saveSettings(settings)
    deps.applyTheme(settings.theme)
    await deps.restartIngress()
    return deps.getState()
  })

  ipcMain.handle('theme:set', async (_event, theme: ThemeMode) => {
    if (!['system', 'light', 'dark'].includes(theme)) {
      throw new Error('不支持的主题模式')
    }
    const settings = await store.saveTheme(theme)
    deps.applyTheme(theme)
    return settings
  })

  ipcMain.handle('ingress:restart', async () => {
    await deps.restartIngress()
    return ingress.getInfo(store.getSettings().ingress)
  })

  ipcMain.handle('model:test', async (_event, model: ModelSettings) => {
    return testModel(model)
  })

  ipcMain.handle('model:list', async (_event, model: ModelSettings): Promise<ModelListResult> => {
    const started = Date.now()
    try {
      const models = await listModelsForProvider(model)
      return { ok: true, models, latencyMs: Date.now() - started }
    } catch (error: any) {
      return {
        ok: false,
        models: [],
        message: error?.message ?? String(error),
        latencyMs: Date.now() - started
      }
    }
  })

  ipcMain.handle('notion:test', async (_event, notion: NotionSettings) => {
    return testNotion(notion)
  })

  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Agent 工作区目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http/https 链接')
    await shell.openExternal(url)
  })

  ipcMain.handle('app:revealDataDir', async () => {
    await shell.openPath(store.dataDir)
  })

  ipcMain.handle('runtime:paths', () => runtimePaths())
}
