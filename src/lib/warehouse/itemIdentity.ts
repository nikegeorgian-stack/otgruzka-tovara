/**
 * R2.9E-C1B — warehouse item identifier uniqueness (create/update + merge reconcile).
 * Item `id` remains the stable relationship key. Historical baseline duplicates
 * are not auto-migrated (C1C owns that).
 */
import type { WarehouseItem, WarehouseStore } from './types'

export const WAREHOUSE_INTERNAL_CODE_PREFIX = 'FC'
export const INTERNAL_CODE_PATTERN = /^FC-\d{6}$/i

export type WarehouseIdentityErrorCode =
  | 'warehouse.err.duplicateInternalCode'
  | 'warehouse.err.invalidInternalCode'
  | 'warehouse.err.duplicateSku'
  | 'warehouse.err.internalCodeImmutable'
  | 'warehouse.err.unsafeIdentifierReconcile'

export class WarehouseItemIdentityError extends Error {
  readonly code: WarehouseIdentityErrorCode

  constructor(code: WarehouseIdentityErrorCode) {
    super(code)
    this.name = 'WarehouseItemIdentityError'
    this.code = code
  }
}

export function formatInternalCode(n: number): string {
  return `${WAREHOUSE_INTERNAL_CODE_PREFIX}-${String(n).padStart(6, '0')}`
}

export function parseInternalCodeNum(code: string): number {
  const m = String(code ?? '').match(/(\d+)\s*$/)
  return m ? Number(m[1]) : 0
}

export function normalizeSkuKey(sku: string | undefined | null): string | null {
  const t = String(sku ?? '').trim()
  if (!t) return null
  return t.toLowerCase()
}

export function normalizeInternalCode(code: string): string {
  return String(code ?? '').trim().toUpperCase()
}

export function isValidInternalCodeFormat(code: string): boolean {
  return INTERNAL_CODE_PATTERN.test(String(code ?? '').trim())
}

export function maxInternalCodeNumber(items: WarehouseItem[]): number {
  let max = 0
  for (const i of items) {
    max = Math.max(max, parseInternalCodeNum(i.internalCode ?? ''))
  }
  return max
}

/** Counter floor: never below max(existing FC)+1 and never below normalized counter. */
export function nextInternalCodeNumber(
  store: Pick<WarehouseStore, 'items' | 'nextInternalCode'>,
): number {
  const fromCounter = Math.max(1, Number(store.nextInternalCode) || 1)
  const fromItems = maxInternalCodeNumber(store.items) + 1
  return Math.max(fromCounter, fromItems)
}

export function usedInternalCodeKeys(
  items: WarehouseItem[],
  exceptItemId?: string,
): Set<string> {
  const used = new Set<string>()
  for (const i of items) {
    if (exceptItemId && i.id === exceptItemId) continue
    const raw = String(i.internalCode ?? '').trim()
    if (!raw) continue
    used.add(normalizeInternalCode(raw))
  }
  return used
}

export function usedSkuKeys(items: WarehouseItem[], exceptItemId?: string): Set<string> {
  const used = new Set<string>()
  for (const i of items) {
    if (exceptItemId && i.id === exceptItemId) continue
    const key = normalizeSkuKey(i.sku)
    if (key) used.add(key)
  }
  return used
}

/** Allocate next free FC-###### skipping every already-used code. */
export function allocateUniqueInternalCode(
  store: Pick<WarehouseStore, 'items' | 'nextInternalCode'>,
  exceptItemId?: string,
): { code: string; nextCounter: number } {
  const used = usedInternalCodeKeys(store.items, exceptItemId)
  let n = nextInternalCodeNumber(store)
  // Safety bound: skip until free
  for (let guard = 0; guard < store.items.length + 10_000; guard++) {
    const code = formatInternalCode(n)
    if (!used.has(normalizeInternalCode(code))) {
      return { code, nextCounter: n + 1 }
    }
    n += 1
  }
  throw new WarehouseItemIdentityError('warehouse.err.unsafeIdentifierReconcile')
}

export function assertSkuAvailable(
  items: WarehouseItem[],
  sku: string | undefined | null,
  exceptItemId?: string,
): void {
  const key = normalizeSkuKey(sku)
  if (!key) return
  if (usedSkuKeys(items, exceptItemId).has(key)) {
    throw new WarehouseItemIdentityError('warehouse.err.duplicateSku')
  }
}

