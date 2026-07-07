import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { SortableTableHeader } from '@/components/ui/SortableTableHeader'
import { citizenshipLabel } from '@/lib/hr/citizenship'
import type { EmployeeCitizenship } from '@/lib/hr/citizenship'
import { collectForeignPersonnelAlerts, listForeignPersonnel } from '@/lib/hr/inspector'
import { compareEmployees, type EmployeeSortKey } from '@/lib/hr/employeeSort'
import { applyTableSort, toggleTableSort, type TableSortState } from '@/lib/ui/tableSort'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function HrInspectorForeignPanel({ employees, selectedId, onSelect }: Props) {
  const { t, locale } = useI18n()
  const foreign = useMemo(() => listForeignPersonnel(employees), [employees])
  const alerts = useMemo(() => collectForeignPersonnelAlerts(employees), [employees])
  const [employeeSort, setEmployeeSort] = useState<
    TableSortState<EmployeeSortKey | 'alert'>
  >({ key: null, dir: 'asc' })

  function handleSort(key: EmployeeSortKey | 'alert') {
    setEmployeeSort((prev) => toggleTableSort(prev, key))
  }

  const sortedForeign = useMemo(() => {
    return applyTableSort(foreign, employeeSort, (a, b, key) => {
      if (key === 'alert') {
        const aa = alerts.some((x) => x.employeeId === a.id) ? 0 : 1
        const ab = alerts.some((x) => x.employeeId === b.id) ? 0 : 1
        if (aa !== ab) return aa - ab
        return compareEmployees(a, b, 'name', locale)
      }
      return compareEmployees(a, b, key, locale)
    })
  }, [foreign, employeeSort, alerts, locale])

  return (
    <div className="space-y-4">
      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('hrInspector.foreign.summary')}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-stone-500">{t('hrInspector.foreign.total')}</p>
            <p className="font-mono text-2xl font-bold text-ink">{foreign.length}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">{t('hrInspector.foreign.withAlerts')}</p>
            <p className="font-mono text-2xl font-bold text-amber-700">{alerts.length}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">{t('hrInspector.foreign.ok')}</p>
            <p className="font-mono text-2xl font-bold text-emerald-700">
              {Math.max(0, foreign.length - alerts.length)}
            </p>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="rounded-sm border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">
            {t('hrInspector.foreign.alertsTitle')}
          </h3>
          <ul className="mt-3 space-y-3">
            {alerts.map((row) => (
              <li key={row.employeeId} className="rounded-sm border border-amber-200/80 bg-white p-3">
                <button
                  type="button"
                  className="text-left text-sm font-semibold text-ink hover:text-accent"
                  onClick={() => onSelect(row.employeeId)}
                >
                  {row.employeeName}
                </button>
                <p className="mt-1 text-xs text-stone-500">
                  {row.position || '—'}
                  {row.citizenship
                    ? ` · ${citizenshipLabel(row.citizenship as EmployeeCitizenship, locale)}`
                    : ''}
                </p>
                {row.missingDocs.length > 0 && (
                  <p className="mt-2 text-xs text-red-700">
                    {t('hrInspector.foreign.missing')}: {row.missingDocs.join(', ')}
                  </p>
                )}
                {row.overdueDocs.length > 0 && (
                  <p className="mt-1 text-xs text-red-700">
                    {t('hrInspector.foreign.overdue')}:{' '}
                    {row.overdueDocs.map((d) => `${d.title} (${d.expiresAt})`).join('; ')}
                  </p>
                )}
                {row.expiringDocs.length > 0 && (
                  <p className="mt-1 text-xs text-amber-800">
                    {t('hrInspector.foreign.expiring')}:{' '}
                    {row.expiringDocs
                      .map((d) => `${d.title} (${d.days ?? '?'} ${t('hrInspector.days')})`)
                      .join('; ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <SortableTableHeader
                label={t('hr.col.employee')}
                sortKey="name"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hr.col.position')}
                sortKey="position"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hr.cec.citizenship')}
                sortKey="citizenship"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hr.col.dept')}
                sortKey="department"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
              <SortableTableHeader
                label={t('hrInspector.foreign.status')}
                sortKey="alert"
                activeKey={employeeSort.key}
                dir={employeeSort.dir}
                onSort={handleSort}
                className="px-3 py-2"
              />
            </tr>
          </thead>
          <tbody>
            {sortedForeign.map((emp) => {
              const alert = alerts.find((a) => a.employeeId === emp.id)
              const active = selectedId === emp.id
              return (
                <tr
                  key={emp.id}
                  className={`cursor-pointer border-t border-grid ${active ? 'bg-sky-50' : 'hover:bg-stone-50'}`}
                  onClick={() => onSelect(emp.id)}
                >
                  <td className="px-3 py-2 font-medium">{emp.fullName}</td>
                  <td className="px-3 py-2">{emp.position || '—'}</td>
                  <td className="px-3 py-2">
                    {citizenshipLabel(emp.citizenship as EmployeeCitizenship, locale)}
                  </td>
                  <td className="px-3 py-2">{emp.department ?? emp.brigade ?? '—'}</td>
                  <td className="px-3 py-2">
                    {alert ? (
                      <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        {t('hrInspector.foreign.needsAttention')}
                      </span>
                    ) : (
                      <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        {t('hrInspector.foreign.complete')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {foreign.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-500">
                  {t('hrInspector.foreign.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
