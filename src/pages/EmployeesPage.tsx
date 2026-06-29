import { useMemo, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { hrStatusLabel } from '@/lib/hr/labels'
import { employeeSearchHr } from '@/lib/hr/sync'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  onSave: (e: Employee) => void
  onRemove: (id: string) => void
  embedded?: boolean
}

export function EmployeesPage({
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onSave,
  onRemove,
  embedded = false,
}: Props) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
  const { confirm } = useConfirm()
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const editor = useEmployeeEditor(brigades, employees)

  const filtered = useMemo(() => {
    const list = employees.filter((e) => showInactive || e.active)
    if (!q.trim()) return list
    const s = q.toLowerCase()
    return list.filter((e) => employeeSearchHr(e).includes(s))
  }, [employees, q, showInactive])

  return (
    <div className={`flex flex-col gap-4 ${embedded ? '' : 'p-5'}`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        {!embedded && (
          <div>
            <h2 className="text-xl font-bold text-ink">{t('employees.title')}</h2>
            <p className="text-sm text-ink-muted">
              {t('employees.activeCount')}: {employees.filter((e) => e.active).length} ·{' '}
              {t('employees.totalCount')}: {employees.length}
            </p>
          </div>
        )}
        {embedded && (
          <p className="text-sm text-stone-500">
            {t('employees.activeCount')}: {employees.filter((e) => e.active).length} ·{' '}
            {t('employees.totalCount')}: {employees.length}
          </p>
        )}
        <Button variant="success" onClick={() => editor.openNew()}>
          {t('employees.add')}
        </Button>
      </header>

      <div className="flex flex-wrap gap-3">
        <Input
          className="min-w-[14rem] flex-1"
          placeholder={t('employees.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('employees.showInactive')}
        </label>
      </div>

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full">
          <thead>
            <tr>
              <th>{t('employees.colTab')}</th>
              <th>{t('employees.colName')}</th>
              <th>{t('employees.colPosition')}</th>
              <th>{t('employees.colBrigade')}</th>
              <th>{t('employees.colSchedule')}</th>
              <th>{t('employees.status')}</th>
              <th>{t('employees.colGroup')}</th>
              <th>{t('employees.colPay')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-stone-500">
                  {t('employees.noSearchResults')}
                </td>
              </tr>
            ) : (
              filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-paper/50">
                  <td className="font-mono text-xs">{emp.tabNumber}</td>
                  <td className="font-medium">
                    <BilingualText lines={employeeNameLines(emp)} />
                  </td>
                  <td className="max-w-[14rem] text-stone-600">
                    <BilingualText lines={employeePositionLines(emp)} />
                  </td>
                  <td className="text-xs">{emp.brigade || '—'}</td>
                  <td className="text-xs">{emp.schedule}</td>
                  <td className="text-xs">
                    {hrStatusLabel(emp.hrStatus ?? 'active', locale)}
                    {emp.statusUntil ? ` (${emp.statusUntil})` : ''}
                  </td>
                  <td className="font-mono text-xs">{emp.group2x2 || '—'}</td>
                  <td className="font-mono text-xs">
                    {emp.schedule === '5/2 8ч'
                      ? emp.monthlySalary
                        ? `${emp.monthlySalary.toLocaleString('ru-RU')} ₾`
                        : '—'
                      : emp.hourlyRate
                        ? `${emp.hourlyRate.toLocaleString('ru-RU')} ₾/ч`
                        : '—'}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => editor.openEdit(emp)}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={async () => {
                          if (await confirm({ message: t('employees.confirmDelete'), danger: true })) {
                            onRemove(emp.id)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <EmployeeEditorHost
        ctx={editor.ctx}
        employees={employees}
        brigades={brigades}
        hrStructuralUnits={hrStructuralUnits}
        hrPositions={hrPositions}
        onSave={onSave}
        onClose={editor.close}
      />
    </div>
  )
}
