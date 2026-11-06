import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icons'

export function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={'toggle' + (checked ? ' is-on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

export function InfoTip({
  title,
  text
}: {
  title: string
  text: string
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onOutside = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onOutside)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [open])

  return (
    <span
      className="info-tip"
      ref={wrapperRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-tip-trigger"
        aria-label={title}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault()
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="help" size={19} strokeWidth={1.6} />
      </button>
      {open ? (
        <span className="info-tip-popover" role="tooltip">
          <strong>{title}</strong>
          <span>{text}</span>
        </span>
      ) : null}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
  wide
}: {
  label: string
  hint?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={'field' + (wide ? ' field-wide' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function SectionTitle({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function RiskBadge({ risk }: { risk?: 'low' | 'medium' | 'high' }) {
  if (!risk || risk === 'low') return <span className="badge badge-muted">低风险</span>
  return (
    <span className={'badge ' + (risk === 'high' ? 'badge-danger' : 'badge-warn')}>
      {risk === 'high' ? '高风险 · 谨慎启用' : '中风险'}
    </span>
  )
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await window.api.copyText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? '已复制' : (label ?? '复制')}
    </button>
  )
}

export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Array<{ id: string; kind: 'success' | 'error' | 'info'; text: string }>
  onDismiss: (id: string) => void
}) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={'toast toast-' + toast.kind}>
          <span className="toast-dot" />
          <span>{toast.text}</span>
          <button className="icon-btn" onClick={() => onDismiss(toast.id)} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}