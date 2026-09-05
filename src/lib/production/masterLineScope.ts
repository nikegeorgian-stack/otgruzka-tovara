/**
 * PHASE P1B — master/brigadier line assignment (fail-closed).
 */
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'
import type { ProductionLineId } from '@/lib/production/types'
import { resolveWorkshopMasterBrigades } from '@/lib/workshopMasterScope'

export function normalizeProductionLineId(raw: string | undefined): ProductionLineId | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (s === '1' || s === '2' || s === 'pack') return s
  if (s === 'line1' || s === 'line_1') return '1'
  if (s === 'line2' || s === 'line_2') return '2'
  if (s === 'packaging' || s === 'line_pack') return 'pack'
  return undefined
}

/** Derive impregnation line from brigade name heuristics (Пропитки №1.x → 1). */
export function lineIdFromBrigadeName(brigade: string): ProductionLineId | undefined {
  const b = brigade.toLowerCase()
  if (/№?\s*1[.．]|пропитк\w*\s*1|line\s*1/.test(b) || /\b1\.[12]\b/.test(b)) return '1'
  if (/№?\s*2[.．]|пропитк\w*\s*2|line\s*2/.test(b) || /\b2\.[12]\b/.test(b)) return '2'
  if (/упаков/.test(b) || /pack/.test(b)) return 'pack'
  return undefined
}

/**
 * Lines the master may operate. Empty = fail-closed (no access).
 * Priority: access.workshopMasterProductionLines[userId] → brigade heuristic → none.
 */
export function resolveWorkshopMasterLineIds(
  store: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>,
  user: AppUser | null | undefined,
  access?: AccessStore | null,
): ProductionLineId[] {
  if (!user?.active) return []
  if (user.roleId === 'operations_director' || user.roleId === 'sysadmin') {
    return ['1', '2', 'pack']
  }
  if (user.roleId !== 'workshop_master') return []

  const explicit = access?.workshopMasterProductionLines?.[user.id]
  if (Array.isArray(explicit)) {
    const lines = explicit
      .map((id) => normalizeProductionLineId(id))
      .filter((id): id is ProductionLineId => Boolean(id))
    return [...new Set(lines)]
  }

  const brigades = resolveWorkshopMasterBrigades(
    store as AppStore,
    user.login,
    user.employeeId,
    user.defaultBrigades,
    { fallbackToAll: false },
  )
  const fromBrigades = brigades
    .map(lineIdFromBrigadeName)
    .filter((id): id is ProductionLineId => Boolean(id))
  return [...new Set(fromBrigades)]
}

export function canMasterOperateLine(
  store: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>,
  user: AppUser | null | undefined,
  lineId: string,
  access?: AccessStore | null,
): boolean {
  if (!user?.active) return false
  if (user.roleId === 'operations_director' || user.roleId === 'sysadmin') return true
  if (user.roleId === 'warehouse_keeper') return false
  const allowed = resolveWorkshopMasterLineIds(store, user, access)
  const norm = normalizeProductionLineId(lineId)
  if (!norm) return false
  return allowed.includes(norm)
}
