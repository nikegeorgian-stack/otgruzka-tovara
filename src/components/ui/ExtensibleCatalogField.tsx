import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'

type NumberProps = {
  kind: 'number'
  label: string
  hint?: string
  unit?: string
  value?: number
  options: number[]
  placeholder?: string
  step?: number
  onChange: (value: number | undefined) => void
  onRegister?: (value: number) => void
  formatOption?: (n: number) => string
}

type TextProps = {
  kind: 'text'
  label: string
  hint?: string
  value?: string
  options: { id: string; label: string }[]
  placeholder?: string
  onChange: (value: string | undefined) => void
  onRegister?: (label: string) => void
}

type Props = NumberProps | TextProps

function fmtDefault(n: number): string {
  if (n >= 10) return String(Math.round(n))
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

/**
 * Выбор из справочника-чипов с возможностью добавить своё значение.
 */
export function ExtensibleCatalogField(props: Props) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function commitAdd() {
    if (props.kind === 'number') {
      const n = Number(draft.replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) return
      const rounded = n >= 10 ? Math.round(n) : Math.round(n * 1000) / 1000
      props.onRegister?.(rounded)
      props.onChange(rounded)
    } else {
      const label = draft.trim()
      if (!label) return
      props.onRegister?.(label)
    }
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          {props.label}
        </span>
        {props.hint && (
          <span className="text-[10px] text-stone-400">{props.hint}</span>
        )}
      </div>

      {props.kind === 'text' ? (
        <select
          className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
          value={props.value ?? ''}
          onChange={(e) => props.onChange(e.target.value || undefined)}
        >
          <option value="">{props.placeholder ?? '—'}</option>
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}

      <div className={`flex flex-wrap gap-1 ${props.kind === 'text' ? 'mt-1.5' : ''}`}>
        {props.kind === 'number' &&
          props.options.map((n) => {
            const active = props.value != null && Math.abs(props.value - n) < 0.001
            const label = props.formatOption?.(n) ?? fmtDefault(n)
            return (
              <button
                key={n}
                type="button"
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${
                  active
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-stone-200 bg-white text-stone-700 hover:border-teal-500 hover:bg-teal-50'
                }`}
                onClick={() => props.onChange(n)}
              >
                {label}
                {props.unit ? (
                  <span className={`ml-0.5 ${active ? 'text-teal-100' : 'text-stone-400'}`}>
                    {props.unit}
                  </span>
                ) : null}
              </button>
            )
          })}

        {!adding ? (
          <button
            type="button"
            className="rounded-md border border-dashed border-teal-600/50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-50"
            onClick={() => setAdding(true)}
          >
            + {t('catalogField.add')}
          </button>
        ) : (
          <div className="flex min-w-[9rem] flex-1 items-center gap-1">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-teal-600 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-600/30"
              placeholder={
                props.kind === 'number'
                  ? props.placeholder ?? t('catalogField.numberPh')
                  : props.placeholder ?? t('catalogField.textPh')
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitAdd()
                }
                if (e.key === 'Escape') {
                  setAdding(false)
                  setDraft('')
                }
              }}
            />
            <button
              type="button"
              className="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white"
              onClick={commitAdd}
            >
              {t('catalogField.ok')}
            </button>
            <button
              type="button"
              className="rounded-md px-1.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
              onClick={() => {
                setAdding(false)
                setDraft('')
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
