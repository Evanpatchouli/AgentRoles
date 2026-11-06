import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReleaseNote, WhatsNewData } from '@shared/types'
import { compareVersions } from '@shared/version'
import { Icon } from './Icons'
import { Spinner } from './Primitives'
import { Markdown } from './Markdown'

function versionLabel(value: string): string {
  return /^v/i.test(value) ? value : 'v' + value
}

function formatDate(value: string): string {
  if (!value) return '日期未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

const SOURCE_LABEL: Record<WhatsNewData['source'], string> = {
  github: 'GitHub 最新数据',
  cache: '本地缓存',
  bundled: '内置版本说明'
}

export function WhatsNewDialog({
  open,
  data,
  loading,
  error,
  onClose,
  onRefresh,
  onCheckUpdate
}: {
  open: boolean
  data: WhatsNewData | null
  loading: boolean
  error: string
  onClose: () => void
  onRefresh: () => void
  onCheckUpdate: () => void
}) {
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!open) return
    setShowAll(false)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const releases = data?.releases ?? []
  const visible = showAll ? releases : releases.slice(0, 5)
  const hasNewer = releases.some(
    (release) => data && compareVersions(release.version, data.currentVersion) > 0
  )

  const renderRelease = (release: ReleaseNote) => {
    const isCurrent = data
      ? compareVersions(release.version, data.currentVersion) === 0
      : false
    const isNewer = data
      ? compareVersions(release.version, data.currentVersion) > 0
      : false
    return (
      <article className="whats-new-release" key={release.version}>
        <div className="whats-new-release-head">
          <div className="whats-new-version-row">
            <span className="whats-new-version">{versionLabel(release.version)}</span>
            {isNewer ? <span className="whats-new-badge is-new">新版本</span> : null}
            {isCurrent ? <span className="whats-new-badge">当前版本</span> : null}
            <span className="whats-new-date">{formatDate(release.publishedAt)}</span>
          </div>
          <h3>{release.name || versionLabel(release.version)}</h3>
        </div>
        {release.body ? (
          <div className="whats-new-markdown">
            <Markdown content={release.body} />
          </div>
        ) : null}
        <button
          className="whats-new-source-link"
          onClick={() => void window.api.openExternal(release.htmlUrl)}
        >
          <Icon name="external" size={12} />
          在 GitHub 查看
        </button>
      </article>
    )
  }

  return createPortal(
    <div className="modal-backdrop whats-new-backdrop" role="presentation" onClick={onClose}>
      <div
        className="about-card whats-new-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="about-close icon-btn" onClick={onClose} aria-label="关闭新功能窗口">
          <Icon name="x" size={16} />
        </button>

        <header className="whats-new-head">
          <div className="whats-new-heading">
            <span className="whats-new-mark">
              <Icon name="sparkle" size={22} />
            </span>
            <div>
              <span className="whats-new-eyebrow">新功能与更新记录</span>
              <h2 id="whats-new-title">版本更新</h2>
              {data ? (
                <p>
                  当前版本 {versionLabel(data.currentVersion)} · {SOURCE_LABEL[data.source]}
                </p>
              ) : null}
            </div>
          </div>
          <button
            className="icon-btn whats-new-refresh"
            onClick={onRefresh}
            disabled={loading}
            title="刷新版本记录"
            aria-label="刷新版本记录"
          >
            {loading ? <Spinner size={14} /> : <Icon name="refresh" size={15} />}
          </button>
        </header>

        <div className="whats-new-scroll">
          {loading && !data ? (
            <div className="whats-new-loading">
              <Spinner size={18} />
              正在读取版本记录…
            </div>
          ) : null}
          {error ? <div className="whats-new-error">{error}</div> : null}
          {!loading && !error && releases.length === 0 ? (
            <div className="whats-new-empty">还没有可展示的版本记录。</div>
          ) : null}
          {visible.map(renderRelease)}
          {releases.length > 5 ? (
            <button className="whats-new-more" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '收起更早版本' : '查看更早版本（' + (releases.length - 5) + '）'}
            </button>
          ) : null}
        </div>

        <footer className="whats-new-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
          {hasNewer ? (
            <button className="btn btn-primary" onClick={onCheckUpdate}>
              <Icon name="refresh" size={14} />
              查看更新
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body
  )
}
