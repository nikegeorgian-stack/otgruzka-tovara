import { brigadeAssignedCount, brigadeMismatchCount } from './brigadeStats'
import { monthStats } from './stats'
import type { AppStore, MonthSheet } from './types'

export type BrigadeSummaryRow = {
  brigade: string
  employees: number
  planHours: number
  factHours: number
  deviation: number
  factShifts: number
  mismatches: number
}

export function brigadeSummaryRows(
  store: AppStore,
  sheet: MonthSheet,
  brigades: string[],
): BrigadeSummaryRow[] {
  return brigades.map((brigade) => {
    const stats = monthStats(sheet, store.employees, { brigades: [brigade] })
    return {
      brigade,
      employees: brigadeAssignedCount(sheet, brigade),
      planHours: stats.planHours,
      factHours: stats.factHours,
      deviation: stats.deviation,
      factShifts: stats.factShifts,
      mismatches: brigadeMismatchCount(store, sheet, brigade),
    }
  })
}

export function brigadeSummaryTotals(rows: BrigadeSummaryRow[]): Omit<BrigadeSummaryRow, 'brigade'> {
  return rows.reduce(
    (acc, row) => ({
      employees: acc.employees + row.employees,
      planHours: acc.planHours + row.planHours,
      factHours: acc.factHours + row.factHours,
      deviation: acc.deviation + row.deviation,
      factShifts: acc.factShifts + row.factShifts,
      mismatches: acc.mismatches + row.mismatches,
    }),
    {
      employees: 0,
      planHours: 0,
      factHours: 0,
      deviation: 0,
      factShifts: 0,
      mismatches: 0,
    },
  )
}
