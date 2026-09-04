/**
 * PHASE G1/G2/G3.1 — shared critical-store helpers (server .mjs + tests).
 * Allowed domains only; unknown envelope/domain fields are preserved.
 * Domain activation is per-domain (warehouse vs production), not bare revision.
 */

export const G1_CRITICAL_SCHEMA_VERSION = 3
/** PHASE G3 — warehouse + production share one FstCriticalStore revision/CAS. */
export const G1_ALLOWED_DOMAINS = Object.freeze(['warehouse', 'production'])

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

const WAREHOUSE_KNOWN = new Set([
  'items',
  'locations',
  'categories',
  'documents',
  'movements',
  'auditLog',
  'counterparties',
  'closedMonths',
  'periodHistory',
  'accountingByWarehouse',
  'dailyIssueSessions',
  'materialShortages',
  'productionLineBindings',
  'scrapLocationId',
])

const PRODUCTION_KNOWN = new Set([
  'recipeVersions',
  'orders',
  'shiftReports',
  'wipBatches',
  'wasteRecords',
  'handoffs',
  'auditLog',
  'lineBindings',
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

/** Minimal authoritative production roots (G3). Legacy FstStore production remains for non-critical UI. */
export function emptyProductionStore() {
  return {
    recipeVersions: [],
    orders: [],
    shiftReports: [],
    wipBatches: [],
    wasteRecords: [],
    handoffs: [],
    auditLog: [],
    lineBindings: [],
  }
}

export function emptyDomainMeta() {
  return {
    warehouse: { active: false, version: 0 },
    production: { active: false, version: 0 },
  }
}

export function emptyCriticalPayload() {
  return {
    schemaVersion: G1_CRITICAL_SCHEMA_VERSION,
    domainMeta: emptyDomainMeta(),
    commandReceipts: {},
    domains: {
      warehouse: emptyWarehouseStore(),
      production: emptyProductionStore(),
    },
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function pickUnknown(obj, known) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    if (!known.has(k)) out[k] = v
  }
  return out
}

function normalizeWarehouse(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, WAREHOUSE_KNOWN),
    items: asArray(src.items),
    locations: asArray(src.locations),
    categories: asArray(src.categories),
    documents: asArray(src.documents),
    movements: asArray(src.movements),
    auditLog: asArray(src.auditLog),
    counterparties: asArray(src.counterparties),
    closedMonths: asArray(src.closedMonths),
    periodHistory: asArray(src.periodHistory),
    accountingByWarehouse: asArray(src.accountingByWarehouse),
    dailyIssueSessions: asArray(src.dailyIssueSessions),
    materialShortages: asArray(src.materialShortages),
    productionLineBindings: asArray(src.productionLineBindings),
    scrapLocationId: src.scrapLocationId,
  }
}

function normalizeProduction(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, PRODUCTION_KNOWN),
    recipeVersions: asArray(src.recipeVersions),
    orders: asArray(src.orders),
    shiftReports: asArray(src.shiftReports),
    wipBatches: asArray(src.wipBatches),
    wasteRecords: asArray(src.wasteRecords),
    handoffs: asArray(src.handoffs),
    auditLog: asArray(src.auditLog),
    lineBindings: asArray(src.lineBindings),
  }
}

function normalizeDomainMeta(raw) {
  const base = emptyDomainMeta()
  if (!raw || typeof raw !== 'object') return base
  const wh = raw.warehouse && typeof raw.warehouse === 'object' ? raw.warehouse : {}
  const prod = raw.production && typeof raw.production === 'object' ? raw.production : {}
  return {
    warehouse: {
      ...pickUnknown(wh, new Set(['active', 'version', 'activatedAt', 'activatedBy'])),
      active: wh.active === true,
      version: Number(wh.version) || (wh.active === true ? 1 : 0),
      activatedAt: wh.activatedAt,
      activatedBy: wh.activatedBy,
    },
    production: {
      ...pickUnknown(prod, new Set(['active', 'version', 'activatedAt', 'activatedBy'])),
      active: prod.active === true,
      version: Number(prod.version) || (prod.active === true ? 1 : 0),
      activatedAt: prod.activatedAt,
      activatedBy: prod.activatedBy,
    },
  }
}

/**
 * Resolve activation. Production is active ONLY when domainMeta.production.active === true.
 * Warehouse: explicit meta, or soft-upgrade when revision>0 and meta omitted (G1/G2 era).
 */
