import { employeeName } from '@/i18n'
import type { AppStore } from '@/lib/types'
import { resolveWorkshopMasterBrigades } from '@/lib/workshopMasterScope'
import type { AppUser, WorkshopMasterCoverage } from './types'
import {
  coveragesOverlappingMonthForUser,
  mergeBrigadeLists,
} from './workshopMasterCoverage'

export type CoverageFocusId = 'all' | 'mine' | `cov:${string}`

export type CoverageFocusChip = {
  id: CoverageFocusId
  /** Краткий ярлык на кнопке */
  label: string
  /** Подсказка */
  title: string
  brigades: string[]
}

function absentMasterLabel(
  store: AppStore,
  absentUserId: string,
  locale: 'ru' | 'ka',
): string {
  const user = store.access.users.find((u) => u.id === absentUserId)
  if (user?.employeeId) {
    const emp = store.employees.find((e) => e.id === user.employeeId)
    if (emp) return employeeName(emp, locale)
  }
  if (user?.displayName?.trim()) return user.displayName.trim()
  if (user?.login?.trim()) return user.login.trim()
  return absentUserId.slice(0, 8)
}

function intersectKnown(brigades: string[], known: Set<string>): string[] {
  return brigades.filter((b) => known.has(b))
}

/**
 * Чипы переключения «мои / подмена конкретного мастера / все» —
 * только если у текущего пользователя есть проведённая подмена на месяц.
 */
export function buildCoverageFocusChips(
  store: AppStore,
  coverUser: AppUser | null | undefined,
  monthKey: string,
  locale: 'ru' | 'ka',
  labels: { all: string; mine: string; coverTitle: (name: string, to: string) => string },
): CoverageFocusChip[] {
  if (!coverUser?.id || coverUser.roleId !== 'workshop_master') return []
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return []

  const coverages = coveragesOverlappingMonthForUser(
    store.access,
    coverUser.id,
    monthKey,
  )
  if (coverages.length === 0) return []

  const known = new Set(store.brigades)
  const mine = resolveWorkshopMasterBrigades(
    store,
    coverUser.login,
    coverUser.employeeId,
    coverUser.defaultBrigades,
    { fallbackToAll: false },
  ).filter((b) => known.has(b))

  const coverChips: CoverageFocusChip[] = coverages.map((c) => {
    const name = absentMasterLabel(store, c.absentUserId, locale)
    const brigades = intersectKnown(c.brigades, known)
    return {
      id: `cov:${c.id}`,
      label: name,
      title: labels.coverTitle(name, c.toDate),
      brigades,
    }
  })

  const allBrigades = mergeBrigadeLists(
    mine,
    ...coverChips.map((c) => c.brigades),
  )

  return [
    {
      id: 'mine',
      label: labels.mine,
      title: labels.mine,
      brigades: mine,
    },
    ...coverChips,
    {
      id: 'all',
      label: labels.all,
      title: labels.all,
      brigades: allBrigades,
    },
  ]
}

export function brigadesForFocusId(
  chips: CoverageFocusChip[],
  focusId: CoverageFocusId,
): string[] | null {
  const chip = chips.find((c) => c.id === focusId)
  return chip ? chip.brigades : null
}

/** Активные подмены для баннера (уникальные по id). */
export function uniqueMonthCoveragesForUser(
  store: AppStore,
  coverUserId: string | undefined | null,
  monthKey: string,
): WorkshopMasterCoverage[] {
  return coveragesOverlappingMonthForUser(store.access, coverUserId, monthKey)
}
