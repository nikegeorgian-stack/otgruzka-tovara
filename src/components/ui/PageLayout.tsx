import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  /** Без боковых отступов (встроенные панели) */
  compact?: boolean
}

export function PageLayout({ children, className = '', compact = false }: Props) {
  return (
    <div
      className={`fc-page flex flex-col gap-3 sm:gap-4 ${compact ? 'px-3 py-2 sm:p-4' : 'p-3 sm:p-4'} ${className}`.trim()}
    >
      {children}
    </div>
  )
}
