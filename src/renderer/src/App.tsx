import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Agent,
  AgentEvent,
  AppSettings,
  AppState,
  ChatMessage,
  Session,
  ThemeMode,
  UpdateInfo,
  WhatsNewData
} from '@shared/types'
import { APP_DOCS_URL, APP_FEEDBACK_URL } from '@shared/types'
import { compareVersions } from '@shared/version'
import { Sidebar, type MainView } from './components/Sidebar'
import { AgentView } from './components/AgentView'
import { InboxView } from './components/InboxView'
import { SettingsView } from './components/SettingsView'
import { Icon, LogoMark } from './components/Icons'
import { ConfirmDialog, ToastStack } from './components/Primitives'
import { TitleBarMenu } from './components/TitleBarMenu'
import { AboutDialog } from './components/AboutDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { WhatsNewDialog } from './components/WhatsNewDialog'

type Tab = 'chat' | 'skills' | 'role' | 'model'

interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  text: string
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  action: () => void | Promise<void>
}

function readInitialView(): MainView {
  const value = new URLSearchParams(window.location.search).get('view')
  return value === 'inbox' || value === 'settings' ? value : 'agents'
}

function readInitialTab(): Tab {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value === 'skills' || value === 'role' || value === 'model' ? value : 'chat'
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => a.createdAt - b.createdAt)
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
  )
}

function latestSession(sessions: Session[], agentId: string): Session | undefined {
  const all = sessions.filter((session) => session.agentId === agentId)
  const active = all.filter((session) => !session.archived)
  return sortSessions(active)[0] ?? sortSessions(all)[0]
}

const WHATS_NEW_SEEN_KEY = 'agentroles.lastSeenReleaseVersion'

