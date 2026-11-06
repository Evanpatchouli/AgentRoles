import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'

type Submenu = 'view' | 'help' | null

export function TitleBarMenu({
  onNewWindow,
  onCloseWindow,
  onZoom,
  onToggleFullscreen,
  onFeedback,
  onWhatsNew,
  onCheckUpdate,
  onAbout
}: {
  onNewWindow: () => void
  onCloseWindow: () => void
  onZoom: (direction: 'in' | 'out') => void
  onToggleFullscreen: () => void
  onFeedback: () => void
  onWhatsNew: () => void
  onCheckUpdate: () => void
  onAbout: () => void
}) {
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return
    const anchor = buttonRef.current.getBoundingClientRect()
    const width = menuRef.current.offsetWidth
    const height = menuRef.current.offsetHeight
    const margin = 8
    let left = anchor.left
    let top = anchor.bottom + 6
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin)
    }
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - height - 6)
    }
    setPosition({ left, top, ready: true })
  }, [open, submenu])

  useEffect(() => {
    if (!open) return
    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setSubmenu(null)
      }
    }
    const closeOnKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        setSubmenu(null)
      }
    }
    const close = (): void => {
      setOpen(false)
      setSubmenu(null)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const close = (): void => {
    setOpen(false)
    setSubmenu(null)
  }

  return (
    <div className="topbar-more-wrap" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={'topbar-more' + (open ? ' is-open' : '')}
        title="更多"
        aria-label="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          setSubmenu(null)
        }}
      >
        <Icon name="more" size={18} />
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="titlebar-menu"
              role="menu"
              aria-label="应用菜单"
              style={{
                left: position.left,
                top: position.top,
                visibility: position.ready ? 'visible' : 'hidden'
              }}
              onMouseLeave={() => setSubmenu(null)}
            >
              <button
                className="titlebar-menu-item"
                role="menuitem"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  close()
                  onNewWindow()
                }}
              >
                <span className="titlebar-menu-icon">
                  <Icon name="plus" size={15} />
                </span>
                <span className="titlebar-menu-label">新窗口</span>
              </button>

              <div
                className="titlebar-menu-group"
                onMouseEnter={() => setSubmenu('view')}
              >
                <button
                  className={
                    'titlebar-menu-item has-submenu' +
                    (submenu === 'view' ? ' is-open' : '')
                  }
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={submenu === 'view'}
                  onFocus={() => setSubmenu('view')}
                  onClick={() => setSubmenu('view')}
                >
                  <span className="titlebar-menu-icon">
                    <Icon name="monitor" size={15} />
                  </span>
                  <span className="titlebar-menu-label">视图</span>
                  <Icon name="chevronRight" size={12} />
                </button>
                {submenu === 'view' ? (
                  <div className="titlebar-submenu" role="menu" aria-label="视图">
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onZoom('in')
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="plus" size={15} />
                      </span>
                      <span className="titlebar-menu-label">放大</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onZoom('out')
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="minus" size={15} />
                      </span>
                      <span className="titlebar-menu-label">缩小</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onToggleFullscreen()
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="maximize" size={15} />
                      </span>
                      <span className="titlebar-menu-label">切换全屏</span>
                    </button>
                  </div>
                ) : null}
              </div>

              <div
                className="titlebar-menu-group"
                onMouseEnter={() => setSubmenu('help')}
              >
                <button
                  className={
                    'titlebar-menu-item has-submenu' +
                    (submenu === 'help' ? ' is-open' : '')
                  }
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={submenu === 'help'}
                  onFocus={() => setSubmenu('help')}
                  onClick={() => setSubmenu('help')}
                >
                  <span className="titlebar-menu-icon">
                    <Icon name="help" size={15} />
                  </span>
                  <span className="titlebar-menu-label">帮助</span>
                  <Icon name="chevronRight" size={12} />
                </button>
                {submenu === 'help' ? (
                  <div className="titlebar-submenu" role="menu" aria-label="帮助">
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      disabled
                      title="暂未提供"
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="file" size={15} />
                      </span>
                      <span className="titlebar-menu-label">文档</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onWhatsNew()
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="sparkle" size={15} />
                      </span>
                      <span className="titlebar-menu-label">新功能</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onFeedback()
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="message" size={15} />
                      </span>
                      <span className="titlebar-menu-label">反馈</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onCheckUpdate()
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="refresh" size={15} />
                      </span>
                      <span className="titlebar-menu-label">检查更新</span>
                    </button>
                    <button
                      className="titlebar-menu-item"
                      role="menuitem"
                      onClick={() => {
                        close()
                        onAbout()
                      }}
                    >
                      <span className="titlebar-menu-icon">
                        <Icon name="help" size={15} />
                      </span>
                      <span className="titlebar-menu-label">关于</span>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="titlebar-menu-separator" />
              <button
                className="titlebar-menu-item"
                role="menuitem"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  close()
                  onCloseWindow()
                }}
              >
                <span className="titlebar-menu-icon">
                  <Icon name="x" size={15} />
                </span>
                <span className="titlebar-menu-label">关闭</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
