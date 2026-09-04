/**
 * PHASE G1 — shared critical-store helpers (server .mjs + tests).
 * Allowed domains only; no arbitrary client JSON patch.
 */

export const G1_CRITICAL_SCHEMA_VERSION = 1
export const G1_ALLOWED_DOMAINS = Object.freeze(['warehouse'])

export function emptyWarehouseStore() {
  return {
    items: [],
    locations: [],
    documents: [],
    movements: [],
    auditLog: [],
    counterparties: [],
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
          items: Array.isArray(warehouse.items) ? warehouse.items : [],
          locations: Array.isArray(warehouse.locations) ? warehouse.locations : [],
          documents: Array.isArray(warehouse.documents) ? warehouse.documents : [],
          movements: Array.isArray(warehouse.movements) ? warehouse.movements : [],
          auditLog: Array.isArray(warehouse.auditLog) ? warehouse.auditLog : [],
          counterparties: Array.isArray(warehouse.counterparties) ? warehouse.counterparties : [],
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

/** Compute available qty for item@warehouse from movements (server recomputes; ignores client balances). */
export function computeServerBalance(movements, warehouseId, itemId) {
  let qty = 0
  for (const m of movements ?? []) {
    if (m.warehouseId !== warehouseId || m.itemId !== itemId) continue
    if (m.cancelled) continue
    const q = Number(m.quantity) || 0
    if (m.type === 'in' || m.type === 'receipt') qty += q
    else if (m.type === 'out' || m.type === 'issue') qty -= q
    else if (m.type === 'adjust') qty += q
  }
  return qty
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
