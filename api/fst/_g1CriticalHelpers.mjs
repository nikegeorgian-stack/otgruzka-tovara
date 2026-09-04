/**
 * PHASE G1/G2/G3.1/G4/G5 — shared critical-store helpers (server .mjs + tests).
 * Allowed domains only; unknown envelope/domain fields are preserved.
 * Domain activation is per-domain / feature, not bare revision.
 */

export const G1_CRITICAL_SCHEMA_VERSION = 4
/**
 * Shared FstCriticalStore domains. Empty domain ≠ authoritative without active marker.
 * G5: masterData, sales, planning, procurement — activated separately from WH/prod/pack.
 */
export const G1_ALLOWED_DOMAINS = Object.freeze([
  'warehouse',
  'production',
  'masterData',
  'sales',
  'planning',
  'procurement',
])

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
  // PHASE G4 — loading/shipment journals live with warehouse stock truth
  'loadingShipments',
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
  // PHASE G4 — packaging / FG lots / canonical QC decision snapshots
  'packagingReports',
  'finishedGoodsLots',
  'qcDecisions',
])

const MASTER_DATA_KNOWN = new Set([
  'items',
  'finishedProducts',
  'suppliers',
  'customers',
  'packagingBoms',
  'auditLog',
])

const SALES_KNOWN = new Set(['orders', 'auditLog'])

const PLANNING_KNOWN = new Set([
  'productionRecommendations',
  'planningRuns',
  'shortages',
  'masterDataErrors',
  'auditLog',
])

const PROCUREMENT_KNOWN = new Set([
  'orders',
  'unassignedShortages',
  'payments',
  'auditLog',
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
    loadingShipments: [],
  }
}

/** Minimal authoritative production roots (G3 + G4 fields). Legacy FstStore remains until packagingQc activation. */
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
    packagingReports: [],
    finishedGoodsLots: [],
    qcDecisions: [],
  }
}

/** PHASE G5 — server master-data subset (not AppStore directories / finishedProducts blob). */
export function emptyMasterDataStore() {
  return {
    items: [],
    finishedProducts: [],
    suppliers: [],
    customers: [],
    packagingBoms: [],
    auditLog: [],
  }
}

export function emptySalesStore() {
  return {
    orders: [],
    auditLog: [],
  }
}

export function emptyPlanningStore() {
  return {
    productionRecommendations: [],
    planningRuns: [],
    shortages: [],
    masterDataErrors: [],
    auditLog: [],
  }
}

export function emptyProcurementStore() {
  return {
    orders: [],
    unassignedShortages: [],
    payments: [],
    auditLog: [],
  }
}

export function emptyDomainMeta() {
  return {
    warehouse: { active: false, version: 0 },
    production: { active: false, version: 0 },
    // G5 — separate activation; bare critical revision does NOT enable these
    masterData: { active: false, version: 0 },
    salesPlanning: { active: false, version: 0 },
    procurement: { active: false, version: 0 },
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
      masterData: emptyMasterDataStore(),
      sales: emptySalesStore(),
      planning: emptyPlanningStore(),
      procurement: emptyProcurementStore(),
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
    loadingShipments: asArray(src.loadingShipments),
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
    packagingReports: asArray(src.packagingReports),
    finishedGoodsLots: asArray(src.finishedGoodsLots),
    qcDecisions: asArray(src.qcDecisions),
  }
}

function normalizeMasterData(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, MASTER_DATA_KNOWN),
    items: asArray(src.items),
    finishedProducts: asArray(src.finishedProducts),
    suppliers: asArray(src.suppliers),
    customers: asArray(src.customers),
    packagingBoms: asArray(src.packagingBoms),
    auditLog: asArray(src.auditLog),
  }
}

function normalizeSales(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, SALES_KNOWN),
    orders: asArray(src.orders),
    auditLog: asArray(src.auditLog),
  }
}

function normalizePlanning(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, PLANNING_KNOWN),
    productionRecommendations: asArray(src.productionRecommendations),
    planningRuns: asArray(src.planningRuns),
    shortages: asArray(src.shortages),
    masterDataErrors: asArray(src.masterDataErrors),
    auditLog: asArray(src.auditLog),
  }
}

function normalizeProcurement(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, PROCUREMENT_KNOWN),
    orders: asArray(src.orders),
    unassignedShortages: asArray(src.unassignedShortages),
    payments: asArray(src.payments),
    auditLog: asArray(src.auditLog),
  }
}

function normalizeFeatureMeta(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') {
      out[key] = value
      continue
    }
    out[key] = {
      ...pickUnknown(value, new Set(['active', 'version', 'activatedAt', 'activatedBy'])),
      active: value.active === true,
      version: Number(value.version) || (value.active === true ? 1 : 0),
      activatedAt: value.activatedAt,
      activatedBy: value.activatedBy,
    }
  }
  return out
}

function normalizeDomainSlot(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...pickUnknown(src, new Set(['active', 'version', 'activatedAt', 'activatedBy'])),
    active: src.active === true,
    version: Number(src.version) || (src.active === true ? 1 : 0),
    activatedAt: src.activatedAt,
    activatedBy: src.activatedBy,
  }
}

