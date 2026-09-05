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
  /** Открыть справочник / добавить (+) */
  onAdd: () => void
  /** Явная ссылка «Журнал» (обычно тот же справочник) */
  onOpenJournal?: () => void
  journalLabel?: string
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
  onOpenJournal,
  journalLabel,
  children,
}: Props) {
  const { t } = useI18n()
  const journal = onOpenJournal ?? onAdd

  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-stone-500">{label}</span>
        <button
          type="button"
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-teal-700 underline-offset-2 hover:underline"
          onClick={journal}
        >
          {journalLabel ?? t('directories.openJournal')}
        </button>
      </div>
      <div className="flex gap-1">
        <SearchableSelect
          className="min-w-0 flex-1"
          value={value}
          options={options}
          placeholder={placeholder ?? '—'}
          disabled={disabled}
          onChange={onChange}
        />
        <button
          type="button"
          title={t('directories.addNew')}
          aria-label={t('directories.addNew')}
          className="btn-add-icon"
          onClick={onAdd}
        >
          +
        </button>
      </div>
      {hint && <span className="mt-1 block text-[10px] leading-snug text-stone-400">{hint}</span>}
      {children}
    </div>
  )
}
