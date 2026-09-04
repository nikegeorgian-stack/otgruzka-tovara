/**
 * PHASE G2.1 — TypeScript copy of canonical FEFO/FIFO (parity-tested vs batchAllocationCore.mjs).
 * Server uses api/fst/_g2BatchAllocation.mjs → batchAllocationCore.mjs.
 */

/** Authoritative movement shape (server + client ledger rows). */
export type AllocationMovement = {
  itemId: string
  warehouseId: string
  locationId?: string
  quantity: number
  type: string
  batchNo?: string
  expiryDate?: string
  createdAt?: string
  at?: string
  date?: string
  cancelled?: boolean
}

export const BATCH_OVERRIDE_REASON_REQUIRED = 'warehouse.batch.errOverrideReasonRequired'
export const BATCH_UNKNOWN = 'warehouse.batch.errUnknownLot'
export const BATCH_INSUFFICIENT = 'warehouse.batch.errInsufficient'
export const BATCH_EXPIRED_FORBIDDEN = 'warehouse.batch.errExpiredForbidden'

export type BatchLot = {
  itemId: string
  warehouseId: string
  locationId: string
  batchNo: string
  expiryDate?: string
  physical: number
  reserved: number
  available: number
  receivedAt: string
}

export type BatchAllocation = {
  batchNo?: string
  expiryDate?: string
  locationId?: string
  quantity: number
}

function absQty(q: unknown): number {
  return Math.abs(Number(q) || 0)
}

function lotKey(parts: {
  itemId?: string
  warehouseId?: string
  locationId?: string
  batchNo?: string
  expiryDate?: string
}): string {
  return [
    String(parts.itemId ?? ''),
    String(parts.warehouseId ?? ''),
    String(parts.locationId ?? ''),
    String(parts.batchNo ?? ''),
    String(parts.expiryDate ?? ''),
  ].join('::')
}

export function buildBatchLotsFromMovements(
  movements: AllocationMovement[],
  opts: { itemId?: string; warehouseId?: string; locationId?: string; asOfIso?: string } = {},
): BatchLot[] {
  const itemId = opts.itemId
  const warehouseId = opts.warehouseId
  const locationId = opts.locationId
  const asOfIso = opts.asOfIso
  const map = new Map<string, BatchLot>()

  for (const m of movements ?? []) {
    if (m.cancelled) continue
    if (itemId && m.itemId !== itemId) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    if (locationId != null && locationId !== '' && (m.locationId ?? '') !== locationId) continue
    const at = m.createdAt || m.at || m.date || ''
    if (asOfIso && at > asOfIso) continue

    const batchNo = m.batchNo != null && String(m.batchNo).trim() ? String(m.batchNo).trim() : ''
    const expiryDate =
      m.expiryDate != null && String(m.expiryDate).trim()
        ? String(m.expiryDate).trim().slice(0, 10)
        : ''
    const key = lotKey({
      itemId: m.itemId,
      warehouseId: m.warehouseId,
      locationId: m.locationId ?? '',
      batchNo,
      expiryDate,
    })
    let lot = map.get(key)
    if (!lot) {
      lot = {
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        locationId: m.locationId ?? '',
        batchNo,
        expiryDate: expiryDate || undefined,
        physical: 0,
        reserved: 0,
        available: 0,
        receivedAt: at,
      }
      map.set(key, lot)
    }

    const q = absQty(m.quantity)
    if (m.type === 'receipt' || m.type === 'in') {
      lot.physical += q
      if (at && (!lot.receivedAt || at < lot.receivedAt)) lot.receivedAt = at
    } else if (m.type === 'issue' || m.type === 'out') {
      lot.physical -= q
    } else if (m.type === 'inventory' || m.type === 'adjustment' || m.type === 'adjust') {
      lot.physical += Number(m.quantity) || 0
    } else if (m.type === 'reserve') {
      lot.reserved += q
    } else if (m.type === 'unreserve') {
      lot.reserved = Math.max(0, lot.reserved - q)
    }
  }

  return [...map.values()].map((l) => ({
    ...l,
    available: Math.max(0, l.physical - l.reserved),
    physical: l.physical,
    reserved: Math.max(0, l.reserved),
  }))
}

