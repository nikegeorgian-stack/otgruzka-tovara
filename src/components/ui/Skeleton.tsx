type SkeletonProps = {
  className?: string
}

/** Плейсхолдер контента при загрузке. Уважает prefers-reduced-motion (через глобальный CSS). */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-sm bg-stone-200/80 ${className}`.trim()}
      aria-hidden
    />
  )
}

type SkeletonTableProps = {
  rows?: number
  cols?: number
}

/** Скелет таблицы для data-dense экранов на время загрузки данных. */
export function SkeletonTable({ rows = 8, cols = 5 }: SkeletonTableProps) {
  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загрузка данных…</span>
      <div className="flex gap-2">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={`h-${i}`} className="h-6 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={`r-${r}`} className="flex gap-2">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={`c-${r}-${c}`} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

type SpinnerProps = {
  /** Размер в px. По умолчанию 20. */
  size?: number
  className?: string
  label?: string
}

/** Индикатор выполнения асинхронной операции. */
export function Spinner({ size = 20, className = '', label }: SpinnerProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span
        className="animate-spin rounded-full border-2 border-stone-300 border-t-accent"
        style={{ width: size, height: size }}
        aria-hidden
      />
      {label ? <span className="text-sm text-stone-500">{label}</span> : null}
    </span>
  )
}
