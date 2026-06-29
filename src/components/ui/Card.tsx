import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md'
}

export function Card({
  children,
  title,
  description,
  actions,
  className = '',
  padding = 'md',
}: Props) {
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-5'
  return (
    <section className={`fc-card ${className}`.trim()}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-grid px-5 py-4">
          <div>
            {title && <h3 className="fc-card__title">{title}</h3>}
            {description && <p className="fc-card__desc">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={pad}>{children}</div>
    </section>
  )
}
