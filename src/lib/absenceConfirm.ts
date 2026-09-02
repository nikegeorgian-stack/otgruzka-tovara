import { planHoursForCode } from '@/lib/hr/absencePlan'
import { getFinance } from '@/lib/finance/calc'
import type { AppStore, DayCode, Employee } from '@/lib/types'

export type AbsenceConfirmState = {
  sickConfirmed?: boolean
  vacationConfirmed?: boolean
}

export function absenceConfirmForEmployee(
  store: AppStore,
  employeeId: string,
  month: string,
): AbsenceConfirmState {
  const fin = getFinance(store)
  return {
    sickConfirmed: fin.sickConfirmations.some(
      (c: { employeeId: string; month: string }) =>
        c.employeeId === employeeId && c.month === month,
    ),
    vacationConfirmed: fin.vacationConfirmations.some(
      (c: { employeeId: string; month: string }) =>
        c.employeeId === employeeId && c.month === month,
    ),
  }
}

export function isAbsenceConfirmed(code: DayCode, confirm?: AbsenceConfirmState): boolean {
  if (code === 'Б') return confirm?.sickConfirmed === true
  if (code === 'ОТ') return confirm?.vacationConfirmed === true
  return true
}

/** Часы зачёта по плану за подтверждённое отсутствие; без подтверждения — 0. */
export function creditedAbsenceHours(
  emp: Employee,
  year: number,
  month: number,
  day: number,
  code: DayCode,
  confirm?: AbsenceConfirmState,
): number {
  if (code !== 'Б' && code !== 'ОТ') return 0
  if (!isAbsenceConfirmed(code, confirm)) return 0
  return planHoursForCode(emp, year, month, day, code)
}

/**
 * Неподтверждённый Б/ОТ не зачитывается в оплату (как отсутствие без оплаты).
 * Не смешивать с кодом «ПР» (простой) в итогах табеля — иначе отпуск выглядит как простой.
 */
export function unconfirmedAbsenceCountsAsPr(code: DayCode, confirm?: AbsenceConfirmState): boolean {
  if (code === 'Б' || code === 'ОТ') return !isAbsenceConfirmed(code, confirm)
  return false
}
