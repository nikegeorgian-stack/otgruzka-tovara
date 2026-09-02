import { monthStatement } from '@/lib/finance/calc'
import type { AppStore } from '@/lib/types'

export type UnconfirmedAbsenceItem = {
  employeeId: string
  employeeName: string
  brigade: string
  sickDays: number
  vacationDays: number
}

export type UnconfirmedAbsencesSummary = {
  sickCount: number
  vacationCount: number
  items: UnconfirmedAbsenceItem[]
}

/** Сотрудники с Б/ОТ в факте без подтверждения финансов за месяц. */
export function collectUnconfirmedAbsences(
  store: AppStore,
  month: string,
  asOfDate?: string,
): UnconfirmedAbsencesSummary {
  const items: UnconfirmedAbsenceItem[] = []
  let sickCount = 0
  let vacationCount = 0

  for (const r of monthStatement(store, month, asOfDate)) {
    const sickPending = r.sickDates.length > 0 && !r.sickConfirmed
    const vacPending = r.vacationDates.length > 0 && !r.vacationConfirmed
    if (!sickPending && !vacPending) continue
    if (sickPending) sickCount++
    if (vacPending) vacationCount++
    items.push({
      employeeId: r.employeeId,
      employeeName: r.emp.fullName,
      brigade: r.brigade ?? '',
      sickDays: sickPending ? r.sickDates.length : 0,
      vacationDays: vacPending ? r.vacationDates.length : 0,
    })
  }

  return { sickCount, vacationCount, items }
}

export function hasUnconfirmedAbsences(summary: UnconfirmedAbsencesSummary): boolean {
  return summary.sickCount > 0 || summary.vacationCount > 0
}
