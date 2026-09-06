import type { AppStore } from '@/lib/types'
import { nextOperationId, type DirtyOperation } from './dirtyOperations'
import type { StoreMutationOrigin } from './storeMutationOrigin'
import { STABLE_ID_COLLECTION_PATHS, getPathValue } from './stableIdPaths'
import { diffMonthsToOperations } from './timesheetCellOps'
import { eqJsonStable as eqJson } from './stableJsonEq'

type IdEntity = { id: string }

function asIdArray(value: unknown): IdEntity[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return []
  if (value.every((x) => x && typeof x === 'object' && typeof (x as IdEntity).id === 'string')) {
    return value as IdEntity[]
  }
  return null
}

function diffIdArray(
  domain: string,
  before: unknown,
  after: unknown,
  baseRevision: number,
  origin: StoreMutationOrigin,
): DirtyOperation[] {
  const beforeArr = asIdArray(before)
  const afterArr = asIdArray(after)
  if (!beforeArr && !afterArr) return []
  const ops: DirtyOperation[] = []
  const bMap = new Map((beforeArr ?? []).map((e) => [e.id, e]))
  const aMap = new Map((afterArr ?? []).map((e) => [e.id, e]))
  const at = new Date().toISOString()

  for (const [id, av] of aMap) {
    const bv = bMap.get(id)
    if (!bv) {
      ops.push({
        operationId: nextOperationId(),
        type: 'create',
        domain,
        entityId: id,
        fields: ['*'],
        baseRevision,
        origin,
        at,
      })
    } else if (!eqJson(bv, av)) {
      ops.push({
        operationId: nextOperationId(),
        type: 'update',
        domain,
        entityId: id,
        fields: ['*'],
        baseRevision,
        origin,
        at,
      })
    }
  }
  // Intentionally NO delete from absence — only recordExplicitDelete may enqueue deletes.
  return ops
}

const COMPOSITE_ROOTS_WITH_STABLE_PATHS = new Set(
  STABLE_ID_COLLECTION_PATHS.map((p) => p.split('.')[0]!),
)

/**
 * Infer create/update dirty ops from a user store transition.
 * Never emits delete operations.
 */
export function diffStoreToOperations(
  before: AppStore,
  after: AppStore,
  baseRevision: number,
  origin: StoreMutationOrigin,
): DirtyOperation[] {
  if (origin !== 'user') return []
  const ops: DirtyOperation[] = []

  for (const path of STABLE_ID_COLLECTION_PATHS) {
    ops.push(
      ...diffIdArray(
        path,
        getPathValue(before, path),
        getPathValue(after, path),
        baseRevision,
        origin,
      ),
    )
  }

  if (!eqJson(before.months, after.months)) {
    ops.push(...diffMonthsToOperations(before.months, after.months, baseRevision, origin))
  }
  if (!eqJson(before.settings, after.settings)) {
    ops.push({
      operationId: nextOperationId(),
      type: 'update',
      domain: 'settings',
      entityId: 'settings',
      fields: ['*'],
      baseRevision,
      origin,
      at: new Date().toISOString(),
    })
  }

  const domainKeys: Array<keyof AppStore> = [
    'brigades',
    'brigadeNamesKa',
    'brigadeNamesEn',
    'brigadiers',
    'brigadeHasBrigadier',
    'brigadeUnits',
    'archivedMonths',
    'closedMonths',
    'monthClosures',
    'auditLog',
    'trash',
    'production',
    'sales',
    'aiChat',
    'counterparties',
    'finishedProducts',
    'packagingRecipes',
    'formulations',
    'technologistQc',
    'otc',
    'wastewater',
    'engineerLog',
    'tasks',
    'warehouse',
    'workwear',
    'itOffice',
    'procurement',
    'access',
    'nightShifts',
    'timesheetEntries',
    'attendance',
    'meals',
    'protocols',
    'orgChart',
    'finance',
    'externalEffects',
  ]
  for (const key of domainKeys) {
    if (!eqJson(before[key], after[key])) {
      ops.push({
        operationId: nextOperationId(),
        type: 'update',
        domain: String(key),
        entityId: '*',
        fields: ['*'],
        baseRevision,
        origin,
        at: new Date().toISOString(),
      })
    }
  }

  return ops
}

export { COMPOSITE_ROOTS_WITH_STABLE_PATHS }
