import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEvent, AppState, IngressInfo, ThemeMode } from '@shared/types'
import { Store } from './store'
import { AgentManager } from './engine/runner'
import { IngressServer } from './ingress/server'
import { registerIpc } from './ipc'
import { defaultSkillStates, skillMetas } from './skills'

if (process.env.AGENTROLES_USER_DATA) {
  // 便于自动化测试与多实例隔离：把配置/会话放到指定目录
  app.setPath('userData', path.resolve(process.env.AGENTROLES_USER_DATA))
}

let store: Store
let manager: AgentManager
let ingress: IngressServer
let mainWindow: BrowserWindow | null = null

function broadcast(event: AgentEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('agent:event', event)
  }
}

function getState(): AppState {
  const settings = store.getSettings()
  return {
    agents: store.getAgents(),
    sessions: store.getAllSessions(),
    settings,
    ingress: ingress.getInfo(settings.ingress),
    skills: skillMetas(),
    running: manager.getRuntimeStates(),
    version: app.getVersion(),
    dataDir: store.dataDir
  }
}

async function restartIngress(): Promise<IngressInfo> {
  const settings = store.getSettings()
  return ingress.start(settings.ingress)
}

function chromeColors(): { background: string; symbol: string } {
  return nativeTheme.shouldUseDarkColors
    ? { background: '#0b0c0e', symbol: '#8f97a3' }
    : { background: '#f5f4ef', symbol: '#586052' }
}

function applyWindowChrome(): void {
  const { background, symbol } = chromeColors()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.setBackgroundColor(background)
    if (process.platform !== 'darwin') {
      window.setTitleBarOverlay({ color: background, symbolColor: symbol, height: 44 })
    }
  }
}

function applyTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
  applyWindowChrome()
}

function createWindow(): void {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const query: Record<string, string> = {}
  if (process.env.AGENTROLES_VIEW) query.view = process.env.AGENTROLES_VIEW
  if (process.env.AGENTROLES_TAB) query.tab = process.env.AGENTROLES_TAB
  const chrome = chromeColors()

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: chrome.background,
    title: 'AgentRoles',
    autoHideMenuBar: true,
    icon: path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'icon.png'
    ),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: chrome.background,
            symbolColor: chrome.symbol,
            height: 44
          }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault()
    }
  })

  if (isDev) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL as string)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    void mainWindow.loadURL(url.toString())
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const screenshotPath = process.env.AGENTROLES_SCREENSHOT
  if (screenshotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow?.webContents.capturePage()
          if (image) {
            await fs.mkdir(path.dirname(path.resolve(screenshotPath)), { recursive: true })
            await fs.writeFile(path.resolve(screenshotPath), image.toPNG())
            console.log('[screenshot] saved to', path.resolve(screenshotPath))
          }
        } catch (error) {
          console.error('[screenshot] failed', error)
        } finally {
          app.quit()
        }
      }, Number(process.env.AGENTROLES_SCREENSHOT_DELAY) || 2200)
    })
  }
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.agentroles.app')
  Menu.setApplicationMenu(null)

  store = new Store({ skillDefaults: defaultSkillStates() })
  await store.init()
  nativeTheme.themeSource = store.getSettings().theme
  nativeTheme.on('updated', applyWindowChrome)
  manager = new AgentManager(store, broadcast)
  ingress = new IngressServer({
    version: app.getVersion(),
    listAgents: () =>
      store.getAgents().map((agent) => ({
        id: agent.id,
        name: agent.name,
        tagline: agent.tagline,
        avatar: agent.avatar,
        autoRun: agent.autoRun,
        sessionCount: store.getSessions(agent.id).length
      })),
    listSessions: (agentKey) => {
      const agent = store.findAgent(agentKey)
      if (!agent) throw new Error('角色不存在：' + agentKey)
      return store.getSessions(agent.id).map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt
      }))
    },
    ingest: (agentKey, payload) => {
      const agent = store.findAgent(agentKey)
      if (!agent) throw new Error('角色不存在：' + agentKey)
      const result = manager.ingest(agent.id, payload.session, payload.content, {
        source: payload.source,
        title: payload.title,
        sender: payload.sender,
        metadata: payload.metadata
      })
      return {
        messageId: result.message.id,
        agentId: agent.id,
        agentName: agent.name,
        sessionId: result.session.id,
        sessionTitle: result.session.title,
        started: result.started
      }
    }
  })

  await restartIngress()
  registerIpc({
    store,
    manager,
    ingress,
    restartIngress,
    getState,
    applyTheme
  })
  createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[app] 启动失败', error)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    manager?.shutdown()
    void ingress?.stop()
    void store?.flush()
  })
}
