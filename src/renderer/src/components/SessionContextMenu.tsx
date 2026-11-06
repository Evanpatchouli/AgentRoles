import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import { Icon } from './Icons'

export interface SessionMenuAnchor {
  session: Session
  x: number
  y: number
}

export function SessionContextMenu({
  anchor,
  onClose,
  onRename,
  onTogglePin,
  onToggleArchive
}: {
  anchor: SessionMenuAnchor
  onClose: () => void
  onRename: (session: Session) => void
  onTogglePin: (session: Session) => void
  onToggleArchive: (session: Session) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y, ready: false })
  const { session } = anchor

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    // 使用未受入场动画缩放影响的布局尺寸，保证翻转后左下角精确贴住右键位置。
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const margin = 8

    // 默认左上角贴住右键位置；下方空间不足时，改为左下角贴住右键位置。
    let left = anchor.x
    let top = anchor.y
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin)
    }
    if (top + height > window.innerHeight - margin) {
      top = anchor.y - height
    }
    if (top < margin) top = margin

    setPosition({ left, top, ready: true })
  }, [anchor.x, anchor.y, anchor.session.id, session.archived, session.pinned])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const closeOnScroll = (): void => onClose()

    document.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', closeOnScroll)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', closeOnScroll)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="session-menu"
      role="menu"
      aria-label="会话操作"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        className="session-menu-item"
        role="menuitem"
        autoFocus
        onClick={() => {
          onClose()
          onRename(session)
        }}
      >
        <span className="session-menu-icon">
          <Icon name="edit" size={14} />
        </span>
        <span className="session-menu-label">重命名</span>
      </button>

      <button
        className="session-menu-item"
        role="menuitem"
        onClick={() => {
          onClose()
          onTogglePin(session)
        }}
      >
        <span className="session-menu-icon">
          <Icon name={session.pinned ? 'pinOff' : 'pin'} size={14} />
        </span>
        <span className="session-menu-label">
          {session.pinned ? '取消置顶' : '置顶'}
        </span>
      </button>

      <button
        className="session-menu-item"
        role="menuitem"
        onClick={() => {
          onClose()
          onToggleArchive(session)
        }}
      >
        <span className="session-menu-icon">
          <Icon name={session.archived ? 'archiveRestore' : 'archive'} size={14} />
        </span>
        <span className="session-menu-label">
          {session.archived ? '取消归档' : '归档'}
        </span>
      </button>
    </div>,
    document.body
  )
}
