import type { ReactNode } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'

type Props = {
  badge?: string
  title: string
  subtitle?: string
  showBrand?: boolean
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({
  badge,
  title,
  subtitle,
  showBrand = true,
  actions,
  meta,
}: Props) {
  return (
    <header className="fc-page-header print:hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {showBrand && <FiberCellBrand variant="page" className="mb-3" />}
          {badge && <p className="fc-page-badge">{badge}</p>}
          <h1 className="fc-page-title">{title}</h1>
          {subtitle && <p className="fc-page-subtitle">{subtitle}</p>}
          {meta && <div className="mt-2">{meta}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  )
}