export function sortLotsFefoFifo(
  lots: BatchLot[],
  { allowExpired = false, today = '' }: { allowExpired?: boolean; today?: string } = {},
): BatchLot[] {
  const todayKey = (today || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const usable = (lots ?? []).filter((l) => {
    if ((l.available ?? 0) <= 1e-9) return false
    if (!allowExpired && l.expiryDate && l.expiryDate < todayKey) return false
    return true
  })
  return usable.sort((a, b) => {
    const aExp = a.expiryDate?.trim()
    const bExp = b.expiryDate?.trim()
    if (aExp && bExp) return aExp.localeCompare(bExp)
    if (aExp && !bExp) return -1
    if (!aExp && bExp) return 1
    return String(a.receivedAt ?? '').localeCompare(String(b.receivedAt ?? ''))
  })
}

export function allocateBatchesFefoFifo(
  lots: BatchLot[],
  qty: number,
  options: { allowExpired?: boolean; today?: string } = {},
):
  | { ok: true; allocations: BatchAllocation[] }
  | { ok: false; error: string; shortfall?: number; allocations?: BatchAllocation[] } {
  const quantity = Number(qty) || 0
  if (quantity <= 0) return { ok: true, allocations: [] }
  const sorted = sortLotsFefoFifo(lots, options)
  let left = quantity
  const out: BatchAllocation[] = []
  for (const lot of sorted) {
    if (left <= 1e-9) break
    const take = Math.min(lot.available, left)
    if (take <= 1e-9) continue
    out.push({
      batchNo: lot.batchNo || undefined,
      expiryDate: lot.expiryDate,
      locationId: lot.locationId || undefined,
      quantity: take,
    })
    left -= take
  }
  if (left > 1e-9) {
    return { ok: false, error: BATCH_INSUFFICIENT, shortfall: left, allocations: out }
  }
  return { ok: true, allocations: out }
}

export function allocateIssueLineBatches(input: {
  movements: AllocationMovement[]
  itemId: string
  warehouseId: string
  locationId?: string
  quantity: number
  manualBatchNo?: string
  manualExpiryDate?: string
  manualOverrideReason?: string
  requireKnownLot?: boolean
  allowExpired?: boolean
  today?: string
}):
  | { ok: true; allocations: BatchAllocation[]; manual?: boolean }
  | { ok: false; error: string; shortfall?: number } {
  const {
    movements,
    itemId,
    warehouseId,
    locationId,
    quantity,
    manualBatchNo,
    manualExpiryDate,
    manualOverrideReason,
    requireKnownLot = false,
    allowExpired = false,
    today,
  } = input

  const qty = Number(quantity) || 0
  if (qty <= 0) return { ok: false, error: 'invalid_quantity' }

  const lots = buildBatchLotsFromMovements(movements, { itemId, warehouseId, locationId })

  if (manualBatchNo != null && String(manualBatchNo).trim()) {
    const reason = String(manualOverrideReason ?? '').trim()
    if (!reason) return { ok: false, error: BATCH_OVERRIDE_REASON_REQUIRED }
    const batchNo = String(manualBatchNo).trim()
    const expiryDate = manualExpiryDate != null ? String(manualExpiryDate).trim().slice(0, 10) : ''
    const match = lots.find(
      (l) =>
        l.batchNo === batchNo &&
        (expiryDate ? (l.expiryDate ?? '') === expiryDate : true) &&
        (locationId == null || locationId === '' || (l.locationId ?? '') === locationId),
    )
    if (requireKnownLot && !match) return { ok: false, error: BATCH_UNKNOWN }
    if (match && match.available + 1e-9 < qty) {
      return { ok: false, error: BATCH_INSUFFICIENT, shortfall: qty - match.available }
    }
    if (match?.expiryDate && !allowExpired) {
      const todayKey = (today || new Date().toISOString().slice(0, 10)).slice(0, 10)
      if (match.expiryDate < todayKey) return { ok: false, error: BATCH_EXPIRED_FORBIDDEN }
    }
    return {
      ok: true,
      allocations: [
        {
          batchNo,
          expiryDate: match?.expiryDate || (expiryDate || undefined),
          locationId: match?.locationId || locationId || undefined,
          quantity: qty,
        },
      ],
      manual: true,
    }
  }

  const hasAnyBatch = lots.some((l) => l.batchNo)
  if (requireKnownLot && hasAnyBatch === false) {
    return { ok: false, error: BATCH_UNKNOWN }
  }

  return allocateBatchesFefoFifo(lots, qty, { allowExpired, today })
}

export function ordinaryAvailableQty(
  movements: AllocationMovement[],
  itemId: string,
  warehouseId: string,
): number {
  const lots = buildBatchLotsFromMovements(movements, { itemId, warehouseId })
  return lots.reduce((s, l) => s + Math.max(0, l.available), 0)
}
