import { useI18n } from '@/context/I18nContext'

export type KanbanViewMode = 'list' | 'kanban'

type Props = {
  mode: KanbanViewMode
  onChange: (mode: KanbanViewMode) => void
  dataCoachKanban?: string
  className?: string
  listLabel?: string
  kanbanLabel?: string
}

export function KanbanViewToggle({
  mode,
  onChange,
  dataCoachKanban,
  className = '',
  listLabel,
  kanbanLabel,
}: Props) {
  const { t } = useI18n()
  return (
    <div
      className={`inline-flex rounded-xl bg-stone-100/90 p-1 ${className}`.trim()}
      role="group"
      aria-label={t('kanban.viewMode')}
    >
      <button
        type="button"
        className={[
          'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
          mode === 'list'
            ? 'bg-white text-sky-900 shadow-sm'
            : 'text-stone-600 hover:text-stone-900',
        ].join(' ')}
        onClick={() => onChange('list')}
      >
        {listLabel ?? t('kanban.viewList')}
      </button>
      <button
        type="button"
        data-coach={dataCoachKanban}
        className={[
          'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
          mode === 'kanban'
            ? 'bg-white text-sky-900 shadow-sm'
            : 'text-stone-600 hover:text-stone-900',
        ].join(' ')}
        onClick={() => onChange('kanban')}
      >
        {kanbanLabel ?? t('kanban.viewKanban')}
      </button>
    </div>
  )
}
