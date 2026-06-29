import type { AppStore } from '@/lib/types'

export type ClearPersonnelStats = {
  employees: number
  candidates: number
  trashEmployees: number
  trashCandidates: number
}

/** Полная очистка персонала перед повторным импортом реестра. */
export function clearPersonnelFromStore(store: AppStore): {
  store: AppStore
  stats: ClearPersonnelStats
} {
  const stats: ClearPersonnelStats = {
    employees: store.employees.length,
    candidates: store.candidates.length,
    trashEmployees: store.trash?.employees?.length ?? 0,
    trashCandidates: store.trash?.candidates?.length ?? 0,
  }

  const months = { ...store.months }
  for (const [key, sheet] of Object.entries(months)) {
    months[key] = {
      ...sheet,
      rows: sheet.rows.map((r) => ({ ...r, employeeId: null })),
      substitutions: {},
    }
  }

  const trash = store.trash ?? { employees: [], months: [], candidates: [] }

  return {
    store: {
      ...store,
      employees: [],
      candidates: [],
      trash: { ...trash, employees: [], candidates: [] },
      months,
      workwear: store.workwear ? { ...store.workwear, issuances: [] } : store.workwear,
    },
    stats,
  }
}
