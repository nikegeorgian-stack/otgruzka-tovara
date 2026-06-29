import { activeStructuralUnits } from './monthViewOptions'
import type { AppStore, HrStructuralUnit } from './types'

/** Штатные подразделения — не для кабинета мастера цеха (только бригады). */
export const OFFICE_STRUCTURAL_UNIT_NAMES = [
  'Управление',
  'Аппарат управления',
  'Служба коммерческого директора',
  'Служба финансового директора',
  'Служба операционного директора',
] as const

/** Бригады по учёткам мастеров (можно расширить в настройках). */
export const WORKSHOP_MASTER_BRIGADES: Record<string, string[]> = {
  'master-karlo@fibercell.net': ['Бригада пропитки №1.1', 'Бригада пропитки №1.2'],
  'master-valera@fibercell.net': ['Бригада пропитки №2.1', 'Бригада пропитки №2.2'],
}

export function isOfficeStructuralUnit(
  unit: HrStructuralUnit | undefined,
): boolean {
  if (!unit) return false
  return (OFFICE_STRUCTURAL_UNIT_NAMES as readonly string[]).includes(unit.name)
}

export function timesheetStructuralUnits(
  units: HrStructuralUnit[],
  workshopMasterMode: boolean,
): HrStructuralUnit[] {
  if (workshopMasterMode) return []
  return activeStructuralUnits(units)
}

export function resolveWorkshopMasterBrigades(
  store: AppStore,
  userLogin: string | undefined,
  linkedEmployeeId?: string | null,
): string[] {
  if (linkedEmployeeId) {
    const byBrigadier = store.brigades.filter(
      (brigade) => store.brigadiers?.[brigade] === linkedEmployeeId,
    )
    if (byBrigadier.length > 0) return byBrigadier

    const emp = store.employees.find((e) => e.id === linkedEmployeeId)
    if (emp?.brigade && store.brigades.includes(emp.brigade)) {
      return [emp.brigade]
    }
  }

  const login = userLogin?.trim().toLowerCase()
  if (login && WORKSHOP_MASTER_BRIGADES[login]?.length) {
    const mapped = WORKSHOP_MASTER_BRIGADES[login].filter((b) =>
      store.brigades.includes(b),
    )
    if (mapped.length > 0) return mapped
  }

  const byBrigadier = store.brigades.filter((brigade) => {
    const brigadierId = store.brigadiers?.[brigade]
    if (!brigadierId) return false
    const emp = store.employees.find((e) => e.id === brigadierId)
    if (!emp) return false
    if (login && emp.email?.trim().toLowerCase() === login) return true
    return false
  })
  if (byBrigadier.length > 0) return byBrigadier

  return [...store.brigades]
}

/** Сотрудники выбранных бригад (для журнала явки мастера). */
export function employeesInBrigades(
  employees: AppStore['employees'],
  brigades: string[],
): AppStore['employees'] {
  const set = new Set(brigades)
  return employees.filter((e) => e.active && set.has(e.brigade))
}
