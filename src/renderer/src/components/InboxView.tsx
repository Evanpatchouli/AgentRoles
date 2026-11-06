import { useMemo, useState } from 'react'
import type { Agent, ChatMessage } from '@shared/types'
import { Icon } from './Icons'
import { AvatarContent } from './Avatar'
import { Spinner } from './Primitives'
import { sourceLabel, timeLabel, truncate } from '../lib/format'

type Filter = 'all' | 'pending' | 'done' | 'error'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待处理' },
  { id: 'done', label: '已处理' },
  { id: 'error', label: '失败' }
]

export function InboxView({
  inbox,
  agents,
  onOpenMessage,
  onRefresh
}: {
  inbox: ChatMessage[]
  agents: Agent[]
  onOpenMessage: (message: ChatMessage) => void
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  const filtered = inbox.filter((message) => {
    if (filter === 'all') return true
    if (filter === 'pending') return message.state === 'pending' || message.state === 'running'
    return message.state === filter
  })

  const count = (id: Filter): number => {
    if (id === 'all') return inbox.length
    if (id === 'pending') {
      return inbox.filter((message) => message.state === 'pending' || message.state === 'running')
        .length
    }
    return inbox.filter((message) => message.state === id).length
  }

  return (
    <div className="inbox-view">
      <header className="page-head">
        <div>
          <h1>收件箱</h1>
          <p>来自 Codex、Claude Code、DSH 或任意 HTTP 客户端的外部消息，会汇聚到这里。</p>
        </div>
        <button className="btn btn-ghost" onClick={onRefresh}>
          <Icon name="refresh" size={15} />
          刷新
        </button>
      </header>

      <div className="inbox-toolbar">
        <div className="segmented">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={'segmented-item' + (filter === item.id ? ' is-active' : '')}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="segmented-count">{count(item.id)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="inbox-scroll">
        {filtered.length === 0 ? (
          <div className="inbox-empty">
            <div className="inbox-empty-icon">
              <Icon name="inbox" size={26} />
            </div>
            <h3>{inbox.length === 0 ? '还没有外部消息' : '这个筛选下没有消息'}</h3>
            <p>
              在 Codex / Claude Code / DSH 里通过 MCP 或 CLI 向某个角色发消息，记录会出现在这里。
            </p>
          </div>
        ) : (
          <div className="inbox-list">
            {filtered.map((message) => {
              const agent = agentMap.get(message.agentId)
              return (
                <button
                  key={message.id}
                  className={'inbox-row is-' + message.state}
                  onClick={() => onOpenMessage(message)}
                >
                  <span
                    className="inbox-avatar"
                    style={{
                      ['--agent-color' as string]: agent?.color ?? '#c9f36b',
                      borderColor: (agent?.color ?? '#c9f36b') + '55'
                    }}
                  >
                    {agent ? <AvatarContent agent={agent} /> : '✦'}
                  </span>
                  <span className="inbox-main">
                    <span className="inbox-line">
                      <span className="inbox-agent">{agent?.name ?? '未知角色'}</span>
                      <span className="source-pill">
                        <span className="source-dot" />
                        {sourceLabel(message.source)}
                      </span>
                      <span className="inbox-time">{timeLabel(message.createdAt)}</span>
                    </span>
                    {message.meta?.title ? (
                      <span className="inbox-title">{String(message.meta.title)}</span>
                    ) : null}
                    <span className="inbox-preview">{truncate(message.content, 160)}</span>
                  </span>
                  <span className={'inbox-state state-' + message.state}>
                    {message.state === 'pending' ? (
                      '待处理'
                    ) : message.state === 'running' ? (
                      <>
                        <Spinner size={10} /> 处理中
                      </>
                    ) : message.state === 'error' ? (
                      '失败'
                    ) : (
                      '已处理'
                    )}
                  </span>
                  <Icon name="chevronRight" size={15} className="inbox-arrow" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
