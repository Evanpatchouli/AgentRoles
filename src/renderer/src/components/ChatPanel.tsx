import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Agent, ChatAttachment, ChatMessage, Session } from '@shared/types'
import { MessageItem } from './MessageItem'
import { AttachmentList } from './AttachmentList'
import { Icon } from './Icons'
import { AvatarContent } from './Avatar'
import { Spinner } from './Primitives'
import {
  createAttachment,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES
} from '../lib/attachments'

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
  archived,
  onUnarchive,
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
  archived: boolean
  onUnarchive: () => void
  onSend: (
    sessionId: string,
    content: string,
    attachments?: ChatAttachment[]
  ) => Promise<boolean>
  onStop: (sessionId: string) => Promise<void>
  onProcessMessage: (sessionId: string, messageId: string) => Promise<void>
  onConfigureModel: () => void
  focusMessageId: string | null
  onFocusConsumed: () => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState('')
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const attachToolsRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
    if (!attachMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!attachToolsRef.current?.contains(event.target as Node)) {
        setAttachMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [attachMenuOpen])

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

  async function addFiles(files: File[]): Promise<void> {
    if (running || archived || attachBusy) return
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      setAttachError('最多添加 ' + MAX_ATTACHMENTS + ' 个附件')
      return
    }
    const existingBytes = attachments.reduce((total, item) => total + item.size, 0)
    const incomingBytes = files.reduce((total, file) => total + file.size, 0)
    if (existingBytes + incomingBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      setAttachError('附件总大小不能超过 20MB')
      return
    }
    const selected = files.slice(0, remaining)
    setAttachBusy(true)
    setAttachError('')
    const added: ChatAttachment[] = []
    const errors: string[] = []
    for (const file of selected) {
      try {
        added.push(await createAttachment(file))
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (added.length > 0) {
      setAttachments((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS))
    }
    if (files.length > remaining) {
      errors.push('最多添加 ' + MAX_ATTACHMENTS + ' 个附件')
    }
    if (errors.length > 0) setAttachError(errors[0])
    setAttachBusy(false)
  }

  async function submit(): Promise<void> {
    const text = draft.trim()
    if ((!text && attachments.length === 0) || running || sending || archived || attachBusy) return
    setSending(true)
    stick.current = true
    const ok = await onSend(session.id, text, attachments)
    setSending(false)
    if (ok) {
      setDraft('')
      setAttachments([])
      setAttachError('')
    }
  }

  const onPickFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return
    void addFiles(Array.from(files))
  }

  const onDragEnter = (event: React.DragEvent): void => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }

  const onDragOver = (event: React.DragEvent): void => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: React.DragEvent): void => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const hasKey = Boolean(agent.model.apiKey.trim())
  const isOpenAiCompatible = agent.model.provider !== 'anthropic'

  return (
    <div
      className={'chat' + (dragActive ? ' is-dragging' : '')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
        {archived ? (
          <div className="composer-notice composer-notice-archived">
            <Icon name="archive" size={14} />
            <span>此会话已归档，取消归档后可继续发送消息</span>
            <button onClick={onUnarchive}>取消归档</button>
          </div>
        ) : !hasKey && isOpenAiCompatible ? (
          <div className="composer-notice">
            <Icon name="key" size={14} />
            <span>这个角色还没有配置 API Key</span>
            <button onClick={onConfigureModel}>去配置</button>
          </div>
        ) : null}

        {pendingCount > 0 && !running && !archived ? (
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

        <div
          className={
            'composer' +
            (running ? ' is-running' : '') +
            (archived ? ' is-archived' : '') +
            (attachments.length > 0 ? ' has-attachments' : '')
          }
        >
          {attachments.length > 0 ? (
            <AttachmentList
              attachments={attachments}
              onRemove={(id) => {
                setAttachments((current) => current.filter((item) => item.id !== id))
                setAttachError('')
              }}
              className="composer-attachment-list"
            />
          ) : null}
          {attachError ? <div className="composer-attachment-error">{attachError}</div> : null}
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            placeholder={
              archived
                ? '此会话已归档'
                : running
                  ? '正在处理上一条消息…'
                  : '给 ' + agent.name + ' 发消息，可粘贴图片或拖入文件'
            }
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const clipboard = event.clipboardData
              const files = Array.from(clipboard?.files ?? [])
              if (files.length === 0 && clipboard) {
                for (const item of Array.from(clipboard.items ?? [])) {
                  if (item.kind !== 'file') continue
                  const file = item.getAsFile()
                  if (file) files.push(file)
                }
              }
              if (files.length > 0) void addFiles(files)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={running || archived}
          />
          <div className="composer-actions">
            <div className="composer-tools" ref={attachToolsRef}>
              <button
                type="button"
                className="composer-add"
                onClick={() => setAttachMenuOpen((value) => !value)}
                disabled={running || archived || attachBusy}
                title="添加图片或文件"
                aria-label="添加图片或文件"
                aria-expanded={attachMenuOpen}
              >
                {attachBusy ? <Spinner size={14} /> : <Icon name="plus" size={17} />}
              </button>
              {attachMenuOpen ? (
                <div className="attach-menu" role="menu" aria-label="添加附件">
                  <button
                    type="button"
                    role="menuitem"
                    className="attach-menu-item"
                    title="图片（需要模型支持视觉）"
                    onClick={() => {
                      setAttachMenuOpen(false)
                      imageInputRef.current?.click()
                    }}
                  >
                    <span className="attach-menu-icon">
                      <Icon name="image" size={15} />
                    </span>
                    <span>图片</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="attach-menu-item"
                    title="文件（文本文件会读取内容）"
                    onClick={() => {
                      setAttachMenuOpen(false)
                      fileInputRef.current?.click()
                    }}
                  >
                    <span className="attach-menu-icon">
                      <Icon name="file" size={15} />
                    </span>
                    <span>文件</span>
                  </button>
                  <div className="attach-menu-note">图片需视觉模型</div>
                </div>
              ) : null}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                data-attachment-input="image"
                onChange={(event) => {
                  onPickFiles(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                data-attachment-input="file"
                onChange={(event) => {
                  onPickFiles(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
            </div>
            <span className="composer-hint">
              {draft.length > 0
                ? draft.length + ' 字'
                : attachments.length > 0
                  ? attachments.length + ' 个附件'
                  : '本地运行 · 数据保存在本机'}
            </span>
            {running ? (
              <button className="send-btn is-stop" onClick={() => void onStop(session.id)} title="停止">
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={() => void submit()}
                disabled={
                  (!draft.trim() && attachments.length === 0) ||
                  sending ||
                  archived ||
                  attachBusy
                }
                title="发送"
              >
                <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {dragActive ? (
        <div className="chat-drop-overlay">
          <span className="chat-drop-icon">
            <Icon name="image" size={26} />
          </span>
          <strong>松开以添加图片或文件</strong>
          <span>支持粘贴截图，最多 {MAX_ATTACHMENTS} 个附件</span>
        </div>
      ) : null}
    </div>
  )
}
