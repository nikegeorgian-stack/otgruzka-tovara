import type { AppStore, Employee, HrStructuralUnit } from './types'

/** id структурного подразделения, к которому привязана бригада (или undefined). */
export function brigadeUnitId(store: Pick<AppStore, 'brigadeUnits'>, brigade: string): string | undefined {
  const id = store.brigadeUnits?.[brigade]
  return id || undefined
}

/** Подразделение бригады как объект (или undefined). */
export function brigadeUnit(
  store: Pick<AppStore, 'brigadeUnits' | 'hrStructuralUnits'>,
  brigade: string,
): HrStructuralUnit | undefined {
  const id = brigadeUnitId(store, brigade)
  if (!id) return undefined
  return store.hrStructuralUnits.find((u) => u.id === id)
}

/**
 * Always-sync: проставляет сотруднику структурное подразделение и department
 * из подразделения его бригады. Если у бригады подразделение не задано —
 * сотрудник возвращается без изменений.
 */
export function syncEmployeeUnitFromBrigade<T extends Employee>(
  emp: T,
  store: Pick<AppStore, 'brigadeUnits' | 'hrStructuralUnits'>,
  brigade: string,
): T {
  const unit = brigadeUnit(store, brigade)
  if (!unit) return emp
  if (emp.structuralUnitId === unit.id && emp.department === unit.name) return emp
  return { ...emp, structuralUnitId: unit.id, department: unit.name }
}
