import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Agent, ChatMessage, Session } from '@shared/types'
import { MessageItem } from './MessageItem'
import { Icon } from './Icons'
import { AvatarContent } from './Avatar'

const SUGGESTIONS_DEFAULT = [
  '你好，先介绍一下你负责什么',
  '帮我梳理一下今天最该推进的三件事'
]

export function ChatPanel({
  agent,
  session,
  messages,
  running,
  pendingCount,
  onSend,
  onStop,
  onProcessMessage,
  onConfigureModel,
  focusMessageId,
  onFocusConsumed
}: {
  agent: Agent
  session: Session
  messages: ChatMessage[]
  running: boolean
  pendingCount: number
  onSend: (sessionId: string, content: string) => Promise<boolean>
  onStop: (sessionId: string) => Promise<void>
  onProcessMessage: (sessionId: string, messageId: string) => Promise<void>
  onConfigureModel: () => void
  focusMessageId: string | null
  onFocusConsumed: () => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const suggestions =
    agent.skills.notion?.enabled
      ? ['记录一条新需求：支持导出周报', '把「登录页改版」标记为进行中', '查一下当前未完成的任务']
      : SUGGESTIONS_DEFAULT

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  const lastUserId = messages.reduce(
    (current, message) => (message.role === 'user' ? message.id : current),
    ''
  )
  const lastUserRef = useRef('')

  useEffect(() => {
    if (lastUserId && lastUserId !== lastUserRef.current) {
      lastUserRef.current = lastUserId
      stick.current = true
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
      return
    }
    if (stick.current) {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }
  }, [messages, running, lastUserId])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(180, textarea.scrollHeight) + 'px'
  }, [draft])

  useEffect(() => {
    if (!focusMessageId) return
    const element = document.getElementById('msg-' + focusMessageId)
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlightId(focusMessageId)
      const timer = window.setTimeout(() => {
        setHighlightId(null)
        onFocusConsumed()
      }, 2600)
      return () => window.clearTimeout(timer)
    }
    onFocusConsumed()
  }, [focusMessageId, messages.length, onFocusConsumed])

  async function submit(): Promise<void> {
    const text = draft.trim()
    if (!text || running || sending) return
    setSending(true)
    stick.current = true
    const ok = await onSend(session.id, text)
    setSending(false)
    if (ok) setDraft('')
  }

  const hasKey = Boolean(agent.model.apiKey.trim())
  const isOpenAiCompatible = agent.model.provider !== 'anthropic'

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current
          if (!element) return
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 140
        }}
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="empty-orb">
              <AvatarContent agent={agent} />
            </div>
            <h2>我是{agent.name}</h2>
            <p className="empty-tagline">{agent.tagline || '随时可以把任务交给我。'}</p>
            <div className="empty-skills">
              {Object.entries(agent.skills)
                .filter(([, state]) => state.enabled)
                .slice(0, 4)
                .map(([id]) => (
                  <span className="empty-skill" key={id}>
                    {id === 'notion'
                      ? 'Notion 任务库'
                      : id === 'memory'
                        ? '长期记忆'
                        : id === 'filesystem'
                          ? '本地文件'
                          : id === 'http'
                            ? '网络请求'
                            : id === 'shell'
                              ? '终端命令'
                              : id}
                  </span>
                ))}
              {Object.values(agent.skills).filter((state) => state.enabled).length === 0 ? (
                <span className="empty-skill is-muted">暂未启用技能</span>
              ) : null}
            </div>
            <div className="suggestion-grid">
              {suggestions.map((item) => (
                <button
                  key={item}
                  className="suggestion"
                  onClick={() => {
                    setDraft(item)
                    textareaRef.current?.focus()
                  }}
                >
                  <Icon name="arrowRight" size={14} />
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              agent={agent}
              highlight={highlightId === message.id}
              onProcess={(messageId) => void onProcessMessage(session.id, messageId)}
            />
          ))
        )}
        <div ref={bottomRef} className="chat-bottom-anchor" />
      </div>

      <div className="composer-wrap">
        {!hasKey && isOpenAiCompatible ? (
          <div className="composer-notice">
            <Icon name="key" size={14} />
            <span>这个角色还没有配置 API Key</span>
            <button onClick={onConfigureModel}>去配置</button>
          </div>
        ) : null}

        {pendingCount > 0 && !running ? (
          <div className="pending-banner">
            <span className="pending-dot" />
            <span>有 {pendingCount} 条外部消息待处理</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const pending = messages.filter(
                  (message) =>
                    message.role === 'user' &&
                    message.source &&
                    message.source !== 'app' &&
                    message.state === 'pending'
                )
                for (const message of pending) {
                  await onProcessMessage(session.id, message.id)
                }
              }}
            >
              让 Agent 处理
            </button>
          </div>
        ) : null}

        <div className={'composer' + (running ? ' is-running' : '')}>
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            placeholder={
              running
                ? '正在处理上一条消息…'
                : '给 ' + agent.name + ' 发消息，Enter 发送，Shift + Enter 换行'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={running}
          />
          <div className="composer-actions">
            <span className="composer-hint">{draft.length > 0 ? draft.length + ' 字' : '本地运行 · 数据保存在本机'}</span>
            {running ? (
              <button className="send-btn is-stop" onClick={() => void onStop(session.id)} title="停止">
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={() => void submit()}
                disabled={!draft.trim() || sending}
                title="发送"
              >
                <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