export function resolveCreateInternalCode(
  store: Pick<WarehouseStore, 'items' | 'nextInternalCode'>,
  incomingCode: string | undefined | null,
  itemId: string,
): { code: string; nextCounter: number } {
  const trimmed = String(incomingCode ?? '').trim()
  if (!trimmed) {
    return allocateUniqueInternalCode(store, itemId)
  }
  if (!isValidInternalCodeFormat(trimmed)) {
    throw new WarehouseItemIdentityError('warehouse.err.invalidInternalCode')
  }
  const normalized = normalizeInternalCode(trimmed)
  const used = usedInternalCodeKeys(store.items, itemId)
  if (used.has(normalized)) {
    throw new WarehouseItemIdentityError('warehouse.err.duplicateInternalCode')
  }
  const num = parseInternalCodeNum(normalized)
  const floor = nextInternalCodeNumber(store)
  const nextCounter = Math.max(floor, num + 1)
  return { code: normalized, nextCounter }
}

/**
 * After mergeArrayById: reallocate only baseline-absent local creates that collide
 * on internalCode. Never renumber baseline or remote/acknowledged items.
 * Historical baseline/remote duplicates are left for C1C.
 */
export function reconcileWarehouseItemCodesAfterMerge(input: {
  baseItems: WarehouseItem[]
  remoteItems: WarehouseItem[]
  localItems: WarehouseItem[]
  mergedItems: WarehouseItem[]
  nextInternalCode?: number
}): { items: WarehouseItem[]; nextInternalCode: number } {
  const baseIds = new Set(input.baseItems.map((i) => i.id))
  const remoteIds = new Set(input.remoteItems.map((i) => i.id))
  const localIds = new Set(input.localItems.map((i) => i.id))

  let items = input.mergedItems.map((i) => ({ ...i }))
  const byCode = new Map<string, WarehouseItem[]>()
  for (const item of items) {
    const raw = String(item.internalCode ?? '').trim()
    if (!raw) continue
    const key = normalizeInternalCode(raw)
    const list = byCode.get(key) ?? []
    list.push(item)
    byCode.set(key, list)
  }

  const toReallocate: WarehouseItem[] = []

  for (const [, group] of byCode) {
    if (group.length < 2) continue

    const keepers = group.filter((i) => baseIds.has(i.id) || remoteIds.has(i.id))
    const pureLocal = group.filter(
      (i) => localIds.has(i.id) && !baseIds.has(i.id) && !remoteIds.has(i.id),
    )

    if (keepers.length > 0) {
      // Remote/baseline own the code; only pure-local unacked creates move.
      toReallocate.push(...pureLocal)
      continue
    }

    // Only local creates collided (no baseline/remote owner): lowest id keeps.
    const sorted = [...pureLocal].sort((a, b) => a.id.localeCompare(b.id))
    toReallocate.push(...sorted.slice(1))
  }

  // Deterministic order for assignment
  toReallocate.sort((a, b) => a.id.localeCompare(b.id))

  let nextCounter = Math.max(
    1,
    Number(input.nextInternalCode) || 1,
    maxInternalCodeNumber(items) + 1,
  )

  for (const victim of toReallocate) {
    const used = usedInternalCodeKeys(items, victim.id)
    let n = nextCounter
    let assigned: string | null = null
    for (let guard = 0; guard < items.length + 10_000; guard++) {
      const code = formatInternalCode(n)
      if (!used.has(normalizeInternalCode(code))) {
        assigned = code
        nextCounter = n + 1
        break
      }
      n += 1
    }
    if (!assigned) {
      throw new WarehouseItemIdentityError('warehouse.err.unsafeIdentifierReconcile')
    }
    items = items.map((i) => (i.id === victim.id ? { ...i, internalCode: assigned! } : i))
  }

  nextCounter = Math.max(nextCounter, maxInternalCodeNumber(items) + 1)

  // Fail closed if any pure-local collision remains unresolved
  const finalByCode = new Map<string, string[]>()
  for (const item of items) {
    const raw = String(item.internalCode ?? '').trim()
    if (!raw) continue
    const key = normalizeInternalCode(raw)
    const ids = finalByCode.get(key) ?? []
    ids.push(item.id)
    finalByCode.set(key, ids)
  }
  for (const [, ids] of finalByCode) {
    if (ids.length < 2) continue
    const unresolvedLocal = ids.filter(
      (id) => localIds.has(id) && !baseIds.has(id) && !remoteIds.has(id),
    )
    if (unresolvedLocal.length > 0 && ids.some((id) => baseIds.has(id) || remoteIds.has(id))) {
      // Should have been reallocated — fail closed
      throw new WarehouseItemIdentityError('warehouse.err.unsafeIdentifierReconcile')
    }
    // baseline/remote historical dups: allowed (C1C)
  }

  return { items, nextInternalCode: nextCounter }
}

