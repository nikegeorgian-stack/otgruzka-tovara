import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { splitEmployeeName } from '@/lib/hr/displayName'
import { employmentAgreementLabel, hrContractLabel } from '@/lib/hr/labels'
import { employeeSearchHr } from '@/lib/hr/sync'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
}

function contractLabel(emp: Employee, locale: 'ru' | 'ka'): string {
  if (emp.employmentAgreementKind) {
    return employmentAgreementLabel(emp.employmentAgreementKind, locale)
  }
  if (emp.contractType) {
    return hrContractLabel(emp.contractType, locale)
  }
  return '—'
}

export function WorkshopMasterRosterPanel({ employees }: Props) {
  const { t, locale, employeePositionLines } = useI18n()
  const [q, setQ] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  const departments = useMemo(() => {
    const s = new Set<string>()
    for (const e of employees) {
      if (e.department) s.add(e.department)
      else if (e.brigade) s.add(e.brigade)
    }
    return [...s].sort()
  }, [employees])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return employees
      .filter((e) => (e.hrStatus ?? 'active') !== 'fired' && e.active !== false)
      .filter((e) => {
        if (deptFilter && (e.department ?? e.brigade) !== deptFilter) return false
        if (!s) return true
        return employeeSearchHr(e).includes(s)
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
  }, [employees, q, deptFilter])

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">{t('workshopMaster.rosterHint')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-[14rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          placeholder={t('hr.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
        >
          <option value="">{t('hr.allDepartments')}</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">{t('workshopMaster.col.surname')}</th>
              <th className="px-3 py-2">{t('workshopMaster.col.firstName')}</th>
              <th className="px-3 py-2">{t('workshopMaster.col.position')}</th>
              <th className="px-3 py-2">{t('workshopMaster.col.contract')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const { surname, firstName } = splitEmployeeName(e.fullName)
              const pos = employeePositionLines(e)
              return (
                <tr key={e.id} className="border-t border-grid">
                  <td className="px-3 py-2 font-medium">{surname}</td>
                  <td className="px-3 py-2">{firstName}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{pos.primary}</div>
                    {pos.secondary && <div className="text-stone-500">{pos.secondary}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{contractLabel(e, locale)}</td>
                </tr>
              )
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-stone-500">
                  {t('employees.noSearchResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-stone-500">{t('workshopMaster.rosterReadOnly')}</p>
    </div>
  )
}
