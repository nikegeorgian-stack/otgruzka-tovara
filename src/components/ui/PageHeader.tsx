import type { ReactNode } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'

type Density = 'default' | 'compact'

type Props = {
  badge?: string
  title: string
  subtitle?: string
  showBrand?: boolean
  /** compact — без логотипа, меньше отступы; для рабочих разделов */
  density?: Density
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({
  badge,
  title,
  subtitle,
  showBrand = true,
  density = 'default',
  actions,
  meta,
}: Props) {
  const compact = density === 'compact'
  return (
    <header
      className={`fc-page-header print:hidden ${compact ? 'fc-page-header--compact' : ''}`.trim()}
    >
      <div
        className={`flex min-w-0 flex-1 gap-2 sm:items-center sm:justify-between ${
          compact ? 'flex-row flex-wrap items-center' : 'flex-col gap-3 sm:flex-row sm:items-start'
        }`}
      >
        <div className="min-w-0 flex-1">
          {showBrand && !compact && <FiberCellBrand variant="page" className="mb-3" />}
          {badge && !compact && <p className="fc-page-badge">{badge}</p>}
          <div className={compact ? 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5' : undefined}>
            <h1 className={`fc-page-title ${compact ? 'fc-page-title--compact' : ''}`.trim()}>
              {title}
            </h1>
            {compact && subtitle ? (
              <span className="fc-page-subtitle fc-page-subtitle--inline">{subtitle}</span>
            ) : null}
          </div>
          {!compact && subtitle && <p className="fc-page-subtitle">{subtitle}</p>}
          {meta && <div className={compact ? 'mt-1' : 'mt-2'}>{meta}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">{actions}</div>
        )}
      </div>
    </header>
  )
}
