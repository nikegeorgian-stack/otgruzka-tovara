import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { SortableTableHeader } from '@/components/ui/SortableTableHeader'
import { useI18n } from '@/context/I18nContext'
import { hasIndividualSalary, salaryFieldsFromPosition } from '@/lib/finance/salary'
import { filterEmployeesForDate, filterEmployeesForMonth } from '@/lib/hr/employeeActive'
import { sortEmployees, type EmployeeSortKey } from '@/lib/hr/employeeSort'
import { toggleTableSort, type TableSortState } from '@/lib/ui/tableSort'
import type { Employee, HrPosition } from '@/lib/types'

type Props = {
  employees: Employee[]
  hrPositions?: HrPosition[]
  onSaveEmployee: (e: Employee) => void
  month?: string
  asOfDate?: string
}
export function FinanceRatesPanel({
  employees,
  hrPositions = [],
  onSaveEmployee,
  month,
  asOfDate,
}: Props) {
  const { t, locale, employeeNameLines } = useI18n()
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, { hourlyRate: string; monthlySalary: string }>>(
    {},
  )
  const [employeeSort, setEmployeeSort] = useState<TableSortState<EmployeeSortKey>>({
    key: 'name',
    dir: 'asc',
  })

  function handleEmployeeSort(key: EmployeeSortKey) {
    setEmployeeSort((prev) => toggleTableSort(prev, key))
  }

  const positionMap = useMemo(
    () => new Map(hrPositions.map((p) => [p.id, p])),
    [hrPositions],
  )

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = asOfDate
      ? filterEmployeesForDate(employees, asOfDate)
      : month
        ? filterEmployeesForMonth(employees, month)
        : employees.filter((e) => e.active)
    const matched = base.filter(
      (e) => !s || e.fullName.toLowerCase().includes(s) || e.tabNumber.includes(s),
    )
    return sortEmployees(matched, employeeSort, locale)
  }, [employees, q, locale, asOfDate, month, employeeSort])

  function positionFor(emp: Employee): HrPosition | undefined {
    if (emp.positionId) return positionMap.get(emp.positionId)
    const title = emp.position?.trim().toLowerCase()
    if (!title) return undefined
    return hrPositions.find((p) => p.title.trim().toLowerCase() === title)
  }

  function positionSalaryHint(emp: Employee): string {
    const pos = positionFor(emp)
    if (!pos || pos.salary <= 0) return '—'
    return `${pos.salary.toLocaleString('ru-RU')} ${pos.currency}`
  }

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

  function saveRow(emp: Employee, opts?: { individualSalary?: boolean }) {
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
    const individualSalary = opts?.individualSalary ?? emp.individualSalary
    onSaveEmployee({
      ...emp,
      hourlyRate,
      monthlySalary,
      individualSalary,
    })
    setDraft((prev) => {
      const next = { ...prev }
      delete next[emp.id]
      return next
    })
    setNotice(t('finance.rates.saved'))
  }

  function toggleIndividual(emp: Employee, checked: boolean) {
    onSaveEmployee({ ...emp, individualSalary: checked })
    setNotice(
      checked ? t('finance.rates.individualOn') : t('finance.rates.individualOff'),
    )
  }

  function applyPositionSalary(emp: Employee) {
    if (hasIndividualSalary(emp)) {
      setNotice(t('finance.rates.individualBlocked'))
      return
    }
    const pos = positionFor(emp)
    if (!pos || pos.salary <= 0) return
    const salaryPatch = salaryFieldsFromPosition(emp, pos)
    if (!salaryPatch) return
    onSaveEmployee({
      ...emp,
      positionId: pos.id,
      ...salaryPatch,
    })
    setDraft((prev) => {
      const next = { ...prev }
      delete next[emp.id]
      return next
    })
    setNotice(t('finance.rates.fromPositionOk'))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">{t('finance.rates.hint')}</p>
      <p className="text-xs text-stone-500">{t('finance.rates.individualHint')}</p>
      {notice && (
        <FormNotice
          type={
            notice.includes('сохран') ||
            notice.includes('შენახ') ||
            notice.includes('штат') ||
            notice.includes('ინდივიდ') ||
            notice.includes('индивид')
              ? 'info'
              : 'error'
          }
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
              <th className="w-10" title={t('finance.rates.individual')}>
                {t('finance.rates.individualShort')}
              </th>
              <SortableTableHeader
                label={t('employees.colName')}
                sortKey="name"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleEmployeeSort}
              />
              <SortableTableHeader
                label={t('employees.colTab')}
                sortKey="tab"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleEmployeeSort}
              />
              <SortableTableHeader
                label={t('employees.colSchedule')}
                sortKey="schedule"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleEmployeeSort}
              />
              <th>{t('finance.rates.positionSalary')}</th>
              <th>{t('finance.rates.hourly')}</th>
              <th>{t('finance.rates.monthly')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => {
              const d = getDraft(emp)
              const pos = positionFor(emp)
              const individual = hasIndividualSalary(emp)
              const dirty =
                draft[emp.id] !== undefined ||
                d.hourlyRate !== (emp.hourlyRate != null ? String(emp.hourlyRate) : '') ||
                d.monthlySalary !==
                  (emp.monthlySalary != null ? String(emp.monthlySalary) : '')
              return (
                <tr
                  key={emp.id}
                  className={`border-t border-grid ${individual ? 'bg-sky-50/60' : ''}`}
                >
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      className="rounded border-sky-400"
                      checked={individual}
                      title={t('finance.rates.individual')}
                      onChange={(e) => toggleIndividual(emp, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <BilingualText lines={employeeNameLines(emp)} />
                    <div className="text-xs text-stone-400">
                      {emp.position || '—'}
                      {individual ? (
                        <span className="ml-1 font-semibold text-sky-800">
                          · {t('finance.rates.individualBadge')}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{emp.tabNumber || '—'}</td>
                  <td className="px-3 py-2 text-xs">{emp.schedule}</td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={`font-mono tabular-nums ${individual ? 'text-stone-400 line-through' : ''}`}
                    >
                      {positionSalaryHint(emp)}
                    </span>
                    {pos && pos.salary > 0 && !individual ? (
                      <button
                        type="button"
                        className="ml-2 text-accent hover:underline"
                        onClick={() => applyPositionSalary(emp)}
                      >
                        {t('finance.rates.applyPosition')}
                      </button>
                    ) : null}
                  </td>
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
                      onClick={() =>
                        saveRow(emp, {
                          individualSalary: individual || dirty ? true : emp.individualSalary,
                        })
                      }
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
