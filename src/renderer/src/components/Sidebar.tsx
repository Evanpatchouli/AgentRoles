import type { Agent, AppState, Session } from '@shared/types'
import { Icon, LogoMark } from './Icons'
import { AvatarContent } from './Avatar'
import { Spinner } from './Primitives'
import { relativeTime } from '../lib/format'

export type MainView = 'agents' | 'inbox' | 'settings'

export function Sidebar({
  state,
  view,
  activeAgentId,
  activeSessionId,
  expandedAgents,
  pendingInbox,
  onSelectView,
  onSelectAgent,
  onToggleAgent,
  onSelectSession,
  onCreateAgent,
  onCreateSession
}: {
  state: AppState
  view: MainView
  activeAgentId: string
  activeSessionId: string
  expandedAgents: Set<string>
  pendingInbox: number
  onSelectView: (view: MainView) => void
  onSelectAgent: (agentId: string) => void
  onToggleAgent: (agentId: string) => void
  onSelectSession: (session: Session) => void
  onCreateAgent: () => void
  onCreateSession: (agentId: string) => void
}) {
  const agents = state.agents
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <nav className="nav">
          <button
            className={'nav-item' + (view === 'agents' ? ' is-active' : '')}
            onClick={() => onSelectView('agents')}
          >
            <Icon name="sparkle" size={17} />
            <span>工作台</span>
            <span className="nav-count">{agents.length}</span>
          </button>
          <button
            className={'nav-item' + (view === 'inbox' ? ' is-active' : '')}
            onClick={() => onSelectView('inbox')}
          >
            <Icon name="inbox" size={17} />
            <span>收件箱</span>
            {pendingInbox > 0 ? <span className="nav-badge">{pendingInbox}</span> : null}
          </button>
          <button
            className={'nav-item' + (view === 'settings' ? ' is-active' : '')}
            onClick={() => onSelectView('settings')}
          >
            <Icon name="sliders" size={17} />
            <span>设置</span>
          </button>
        </nav>

        <div className="sidebar-section-head">
          <span>角色</span>
          <button className="icon-btn" onClick={onCreateAgent} title="新建角色" aria-label="新建角色">
            <Icon name="plus" size={16} />
          </button>
        </div>

        <div className="agent-list">
          {agents.map((agent) => {
            const sessions = state.sessions
              .filter((session) => session.agentId === agent.id)
              .sort((a, b) => b.updatedAt - a.updatedAt)
            const running = sessions.some((session) => state.running[session.id]?.running)
            const queued = sessions.reduce(
              (total, session) => total + (state.running[session.id]?.queued ?? 0),
              0
            )
            return (
              <AgentGroup
                key={agent.id}
                agent={agent}
                sessions={sessions}
                active={view === 'agents' && agent.id === activeAgentId}
                activeSessionId={activeSessionId}
                expanded={expandedAgents.has(agent.id)}
                running={running}
                queued={queued}
                runningMap={state.running}
                onClick={() => onSelectAgent(agent.id)}
                onToggle={() => onToggleAgent(agent.id)}
                onSelectSession={onSelectSession}
                onCreateSession={() => onCreateSession(agent.id)}
              />
            )
          })}
          {agents.length === 0 ? (
            <p className="sidebar-empty">还没有角色。创建第一个，给它职责与技能。</p>
          ) : null}
        </div>
      </div>

      <div className="sidebar-footer">
        <button className="ingress-chip" onClick={() => onSelectView('settings')}>
          <span
            className={
              'status-dot ' +
              (state.ingress.running ? 'is-ok' : state.ingress.error ? 'is-bad' : 'is-idle')
            }
          />
          <span className="ingress-label">外部接入</span>
          <span className="ingress-port">
            {state.ingress.running ? ':' + state.ingress.port : state.ingress.error ? '异常' : '关闭'}
          </span>
        </button>
        <div className="sidebar-brand">
          <LogoMark size={18} />
          <span>AgentRoles</span>
          <span className="version">v{state.version}</span>
        </div>
      </div>
    </aside>
  )
}

function AgentGroup({
  agent,
  sessions,
  active,
  activeSessionId,
  expanded,
  running,
  queued,
  runningMap,
  onClick,
  onToggle,
  onSelectSession,
  onCreateSession
}: {
  agent: Agent
  sessions: Session[]
  active: boolean
  activeSessionId: string
  expanded: boolean
  running: boolean
  queued: number
  runningMap: AppState['running']
  onClick: () => void
  onToggle: () => void
  onSelectSession: (session: Session) => void
  onCreateSession: () => void
}) {
  return (
    <div
      className={'agent-group' + (active ? ' is-active-group' : '')}
      style={{ ['--agent-color' as string]: agent.color }}
    >
      <div className="agent-row">
        <button className={'agent-item' + (active ? ' is-active' : '')} onClick={onClick}>
          <span className="agent-avatar">
            <AvatarContent agent={agent} />
          </span>
          <span className="agent-copy">
            <span className="agent-name">{agent.name}</span>
            <span className="agent-sub">
              {running
                ? queued > 0
                  ? '处理中 · 队列 ' + queued
                  : '处理中…'
                : agent.tagline || agent.model.model}
            </span>
          </span>
        </button>
        <button
          className={'agent-expand' + (expanded ? ' is-open' : '')}
          onClick={onToggle}
          title={expanded ? '收起会话' : '展开会话'}
          aria-label={expanded ? '收起会话' : '展开会话'}
          aria-expanded={expanded}
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </div>

      {expanded ? (
        <div className="session-list">
          {sessions.map((session) => {
            const sessionRunning = runningMap[session.id]?.running ?? false
            return (
              <div
                key={session.id}
                className={
                  'session-item' + (session.id === activeSessionId ? ' is-active' : '')
                }
              >
                <button
                  className="session-main"
                  onClick={() => onSelectSession(session)}
                  title={session.title}
                >
                  {sessionRunning ? (
                    <Spinner size={10} />
                  ) : (
                    <span className="session-dot" />
                  )}
                  <span className="session-title">{session.title}</span>
                  <span className="session-time">{relativeTime(session.updatedAt)}</span>
                </button>
              </div>
            )
          })}
          <button className="session-new" onClick={onCreateSession}>
            <Icon name="plus" size={12} />
            新建会话
          </button>
        </div>
      ) : null}
    </div>
  )
}
