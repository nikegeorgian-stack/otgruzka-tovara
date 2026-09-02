import { useMemo, useState } from 'react'
import { EmployeeTimesheetCalendar } from '@/components/my/EmployeeTimesheetCalendar'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { buildEmployeeCabinetSnapshot } from '@/lib/employeeCabinet/snapshot'
import { monthKey } from '@/lib/dates'
import { hrAbsenceLabel, hrJournalKindLabel } from '@/lib/hr/labels'
import type { AppStore, Employee } from '@/lib/types'

type Props = {
  store: AppStore
  employee: Employee
}

export function HrEmployeeTimesheetPanel({ store, employee }: Props) {
  const { t, tf, locale } = useI18n()
  const now = new Date()
  const [month, setMonth] = useState(() => monthKey(now.getFullYear(), now.getMonth() + 1))

  const snap = useMemo(
    () => buildEmployeeCabinetSnapshot(store, employee, month),
    [store, employee, month],
  )

  const absences = useMemo(() => {
    const list = [...(employee.hrAbsences ?? [])]
    list.sort((a, b) => b.startDate.localeCompare(a.startDate))
    return list.slice(0, 12)
  }, [employee.hrAbsences])

  const journal = useMemo(() => {
    const list = [...(employee.hrJournal ?? [])]
    list.sort((a, b) => b.at.localeCompare(a.at))
    return list.slice(0, 15)
  }, [employee.hrJournal])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{t('hr.timesheet.title')}</p>
          <p className="text-xs text-stone-500">{t('hr.timesheet.hint')}</p>
        </div>
        <MonthNavigator month={month} onChange={setMonth} />
      </div>

      {!snap.inMonth ? (
        <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {t('hr.timesheet.notInMonth')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-sm border border-grid bg-stone-50 px-2.5 py-2">
              <p className="text-[10px] uppercase text-stone-500">{t('my.col.plan')}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{snap.planHours}</p>
            </div>
            <div className="rounded-sm border border-grid bg-stone-50 px-2.5 py-2">
              <p className="text-[10px] uppercase text-stone-500">{t('my.col.fact')}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{snap.factHours}</p>
            </div>
            <div className="rounded-sm border border-grid bg-stone-50 px-2.5 py-2">
              <p className="text-[10px] uppercase text-stone-500">{t('hr.timesheet.workDays')}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{snap.workDaysCount}</p>
            </div>
            <div className="rounded-sm border border-grid bg-stone-50 px-2.5 py-2">
              <p className="text-[10px] uppercase text-stone-500">{t('hr.timesheet.estPay')}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">
                {Math.round(snap.estimatedPay).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU')} ₾
              </p>
            </div>
          </div>

          {snap.brigades.length > 0 ? (
            <p className="text-xs text-stone-600">
              {tf('hr.timesheet.brigades', { list: snap.brigades.join(', ') })}
            </p>
          ) : null}

          <EmployeeTimesheetCalendar month={month} days={snap.days} />
        </>
      )}

      <section className="rounded-sm border border-grid bg-white px-3 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-stone-500">
          {t('hr.timesheet.absences')}
        </h3>
        {absences.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-400">{t('hr.timesheet.absencesEmpty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-grid text-sm">
            {absences.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="font-medium text-ink">{hrAbsenceLabel(a.type, locale)}</span>
                <span className="tabular-nums text-stone-600">
                  {a.startDate} → {a.endDate}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-sm border border-grid bg-white px-3 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-stone-500">
          {t('hr.timesheet.journal')}
        </h3>
        {journal.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-400">{t('hr.timesheet.journalEmpty')}</p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-sm">
            {journal.map((j) => (
              <li key={j.id} className="rounded-sm bg-stone-50 px-2 py-1.5">
                <p className="font-medium text-ink">
                  {hrJournalKindLabel(j.kind, locale)}
                  {j.note ? ` · ${j.note}` : ''}
                </p>
                <p className="text-[11px] text-stone-500">{j.at.slice(0, 16).replace('T', ' ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
