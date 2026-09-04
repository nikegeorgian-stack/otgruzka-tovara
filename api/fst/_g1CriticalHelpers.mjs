/**
 * PHASE G1/G2 — shared critical-store helpers (server .mjs + tests).
 * Allowed domains only; no arbitrary client JSON patch.
 */

export const G1_CRITICAL_SCHEMA_VERSION = 2
export const G1_ALLOWED_DOMAINS = Object.freeze(['warehouse'])

export const G2_MAX_DOCUMENT_LINES = 500
export const G2_MAX_BODY_BYTES = 256 * 1024
export const G2_ALLOWED_DOC_TYPES = Object.freeze([
  'receipt',
  'issue',
  'inventory',
  'reservation',
])
export const G2_ALLOWED_PURPOSES = Object.freeze([
  'purchase',
  'production_issue',
  'production_receipt',
  'return',
  'writeoff',
  'transfer',
  'other',
  'loading',
  'opening_inventory',
])

export function emptyWarehouseStore() {
  return {
    items: [],
    locations: [],
    categories: [],
    documents: [],
    movements: [],
    auditLog: [],
    counterparties: [],
    closedMonths: [],
    periodHistory: [],
    accountingByWarehouse: [],
    dailyIssueSessions: [],
  }
}

export function emptyCriticalPayload() {
  return {
    schemaVersion: G1_CRITICAL_SCHEMA_VERSION,
    domains: {
      warehouse: emptyWarehouseStore(),
    },
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

export function parseCriticalPayload(payloadJson) {
  let raw
  try {
    raw = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson
  } catch {
    return { ok: false, error: 'invalid_payload_json' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_payload' }
  const domains = raw.domains && typeof raw.domains === 'object' ? raw.domains : null
  if (!domains) return { ok: false, error: 'missing_domains' }
  for (const key of Object.keys(domains)) {
    if (!G1_ALLOWED_DOMAINS.includes(key)) {
      return { ok: false, error: 'domain_not_allowed' }
    }
  }
  const warehouse = domains.warehouse && typeof domains.warehouse === 'object'
    ? domains.warehouse
    : emptyWarehouseStore()
  return {
    ok: true,
    payload: {
      schemaVersion: Number(raw.schemaVersion) || G1_CRITICAL_SCHEMA_VERSION,
      domains: {
        warehouse: {
          items: asArray(warehouse.items),
          locations: asArray(warehouse.locations),
          categories: asArray(warehouse.categories),
          documents: asArray(warehouse.documents),
          movements: asArray(warehouse.movements),
          auditLog: asArray(warehouse.auditLog),
          counterparties: asArray(warehouse.counterparties),
          closedMonths: asArray(warehouse.closedMonths),
          periodHistory: asArray(warehouse.periodHistory),
          accountingByWarehouse: asArray(warehouse.accountingByWarehouse),
          dailyIssueSessions: asArray(warehouse.dailyIssueSessions),
        },
      },
    },
  }
}

export function serializeCriticalPayload(payload) {
  return JSON.stringify(payload)
}

export function fingerprintCriticalPayload(payloadJson) {
  let h = 2166136261
  const s = String(payloadJson ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `g1:${(h >>> 0).toString(16)}`
}

/** Physical stock balance from movements (server recomputes; ignores client balances). */
export function computeServerBalance(movements, warehouseId, itemId) {
  let qty = 0
  for (const m of movements ?? []) {
    if (m.warehouseId !== warehouseId || m.itemId !== itemId) continue
    if (m.cancelled) continue
    const q = Number(m.quantity) || 0
    if (m.type === 'in' || m.type === 'receipt') qty += q
    else if (m.type === 'out' || m.type === 'issue') qty -= q
    else if (m.type === 'adjust' || m.type === 'adjustment' || m.type === 'inventory') qty += q
  }
  return qty
}

/** Reserved qty (own + foreign). Available = balance - reserved. */
export function computeServerReserved(movements, warehouseId, itemId) {
  let reserved = 0
  for (const m of movements ?? []) {
    if (m.warehouseId !== warehouseId || m.itemId !== itemId) continue
    if (m.cancelled) continue
    const q = Number(m.quantity) || 0
    if (m.type === 'reserve') reserved += q
    else if (m.type === 'unreserve') reserved -= q
  }
  return Math.max(0, reserved)
}

export function computeServerAvailable(movements, warehouseId, itemId) {
  return computeServerBalance(movements, warehouseId, itemId) - computeServerReserved(movements, warehouseId, itemId)
}

export function monthKeyFromDate(dateIso) {
  return String(dateIso ?? '').slice(0, 7)
}

export function isPeriodClosed(warehouse, dateIso) {
  const key = monthKeyFromDate(dateIso)
  if (!key || key.length < 7) return false
  const closed = warehouse?.closedMonths
  if (!Array.isArray(closed) || closed.length === 0) return false
  return closed.includes(key)
}

export function documentNumberPrefix(type) {
  if (type === 'receipt') return 'ПР'
  if (type === 'issue') return 'РС'
  if (type === 'reservation') return 'РЗВ'
  return 'ИНВ'
}

/** Server-assigned number: PREFIX-WH-{warehouseShort}-{year}-NNN */
export function nextServerDocumentNumber(documents, type, warehouseId, dateIso) {
  const prefix = documentNumberPrefix(type)
  const year = String(dateIso ?? '').slice(0, 4) || String(new Date().getUTCFullYear())
  const wh = String(warehouseId ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase() || 'WH'
  const pattern = new RegExp(`^${prefix}-${wh}-${year}-(\\d+)$`, 'i')
  let max = 0
  for (const doc of documents ?? []) {
    const m = String(doc.number ?? '').match(pattern)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${wh}-${year}-${String(max + 1).padStart(3, '0')}`
}

export function nextReversalNumber(originalNumber) {
  const base = String(originalNumber ?? '').replace(/-СТ\d*$/i, '')
  return `${base}-СТ`
}

export function parseCapabilities(capabilitiesJson) {
  try {
    const raw = typeof capabilitiesJson === 'string' ? JSON.parse(capabilitiesJson) : capabilitiesJson
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function principalAccessId(storeId, uid) {
  return `${String(storeId ?? '').trim()}::${String(uid ?? '').trim()}`
}

export function sanitizeDocumentLines(lines) {
  if (!Array.isArray(lines)) return { ok: false, error: 'invalid_lines' }
  if (lines.length === 0) return { ok: false, error: 'empty_lines' }
  if (lines.length > G2_MAX_DOCUMENT_LINES) return { ok: false, error: 'too_many_lines' }
  const out = []
  for (const line of lines) {
    const itemId = String(line?.itemId ?? '').trim()
    const qty = Number(line?.quantity)
    if (!itemId) return { ok: false, error: 'invalid_line_item' }
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'invalid_quantity' }
    const batchNo =
      line.batchNo != null && String(line.batchNo).trim()
        ? String(line.batchNo).trim()
        : undefined
    const expiryDate =
      line.expiryDate != null && String(line.expiryDate).trim()
        ? String(line.expiryDate).trim().slice(0, 10)
        : undefined
    const batchOverrideReason =
      line.batchOverrideReason != null && String(line.batchOverrideReason).trim()
        ? String(line.batchOverrideReason).trim()
        : undefined
    out.push({
      lineId: String(line.lineId ?? '').trim() || crypto.randomUUID(),
      itemId,
      quantity: qty,
      inputUnit: line.inputUnit != null ? String(line.inputUnit) : undefined,
      itemCodeSnapshot: line.itemCodeSnapshot != null ? String(line.itemCodeSnapshot) : undefined,
      itemNameSnapshot: line.itemNameSnapshot != null ? String(line.itemNameSnapshot) : undefined,
      unitSnapshot: line.unitSnapshot != null ? String(line.unitSnapshot) : undefined,
      batchId: line.batchId != null ? String(line.batchId) : undefined,
      batchNo,
      expiryDate,
      batchOverrideReason,
      locationId: line.locationId != null ? String(line.locationId) : undefined,
      plannedQty: line.plannedQty != null ? Number(line.plannedQty) : qty,
      actualQty: line.actualQty != null ? Number(line.actualQty) : qty,
    })
  }
  return { ok: true, lines: out }
}
