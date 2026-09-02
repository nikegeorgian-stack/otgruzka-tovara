import type { ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'

type Props = {
  children: ReactNode
  /** Показать подсказку про перетаскивание */
  showHint?: boolean
  className?: string
}

export function KanbanBoard({ children, showHint = true, className = '' }: Props) {
  const { t } = useI18n()
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {showHint ? (
        <p className="text-xs text-stone-500">{t('kanban.hint')}</p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-3 pt-1">{children}</div>
    </div>
  )
}
