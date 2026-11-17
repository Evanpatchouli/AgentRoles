import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateInfo, UpdateInstallProgress } from '@shared/types'
import { Icon } from './Icons'
import { Markdown } from './Markdown'

function versionLabel(value: string): string {
  return /^v/i.test(value) ? value : 'v' + value
}

function formatPublishedAt(value: string): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return Math.round(value) + ' B'
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return size.toFixed(size >= 10 ? 0 : 1) + ' ' + units[unit]
}

function progressSummary(progress: UpdateInstallProgress): string {
  const received = formatBytes(progress.received) || '0 B'
  const total = formatBytes(progress.total)
  return total ? received + ' / ' + total : received
}

export function UpdateDialog({
  open,
  info,
  progress,
  error,
  onClose,
  onInstall,
  onCancel
}: {
  open: boolean
  info: UpdateInfo | null
  progress: UpdateInstallProgress | null
  error: string
  onClose: () => void
  onInstall: () => void
  onCancel: () => void
}) {
  const busy = progress !== null
  const closable = !busy

  useEffect(() => {
    if (!open || !closable) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closable, onClose])

  if (!open || !info) return null

  const phase = progress?.phase

  return createPortal(
    <div
      className="modal-backdrop update-backdrop"
      role="presentation"
      onClick={() => {
        if (closable) onClose()
      }}
    >
      <div
        className="about-card update-card"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="update-title"
        onClick={(event) => event.stopPropagation()}
      >
        {closable ? (
          <button className="about-close icon-btn" onClick={onClose} aria-label="关闭更新窗口">
            <Icon name="x" size={16} />
          </button>
        ) : null}

        <div className="update-head">
          <span className="update-mark">
            <Icon name="sparkle" size={23} />
          </span>
          <div>
            <span className="update-eyebrow">发现新版本</span>
            <h2 id="update-title">AgentRoles 可以更新</h2>
            {info.releaseName ? <p>{info.releaseName}</p> : null}
          </div>
        </div>

        <div className="about-meta update-meta">
          <div>
            <span>当前版本</span>
            <strong>{versionLabel(info.currentVersion)}</strong>
          </div>
          <div>
            <span>最新版本</span>
            <strong className="update-latest">{versionLabel(info.latestVersion)}</strong>
          </div>
          <div>
            <span>发布时间</span>
            <strong>{formatPublishedAt(info.publishedAt)}</strong>
          </div>
        </div>

        {info.notes && !busy ? (
          <div className="update-notes">
            <Markdown content={info.notes} />
          </div>
        ) : null}

        {phase === 'downloading' && progress ? (
          <div className="update-progress" role="status" aria-live="polite">
            <div className="update-progress-head">
              <span>正在下载更新…</span>
              <span>{progress.percent === undefined ? '' : progress.percent + '%'}</span>
            </div>
            <div className="update-progress-track">
              <span
                className="update-progress-bar"
                style={{ width: (progress.percent ?? 8) + '%' }}
              />
            </div>
            <p className="update-progress-hint">{progressSummary(progress)}</p>
          </div>
        ) : null}

        {phase === 'verifying' ? (
          <p className="update-status" role="status" aria-live="polite">
            正在校验安装包（SHA-256），校验通过后会自动安装…
          </p>
        ) : null}

        {phase === 'installing' ? (
          <p className="update-status" role="status" aria-live="polite">
            正在安装更新，应用即将自动重启…
          </p>
        ) : null}

        {error && !busy ? (
          <p className="update-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="about-actions update-actions">
          {phase === 'downloading' ? (
            <button className="btn btn-ghost" onClick={onCancel}>
              取消下载
            </button>
          ) : null}
          {!busy ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                稍后再说
              </button>
              <button className="btn btn-primary" onClick={onInstall}>
                <Icon name="refresh" size={14} />
                {error ? '重试' : '立即更新'}
              </button>
            </>
          ) : null}
        </div>

        {!busy && !error ? (
          <p className="update-hint">下载完成后会自动校验安装包并安装，安装期间应用会重启。</p>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
