import { createDefaultFinanceStore, normalizeFinanceStore } from '@/lib/finance/init'
import { shiftMonth } from '@/lib/dates'
import { ensureMonth } from '@/lib/monthSheet'
import type { AppStore } from '@/lib/types'

export type MonthPurgeReport = {
  beforeMonth: string
  removedMonths: string[]
  keptMonths: string[]
  finance: {
    advances: number
    advanceDocuments: number
    advanceAccruals: number
    payoutDocuments: number
    adjustments: number
    payouts: number
    sickConfirmations: number
    vacationConfirmations: number
    snapshots: number
  }
  nightShiftDocs: number
  closedRemoved: number
  archivedRemoved: number
  closuresRemoved: number
  trashMonthsRemoved: number
}

function keepMonth(month: string | undefined, beforeMonth: string): boolean {
  if (!month || typeof month !== 'string') return true
  return month >= beforeMonth
}

/**
 * Удаляет табель и связанные финансы/ночные смены за месяцы строго раньше `beforeMonth`.
 * HR, склад, сотрудники, июль+ — не трогает.
 */
export function purgeMonthsBefore(
  store: AppStore,
  beforeMonth: string,
): { store: AppStore; report: MonthPurgeReport } {
  if (!/^\d{4}-\d{2}$/.test(beforeMonth)) {
    throw new Error(`bad_before_month:${beforeMonth}`)
  }

  const removedMonths: string[] = []
  const keptMonths: string[] = []
  const months: AppStore['months'] = {}
  for (const [key, sheet] of Object.entries(store.months ?? {})) {
    if (key < beforeMonth) {
      removedMonths.push(key)
    } else {
      months[key] = sheet
      keptMonths.push(key)
    }
  }
  removedMonths.sort()
  keptMonths.sort()

  const fin = normalizeFinanceStore(store.finance)
  const financeCounts = {
    advances: 0,
    advanceDocuments: 0,
    advanceAccruals: 0,
    payoutDocuments: 0,
    adjustments: 0,
    payouts: 0,
    sickConfirmations: 0,
    vacationConfirmations: 0,
    snapshots: 0,
  }

  const advances = fin.advances.filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.advances += 1
    return ok
  })
  const advanceDocuments = (fin.advanceDocuments ?? []).filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.advanceDocuments += 1
    return ok
  })
  const advanceAccruals = (fin.advanceAccruals ?? []).filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.advanceAccruals += 1
    return ok
  })
  const payoutDocuments = (fin.payoutDocuments ?? []).filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.payoutDocuments += 1
    return ok
  })
  const adjustments = fin.adjustments.filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.adjustments += 1
    return ok
  })
  const payouts = fin.payouts.filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.payouts += 1
    return ok
  })
  const sickConfirmations = fin.sickConfirmations.filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.sickConfirmations += 1
    return ok
  })
  const vacationConfirmations = fin.vacationConfirmations.filter((x) => {
    const ok = keepMonth(x.month, beforeMonth)
    if (!ok) financeCounts.vacationConfirmations += 1
    return ok
  })
  const snapshots: typeof fin.snapshots = {}
  for (const [key, snap] of Object.entries(fin.snapshots ?? {})) {
    if (key < beforeMonth) financeCounts.snapshots += 1
    else snapshots[key] = snap
  }

  const nightDocs = store.nightShifts?.documents ?? []
  let nightShiftDocs = 0
  const nextNightDocs = nightDocs.filter((d) => {
    const m = d.date?.slice(0, 7)
    const ok = keepMonth(m, beforeMonth)
    if (!ok) nightShiftDocs += 1
    return ok
  })

  const closedMonths = (store.closedMonths ?? []).filter((m) => m >= beforeMonth)
  const closedRemoved = (store.closedMonths ?? []).length - closedMonths.length
  const archivedMonths = (store.archivedMonths ?? []).filter((m) => m >= beforeMonth)
  const archivedRemoved = (store.archivedMonths ?? []).length - archivedMonths.length

  const monthClosures: NonNullable<AppStore['monthClosures']> = {}
  let closuresRemoved = 0
  for (const [key, meta] of Object.entries(store.monthClosures ?? {})) {
    if (key < beforeMonth) closuresRemoved += 1
    else monthClosures[key] = meta
  }

  const trashMonths = (store.trash?.months ?? []).filter((t) => {
    const key = t?.sheet?.month
    return !key || key >= beforeMonth
  })
  const trashMonthsRemoved = (store.trash?.months ?? []).length - trashMonths.length

  const next: AppStore = {
    ...store,
    months,
    closedMonths,
    archivedMonths,
    monthClosures,
    trash: {
      ...(store.trash ?? { employees: [], months: [], candidates: [] }),
      months: trashMonths,
    },
    finance: {
      ...createDefaultFinanceStore(),
      advances,
      advanceDocuments,
      advanceAccruals,
      payoutDocuments,
      adjustments,
      payouts,
      sickConfirmations,
      vacationConfirmations,
      snapshots,
    },
    nightShifts: {
      documents: nextNightDocs,
    },
  }

  return {
    store: next,
    report: {
      beforeMonth,
      removedMonths,
      keptMonths,
      finance: financeCounts,
      nightShiftDocs,
      closedRemoved,
      archivedRemoved,
      closuresRemoved,
      trashMonthsRemoved,
    },
  }
}

/** Гарантирует наличиещий и следующий месяц в сторе (без ручного «Добавить месяц»). */
export function ensureWorkingMonths(
  store: AppStore,
  aroundMonth: string,
  opts?: { alsoPrevious?: boolean },
): AppStore {
  let next = store
  const keys = [aroundMonth, shiftMonth(aroundMonth, 1)]
  if (opts?.alsoPrevious) keys.unshift(shiftMonth(aroundMonth, -1))
  for (const m of keys) {
    next = ensureMonth(next, m)
  }
  return next
}
