import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import {
  addExtraRosterMember,
  employeesInBrigade,
  removeRosterMember,
} from '@/lib/production/brigades'
import type { ProductionRosterEntry } from '@/lib/production/types'
import type { Employee, MonthSheet } from '@/lib/types'

type Props = {
  brigadeName: string
  roster: ProductionRosterEntry[]
  employees: Employee[]
  monthSheet?: MonthSheet | null
  onChange: (next: ProductionRosterEntry[]) => void
}

export function ProductionBrigadeRoster({
  brigadeName,
  roster,
  employees,
  monthSheet,
  onChange,
}: Props) {
  const { t, employeeNameLines } = useI18n()
  const [pickId, setPickId] = useState<string | null>(null)

  const memberIds = useMemo(
    () => new Set(employeesInBrigade(brigadeName, employees, monthSheet).map((e) => e.id)),
    [brigadeName, employees, monthSheet],
  )

  const rosterIds = useMemo(() => new Set(roster.map((r) => r.employeeId)), [roster])

  const pickableEmployees = useMemo(
    () => employees.filter((e) => !rosterIds.has(e.id)),
    [employees, rosterIds],
  )

  if (!brigadeName) return null

  const presentCount = roster.filter((r) => r.present).length

  function toggle(employeeId: string) {
    onChange(
      roster.map((r) =>
        r.employeeId === employeeId ? { ...r, present: !r.present } : r,
      ),
    )
  }

  function setAll(present: boolean) {
    onChange(roster.map((r) => ({ ...r, present })))
  }

  function addExtra(employeeId: string | null) {
    if (!employeeId) return
    onChange(addExtraRosterMember(roster, employeeId))
    setPickId(null)
  }

  function removeExtra(employeeId: string) {
    onChange(removeRosterMember(roster, employeeId))
  }

  return (
    <div className="mt-3 border-t border-grid/60 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
          {t('production.rosterTitle')}
          <span className="ml-2 font-normal normal-case text-stone-400">
            {presentCount}/{roster.length}
          </span>
        </p>
        {roster.length > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded border border-grid px-2 py-0.5 text-[10px] text-stone-600 hover:bg-white"
              onClick={() => setAll(true)}
            >
              {t('production.rosterAllIn')}
            </button>
            <button
              type="button"
              className="rounded border border-grid px-2 py-0.5 text-[10px] text-stone-600 hover:bg-white"
              onClick={() => setAll(false)}
            >
              {t('production.rosterAllOut')}
            </button>
          </div>
        )}
      </div>

      {roster.length === 0 && (
        <p className="mb-2 text-xs text-stone-400">{t('production.rosterEmpty')}</p>
      )}

      <ul className="grid gap-1 sm:grid-cols-2">
        {roster.map((entry) => {
          const emp = employees.find((e) => e.id === entry.employeeId)
          if (!emp) return null
          const isExtra = entry.extra || !memberIds.has(entry.employeeId)
          return (
            <li key={entry.employeeId}>
              <div
                className={`flex items-center gap-1 rounded-sm border transition-colors ${
                  entry.present
                    ? 'border-emerald-200 bg-emerald-50/80 text-ink'
                    : 'border-stone-200 bg-stone-50/80 text-stone-400'
                }`}
              >
                <label
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm ${
                    !entry.present ? 'line-through' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500/30"
                    checked={entry.present}
                    onChange={() => toggle(entry.employeeId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <BilingualText lines={employeeNameLines(emp)} />
                    </span>
                    {isExtra && (
                      <span className="mt-0.5 block truncate text-[10px] font-medium normal-case text-violet-700">
                        {t('production.rosterExtraBadge')}
                        {emp.brigade ? ` · ${emp.brigade}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium uppercase">
                    {entry.present ? t('production.rosterIn') : t('production.rosterOut')}
                  </span>
                </label>
                {isExtra && (
                  <button
                    type="button"
                    className="mr-1 shrink-0 rounded px-1.5 py-1 text-sm text-stone-400 hover:bg-white hover:text-red-600"
                    title={t('production.rosterRemoveExtra')}
                    onClick={() => removeExtra(entry.employeeId)}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-grid/40 pt-3">
        <div className="min-w-[14rem] flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-stone-500">
            {t('production.rosterAddExtra')}
          </p>
          <EmployeePicker
            employees={pickableEmployees}
            value={pickId}
            compact
            elevated
            placeholder={t('production.rosterAddExtraPlaceholder')}
            onChange={(id) => addExtra(id)}
          />
        </div>
        <p className="max-w-xs pb-1 text-[11px] leading-snug text-stone-500">
          {t('production.rosterAddExtraHint')}
        </p>
      </div>
    </div>
  )
}
