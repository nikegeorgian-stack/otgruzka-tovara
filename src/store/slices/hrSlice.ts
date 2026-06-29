import { appendAudit } from '@/lib/audit'
import { clearPersonnelFromStore } from '@/lib/hr/clearPersonnel'
import { buildOrgStructureFromSeed } from '@/lib/hr/orgStructure'
import { syncPlanRow } from '@/lib/monthSheet'
import { trashEmployee } from '@/lib/trash'
import type { Employee, HrPosition, HrStructuralUnit } from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'

export function createHrSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertEmployee(emp: Employee) {
      setStore((s) => {
        const exists = s.employees.some((e) => e.id === emp.id)
        const employees = exists
          ? s.employees.map((e) => (e.id === emp.id ? emp : e))
          : [...s.employees, emp]
        let next = { ...s, employees }
        for (const [key, sheet] of Object.entries(next.months)) {
          let updated = sheet
          for (const row of sheet.rows) {
            if (row.employeeId === emp.id) {
              updated = syncPlanRow(updated, row.id, emp)
            }
          }
          next = { ...next, months: { ...next.months, [key]: updated } }
        }
        return next
      })
    },

    removeEmployee(id: string) {
      setStore((s) => {
        let next = trashEmployee(s, id)
        next = appendAudit(next, {
          action: 'employee_remove',
          employeeId: id,
          detail: `employee ${id}`,
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
        const exists = s.hrPositions.some((p) => p.id === nextPosition.id)
        const hrPositions = exists
          ? s.hrPositions.map((p) => (p.id === nextPosition.id ? nextPosition : p))
          : [...s.hrPositions, nextPosition]
        return { ...s, hrPositions }
      })
    },

    removeHrPosition(id: string) {
      setStore((s) => ({
        ...s,
        hrPositions: s.hrPositions.filter((p) => p.id !== id),
      }))
    },

    upsertHrStructuralUnit(unit: HrStructuralUnit) {
      setStore((s) => {
        const exists = s.hrStructuralUnits.some((u) => u.id === unit.id)
        const hrStructuralUnits = exists
          ? s.hrStructuralUnits.map((u) => (u.id === unit.id ? unit : u))
          : [...s.hrStructuralUnits, unit]
        const hrPositions = s.hrPositions.map((p) =>
          p.structuralUnitId === unit.id ? { ...p, department: unit.name } : p,
        )
        const employees = s.employees.map((e) =>
          e.structuralUnitId === unit.id ? { ...e, department: unit.name } : e,
        )
        return { ...s, hrStructuralUnits, hrPositions, employees }
      })
    },

    removeHrStructuralUnit(id: string) {
      setStore((s) => ({
        ...s,
        hrStructuralUnits: s.hrStructuralUnits.filter((u) => u.id !== id),
        hrPositions: s.hrPositions.map((p) =>
          p.structuralUnitId === id ? { ...p, structuralUnitId: undefined } : p,
        ),
        employees: s.employees.map((e) =>
          e.structuralUnitId === id ? { ...e, structuralUnitId: undefined } : e,
        ),
      }))
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
          { action: 'bulk', detail: 'org structure seed import' },
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
        })
      })
    },

    clearAllPersonnel() {
      setStore((s) => {
        const { store: next, stats } = clearPersonnelFromStore(s)
        return appendAudit(next, {
          action: 'bulk',
          detail: `clear personnel: ${stats.employees} employees, ${stats.candidates} candidates`,
        })
      })
    },
  }
}
