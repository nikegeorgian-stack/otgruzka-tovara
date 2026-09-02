import { appendAudit } from '@/lib/audit'
import { clearPersonnelFromStore } from '@/lib/hr/clearPersonnel'
import { absencesChanged, syncAbsencesToTimesheetFact } from '@/lib/hr/absenceTimesheet'
import { lockEmployeeNumber } from '@/lib/hr/employeeNumber'
import { applyEmployeeMovementJournal } from '@/lib/hr/movementJournal'
import { buildOrgStructureFromSeed } from '@/lib/hr/orgStructure'
import { normalizeEmploymentStatus } from '@/lib/hr/sync'
import { syncPlanRow } from '@/lib/monthSheet'
import { withScheduleDefaults } from '@/lib/scheduleHeal'
import { trashEmployee } from '@/lib/trash'
import type { Employee, HrPosition, HrStructuralUnit } from '@/lib/types'
import { actorAuditFields } from './actorAuditFields'
import type { StoreSliceDeps } from '../storeApi'

export function createHrSlice({ setStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  return {
    upsertEmployee(emp: Employee) {
      setStore((s) => {
        const prev = s.employees.find((e) => e.id === emp.id)
        const locked = lockEmployeeNumber(emp, prev, s.employees)
        const draft = {
          ...withScheduleDefaults(locked),
          employmentStatus: normalizeEmploymentStatus(locked),
        }
        const normalized = applyEmployeeMovementJournal(prev, draft)
        const exists = !!prev
        const employees = exists
          ? s.employees.map((e) => (e.id === normalized.id ? normalized : e))
          : [...s.employees, normalized]
        let next = { ...s, employees }
        for (const [key, sheet] of Object.entries(next.months)) {
          let updated = sheet
          for (const row of sheet.rows) {
            if (row.employeeId === normalized.id) {
              updated = syncPlanRow(updated, row.id, normalized)
            }
          }
          next = { ...next, months: { ...next.months, [key]: updated } }
        }
        if (!prev || absencesChanged(prev.hrAbsences, normalized.hrAbsences)) {
          next = syncAbsencesToTimesheetFact(next, normalized.id, normalized.hrAbsences)
        }
        const parts = [normalized.fullName]
        if (exists && prev) {
          if ((prev.fullName || '').trim() !== (normalized.fullName || '').trim()) {
            parts.push(`ФИО: ${prev.fullName} → ${normalized.fullName}`)
          }
          if ((prev.nameKa || '').trim() !== (normalized.nameKa || '').trim()) {
            parts.push(`KA: ${prev.nameKa || '—'} → ${normalized.nameKa || '—'}`)
          }
          if ((prev.nameEn || '').trim() !== (normalized.nameEn || '').trim()) {
            parts.push(`EN: ${prev.nameEn || '—'} → ${normalized.nameEn || '—'}`)
          }
          if (prev.brigade !== normalized.brigade) {
            parts.push(`бригада: ${prev.brigade ?? '—'} → ${normalized.brigade ?? '—'}`)
          }
          if (prev.position !== normalized.position) {
            parts.push(`должность: ${prev.position ?? '—'} → ${normalized.position ?? '—'}`)
          }
          if ((prev.monthlySalary ?? 0) !== (normalized.monthlySalary ?? 0)) {
            parts.push(`ЗП: ${prev.monthlySalary ?? '—'} → ${normalized.monthlySalary ?? '—'}`)
          }
        } else {
          parts.push(normalized.brigade ? `бригада ${normalized.brigade}` : 'новый сотрудник')
          if (normalized.employeeNumber) {
            parts.push(`инд. № ${normalized.employeeNumber}`)
          }
        }
        return appendAudit(next, {
          action: 'employee_upsert',
          employeeId: normalized.id,
          detail: parts.join(' · '),
          oldValue: exists && prev ? prev.fullName : undefined,
          newValue: normalized.fullName,
          ...who(),
        })
      })
    },

    removeEmployee(id: string) {
      setStore((s) => {
        const emp = s.employees.find((e) => e.id === id)
        let next = trashEmployee(s, id)
        next = appendAudit(next, {
          action: 'employee_remove',
          employeeId: id,
          detail: emp?.fullName ?? `employee ${id}`,
          ...who(),
        })
        return next
      })
    },

    upsertHrPosition(position: HrPosition) {
      setStore((s) => {
        const unit = s.hrStructuralUnits.find((u) => u.id === position.structuralUnitId)
        const nextPosition: HrPosition = {
          ...position,
          department: unit?.name ?? position.department,
        }
        const prev = s.hrPositions.find((p) => p.id === nextPosition.id)
        const exists = !!prev
        const hrPositions = exists
          ? s.hrPositions.map((p) => (p.id === nextPosition.id ? nextPosition : p))
          : [...s.hrPositions, nextPosition]
        return appendAudit(
          { ...s, hrPositions },
          {
            action: 'directory_change',
            detail: exists
              ? `Должность: ${prev?.title ?? '—'} → ${nextPosition.title}`
              : `Должность создана: ${nextPosition.title}`,
            oldValue: prev?.title,
            newValue: nextPosition.title,
            ...who(),
          },
        )
      })
    },

    removeHrPosition(id: string) {
      setStore((s) => {
        const prev = s.hrPositions.find((p) => p.id === id)
        return appendAudit(
          { ...s, hrPositions: s.hrPositions.filter((p) => p.id !== id) },
          {
            action: 'directory_change',
            detail: `Должность удалена: ${prev?.title ?? id}`,
            oldValue: prev?.title,
            ...who(),
          },
        )
      })
    },

    upsertHrStructuralUnit(unit: HrStructuralUnit) {
      setStore((s) => {
        const prev = s.hrStructuralUnits.find((u) => u.id === unit.id)
        const exists = !!prev
        const hrStructuralUnits = exists
          ? s.hrStructuralUnits.map((u) => (u.id === unit.id ? unit : u))
          : [...s.hrStructuralUnits, unit]
        const hrPositions = s.hrPositions.map((p) =>
          p.structuralUnitId === unit.id ? { ...p, department: unit.name } : p,
        )
        const employees = s.employees.map((e) =>
          e.structuralUnitId === unit.id ? { ...e, department: unit.name } : e,
        )
        return appendAudit(
          { ...s, hrStructuralUnits, hrPositions, employees },
          {
            action: 'directory_change',
            detail: exists
              ? `Подразделение: ${prev?.name ?? '—'} → ${unit.name}`
              : `Подразделение создано: ${unit.name}`,
            oldValue: prev?.name,
            newValue: unit.name,
            ...who(),
          },
        )
      })
    },

    removeHrStructuralUnit(id: string) {
      setStore((s) => {
        const prev = s.hrStructuralUnits.find((u) => u.id === id)
        return appendAudit(
          {
            ...s,
            hrStructuralUnits: s.hrStructuralUnits.filter((u) => u.id !== id),
            hrPositions: s.hrPositions.map((p) =>
              p.structuralUnitId === id ? { ...p, structuralUnitId: undefined } : p,
            ),
            employees: s.employees.map((e) =>
              e.structuralUnitId === id ? { ...e, structuralUnitId: undefined } : e,
            ),
          },
          {
            action: 'directory_change',
            detail: `Подразделение удалено: ${prev?.name ?? id}`,
            oldValue: prev?.name,
            ...who(),
          },
        )
      })
    },

    importOrgStructureFromSeed() {
      setStore((s) => {
        const seeded = buildOrgStructureFromSeed()
        return appendAudit(
          {
            ...s,
            hrStructuralUnits: seeded.units,
            hrPositions: seeded.positions,
          },
          { action: 'bulk', detail: 'org structure seed import', ...who() },
        )
      })
    },

    importEmployeeRegistry(employees: Employee[]) {
      setStore((s) => {
        const byId = new Map(employees.map((e) => [e.id, e]))
        let next = { ...s, employees }
        for (const [key, sheet] of Object.entries(next.months)) {
          let updated = sheet
          for (const row of sheet.rows) {
            if (row.employeeId && byId.has(row.employeeId)) {
              updated = syncPlanRow(updated, row.id, byId.get(row.employeeId)!)
            }
          }
          next = { ...next, months: { ...next.months, [key]: updated } }
        }
        return appendAudit(next, {
          action: 'bulk',
          detail: `registry import: ${employees.length} employees`,
          ...who(),
        })
      })
    },

    clearAllPersonnel() {
      setStore((s) => {
        const { store: next, stats } = clearPersonnelFromStore(s)
        return appendAudit(next, {
          action: 'bulk',
          detail: `clear personnel: ${stats.employees} employees, ${stats.candidates} candidates`,
          ...who(),
        })
      })
    },
  }
}
