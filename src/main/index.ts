import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray
} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEvent, AppState, IngressInfo, ThemeMode } from '@shared/types'
import { APP_RELEASE_DATE } from '@shared/types'
import { Store } from './store'
import { MemoryStore } from './memory/store'
import { MemoryIndex } from './memory/index'
import { AgentManager } from './engine/runner'
import { IngressServer } from './ingress/server'
import { registerIpc } from './ipc'
import { defaultSkillStates, skillMetas } from './skills'

if (process.env.AGENTROLES_USER_DATA) {
  // 便于自动化测试与多实例隔离：把配置/会话放到指定目录
  app.setPath('userData', path.resolve(process.env.AGENTROLES_USER_DATA))
}

let store: Store
let memory: MemoryStore
let memoryIndex: MemoryIndex | null = null
let manager: AgentManager
let ingress: IngressServer
let mainWindow: BrowserWindow | null = null
const windows = new Set<BrowserWindow>()
let tray: Tray | null = null
let quitting = false

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
}

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
    releaseDate: APP_RELEASE_DATE,
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

function createWindow(): BrowserWindow {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const query: Record<string, string> = {}
  if (process.env.AGENTROLES_VIEW) query.view = process.env.AGENTROLES_VIEW
  if (process.env.AGENTROLES_TAB) query.tab = process.env.AGENTROLES_TAB
  const chrome = chromeColors()

  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: chrome.background,
    title: 'AgentRoles',
    autoHideMenuBar: true,
    icon: path.join(resourcesDir(), 'icon.png'),
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

  windows.add(window)
  mainWindow = window
  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (
      url !== current &&
      !url.startsWith('http://localhost') &&
      !url.startsWith('http://127.0.0.1')
    ) {
      event.preventDefault()
    }
  })

  if (isDev) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL as string)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }

  window.on('closed', () => {
    windows.delete(window)
    if (mainWindow === window) {
      mainWindow = [...windows].at(-1) ?? null
    }
  })

  const screenshotPath = process.env.AGENTROLES_SCREENSHOT
  if (screenshotPath && windows.size === 1) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await window.webContents.capturePage()
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

  return window
}

function focusOrCreateWindow(): void {
  const target =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : [...windows].find((window) => !window.isDestroyed())
  if (target) {
    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
    return
  }
  if (!quitting) createWindow()
}

function createTray(): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromPath(path.join(resourcesDir(), 'icon.png'))
    if (icon.isEmpty()) {
      console.warn('[tray] icon not found; window close will quit the app')
      return
    }
    tray = new Tray(icon.resize({ width: 16, height: 16 }))
    tray.setToolTip('AgentRoles')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开主窗口', click: focusOrCreateWindow },
        { label: '新建窗口', click: () => createWindow() },
        { type: 'separator' },
        {
          label: '退出 AgentRoles',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', focusOrCreateWindow)
  } catch (error) {
    console.error('[tray] create failed', error)
    tray = null
  }
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.agentroles.app')
  Menu.setApplicationMenu(null)

  store = new Store({ skillDefaults: defaultSkillStates() })
  await store.init()
  nativeTheme.themeSource = store.getSettings().theme
  nativeTheme.on('updated', applyWindowChrome)
  memoryIndex = await MemoryIndex.open({
    dataDir: store.dataDir,
    getSettings: () => store.getSettings(),
    logger: (message, error) => console.error(message, error ?? '')
  })
  memory = new MemoryStore(
    store.dataDir,
    memoryIndex ? { index: memoryIndex } : undefined
  )
  manager = new AgentManager(store, memory, broadcast)
  ingress = new IngressServer({
    version: app.getVersion(),
    listAgents: () =>
      store.getAgents().map((agent) => ({
        id: agent.id,
        name: agent.name,
        tagline: agent.tagline,
        avatar: agent.avatar,
        autoRun: agent.autoRun,
        sessionCount: store.getSessions(agent.id).filter((session) => !session.archived).length
      })),
    listSessions: (agentKey) => {
      const agent = store.findAgent(agentKey)
      if (!agent) throw new Error('角色不存在：' + agentKey)
      return store
        .getSessions(agent.id)
        .filter((session) => !session.archived)
        .map((session) => ({
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
    memory,
    manager,
    ingress,
    restartIngress,
    getState,
    applyTheme,
    openWindow: () => {
      createWindow()
    }
  })
  createTray()
  createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusOrCreateWindow()
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[app] 启动失败', error)
    app.quit()
  })

  app.on('activate', () => {
    focusOrCreateWindow()
  })

  app.on('window-all-closed', () => {
    // 关闭窗口不退出应用：托盘保持驻留，Agent 与外部接入可继续工作。
    if (!tray && process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    tray?.destroy()
    tray = null
    manager?.shutdown()
    void ingress?.stop()
    void store?.flush()
    memoryIndex?.close()
  })
}
