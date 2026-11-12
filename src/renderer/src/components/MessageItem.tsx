import { useEffect, useState } from 'react'
import type { Agent, ChatMessage, ToolCall } from '@shared/types'
import { Icon } from './Icons'
import { Markdown } from './Markdown'
import { Spinner } from './Primitives'
import { AvatarContent } from './Avatar'
import { AttachmentList } from './AttachmentList'
import { prettyToolName, sourceLabel, timeLabel, toolIcon } from '../lib/format'

export function MessageItem({
  message,
  agent,
  highlight,
  onProcess
}: {
  message: ChatMessage
  agent: Agent
  highlight: boolean
  onProcess: (messageId: string) => void
}) {
  if (message.role === 'user') {
    const external = Boolean(message.source && message.source !== 'app')
    return (
      <div
        id={'msg-' + message.id}
        className={
          'msg msg-user' +
          (external ? ' is-external' : '') +
          (highlight ? ' is-focused' : '')
        }
      >
        <div className="user-message-wrap">
          {external ? (
            <div className="external-head">
              <span className="source-pill">
                <span className="source-dot" />
                {sourceLabel(message.source)}
                {message.meta?.sender ? ' · ' + String(message.meta.sender) : ''}
              </span>
              <span className="msg-time">{timeLabel(message.createdAt)}</span>
            </div>
          ) : null}
          {message.meta?.title ? (
            <div className="external-title">{String(message.meta.title)}</div>
          ) : null}
          {message.attachments?.length ? (
            <AttachmentList
              attachments={message.attachments}
              className="message-attachment-list"
            />
          ) : null}
          {message.content ? <div className="user-bubble">{message.content}</div> : null}
          {external ? (
            <div className="external-foot">
              <span className={'state-pill state-' + message.state}>
                {message.state === 'pending' ? (
                  '待处理'
                ) : message.state === 'running' ? (
                  <>
                    <Spinner size={10} /> 处理中
                  </>
                ) : message.state === 'error' ? (
                  '处理失败'
                ) : (
                  '已记录'
                )}
              </span>
              {message.state === 'pending' ? (
                <button className="link-btn" onClick={() => onProcess(message.id)}>
                  立即处理
                </button>
              ) : null}
              {message.state === 'error' ? (
                <button className="link-btn" onClick={() => onProcess(message.id)}>
                  重试
                </button>
              ) : null}
              <span className="external-foot-spacer" />
              {message.content ? (
                <span className="msg-copy">
                  <CopyMessage text={message.content} />
                </span>
              ) : null}
            </div>
          ) : (
            <div className="user-meta">
              {message.content ? (
                <span className="msg-copy">
                  <CopyMessage text={message.content} />
                </span>
              ) : null}
              <span>{timeLabel(message.createdAt)}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const streaming = message.state === 'running'
  const empty = !message.content.trim()

  return (
    <div
      id={'msg-' + message.id}
      className={
        'msg msg-assistant' +
        (message.state === 'error' ? ' is-error' : '') +
        (highlight ? ' is-focused' : '')
      }
    >
      <div className="assistant-avatar" style={{ borderColor: agent.color + '55' }}>
        <AvatarContent agent={agent} />
      </div>
      <div className="assistant-content">
        <div className="assistant-head">
          <span className="assistant-name">{agent.name}</span>
          <span className="msg-time">{timeLabel(message.createdAt)}</span>
          {message.state === 'error' ? <span className="error-pill">异常</span> : null}
        </div>

        {message.reasoning ? (
          <details className="reasoning">
            <summary>思考过程</summary>
            <pre>{message.reasoning}</pre>
          </details>
        ) : null}

        {empty && streaming ? (
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
        ) : empty ? null : (
          <Markdown content={message.content} />
        )}

        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="tool-list">
            {message.toolCalls.map((call) => (
              <ToolCard key={call.id} call={call} />
            ))}
          </div>
        ) : null}

        {message.content && !streaming ? (
          <div className="assistant-actions">
            <CopyMessage text={message.content} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="link-btn subtle"
      onClick={async () => {
        await window.api.copyText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function ToolCard({ call }: { call: ToolCall }) {
  const running = call.result === undefined
  const failed = call.result !== undefined && call.ok === false
  const [open, setOpen] = useState(failed)

  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  const duration =
    call.endedAt && call.startedAt ? ((call.endedAt - call.startedAt) / 1000).toFixed(1) + 's' : ''

  return (
    <div className={'tool-card' + (running ? ' is-running' : failed ? ' is-failed' : ' is-ok')}>
      <button className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-icon">{toolIcon(call.name)}</span>
        <span className="tool-title">{prettyToolName(call.name)}</span>
        <code className="tool-code">{call.name}</code>
        <span className="tool-status">
          {running ? <Spinner size={11} /> : duration}
          {failed ? <span className="tool-failed-dot" /> : null}
        </span>
        <Icon
          name="chevronDown"
          size={14}
          className={'tool-chevron' + (open ? ' is-open' : '')}
        />
      </button>
      {open ? (
        <div className="tool-body">
          <div className="tool-section">
            <span className="tool-label">参数</span>
            <pre>{JSON.stringify(call.args ?? {}, null, 2)}</pre>
          </div>
          {call.result !== undefined ? (
            <div className="tool-section">
              <span className="tool-label">{failed ? '错误' : '结果'}</span>
              <pre className={'tool-result' + (failed ? ' is-error' : '')}>
                {call.result || '（空）'}
              </pre>
            </div>
          ) : (
            <div className="tool-running-note">
              <Spinner size={12} /> 正在执行…
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
