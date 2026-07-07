import type { ReactNode } from 'react'
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect'
import { useI18n } from '@/context/I18nContext'

type Props = {
  label: string
  hint?: string
  value: string
  options: SearchableOption[]
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
        <SearchableSelect
          className="flex-1"
          value={value}
          options={options}
          placeholder={placeholder ?? '—'}
          disabled={disabled}
          onChange={onChange}
        />
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
