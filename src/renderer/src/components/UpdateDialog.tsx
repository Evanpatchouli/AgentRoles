import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateInfo } from '@shared/types'
import { Icon } from './Icons'

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

export function UpdateDialog({
  open,
  info,
  onClose,
  onDownload
}: {
  open: boolean
  info: UpdateInfo | null
  onClose: () => void
  onDownload: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !info) return null

  return createPortal(
    <div className="modal-backdrop update-backdrop" role="presentation" onClick={onClose}>
      <div
        className="about-card update-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="about-close icon-btn" onClick={onClose} aria-label="关闭更新窗口">
          <Icon name="x" size={16} />
        </button>

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

        {info.notes ? <p className="update-notes">{info.notes}</p> : null}

        <div className="about-actions update-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            稍后再说
          </button>
          <button className="btn btn-primary" onClick={onDownload}>
            <Icon name="external" size={14} />
            前往下载
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
