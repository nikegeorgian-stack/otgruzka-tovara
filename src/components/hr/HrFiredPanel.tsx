import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { employeeSearchHr } from '@/lib/hr/sync'
import { sortEmployees, type EmployeeSortKey } from '@/lib/hr/employeeSort'
import { toggleTableSort, type TableSortState } from '@/lib/ui/tableSort'
import { SortableTableHeader } from '@/components/ui/SortableTableHeader'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  onOpenEmployee: (employee: Employee) => void
}

export function HrFiredPanel({ employees, onOpenEmployee }: Props) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<TableSortState<EmployeeSortKey>>({
    key: 'name',
    dir: 'asc',
  })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = employees.filter((e) => {
      if ((e.hrStatus ?? 'active') !== 'fired') return false
      if (!s) return true
      return employeeSearchHr(e).includes(s)
    })
    return sortEmployees(list, sort, locale)
  }, [employees, q, sort, locale])

  function handleSort(key: EmployeeSortKey) {
    setSort((prev) => toggleTableSort(prev, key))
  }

  function fmtDate(iso?: string): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString(locale === 'ka' ? 'ka-GE' : 'ru-RU')
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-4" data-coach="hr:firedPanel">
      <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-ink">{t('hr.fired.title')}</h3>
        <p className="mt-1 text-xs text-stone-500">{t('hr.fired.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder={t('hr.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-stone-500">
          {t('hr.fired.count').replace('{n}', String(rows.length))}
        </span>
      </div>

      <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <SortableTableHeader
                label={t('hr.col.employee')}
                sortKey="name"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hr.col.position')}
                sortKey="position"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hr.col.dept')}
                sortKey="department"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <th className="px-3 py-2">{t('hr.fired.terminationDate')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => (
              <tr key={emp.id} className="border-t border-grid hover:bg-stone-50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <EmployeePhoto
                      photoDataUrl={emp.photoDataUrl}
                      gender={emp.gender ?? 'unknown'}
                      className="h-9 w-9 shrink-0 rounded-sm object-cover ring-1 ring-grid opacity-80"
                    />
                    <BilingualText
                      lines={employeeNameLines(emp)}
                      className="font-medium leading-snug text-ink"
                    />
                    <span className="font-mono text-xs text-stone-400">№ {emp.tabNumber}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <BilingualText lines={employeePositionLines(emp)} className="text-xs text-stone-600" />
                </td>
                <td className="px-3 py-2">{emp.department ?? emp.brigade ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtDate(emp.terminationDate)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent hover:underline"
                    onClick={() => onOpenEmployee(emp)}
                  >
                    {t('hr.openCard')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-stone-400">{t('hr.fired.empty')}</p>
        )}
      </div>
    </div>
  )
}
