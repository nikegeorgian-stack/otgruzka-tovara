import { useI18n } from '@/context/I18nContext'
import type { WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  label: string
  hint?: string
  value: string
  options: WarehouseItem[]
  placeholder?: string
  onChange: (id: string) => void
  onAdd?: () => void
}

export function WarehouseItemSelect({
  label,
  hint,
  value,
  options,
  placeholder,
  onChange,
  onAdd,
}: Props) {
  const { t } = useI18n()
  return (
    <label className="text-xs font-medium text-stone-500">
      {label}
      <div className="mt-1 flex gap-1">
        <select
          className="min-w-0 flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{placeholder ?? '—'}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {onAdd && (
          <button
            type="button"
            title={t('directories.openList')}
            className="btn-add-icon"
            onClick={onAdd}
          >
            +
          </button>
        )}
      </div>
      {hint && <span className="mt-1 block text-[10px] text-stone-400">{hint}</span>}
    </label>
  )
}
