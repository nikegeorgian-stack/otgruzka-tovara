/**
 * PHASE G2.1 — canonical FEFO/FIFO batch allocation (pure, no I/O).
 * Shared algorithm for server (.mjs) and client parity tests.
 *
 * Rules:
 * - Lots keyed by itemId + warehouseId + locationId + batchNo + expiryDate
 * - Physical in: receipt / in / inventory(+) / unreserve does NOT add physical
 * - Physical out: issue / out / inventory(-)
 * - Reserve locks qty from ordinary issue available (foreign reserve unavailable)
 * - FEFO: lots with expiryDate sorted ascending; expired excluded unless allowExpired
 * - FIFO: lots without expiry sorted by earliest receipt time
 * - Multi-lot split supported; shortfall → fail (no partial apply by caller)
 * - Manual override requires non-empty reason; unknown lot fail-closed when requireKnownLot
 */

export const BATCH_OVERRIDE_REASON_REQUIRED = 'warehouse.batch.errOverrideReasonRequired'
export const BATCH_UNKNOWN = 'warehouse.batch.errUnknownLot'
export const BATCH_INSUFFICIENT = 'warehouse.batch.errInsufficient'
export const BATCH_EXPIRED_FORBIDDEN = 'warehouse.batch.errExpiredForbidden'

function absQty(q) {
  return Math.abs(Number(q) || 0)
}

function lotKey(parts) {
  return [
    String(parts.itemId ?? ''),
    String(parts.warehouseId ?? ''),
    String(parts.locationId ?? ''),
    String(parts.batchNo ?? ''),
    String(parts.expiryDate ?? ''),
  ].join('::')
}

function movementInSign(type) {
  if (type === 'receipt' || type === 'in') return 1
  if (type === 'issue' || type === 'out') return -1
  if (type === 'inventory' || type === 'adjustment' || type === 'adjust') return 0 // handled separately
  return 0
}

/**
 * Build physical lot balances from authoritative movements.
 * Reserve/unreserve tracked separately and do not change physical lot qty,
 * but reserve reduces available for ordinary issues.
 */
export function buildBatchLotsFromMovements(movements, opts = {}) {
  const itemId = opts.itemId
  const warehouseId = opts.warehouseId
  const locationId = opts.locationId // optional filter; undefined = all locations aggregated per key
  const asOfIso = opts.asOfIso
  const map = new Map()

  for (const m of movements ?? []) {
    if (m.cancelled) continue
    if (itemId && m.itemId !== itemId) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    if (locationId != null && locationId !== '' && (m.locationId ?? '') !== locationId) continue
    if (asOfIso && (m.at || m.createdAt || m.date) > asOfIso) continue

    const batchNo = m.batchNo != null && String(m.batchNo).trim() ? String(m.batchNo).trim() : ''
    // Unbatched movements still contribute to a synthetic empty-batch lot for FIFO without batch tracking.
    const expiryDate = m.expiryDate != null && String(m.expiryDate).trim()
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
        receivedAt: m.at || m.createdAt || m.date || '',
      }
      map.set(key, lot)
    }

    const q = absQty(m.quantity)
    const at = m.at || m.createdAt || m.date || ''
    if (m.type === 'receipt' || m.type === 'in') {
      lot.physical += q
      if (at && (!lot.receivedAt || at < lot.receivedAt)) lot.receivedAt = at
    } else if (m.type === 'issue' || m.type === 'out') {
      lot.physical -= q
    } else if (m.type === 'inventory' || m.type === 'adjustment' || m.type === 'adjust') {
      // inventory quantity is signed delta
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

export function sortLotsFefoFifo(lots, { allowExpired = false, today = '' } = {}) {
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

/**
 * Allocate qty across lots (FEFO then FIFO). Returns allocations; does not mutate.
 * If total available < qty → ok:false (caller must not CAS).
 */
export function allocateBatchesFefoFifo(lots, qty, options = {}) {
  const quantity = Number(qty) || 0
  if (quantity <= 0) return { ok: true, allocations: [] }
  const sorted = sortLotsFefoFifo(lots, options)
  let left = quantity
  const out = []
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

/**
 * Resolve issue line allocation.
 * - Manual batchNo requires reason
 * - requireKnownLot: fail if manual lot not found / no batches when item tracks batches
 * - reserved stock not available unless consumeOwnReserve (not implemented here — caller filters lots)
 */
export function allocateIssueLineBatches(input) {
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

  // No batch tracking in ledger → single unbatched allocation (allowed unless requireKnownLot)
  const hasAnyBatch = lots.some((l) => l.batchNo)
  if (requireKnownLot && hasAnyBatch === false) {
    return { ok: false, error: BATCH_UNKNOWN }
  }

  return allocateBatchesFefoFifo(lots, qty, { allowExpired, today })
}

/** Effective ordinary available (physical - all reserved) for item@warehouse. */
export function ordinaryAvailableQty(movements, itemId, warehouseId) {
  const lots = buildBatchLotsFromMovements(movements, { itemId, warehouseId })
  return lots.reduce((s, l) => s + Math.max(0, l.available), 0)
}
