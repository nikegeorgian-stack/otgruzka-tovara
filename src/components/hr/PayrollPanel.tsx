import { useMemo } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { employeeNameLines } from '@/i18n'
import { formatMonthTitle, parseMonthKey } from '@/lib/dates'
import { runExport } from '@/lib/export'
import { holidaysInMonth } from '@/lib/georgiaCalendar'
import { calculateRowPay, formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
}

export function PayrollPanel({ store, month, onMonthChange }: Props) {
  const { t, locale, employeeNameLines: nameLines } = useI18n()
  const sheet = store.months[month]
  const { year, month: mo } = parseMonthKey(month)
  const monthHolidays = holidaysInMonth(year, mo)

  const rows = useMemo(() => {
    if (!sheet) return []
    const list: {
      id: string
      emp: import('@/lib/types').Employee
      schedule: string
      brigade: string
      pay: ReturnType<typeof calculateRowPay>
    }[] = []

    for (const row of sheet.rows) {
      if (!row.employeeId) continue
      const emp = store.employees.find((e) => e.id === row.employeeId)
      if (!emp?.active) continue
      list.push({
        id: row.id,
        emp,
        schedule: emp.schedule,
        brigade: emp.brigade,
        pay: calculateRowPay(emp, sheet, row.id, year, mo),
      })
    }
    return list.sort((a, b) =>
      employeeNameLines(a.emp, locale).primary.localeCompare(
        employeeNameLines(b.emp, locale).primary,
        locale === 'ka' ? 'ka' : 'ru',
      ),
    )
  }, [sheet, store.employees, year, mo, locale])

  const total = rows.reduce((s, r) => s + r.pay.amount, 0)

  if (!sheet) {
    return <div className="p-8 text-stone-500">{t('month.notFound')}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('pay.title')}</h2>
          <p className="text-sm text-stone-500">
            {formatMonthTitle(month, locale)} · {t('pay.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNavigator month={month} onChange={onMonthChange} variant="input" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runExport('payroll', store, { month, locale })}
          >
            {t('pay.exportExcel')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runExport('brigades', store, { month, locale })}
          >
            {t('pay.exportBrigades')}
          </Button>
        </div>
      </div>

      {monthHolidays.length > 0 && (
        <div className="rounded-sm border border-violet-200 bg-violet-50/80 px-4 py-3 text-sm text-violet-900">
          <p className="font-semibold">{t('pay.holidaysTitle')}</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {monthHolidays.map((h) => (
              <li key={h.date}>
                {h.date.slice(8, 10)}.{h.date.slice(5, 7)} — {h.name}
                {h.nameKa && h.nameKa !== h.name ? ` / ${h.nameKa}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-violet-700">{t('pay.holidaysHint')}</p>
        </div>
      )}

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full">
          <thead>
            <tr>
              <th className="px-3 py-2">{t('employees.colName')}</th>
              <th className="px-3 py-2">{t('employees.colSchedule')}</th>
              <th className="px-3 py-2">{t('pay.colRate')}</th>
              <th className="px-3 py-2">{t('stats.factH')}</th>
              <th className="px-3 py-2">{t('pay.colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-grid">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    <BilingualText lines={nameLines(r.emp)} />
                  </div>
                  <div className="text-xs text-stone-400">{r.brigade || '—'}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.schedule}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.pay.rateLabel}</td>
                <td className="px-3 py-2 font-mono">{r.pay.factHours}</td>
                <td className="px-3 py-2 font-mono font-semibold">
                  {formatGel(r.pay.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-accent/30 bg-accent-soft/20 font-bold">
              <td colSpan={4} className="px-3 py-3">
                {t('pay.monthTotal')}
              </td>
              <td className="px-3 py-3 font-mono">{formatGel(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-stone-500">{t('pay.formula')}</p>
    </div>
  )
}