const THEME_OPTIONS: Array<{
  id: ThemeMode
  label: string
  icon: 'monitor' | 'sun' | 'moon'
}> = [
  { id: 'system', label: '跟随系统', icon: 'monitor' },
  { id: 'light', label: '浅色', icon: 'sun' },
  { id: 'dark', label: '深色', icon: 'moon' }
]

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [view, setView] = useState<MainView>(readInitialView)
  const [tab, setTab] = useState<Tab>(readInitialTab)
  const [activeAgentId, setActiveAgentId] = useState('')
  const [activeSessionId, setActiveSessionId] = useState('')
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [inbox, setInbox] = useState<ChatMessage[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [whatsNewData, setWhatsNewData] = useState<WhatsNewData | null>(null)
  const [whatsNewLoading, setWhatsNewLoading] = useState(false)
  const [whatsNewError, setWhatsNewError] = useState('')
  const [whatsNewUnread, setWhatsNewUnread] = useState(false)
  const checkingUpdate = useRef(false)
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null)
  const inboxTimer = useRef<number | null>(null)
  const themeRequest = useRef(0)
  const isMac = useMemo(() => /Mac/i.test(navigator.userAgent), [])

  useEffect(() => {
    if (!state) return
    const mode = state.settings.theme
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
      try {
        window.localStorage.setItem('agentroles.theme', mode)
      } catch {
        /* ignore */
      }
    }
    apply()
    const onChange = (): void => {
      if (mode === 'system') apply()
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [state?.settings.theme])

  const notify = useCallback((kind: Toast['kind'], text: string): string => {
    const id = Date.now() + '-' + Math.random().toString(16).slice(2)
    setToasts((prev) => [...prev, { id, kind, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 4600)
    return id
  }, [])

  const refreshInbox = useCallback(async () => {
    try {
      const list = await window.api.getInbox()
      setInbox(list)
    } catch {
      /* ignore */
    }
  }, [])

  const scheduleInbox = useCallback(() => {
    if (inboxTimer.current !== null) window.clearTimeout(inboxTimer.current)
    inboxTimer.current = window.setTimeout(() => {
      inboxTimer.current = null
      void refreshInbox()
    }, 350)
  }, [refreshInbox])

  useEffect(() => {
    let alive = true
    window.api
      .getState()
      .then((next) => {
        if (!alive) return
        setState(next)
        const agent = next.agents[0]
        const session = agent ? latestSession(next.sessions, agent.id) : undefined
        setActiveAgentId(agent?.id ?? '')
        setActiveSessionId(session?.id ?? '')
        if (agent) setExpandedAgents(new Set([agent.id]))
      })
      .catch((error) => {
        notify('error', '加载应用状态失败：' + (error?.message ?? String(error)))
      })
    void refreshInbox()
    return () => {
      alive = false
    }
  }, [notify, refreshInbox])

  useEffect(() => {
    if (!state) return
    if (!state.agents.some((agent) => agent.id === activeAgentId)) {
      const nextAgent = state.agents[0]
      setActiveAgentId(nextAgent?.id ?? '')
      setActiveSessionId(nextAgent ? latestSession(state.sessions, nextAgent.id)?.id ?? '' : '')
      return
    }
    const sessions = state.sessions.filter((session) => session.agentId === activeAgentId)
    if (!sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(latestSession(state.sessions, activeAgentId)?.id ?? '')
    }
  }, [state, activeAgentId, activeSessionId])

  useEffect(() => {
    if (!activeAgentId) return
    setExpandedAgents((prev) => {
      if (prev.has(activeAgentId)) return prev
      const next = new Set(prev)
      next.add(activeAgentId)
      return next
    })
  }, [activeAgentId])

  useEffect(() => {
    if (!activeSessionId) return
    let alive = true
    window.api
      .getMessages(activeSessionId)
      .then((list) => {
        if (!alive) return
        setMessages((prev) => ({ ...prev, [activeSessionId]: sortMessages(list) }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [activeSessionId])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const data = await window.api.getWhatsNew()
        if (!alive || data.releases.length === 0) return
        const latest = data.releases[0].version
        let seen = window.localStorage.getItem(WHATS_NEW_SEEN_KEY)
        if (!seen) {
          seen = data.currentVersion
          try {
            window.localStorage.setItem(WHATS_NEW_SEEN_KEY, seen)
          } catch {
            /* ignore */
          }
        }
        setWhatsNewUnread(compareVersions(latest, seen) > 0)
      } catch {
        /* 未读提示是增强功能，静默失败 */
      }
    }, 600)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === WHATS_NEW_SEEN_KEY) setWhatsNewUnread(false)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onAgentEvent((event: AgentEvent) => {
      if (event.type === 'agent_state') {
        setState((prev) =>
          prev
            ? {
                ...prev,
                running: {
                  ...prev.running,
                  [event.sessionId]: { running: event.running, queued: event.queued }
                }
              }
            : prev
        )
        return
      }

      if (event.type === 'session_updated') {
        setState((prev) => {
          if (!prev) return prev
          const exists = prev.sessions.some((session) => session.id === event.session.id)
          return {
            ...prev,
            sessions: exists
              ? prev.sessions.map((session) =>
                  session.id === event.session.id ? event.session : session
                )
              : [...prev.sessions, event.session]
          }
        })
        return
      }

      if (event.type === 'run_end') {
        scheduleInbox()
        return
      }

      if (event.type === 'run_start') return

      if (event.type === 'message_added' || event.type === 'message_updated') {
        setMessages((prev) => {
          const list = prev[event.sessionId]
          if (!list) return prev
          const index = list.findIndex((item) => item.id === event.message.id)
          const next = [...list]
          if (index >= 0) next[index] = event.message
          else next.push(event.message)
          return { ...prev, [event.sessionId]: sortMessages(next) }
        })
        scheduleInbox()
        return
      }

      if (event.type === 'message_delta') {
        setMessages((prev) => {
          const list = prev[event.sessionId]
          if (!list) return prev
          return {
            ...prev,
            [event.sessionId]: list.map((message) =>
              message.id === event.messageId
                ? {
                    ...message,
                    content: message.content + event.text,
                    reasoning: event.reasoning
                      ? (message.reasoning ?? '') + event.reasoning
                      : message.reasoning
                  }
                : message
            )
          }
        })
        return
      }

      if (event.type === 'tool_started' || event.type === 'tool_finished') {
        setMessages((prev) => {
          const list = prev[event.sessionId]
          if (!list) return prev
          return {
            ...prev,
            [event.sessionId]: list.map((message) => {
              if (message.id !== event.messageId) return message
              if (event.type === 'tool_started') {
                const calls = message.toolCalls ? [...message.toolCalls] : []
                const index = calls.findIndex((call) => call.id === event.call.id)
                if (index >= 0) calls[index] = event.call
                else calls.push(event.call)
                return { ...message, toolCalls: calls }
              }
              return {
                ...message,
                toolCalls: (message.toolCalls ?? []).map((call) =>
                  call.id === event.callId
                    ? {
                        ...call,
                        result: event.result,
                        ok: event.ok,
                        endedAt: event.endedAt
                      }
                    : call
                )
              }
            })
          }
        })
      }
    })
    return () => {
      unsubscribe()
      if (inboxTimer.current !== null) window.clearTimeout(inboxTimer.current)
    }
  }, [scheduleInbox])

  const activeSession =
    state?.sessions.find((session) => session.id === activeSessionId) ?? null
  const activeAgent =
    state?.agents.find((agent) => agent.id === (activeSession?.agentId ?? activeAgentId)) ?? null
  const activeMessages = activeSession ? messages[activeSession.id] ?? [] : []
  const pendingInbox = inbox.filter((message) => message.state === 'pending').length

  const saveAgent = useCallback(
    async (agent: Agent): Promise<Agent | null> => {
      try {
        const saved = await window.api.saveAgent(agent)
        setState((prev) =>
          prev
            ? {
                ...prev,
                agents: prev.agents.map((item) => (item.id === saved.id ? saved : item))
              }
            : prev
        )
        notify('success', '角色已保存')
        return saved
      } catch (error: any) {
        notify('error', '保存失败：' + (error?.message ?? String(error)))
        return null
      }
    },
    [notify]
  )

  const createAgent = useCallback(async () => {
    try {
      const { agent, session } = await window.api.createAgent()
      setState((prev) =>
        prev
          ? { ...prev, agents: [...prev.agents, agent], sessions: [...prev.sessions, session] }
          : prev
      )
      setMessages((prev) => ({ ...prev, [session.id]: [] }))
      setActiveAgentId(agent.id)
      setActiveSessionId(session.id)
      setExpandedAgents((prev) => new Set(prev).add(agent.id))
      setView('agents')
      setTab('role')
      notify('info', '已创建新角色，先填写职责，再选择模型')
    } catch (error: any) {
      notify('error', '创建失败：' + (error?.message ?? String(error)))
    }
  }, [notify])

  const createSession = useCallback(
    async (agentId: string) => {
      try {
        const session = await window.api.createSession(agentId)
        setState((prev) =>
          prev ? { ...prev, sessions: [...prev.sessions, session] } : prev
        )
        setMessages((prev) => ({ ...prev, [session.id]: [] }))
        setActiveAgentId(agentId)
        setActiveSessionId(session.id)
        setExpandedAgents((prev) => new Set(prev).add(agentId))
        setView('agents')
        setTab('chat')
        notify('info', '已创建新会话，首条消息会自动生成标题')
      } catch (error: any) {
        notify('error', '创建会话失败：' + (error?.message ?? String(error)))
      }
    },
    [notify]
  )

  const requestDeleteAgent = useCallback(
    (agent: Agent) => {
      setConfirm({
        title: '删除角色「' + agent.name + '」？',
        message: '角色配置、全部会话与长期记忆将一并删除，此操作不可撤销。',
        confirmLabel: '删除角色',
        danger: true,
        action: async () => {
          const removedSessions =
            state?.sessions.filter((session) => session.agentId === agent.id).map((session) => session.id) ??
            []
          await window.api.deleteAgent(agent.id)
          const fresh = await window.api.getState()
          setState(fresh)
          setMessages((prev) => {
            const next = { ...prev }
            for (const id of removedSessions) delete next[id]
            return next
          })
          setExpandedAgents((prev) => {
            const next = new Set(prev)
            next.delete(agent.id)
            return next
          })
          if (activeAgentId === agent.id) {
            const nextAgent = fresh.agents[0]
            setActiveAgentId(nextAgent?.id ?? '')
            setActiveSessionId(
              nextAgent ? latestSession(fresh.sessions, nextAgent.id)?.id ?? '' : ''
            )
          }
          setView('agents')
          void refreshInbox()
          notify('success', '角色已删除')
        }
      })
    },
    [activeAgentId, notify, refreshInbox, state]
  )

  const sendMessage = useCallback(
    async (sessionId: string, content: string): Promise<boolean> => {
      const result = await window.api.sendMessage(sessionId, content)
      if (!result.ok) {
        notify('error', result.error ?? '发送失败')
        return false
      }
      return true
    },
    [notify]
  )

  const processMessage = useCallback(
    async (sessionId: string, messageId: string) => {
      const result = await window.api.processMessage(sessionId, messageId)
      if (!result.ok) notify('error', result.error ?? '无法处理该消息')
    },
    [notify]
  )

  const stopSession = useCallback(async (sessionId: string) => {
    await window.api.stopSession(sessionId)
  }, [])

  const applySessionUpdate = useCallback((updated: Session) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            sessions: prev.sessions.map((session) =>
              session.id === updated.id ? updated : session
            )
          }
        : prev
    )
  }, [])

  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      try {
        const updated = await window.api.updateSession(sessionId, { title })
        applySessionUpdate(updated)
        notify('success', '会话已重命名')
        return true
      } catch (error: any) {
        notify('error', '重命名失败：' + (error?.message ?? String(error)))
        return false
      }
    },
    [applySessionUpdate, notify]
  )

  const toggleSessionPin = useCallback(
    async (session: Session) => {
      try {
        const updated = await window.api.updateSession(session.id, {
          pinned: !session.pinned
        })
        applySessionUpdate(updated)
        notify('success', updated.pinned ? '会话已置顶' : '已取消置顶')
      } catch (error: any) {
        notify('error', '更新置顶失败：' + (error?.message ?? String(error)))
      }
    },
    [applySessionUpdate, notify]
  )

  const toggleSessionArchive = useCallback(
    async (session: Session) => {
      const archived = !session.archived
      if (archived) {
        const runtime = state?.running[session.id]
        if (runtime?.running || runtime?.queued) {
          notify('error', '会话正在运行，停止后再归档')
          return
        }
        const activeCount =
          state?.sessions.filter(
            (item) => item.agentId === session.agentId && !item.archived
          ).length ?? 0
        if (activeCount <= 1) {
          notify('error', '至少保留一个未归档会话')
          return
        }
      }
      try {
        const updated = await window.api.updateSession(session.id, { archived })
        applySessionUpdate(updated)
        if (archived && activeSessionId === session.id) {
          const nextSessions = (state?.sessions ?? []).map((item) =>
            item.id === updated.id ? updated : item
          )
          const next = latestSession(nextSessions, session.agentId)
          setActiveSessionId(next?.id ?? '')
        }
        notify('success', archived ? '会话已归档' : '已取消归档')
      } catch (error: any) {
        notify('error', '更新归档失败：' + (error?.message ?? String(error)))
      }
    },
    [activeSessionId, applySessionUpdate, notify, state]
  )

  const checkUpdates = useCallback(async () => {
    if (checkingUpdate.current) return
    checkingUpdate.current = true
    const toastId = notify('info', '正在检查更新…')
    try {
      const result = await window.api.checkForUpdates()
      if (!result.ok) {
        notify('error', result.message || '检查更新失败')
        return
      }
      if (result.noRelease) {
        notify('info', result.message || '项目暂未发布 Release')
        return
      }
      if (!result.info) {
        notify('error', '检查更新失败：返回信息为空')
        return
      }
      if (!result.info.hasUpdate) {
        notify('success', '已是最新版本（' + result.info.latestVersion + '）')
        return
      }
      setUpdateInfo(result.info)
      setUpdateOpen(true)
    } catch (error: any) {
      notify('error', '检查更新失败：' + (error?.message ?? String(error)))
    } finally {
      checkingUpdate.current = false
      setToasts((prev) => prev.filter((item) => item.id !== toastId))
    }
  }, [notify])

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo) return
    try {
      await window.api.openExternal(updateInfo.downloadUrl || updateInfo.releaseUrl)
      setUpdateOpen(false)
    } catch (error: any) {
      notify('error', '打开下载链接失败：' + (error?.message ?? String(error)))
    }
  }, [notify, updateInfo])

  const openWhatsNew = useCallback(async (force = false) => {
    setWhatsNewOpen(true)
    setWhatsNewLoading(true)
    setWhatsNewError('')
    try {
      const data = await window.api.getWhatsNew(force)
      setWhatsNewData(data)
      const latest = data.releases[0]?.version
      if (latest) {
        try {
          window.localStorage.setItem(WHATS_NEW_SEEN_KEY, latest)
        } catch {
          /* ignore */
        }
        setWhatsNewUnread(false)
      }
    } catch (error: any) {
      setWhatsNewError('读取版本记录失败：' + (error?.message ?? String(error)))
    } finally {
      setWhatsNewLoading(false)
    }
  }, [])

  const changeTheme = useCallback(
    async (theme: ThemeMode) => {
      const requestId = ++themeRequest.current
      setState((prev) =>
        prev ? { ...prev, settings: { ...prev.settings, theme } } : prev
      )
      try {
        const settings = await window.api.setTheme(theme)
        if (requestId !== themeRequest.current) return
        setState((prev) => (prev ? { ...prev, settings } : prev))
      } catch (error: any) {
        if (requestId !== themeRequest.current) return
        notify('error', '切换主题失败：' + (error?.message ?? String(error)))
        const fresh = await window.api.getState().catch(() => null)
        if (fresh) setState(fresh)
      }
    },
    [notify]
  )

  const saveSettings = useCallback(
    async (settings: AppSettings) => {
      try {
        const next = await window.api.saveSettings(settings)
        setState(next)
        notify(
          'success',
          next.ingress.running
            ? '设置已保存，外部接入运行在 :' + next.ingress.port
            : '设置已保存，外部接入未运行'
        )
        return next
      } catch (error: any) {
        notify('error', '保存设置失败：' + (error?.message ?? String(error)))
        return null
      }
    },
    [notify]
  )

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setExpandedAgents((prev) => new Set(prev).add(agentId))
      setView('agents')
      setTab('chat')
      if (agentId === activeAgentId && activeSessionId) return
      const session = state ? latestSession(state.sessions, agentId) : undefined
      setActiveAgentId(agentId)
      setActiveSessionId(session?.id ?? '')
    },
    [activeAgentId, activeSessionId, state]
  )

  const handleSelectSession = useCallback((session: Session) => {
    setActiveAgentId(session.agentId)
    setActiveSessionId(session.id)
    setExpandedAgents((prev) => new Set(prev).add(session.agentId))
    setView('agents')
    setTab('chat')
  }, [])

  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  const openInboxMessage = useCallback(
    async (message: ChatMessage) => {
      if (!messages[message.sessionId]) {
        try {
          const list = await window.api.getMessages(message.sessionId)
          setMessages((prev) => ({
            ...prev,
            [message.sessionId]: sortMessages(list)
          }))
        } catch {
          /* ignore */
        }
      }
      setActiveAgentId(message.agentId)
      setActiveSessionId(message.sessionId)
      setExpandedAgents((prev) => new Set(prev).add(message.agentId))
      setView('agents')
      setTab('chat')
      setFocusMessageId(message.id)
    },
    [messages]
  )

  if (!state) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <LogoMark size={40} />
        </div>
        <div className="boot-title">AgentRoles</div>
        <div className="boot-sub">正在准备你的角色工作台…</div>
      </div>
    )
  }

  return (
    <div className={'app' + (isMac ? ' platform-mac' : '')}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo">
            <LogoMark size={19} />
          </span>
          <span className="topbar-wordmark">AgentRoles</span>
          <TitleBarMenu
            onNewWindow={() => void window.api.newWindow()}
            onCloseWindow={() => void window.api.closeWindow()}
            onZoom={(direction) => void window.api.zoomWindow(direction)}
            onToggleFullscreen={() => void window.api.toggleFullscreen()}
            onFeedback={() => void window.api.openExternal(APP_FEEDBACK_URL)}
            onDocs={() => void window.api.openExternal(APP_DOCS_URL)}
            hasUnreadWhatsNew={whatsNewUnread}
            onWhatsNew={() => void openWhatsNew()}
            onCheckUpdate={() => void checkUpdates()}
            onAbout={() => setAboutOpen(true)}
          />
          <span className="topbar-divider" />
          <span className="topbar-scope">
            {view === 'agents' ? '角色工作台' : view === 'inbox' ? '收件箱' : '设置'}
          </span>
        </div>
        <div className="topbar-right">
          <div className="theme-switch" role="group" aria-label="外观主题">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  'theme-option' +
                  (state.settings.theme === option.id ? ' is-active' : '')
                }
                data-theme-option={option.id}
                title={option.label}
                aria-label={option.label}
                aria-pressed={state.settings.theme === option.id}
                onClick={() => void changeTheme(option.id)}
              >
                <Icon name={option.icon} size={15} />
              </button>
            ))}
          </div>
          <button
            className="topbar-chip"
            onClick={() => setView('settings')}
            title="外部接入设置"
          >
            <span className={'status-dot ' + (state.ingress.running ? 'is-ok' : 'is-idle')} />
            {state.ingress.running ? '接入 :' + state.ingress.port : '接入未运行'}
          </button>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          state={state}
          view={view}
          activeAgentId={activeAgentId}
          activeSessionId={activeSessionId}
          expandedAgents={expandedAgents}
          pendingInbox={pendingInbox}
          onSelectView={(next) => {
            setView(next)
            if (next === 'inbox') void refreshInbox()
          }}
          onSelectAgent={handleSelectAgent}
          onToggleAgent={toggleAgent}
          onSelectSession={handleSelectSession}
          onCreateAgent={() => void createAgent()}
          onCreateSession={(agentId) => void createSession(agentId)}
          onRenameSession={renameSession}
          onTogglePin={(session) => void toggleSessionPin(session)}
          onToggleArchive={(session) => void toggleSessionArchive(session)}
        />

        <main className="stage">
          {view === 'agents' && activeAgent && activeSession ? (
            <AgentView
              key={activeAgent.id}
              agent={activeAgent}
              session={activeSession}
              running={
                state.running[activeSession.id] ?? { running: false, queued: 0 }
              }
              messages={activeMessages}
              skills={state.skills}
              settings={state.settings}
              tab={tab}
              onTabChange={setTab}
              onSaveAgent={saveAgent}
              onDeleteAgent={requestDeleteAgent}
              onNewSession={() => void createSession(activeAgent.id)}
              onUnarchive={() => void toggleSessionArchive(activeSession)}
              onSend={sendMessage}
              onProcessMessage={processMessage}
              onStop={stopSession}
              notify={notify}
              focusMessageId={focusMessageId}
              onFocusConsumed={() => setFocusMessageId(null)}
            />
          ) : null}

          {view === 'agents' && !activeAgent ? (
            <div className="empty-workspace">
              <LogoMark size={44} />
              <h1>给一个角色，配一个智能体</h1>
              <p>每个角色拥有独立的职责、模型 API 与技能。先创建一个，让它开始接活。</p>
              <button className="btn btn-primary" onClick={() => void createAgent()}>
                <Icon name="plus" size={16} />
                新建角色
              </button>
            </div>
          ) : null}

          {view === 'inbox' ? (
            <InboxView
              inbox={inbox}
              agents={state.agents}
              onOpenMessage={(message) => void openInboxMessage(message)}
              onRefresh={() => void refreshInbox()}
            />
          ) : null}

          {view === 'settings' ? (
            <SettingsView
              state={state}
              onSave={saveSettings}
              notify={notify}
              onRestartIngress={async () => {
                const info = await window.api.restartIngress()
                setState((prev) => (prev ? { ...prev, ingress: info } : prev))
                notify(
                  info.running ? 'success' : 'error',
                  info.running ? '外部接入已重启' : info.error || '外部接入未运行'
                )
              }}
            />
          ) : null}
        </main>
      </div>

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))}
      />

      <AboutDialog
        open={aboutOpen}
        version={state.version}
        releaseDate={state.releaseDate}
        onClose={() => setAboutOpen(false)}
      />

      <UpdateDialog
        open={updateOpen}
        info={updateInfo}
        onClose={() => setUpdateOpen(false)}
        onDownload={() => void downloadUpdate()}
      />

      <WhatsNewDialog
        open={whatsNewOpen}
        data={whatsNewData}
        loading={whatsNewLoading}
        error={whatsNewError}
        onClose={() => setWhatsNewOpen(false)}
        onRefresh={() => void openWhatsNew(true)}
        onCheckUpdate={() => {
          setWhatsNewOpen(false)
          void checkUpdates()
        }}
      />

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
            Promise.resolve(action()).catch((error: any) => {
              notify('error', error?.message ?? String(error))
            })
          }
        }}
      />
    </div>
  )
}
