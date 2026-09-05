import type { ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'

type Props = {
  title: string
  count: number
  isDropTarget: boolean
  isDragging: boolean
  dropHandlers: {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
  }
  children: ReactNode
  className?: string
  minWidth?: string
}

export function KanbanColumn({
  title,
  count,
  isDropTarget,
  isDragging,
  dropHandlers,
  children,
  className = '',
  minWidth = 'min-w-[240px] max-w-[300px]',
}: Props) {
  const { t } = useI18n()
  return (
    <div
      className={[
        `${minWidth} flex-1 rounded-2xl p-2.5 transition-all duration-200`,
        isDropTarget && isDragging
          ? 'bg-sky-50/90 ring-2 ring-sky-300/70 ring-offset-1'
          : 'bg-stone-100/70',
        className,
      ].join(' ')}
      {...dropHandlers}
    >
      <div className="mb-2.5 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-stone-600">
        <span className="truncate">{title}</span>
        <span className="shrink-0 tabular-nums text-stone-400">{count}</span>
      </div>
      <div className="flex max-h-[min(70vh,36rem)] flex-col gap-2 overflow-y-auto">
        {count === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-stone-400">{t('kanban.emptyCol')}</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
