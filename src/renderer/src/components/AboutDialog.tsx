import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { APP_INTRO } from '@shared/types'
import { Icon, LogoMark } from './Icons'

export function AboutDialog({
  open,
  version,
  releaseDate,
  onClose
}: {
  open: boolean
  version: string
  releaseDate: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop about-backdrop" role="presentation" onClick={onClose}>
      <div
        className="about-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="about-close icon-btn" onClick={onClose} aria-label="关闭关于窗口">
          <Icon name="x" size={16} />
        </button>

        <div className="about-hero">
          <span className="about-mark">
            <LogoMark size={40} />
          </span>
          <div>
            <h2 id="about-title">AgentRoles</h2>
            <p>多角色 Agent 桌面工作台</p>
          </div>
        </div>

        <div className="about-meta">
          <div>
            <span>项目名称</span>
            <strong>AgentRoles</strong>
          </div>
          <div>
            <span>最新发布时间</span>
            <strong>{releaseDate}</strong>
          </div>
          <div>
            <span>当前版本号</span>
            <strong>v{version}</strong>
          </div>
        </div>

        <p className="about-intro">{APP_INTRO}</p>

        <div className="about-actions">
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
