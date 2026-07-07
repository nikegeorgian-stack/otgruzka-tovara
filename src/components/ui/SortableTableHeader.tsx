import { useI18n } from '@/context/I18nContext'
import type { SortDir } from '@/lib/ui/tableSort'

type Props<K extends string> = {
  label: string
  sortKey: K
  activeKey: K | null
  dir: SortDir
  onSort: (key: K) => void
  className?: string
}

export function SortableTableHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = '',
}: Props<K>) {
  const { t } = useI18n()
  const active = activeKey === sortKey

  return (
    <th className={className}>
      <button
        type="button"
        className="th-sortable inline-flex w-full items-center gap-0.5 text-left font-semibold hover:text-accent"
        title={t('table.sortBy')}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active && (
          <span className="font-mono text-[10px] text-accent" aria-hidden>
            {dir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    </th>
  )
}