export function resolveDomainActivation(payload, revision = 0) {
  const rev = Number(revision) || 0
  const meta = payload?.domainMeta
  const hasExplicitMeta = meta && typeof meta === 'object'
  const wh = hasExplicitMeta ? meta.warehouse : null
  const prod = hasExplicitMeta ? meta.production : null
  const warehouseActive =
    wh?.active === true ||
    (!hasExplicitMeta && rev > 0) ||
    (hasExplicitMeta && wh?.active !== false && rev > 0 && wh?.active == null)
  // Strict: only explicit true
  const productionActive = prod?.active === true
  return {
    warehouseActive: Boolean(warehouseActive),
    productionActive: Boolean(productionActive),
    warehouseVersion: Number(wh?.version) || (warehouseActive ? 1 : 0),
    productionVersion: Number(prod?.version) || (productionActive ? 1 : 0),
  }
}

export function isWarehouseDomainActive(payload, revision = 0) {
  return resolveDomainActivation(payload, revision).warehouseActive
}

export function isProductionDomainActive(payload, revision = 0) {
  return resolveDomainActivation(payload, revision).productionActive
}

export function markWarehouseDomainActive(payload, actorUid, now = new Date().toISOString()) {
  const meta = {
    ...(payload.domainMeta && typeof payload.domainMeta === 'object'
      ? payload.domainMeta
      : emptyDomainMeta()),
  }
  const prev = meta.warehouse && typeof meta.warehouse === 'object' ? meta.warehouse : {}
  meta.warehouse = {
    ...prev,
    active: true,
    version: Math.max(1, Number(prev.version) || 0),
    activatedAt: prev.activatedAt ?? now,
    activatedBy: prev.activatedBy ?? actorUid,
  }
  if (!meta.production || typeof meta.production !== 'object') {
    meta.production = { active: false, version: 0 }
  }
  return { ...payload, domainMeta: meta }
}

export function markProductionDomainActive(payload, actorUid, now = new Date().toISOString()) {
  const meta = {
    ...(payload.domainMeta && typeof payload.domainMeta === 'object'
      ? payload.domainMeta
      : emptyDomainMeta()),
  }
  if (!meta.warehouse || typeof meta.warehouse !== 'object') {
    meta.warehouse = { active: false, version: 0 }
  }
  const prev = meta.production && typeof meta.production === 'object' ? meta.production : {}
  meta.production = {
    ...prev,
    active: true,
    version: Math.max(1, Number(prev.version) || 0) + (prev.active === true ? 0 : 1),
    activatedAt: now,
    activatedBy: actorUid,
  }
  return { ...payload, domainMeta: meta }
}

export function parseCriticalPayload(payloadJson, { revision = 0 } = {}) {
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

  const topKnown = new Set(['schemaVersion', 'domains', 'domainMeta', 'commandReceipts'])
  const topUnknown = pickUnknown(raw, topKnown)

  const hasProductionKey = Object.prototype.hasOwnProperty.call(domains, 'production')
  const warehouse = normalizeWarehouse(domains.warehouse)
  // v1/v2 without production key: keep absent as empty in memory but do not imply active
  const production = hasProductionKey
    ? normalizeProduction(domains.production)
    : emptyProductionStore()

  const domainMeta = Object.prototype.hasOwnProperty.call(raw, 'domainMeta')
    ? normalizeDomainMeta(raw.domainMeta)
    : emptyDomainMeta()
  // Soft-upgrade G1/G2 era: omitted domainMeta + revision>0 ⇒ warehouse active only
  if (!Object.prototype.hasOwnProperty.call(raw, 'domainMeta') && Number(revision) > 0) {
    domainMeta.warehouse.active = true
    domainMeta.warehouse.version = Math.max(1, domainMeta.warehouse.version)
  }
  const commandReceipts =
    raw.commandReceipts && typeof raw.commandReceipts === 'object' ? { ...raw.commandReceipts } : {}

  return {
    ok: true,
    payload: {
      ...topUnknown,
      schemaVersion: Number(raw.schemaVersion) || G1_CRITICAL_SCHEMA_VERSION,
      domainMeta,
      commandReceipts,
      domains: {
        warehouse,
        production,
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

export function stableDomainHash(domain) {
  return fingerprintCriticalPayload(JSON.stringify(domain ?? null))
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
