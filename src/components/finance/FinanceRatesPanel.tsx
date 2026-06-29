import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  onSaveEmployee: (e: Employee) => void
}

export function FinanceRatesPanel({ employees, onSaveEmployee }: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, { hourlyRate: string; monthlySalary: string }>>(
    {},
  )

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return employees
      .filter((e) => e.active)
      .filter((e) => !s || e.fullName.toLowerCase().includes(s) || e.tabNumber.includes(s))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, locale === 'ka' ? 'ka' : 'ru'))
  }, [employees, q, locale])

  function getDraft(emp: Employee) {
    return (
      draft[emp.id] ?? {
        hourlyRate: emp.hourlyRate != null ? String(emp.hourlyRate) : '',
        monthlySalary: emp.monthlySalary != null ? String(emp.monthlySalary) : '',
      }
    )
  }

  function setField(id: string, field: 'hourlyRate' | 'monthlySalary', value: string) {
    setDraft((prev) => {
      const emp = employees.find((e) => e.id === id)
      if (!emp) return prev
      const cur =
        prev[id] ?? {
          hourlyRate: emp.hourlyRate != null ? String(emp.hourlyRate) : '',
          monthlySalary: emp.monthlySalary != null ? String(emp.monthlySalary) : '',
        }
      return { ...prev, [id]: { ...cur, [field]: value } }
    })
  }

  function saveRow(emp: Employee) {
    const d = getDraft(emp)
    const hourlyRate = d.hourlyRate.trim() ? Number(d.hourlyRate.replace(',', '.')) : undefined
    const monthlySalary = d.monthlySalary.trim()
      ? Number(d.monthlySalary.replace(',', '.'))
      : undefined
    if (
      (d.hourlyRate.trim() && !Number.isFinite(hourlyRate)) ||
      (d.monthlySalary.trim() && !Number.isFinite(monthlySalary))
    ) {
      setNotice(t('finance.rates.invalidNumber'))
      return
    }
    onSaveEmployee({
      ...emp,
      hourlyRate,
      monthlySalary,
    })
    setDraft((prev) => {
      const next = { ...prev }
      delete next[emp.id]
      return next
    })
    setNotice(t('finance.rates.saved'))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">{t('finance.rates.hint')}</p>
      {notice && (
        <FormNotice
          type={notice.includes('сохран') || notice.includes('შენახ') ? 'info' : 'error'}
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}
      <Input
        placeholder={t('finance.rates.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      <div className="fc-table-wrap">
        <table className="fc-table min-w-full">
          <thead>
            <tr>
              <th>{t('employees.colName')}</th>
              <th>{t('employees.colTab')}</th>
              <th>{t('employees.colSchedule')}</th>
              <th>{t('finance.rates.hourly')}</th>
              <th>{t('finance.rates.monthly')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => {
              const d = getDraft(emp)
              const dirty =
                draft[emp.id] !== undefined ||
                d.hourlyRate !== (emp.hourlyRate != null ? String(emp.hourlyRate) : '') ||
                d.monthlySalary !==
                  (emp.monthlySalary != null ? String(emp.monthlySalary) : '')
              return (
                <tr key={emp.id} className="border-t border-grid">
                  <td className="px-3 py-2">
                    <BilingualText lines={employeeNameLines(emp)} />
                    <div className="text-xs text-stone-400">{emp.position || '—'}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{emp.tabNumber || '—'}</td>
                  <td className="px-3 py-2 text-xs">{emp.schedule}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-24 rounded border border-grid px-2 py-1 font-mono text-sm"
                      value={d.hourlyRate}
                      onChange={(e) => setField(emp.id, 'hourlyRate', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-28 rounded border border-grid px-2 py-1 font-mono text-sm"
                      value={d.monthlySalary}
                      onChange={(e) => setField(emp.id, 'monthlySalary', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!dirty}
                      onClick={() => saveRow(emp)}
                    >
                      {t('common.save')}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