function normalizeDomainMeta(raw) {
  const base = emptyDomainMeta()
  if (!raw || typeof raw !== 'object') return base
  const wh = raw.warehouse && typeof raw.warehouse === 'object' ? raw.warehouse : {}
  const prod = raw.production && typeof raw.production === 'object' ? raw.production : {}
  const prodKnown = new Set(['active', 'version', 'activatedAt', 'activatedBy', 'features'])
  const features = normalizeFeatureMeta(prod.features)
  return {
    warehouse: {
      ...pickUnknown(wh, new Set(['active', 'version', 'activatedAt', 'activatedBy'])),
      active: wh.active === true,
      version: Number(wh.version) || (wh.active === true ? 1 : 0),
      activatedAt: wh.activatedAt,
      activatedBy: wh.activatedBy,
    },
    production: {
      ...pickUnknown(prod, prodKnown),
      active: prod.active === true,
      version: Number(prod.version) || (prod.active === true ? 1 : 0),
      activatedAt: prod.activatedAt,
      activatedBy: prod.activatedBy,
      ...(features ? { features } : {}),
    },
    masterData: normalizeDomainSlot(raw.masterData),
    salesPlanning: normalizeDomainSlot(raw.salesPlanning),
    procurement: normalizeDomainSlot(raw.procurement),
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

/**
 * PHASE G4 — packaging/QC/FG/shipment feature flag.
 * Production core active alone must NOT make empty packaging/QC authoritative.
 */
export function isPackagingQcFeatureActive(payload) {
  return payload?.domainMeta?.production?.features?.packagingQc?.active === true
}

export function markPackagingQcFeatureActive(payload, actorUid, now = new Date().toISOString()) {
  const meta = {
    ...(payload.domainMeta && typeof payload.domainMeta === 'object'
      ? payload.domainMeta
      : emptyDomainMeta()),
  }
  if (!meta.warehouse || typeof meta.warehouse !== 'object') {
    meta.warehouse = { active: false, version: 0 }
  }
  const prevProd = meta.production && typeof meta.production === 'object' ? meta.production : {}
  const prevFeatures =
    prevProd.features && typeof prevProd.features === 'object' ? { ...prevProd.features } : {}
  const prevFeat =
    prevFeatures.packagingQc && typeof prevFeatures.packagingQc === 'object'
      ? prevFeatures.packagingQc
      : {}
  prevFeatures.packagingQc = {
    ...prevFeat,
    active: true,
    version: Math.max(1, Number(prevFeat.version) || 0) + (prevFeat.active === true ? 0 : 1),
    activatedAt: prevFeat.activatedAt ?? now,
    activatedBy: prevFeat.activatedBy ?? actorUid,
  }
  meta.production = {
    ...prevProd,
    features: prevFeatures,
  }
  return { ...payload, domainMeta: meta }
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

function markNamedDomainActive(payload, slotKey, actorUid, now = new Date().toISOString()) {
  const meta = {
    ...(payload.domainMeta && typeof payload.domainMeta === 'object'
      ? { ...payload.domainMeta }
      : emptyDomainMeta()),
  }
  const prev = meta[slotKey] && typeof meta[slotKey] === 'object' ? meta[slotKey] : {}
  meta[slotKey] = {
    ...prev,
    active: true,
    version: Math.max(1, Number(prev.version) || 0) + (prev.active === true ? 0 : 1),
    activatedAt: prev.activatedAt ?? now,
    activatedBy: prev.activatedBy ?? actorUid,
  }
  return { ...payload, domainMeta: meta }
}

/** PHASE G5 — master-data domain (items/products/customers/suppliers/BOM). */
export function isMasterDataDomainActive(payload) {
  return payload?.domainMeta?.masterData?.active === true
}

export function markMasterDataDomainActive(payload, actorUid, now = new Date().toISOString()) {
  return markNamedDomainActive(payload, 'masterData', actorUid, now)
}

/**
 * PHASE G5 — sales + planning/MRP share one activation flag (salesPlanning).
 * Empty sales/planning domains are not authoritative until this is true.
 */
export function isSalesPlanningActive(payload) {
  return payload?.domainMeta?.salesPlanning?.active === true
}

export function markSalesPlanningActive(payload, actorUid, now = new Date().toISOString()) {
  return markNamedDomainActive(payload, 'salesPlanning', actorUid, now)
}

export function isProcurementDomainActive(payload) {
  return payload?.domainMeta?.procurement?.active === true
}

export function markProcurementDomainActive(payload, actorUid, now = new Date().toISOString()) {
  return markNamedDomainActive(payload, 'procurement', actorUid, now)
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
  const production = hasProductionKey
    ? normalizeProduction(domains.production)
    : emptyProductionStore()
  const masterData = Object.prototype.hasOwnProperty.call(domains, 'masterData')
    ? normalizeMasterData(domains.masterData)
    : emptyMasterDataStore()
  const sales = Object.prototype.hasOwnProperty.call(domains, 'sales')
    ? normalizeSales(domains.sales)
    : emptySalesStore()
  const planning = Object.prototype.hasOwnProperty.call(domains, 'planning')
    ? normalizePlanning(domains.planning)
    : emptyPlanningStore()
  const procurement = Object.prototype.hasOwnProperty.call(domains, 'procurement')
    ? normalizeProcurement(domains.procurement)
    : emptyProcurementStore()

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
        masterData,
        sales,
        planning,
        procurement,
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
