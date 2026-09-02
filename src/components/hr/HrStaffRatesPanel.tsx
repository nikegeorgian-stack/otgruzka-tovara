import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { StaffRateField } from '@/components/hr/StaffRateField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { employeeStaffRate } from '@/lib/payroll'
import { filterEmployeesForMonth } from '@/lib/hr/employeeActive'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  onSaveEmployee: (e: Employee) => void
  /** Месяц для фильтра активных (опционально). */
  month?: string
}

export function HrStaffRatesPanel({ employees, onSaveEmployee, month }: Props) {
  const { t, employeeNameLines } = useI18n()
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = month
      ? filterEmployeesForMonth(employees, month)
      : employees.filter((e) => (e.hrStatus ?? 'active') !== 'fired')
    return base
      .filter(
        (e) =>
          !s ||
          e.fullName.toLowerCase().includes(s) ||
          e.tabNumber.includes(s) ||
          (e.position ?? '').toLowerCase().includes(s),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
  }, [employees, q, month])

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">{t('hrInspector.rates.hint')}</p>
      {notice ? (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {notice}
        </p>
      ) : null}
      <Input
        className="max-w-md"
        placeholder={t('hr.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">{t('hr.col.employee')}</th>
              <th className="px-3 py-2">{t('employees.colTab')}</th>
              <th className="px-3 py-2">{t('hr.col.position')}</th>
              <th className="px-3 py-2">{t('finance.rates.monthly')}</th>
              <th className="px-3 py-2" title={t('finance.rates.staffRateHint')}>
                {t('finance.rates.staffRate')}
              </th>
              <th className="px-3 py-2">{t('hrInspector.rates.effective')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => {
              const rate = employeeStaffRate(emp)
              const monthly = emp.monthlySalary ?? 0
              const effective =
                monthly > 0 ? Math.round(monthly * rate * 100) / 100 : null
              return (
                <tr key={emp.id} className="border-t border-grid hover:bg-stone-50/80">
                  <td className="px-3 py-2">
                    <BilingualText
                      lines={employeeNameLines(emp)}
                      className="font-medium leading-snug text-ink"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-stone-500">
                    {emp.tabNumber || '—'}
                  </td>
                  <td className="px-3 py-2 text-stone-600">{emp.position || '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-stone-700">
                    {monthly > 0 ? `${monthly.toLocaleString('ru-RU')} ₾` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StaffRateField
                      compact
                      value={emp.staffRate}
                      customOptionLabel={t('finance.rates.staffRateCustom')}
                      onChange={(staffRate) => {
                        onSaveEmployee({ ...emp, staffRate })
                        setNotice(
                          `${emp.fullName}: ${t('finance.rates.staffRate')} → ${
                            staffRate ?? 1
                          }`,
                        )
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums font-semibold text-teal-900">
                    {effective != null
                      ? `${effective.toLocaleString('ru-RU')} ₾`
                      : rate !== 1
                        ? `${rate} · ${Math.round(rate * 100)}%`
                        : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-500">{t('hr.empty')}</p>
        ) : null}
      </div>
    </div>
  )
}
