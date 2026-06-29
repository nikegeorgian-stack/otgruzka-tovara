import type { ReactNode } from 'react'
import type { ViewId } from '@/lib/types'

type IconProps = { className?: string; children: ReactNode }

function Icon({ className, children }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-5 w-5'}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function viewNavIcon(view: ViewId, className?: string) {
  switch (view) {
    case 'month':
      return (
        <Icon className={className}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </Icon>
      )
    case 'summary':
      return (
        <Icon className={className}>
          <path d="M4 19V5M10 19V9M16 19v-6M22 19V3" />
        </Icon>
      )
    case 'production':
      return (
        <Icon className={className}>
          <path d="M2 20h20M6 16V8l6-4 6 4v8" />
        </Icon>
      )
    case 'planner':
      return (
        <Icon className={className}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </Icon>
      )
    case 'warehouse':
      return (
        <Icon className={className}>
          <path d="M3 9l9-5 9 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
          <path d="M9 22V12h6v10" />
        </Icon>
      )
    case 'procurement':
      return (
        <Icon className={className}>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
        </Icon>
      )
    case 'hr':
      return (
        <Icon className={className}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </Icon>
      )
    case 'finance':
      return (
        <Icon className={className}>
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
        </Icon>
      )
    case 'technologist':
      return (
        <Icon className={className}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </Icon>
      )
    case 'mixer':
      return (
        <Icon className={className}>
          <path d="M5 3h14l-1.5 5.5a6 6 0 0 1-11 0L5 3z" />
          <path d="M12 14v5M8 21h8" />
        </Icon>
      )
    case 'director':
      return (
        <Icon className={className}>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-6" />
        </Icon>
      )
    case 'directories':
      return (
        <Icon className={className}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </Icon>
      )
    case 'settings':
      return (
        <Icon className={className}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </Icon>
      )
    case 'journals':
      return (
        <Icon className={className}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M8 6h12v12H8a2 2 0 0 1-2-2V6z" />
          <path d="M8 6V4a2 2 0 0 1 2-2h8" />
        </Icon>
      )
    case 'it':
      return (
        <Icon className={className}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </Icon>
      )
    default:
      return (
        <Icon className={className}>
          <circle cx="12" cy="12" r="9" />
        </Icon>
      )
  }
}
