import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { employeeSearchHr } from '@/lib/hr/sync'
import {
  applyPositionToEmployee,
  isEmployeeOnPosition,
} from '@/lib/hr/orgStructure'
import type { Employee, HrPosition, HrStructuralUnit } from '@/lib/types'

type Props = {
  position: HrPosition | null
  unit?: HrStructuralUnit
  units: HrStructuralUnit[]
  employees: Employee[]
  onSaveEmployee: (e: Employee) => void
  onClose: () => void
}

export function PositionStaffAssignDialog({
  position,
  unit,
  units,
  employees,
  onSaveEmployee,
  onClose,
}: Props) {
  const { t, tf, employeeName } = useI18n()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const open = position !== null

  useEffect(() => {
    if (!position) {
      setSelected(new Set())
      setQ('')
      return
    }
    const ids = employees.filter((e) => isEmployeeOnPosition(e, position)).map((e) => e.id)
    setSelected(new Set(ids))
    setQ('')
  }, [position, employees])

  const filtered = useMemo(() => {
    const list = employees.filter((e) => e.active !== false)
    if (!q.trim()) return list
    const s = q.toLowerCase()
    return list.filter((e) => employeeSearchHr(e).includes(s))
  }, [employees, q])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function save() {
    if (!position) return
    for (const emp of employees) {
      const wasOn = isEmployeeOnPosition(emp, position)
      const shouldBe = selected.has(emp.id)
      if (shouldBe && !wasOn) {
        onSaveEmployee(applyPositionToEmployee(emp, position, units))
      } else if (!shouldBe && wasOn) {
        onSaveEmployee({
          ...emp,
          positionId: undefined,
          structuralUnitId: undefined,
        })
      }
    }
    onClose()
  }

  if (!position) return null

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={tf('orgStructure.assignStaffTitle', { title: position.title })}
      size="md"
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-stone-600">
          {unit?.name ?? position.department}
          {' · '}
          {tf('orgStructure.assignStaffHint', { n: selected.size })}
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('orgStructure.assignStaffSearch')}
          autoFocus
        />
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-sm border border-grid p-2">
          {filtered.length === 0 ? (
            <li className="px-2 py-4 text-center text-sm text-stone-500">
              {t('orgStructure.assignStaffEmpty')}
            </li>
          ) : (
            filtered.map((emp) => (
              <li key={emp.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={selected.has(emp.id)}
                    onChange={() => toggle(emp.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {employeeName(emp)}
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      {emp.position || t('orgStructure.noPosition')}
                      {emp.department ? ` · ${emp.department}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
