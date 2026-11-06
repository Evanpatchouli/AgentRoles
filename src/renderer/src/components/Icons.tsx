import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  sparkle: (
    <>
      <path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6L5.7 9.8l4.6-1.7L12 3.5z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5.5h16v13H4z" />
      <path d="M4 13h4.5l1.6 2.5h3.8l1.6-2.5H20" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  send: (
    <>
      <path d="M4.5 11.5L20 4l-5.5 16-3.6-6.6-6.4-1.9z" />
      <path d="M10.8 13.3L20 4" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  copy: (
    <>
      <rect x="9" y="9" width="10" height="11" rx="2" />
      <path d="M15 9V6.5A1.5 1.5 0 0013.5 5H6.5A1.5 1.5 0 005 6.5v9A1.5 1.5 0 006.5 17H9" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 10-2.5 5.8" />
      <path d="M20 5v6h-6" />
    </>
  ),
  folder: <path d="M3.5 6.5h6l2 2.5h9v10h-17z" />,
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H21l-1.5 1.5M18 12v3M15 12v2" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v5H5V6h5" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9l3 3-3 3M13 15h4" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0V8zM12 16v5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 16h6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5s1.3-6.1 3.8-8.5z" />
    </>
  ),
  memory: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M8.2 9.5h7.6M8.2 14.5h7.6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4M12 17.2v.3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4" />
    </>
  ),
  moon: (
    <path d="M20.4 14.6A8.6 8.6 0 019.4 3.6a8.6 8.6 0 1011 11z" />
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17.5l4.8-4.6 3.6 3.4 3-2.8L20 17" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10.2" />
      <path d="M9.2 9.1a2.9 2.9 0 015.7.6c0 2-2.9 2.2-2.9 4.2" />
      <path d="M12 18v.3" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  message: (
    <>
      <path d="M4.5 5h15v11h-8l-4 3v-3h-3z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 6a3 3 0 010 5.8M16 14.2c2.6.3 4.5 2.3 4.5 4.8" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />
}

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.6
}: {
  name: keyof typeof paths | string
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.sparkle}
    </svg>
  )
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="4.5" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="10.5"
        y="10.5"
        width="15"
        height="15"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.55"
      />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
    </svg>
  )
}
