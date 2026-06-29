import type { ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'

type Option = { value: string; label: string }

type Props = {
  label: string
  hint?: string
  value: string
  options: Option[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
  onAdd: () => void
  children?: ReactNode
}

export function DirectoryFieldPicker({
  label,
  hint,
  value,
  options,
  placeholder,
  disabled,
  onChange,
  onAdd,
  children,
}: Props) {
  const { t } = useI18n()
  return (
    <label className="text-xs font-medium text-stone-500">
      {label}
      <div className="mt-1 flex gap-1">
        <select
          className="min-w-0 flex-1 rounded-sm border border-grid px-3 py-2 text-sm disabled:bg-stone-50"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{placeholder ?? '—'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title={t('directories.openList')}
          className="btn-add-icon"
          onClick={onAdd}
        >
          +
        </button>
      </div>
      {hint && <span className="mt-1 block text-[10px] text-stone-400">{hint}</span>}
      {children}
    </label>
  )
}
