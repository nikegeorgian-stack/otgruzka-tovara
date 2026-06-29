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
      className={`fc-page flex flex-col gap-4 sm:gap-5 ${compact ? 'px-3 py-3 sm:p-5 md:p-6' : 'p-3 sm:p-5 md:p-6'} ${className}`.trim()}
    >
      {children}
    </div>
  )
}
