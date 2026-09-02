import type { Employee, MonthRowBounds, MonthSheet } from './types'

/** Снимок графика строки табеля (для нормы/ставки при смене расписания с даты). */
export function scheduleSnapshotFromEmployee(
  emp: Pick<Employee, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode' | 'cycleStart'>,
): Pick<MonthRowBounds, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode' | 'cycleStart'> {
  return {
    schedule: emp.schedule,
    shiftHours: emp.shiftHours,
    group2x2: emp.group2x2,
    shiftMode: emp.shiftMode,
    cycleStart: emp.cycleStart,
  }
}

/**
 * Карточка HR + снимок графика строки (если задан в rowBounds).
 * После перевода с даты в карточке новый график, а ранняя строка месяца
 * должна считаться по старому — иначе норма и ₾/ч будут неверны.
 */
export function employeeForTimesheetRow(
  emp: Employee,
  sheet: MonthSheet,
  rowId: string,
): Employee {
  const b = sheet.rowBounds?.[rowId]
  if (!b?.schedule) return emp
  return {
    ...emp,
    schedule: b.schedule,
    shiftHours: b.shiftHours ?? emp.shiftHours,
    group2x2: b.group2x2 ?? emp.group2x2,
    shiftMode: b.shiftMode ?? emp.shiftMode,
    cycleStart: b.cycleStart ?? emp.cycleStart,
  }
}
