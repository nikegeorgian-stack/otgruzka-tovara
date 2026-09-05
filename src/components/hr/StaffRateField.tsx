import { useEffect, useState } from 'react'
import {
  DEFAULT_STAFF_RATE,
  STAFF_RATE_PRESETS,
  employeeStaffRate,
  normalizeStaffRate,
} from '@/lib/payrollRates'
import type { Employee } from '@/lib/types'

type Props = {
  value: Employee['staffRate']
  onChange: (staffRate: number | undefined) => void
  /** Компактный вид для таблицы ставок. */
  compact?: boolean
  className?: string
  id?: string
  label?: string
  hint?: string
  customOptionLabel?: string
}

function presetLabel(rate: number): string {
  const pct = Math.round(rate * 100)
  if (rate === 1) return `1 · 100%`
  return `${rate} · ${pct}%`
}

export function StaffRateField({
  value,
  onChange,
  compact,
  className = '',
  id,
  label,
  hint,
  customOptionLabel = '…',
}: Props) {
  const current = employeeStaffRate({ staffRate: value })
  const isPreset = (STAFF_RATE_PRESETS as readonly number[]).includes(current)
  const [customMode, setCustomMode] = useState(!isPreset)
  const [draft, setDraft] = useState(String(current))

  useEffect(() => {
    const next = employeeStaffRate({ staffRate: value })
    const preset = (STAFF_RATE_PRESETS as readonly number[]).includes(next)
    setCustomMode(!preset)
    setDraft(String(next))
  }, [value])

  function commit(raw: number) {
    const n = normalizeStaffRate(raw)
    onChange(n === DEFAULT_STAFF_RATE ? undefined : n)
  }

  const selectValue = customMode ? 'custom' : String(current)

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-stone-500">
          {label}
        </label>
      ) : null}
      <div className={`flex items-center gap-1.5 ${label ? 'mt-1' : ''}`}>
        <select
          id={id}
          className={
            compact
              ? 'min-w-[5.5rem] rounded border border-grid px-1 py-1 text-xs'
              : 'min-w-[8rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm'
          }
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustomMode(true)
              setDraft(String(current))
              return
            }
            setCustomMode(false)
            commit(Number(e.target.value))
          }}
        >
          {STAFF_RATE_PRESETS.map((r) => (
            <option key={r} value={String(r)}>
              {presetLabel(r)}
            </option>
          ))}
          <option value="custom">{customOptionLabel}</option>
        </select>
        {customMode ? (
          <input
            type="text"
            inputMode="decimal"
            className={
              compact
                ? 'w-14 rounded border border-grid px-1 py-1 font-mono text-xs'
                : 'w-24 rounded-sm border border-grid px-2 py-2 font-mono text-sm'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = Number(draft.replace(',', '.'))
              if (!Number.isFinite(n)) {
                setDraft(String(current))
                return
              }
              commit(n)
            }}
            title="0.1 … 2"
            aria-label="staff rate custom"
          />
        ) : null}
      </div>
      {hint ? <span className="mt-1 block text-[11px] text-stone-400">{hint}</span> : null}
    </div>
  )
}
