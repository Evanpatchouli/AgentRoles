import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Agent, ChatAttachment, ChatMessage, Session, SkillMeta, AppSettings } from '@shared/types'
import { Icon } from './Icons'
import { AvatarContent } from './Avatar'
import { Spinner } from './Primitives'
import { PROVIDER_LABEL } from '../lib/format'
import { ChatPanel } from './ChatPanel'
import { RolePanel } from './RolePanel'
import { ModelPanel } from './ModelPanel'
import { SkillsPanel } from './SkillsPanel'
import { MemoryPanel } from './MemoryPanel'

export type AgentTab = 'chat' | 'skills' | 'memory' | 'role' | 'model'

const TAB_INDICATOR_INSET = 12

const TABS: Array<{ id: AgentTab; label: string; icon: string }> = [
  { id: 'chat', label: '会话', icon: 'message' },
  { id: 'skills', label: '技能', icon: 'sparkle' },
  { id: 'memory', label: '记忆', icon: 'memory' },
  { id: 'role', label: '角色', icon: 'users' },
  { id: 'model', label: '模型', icon: 'sliders' }
]

export function AgentView({
  agent,
  session,
  running,
  messages,
  skills,
  settings,
  tab,
  onTabChange,
  onSaveAgent,
  onDeleteAgent,
  onNewSession,
  onUnarchive,
  onSend,
  onProcessMessage,
  onStop,
  notify,
  focusMessageId,
  onFocusConsumed,
  onImportSkillFolder,
  onImportSkillUrl,
  onRemoveSkill,
  onRevealSkill
}: {
  agent: Agent
  session: Session
  running: { running: boolean; queued: number }
  messages: ChatMessage[]
  skills: SkillMeta[]
  settings: AppSettings
  tab: AgentTab
  onTabChange: (tab: AgentTab) => void
  onSaveAgent: (agent: Agent) => Promise<Agent | null>
  onDeleteAgent: (agent: Agent) => void
  onNewSession: () => void
  onUnarchive: () => void
  onSend: (sessionId: string, content: string, attachments?: ChatAttachment[]) => Promise<boolean>
  onProcessMessage: (sessionId: string, messageId: string) => Promise<void>
  onStop: (sessionId: string) => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', text: string) => void
  focusMessageId: string | null
  onFocusConsumed: () => void
  onImportSkillFolder: () => Promise<boolean>
  onImportSkillUrl: (url: string) => Promise<boolean>
  onRemoveSkill: (skill: SkillMeta) => void
  onRevealSkill: (skill: SkillMeta) => void
}) {
  const enabledSkills = skills.filter((skill) => agent.skills[skill.id]?.enabled).length
  const tabsRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{
    left: number
    right: number
    direction: 'left' | 'right'
  } | null>(null)

  // 选中指示条需要一个绝对定位元素在页签之间滑动，位置跟随激活页签的实测几何。
  useLayoutEffect(() => {
    const container = tabsRef.current
    if (!container) return
    const measure = (): void => {
      const active = container.querySelector<HTMLElement>('.tab[aria-selected="true"]')
      if (!active) return
      const containerRect = container.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      const left = activeRect.left - containerRect.left + TAB_INDICATOR_INSET
      const right = containerRect.right - activeRect.right + TAB_INDICATOR_INSET
      setIndicator((current) => ({
        left,
        right,
        // 先让目标侧边缘吸附到位，另一侧滞后跟随，形成橡皮筋拉伸
        direction: !current || left >= current.left ? 'right' : 'left'
      }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    container.querySelectorAll('.tab').forEach((button) => observer.observe(button))
    return () => observer.disconnect()
  }, [tab, enabledSkills])
  const pendingExternal = messages.filter(
    (message) =>
      message.role === 'user' &&
      message.source &&
      message.source !== 'app' &&
      message.state === 'pending'
  )

  return (
    <div className="agent-view" style={{ ['--agent-color' as string]: agent.color } as CSSProperties}>
      <div className="agent-glow" aria-hidden="true" />
      <header className="agent-header">
        <div className="agent-identity">
          <div className="agent-orb">
            <AvatarContent agent={agent} />
          </div>
          <div className="agent-titles">
            <div className="agent-name-row">
              <h1>{agent.name}</h1>
              {running.running ? (
                <span className="live-pill">
                  <Spinner size={11} />
                  处理中{running.queued > 0 ? ' · 队列 ' + running.queued : ''}
                </span>
              ) : null}
            </div>
            <p className="agent-tagline">{agent.tagline || '还没有一句话职责描述'}</p>
            <div className="agent-chips">
              <span className="chip">
                {PROVIDER_LABEL[agent.model.provider] ?? agent.model.provider} · {agent.model.model}
              </span>
              <span className="chip">{enabledSkills} 个技能</span>
              {agent.autoRun ? <span className="chip chip-soft">自动接单</span> : null}
            </div>
          </div>
        </div>
        <div className="agent-actions">
          {session.archived ? (
            <span className="session-archived-badge">
              <Icon name="archive" size={11} />
              已归档
            </span>
          ) : null}
          <span className="session-chip" title={session.title}>
            <Icon name="message" size={12} />
            {session.title}
          </span>
          <button className="btn btn-ghost" onClick={onNewSession} title="新建会话">
            <Icon name="plus" size={15} />
            新会话
          </button>
        </div>
      </header>

      <div className="tabs-row">
        <div className="tabs" role="tablist" ref={tabsRef}>
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={'tab' + (tab === item.id ? ' is-active' : '')}
              onClick={() => onTabChange(item.id)}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
              {item.id === 'skills' ? <span className="tab-count">{enabledSkills}</span> : null}
            </button>
          ))}
          {indicator ? (
            <span
              className="tab-indicator"
              aria-hidden="true"
              data-direction={indicator.direction}
              style={{ left: indicator.left, right: indicator.right }}
            />
          ) : null}
        </div>
        {running.running ? (
          <button className="btn btn-ghost btn-sm" onClick={() => void onStop(session.id)}>
            <Icon name="stop" size={13} />
            停止
          </button>
        ) : null}
      </div>

      <div className={'agent-body tab-' + tab}>
        {tab === 'chat' ? (
          <ChatPanel
            key={session.id}
            agent={agent}
            session={session}
            messages={messages}
            running={running.running}
            pendingCount={pendingExternal.length}
            archived={Boolean(session.archived)}
            onUnarchive={onUnarchive}
            onSend={onSend}
            onStop={onStop}
            onProcessMessage={onProcessMessage}
            onConfigureModel={() => onTabChange('model')}
            focusMessageId={focusMessageId}
            onFocusConsumed={onFocusConsumed}
          />
        ) : null}

        {tab === 'role' ? (
          <RolePanel
            agent={agent}
            onSave={onSaveAgent}
            onDelete={onDeleteAgent}
            notify={notify}
          />
        ) : null}

        {tab === 'model' ? (
          <ModelPanel agent={agent} onSave={onSaveAgent} notify={notify} />
        ) : null}

        {tab === 'skills' ? (
          <SkillsPanel
            agent={agent}
            skills={skills}
            settings={settings}
            onSave={onSaveAgent}
            notify={notify}
            onImportFolder={onImportSkillFolder}
            onImportUrl={onImportSkillUrl}
            onRemoveSkill={onRemoveSkill}
            onRevealSkill={onRevealSkill}
          />
        ) : null}

        {tab === 'memory' ? <MemoryPanel agent={agent} notify={notify} /> : null}
      </div>
    </div>
  )
}