export type ConcurrentSkuConflict = {
  localItemId: string
  conflictingItemId: string
  skuKey: string
}

/**
 * Concurrent non-empty SKU collisions introduced by local creates/edits.
 * Does not migrate legacy baseline duplicates (C1C). Never invents/renames SKUs.
 */
export function findConcurrentSkuConflicts(input: {
  baseItems: WarehouseItem[]
  remoteItems: WarehouseItem[]
  localItems: WarehouseItem[]
  mergedItems: WarehouseItem[]
}): ConcurrentSkuConflict[] {
  const baseIds = new Set(input.baseItems.map((i) => i.id))
  const remoteIds = new Set(input.remoteItems.map((i) => i.id))
  const localIds = new Set(input.localItems.map((i) => i.id))
  const baseById = new Map(input.baseItems.map((i) => [i.id, i]))

  const bySku = new Map<string, WarehouseItem[]>()
  for (const item of input.mergedItems) {
    const key = normalizeSkuKey(item.sku)
    if (!key) continue
    const list = bySku.get(key) ?? []
    list.push(item)
    bySku.set(key, list)
  }

  const out: ConcurrentSkuConflict[] = []
  const seen = new Set<string>()

  for (const [skuKey, group] of bySku) {
    if (group.length < 2) continue
    if (group.every((i) => baseIds.has(i.id))) continue // legacy baseline — C1C

    for (const item of group) {
      const others = group.filter((o) => o.id !== item.id)
      if (others.length === 0) continue

      const isPureLocal =
        localIds.has(item.id) && !baseIds.has(item.id) && !remoteIds.has(item.id)
      const baseItem = baseById.get(item.id)
      const localItem = input.localItems.find((l) => l.id === item.id)
      const localSkuChanged =
        !!baseItem &&
        !!localItem &&
        normalizeSkuKey(localItem.sku) !== normalizeSkuKey(baseItem.sku) &&
        normalizeSkuKey(localItem.sku) === skuKey

      const collidesWithForeign = others.some(
        (o) => remoteIds.has(o.id) || baseIds.has(o.id) || (localIds.has(o.id) && o.id !== item.id),
      )

      if ((isPureLocal || localSkuChanged) && collidesWithForeign) {
        const conflictingItemId = others.sort((a, b) => a.id.localeCompare(b.id))[0]!.id
        const dedupe = `${item.id}:${skuKey}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        out.push({ localItemId: item.id, conflictingItemId, skuKey })
      }
    }
  }

  out.sort((a, b) => a.localItemId.localeCompare(b.localItemId))
  return out
}

/** Shared post-merge identity step for cloudMerge + conservativeMergeForSave. */
export function applyWarehouseIdentityAfterMerge(input: {
  baseItems: WarehouseItem[]
  remoteItems: WarehouseItem[]
  localItems: WarehouseItem[]
  mergedItems: WarehouseItem[]
  nextInternalCode?: number
}): {
  items: WarehouseItem[]
  nextInternalCode: number
  skuConflicts: ConcurrentSkuConflict[]
} {
  const reconciled = reconcileWarehouseItemCodesAfterMerge(input)
  const skuConflicts = findConcurrentSkuConflicts({
    baseItems: input.baseItems,
    remoteItems: input.remoteItems,
    localItems: input.localItems,
    mergedItems: reconciled.items,
  })
  return {
    items: reconciled.items,
    nextInternalCode: reconciled.nextInternalCode,
    skuConflicts,
  }
}

export function mergeNextInternalCodeCounter(
  base?: number,
  remote?: number,
  local?: number,
  items: WarehouseItem[] = [],
): number {
  const fromPick = Math.max(1, Number(base) || 1, Number(remote) || 1, Number(local) || 1)
  return Math.max(fromPick, maxInternalCodeNumber(items) + 1)
}

/** Message token used by SQL save fail-closed + UI conflict formatting. */
export const CONCURRENT_SKU_CONFLICT_MESSAGE =
  'warehouse.err.duplicateSku: Concurrent SKU conflict; assign a unique SKU and retry'

export function isWarehouseSkuConflictMessage(message: string | undefined): boolean {
  return String(message ?? '').includes('warehouse.err.duplicateSku')
}
