/**
 * PHASE G5 — authoritative master-data / sales / planning (MRP) / procurement service.
 *
 * Mirrors G3/G4: typed commands, FstPrincipalAccess ACL (deny-by-default), single CAS
 * that never drops warehouse/production/packaging fields. Local casCommitG5 keeps G3's
 * casCommitDomains signature stable.
 *
 * Trust model:
 * - Capabilities from FstPrincipalAccess.capabilitiesJson only (never AppStore roleId).
 * - Rejects payloadJson / warehousePatch / fullStore / client roleId.
 * - Sales cannot invent products; procurement cannot free-text create items/suppliers.
 * - planning.mrp.acceptProductionDrafts returns draft specs — does NOT create G3 orders.
 *
 * G5.3 packaging BOM: versioned draft→approved→retired. MRP explodes approved BOMs only.
 * G5.4: acceptProductionDrafts attaches trusted BOM refs; G3/G4 consume packagingBomSnapshot
 * via shared _g5PackagingBomHelpers.mjs (never client-forged BOM objects).
 */
import { FST_ADMIN_EMAILS } from './_adminAuth.mjs'
import { createHash } from 'node:crypto'
import {
  bomComponentList,
  bomIsApprovedEffective,
  buildPackagingBomSnapshot,
  computePackagingRequirements,
  packagingBomContentHash,
  productRequiresPackagingBom,
  selectApprovedPackagingBom,
  trustedBomRefFromBom,
} from './_g5PackagingBomHelpers.mjs'
import {
  getFstCommandReceipt,
  getFstCriticalStore,
  getFstPrincipalAccessByUidStore,
  getG1DataConnect,
  insertFstCommandReceipt,
  updateFstCriticalStoreCas,
  upsertFstCriticalStore,
} from './_g1DataConnect.mjs'
import {
  computeServerAvailable,
  computeServerBalance,
  computeServerReserved,
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  isMasterDataDomainActive,
  isPackagingQcFeatureActive,
  isPeriodClosed,
  isProcurementDomainActive,
  isProductionDomainActive,
  isSalesPlanningActive,
  isWarehouseDomainActive,
  isDomainFrozen,
  markMasterDataDomainActive,
  markProcurementDomainActive,
  markSalesPlanningActive,
  markWarehouseDomainActive,
  nextServerDocumentNumber,
  parseCapabilities,
  parseCriticalPayload,
  principalAccessId,
  sanitizeDocumentLines,
  serializeCriticalPayload,
  stableDomainHash,
} from './_g1CriticalHelpers.mjs'
import { G5_CAPS, defaultG5Capabilities } from './_g5Capabilities.mjs'
import { isStagingIsolatedRuntime } from './_dataConnectRuntime.mjs'
import {
  canonicalG5ShipmentCancel,
  canonicalG5ShipmentPost,
} from '../../src/lib/warehouse/g5ShipmentIntegrityCore.mjs'

const EPS = 1e-9
const OPEN_SALES = new Set([
  'confirmed',
  'in_production',
  'partially_ready',
  'ready',
  'partially_shipped',
])
/** Open inbound PO supply for MRP (not submitted/draft/cancelled). */
const INBOUND_PO_STATUSES = new Set(['approved', 'ordered', 'partially_received'])
/** Receipt posting allowed on these statuses. */
const OPEN_PO = new Set(['approved', 'ordered', 'partially_received'])
const OPEN_PROD = new Set([
  'confirmed',
  'released',
  'in_progress',
  'partially_produced',
  'produced',
  'open',
])
const OPEN_REC = new Set(['open'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const CAP_BY_COMMAND = Object.freeze({
  'masterdata.domain.activate': G5_CAPS.MASTERDATA_ITEM_MANAGE,
  'sales.domain.activate': G5_CAPS.SALES_ORDER_CONFIRM,
  'procurement.domain.activate': G5_CAPS.PROCUREMENT_ORDER_APPROVE,

  'masterdata.item.upsert': G5_CAPS.MASTERDATA_ITEM_MANAGE,
  'masterdata.item.archive': G5_CAPS.MASTERDATA_ARCHIVE,
  'masterdata.product.upsert': G5_CAPS.MASTERDATA_PRODUCT_MANAGE,
  'masterdata.product.archive': G5_CAPS.MASTERDATA_ARCHIVE,
  'masterdata.customer.upsert': G5_CAPS.MASTERDATA_CUSTOMER_MANAGE,
  'masterdata.customer.archive': G5_CAPS.MASTERDATA_ARCHIVE,
  'masterdata.supplier.upsert': G5_CAPS.MASTERDATA_SUPPLIER_MANAGE,
  'masterdata.supplier.archive': G5_CAPS.MASTERDATA_ARCHIVE,
  'masterdata.bom.upsert': G5_CAPS.MASTERDATA_BOM_MANAGE,
  'masterdata.bom.approve': G5_CAPS.MASTERDATA_BOM_APPROVE,
  'masterdata.bom.archive': G5_CAPS.MASTERDATA_ARCHIVE,
  'masterdata.bom.retire': G5_CAPS.MASTERDATA_ARCHIVE,

  'sales.order.draft.save': G5_CAPS.SALES_ORDER_EDIT,
  'sales.order.draft.delete': G5_CAPS.SALES_ORDER_EDIT,
  'sales.order.confirm': G5_CAPS.SALES_ORDER_CONFIRM,
  'sales.order.change': G5_CAPS.SALES_ORDER_EDIT,
  'sales.order.cancel': G5_CAPS.SALES_ORDER_CANCEL,
  'sales.order.priority.set': G5_CAPS.SALES_PRIORITY_CHANGE,
  'sales.fulfillment.syncFromShipments': G5_CAPS.SALES_ORDER_EDIT,
  'sales.shipment.post': G5_CAPS.SALES_SHIPMENT_POST,
  'sales.shipment.cancel': G5_CAPS.SALES_SHIPMENT_CANCEL,

  'planning.mrp.run': G5_CAPS.PLANNING_MRP_RUN,
  'planning.mrp.acceptProductionDrafts': G5_CAPS.PLANNING_PRODUCTION_DRAFT_CREATE,
  'planning.shortage.acknowledge': G5_CAPS.PLANNING_SHORTAGE_MANAGE,
  'planning.shortage.resolveManual': G5_CAPS.PLANNING_SHORTAGE_MANAGE,
  'planning.productionRecommendation.createManual': G5_CAPS.PLANNING_MANUAL_PRODUCTION,

  'procurement.generateDraftsFromMrp': G5_CAPS.PROCUREMENT_DRAFT_EDIT,
  'procurement.draft.create': G5_CAPS.PROCUREMENT_DRAFT_EDIT,
  'procurement.draft.edit': G5_CAPS.PROCUREMENT_DRAFT_EDIT,
  'procurement.order.change': G5_CAPS.PROCUREMENT_ORDER_APPROVE,
  'procurement.order.submit': G5_CAPS.PROCUREMENT_ORDER_SUBMIT,
  'procurement.order.approve': G5_CAPS.PROCUREMENT_ORDER_APPROVE,
  'procurement.order.markOrdered': G5_CAPS.PROCUREMENT_ORDER_MARK_ORDERED,
  'procurement.order.cancel': G5_CAPS.PROCUREMENT_ORDER_CANCEL,
  'procurement.receipt.post': G5_CAPS.PROCUREMENT_RECEIPT_POST,
  'procurement.payment.record': G5_CAPS.PROCUREMENT_PAYMENT_RECORD,
})

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function str(value) {
  return String(value ?? '').trim()
}

function num(value) {
  return Number(value)
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6
}

function isAdminEmail(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '')
    .trim()
    .toLowerCase()
  return Boolean(email && FST_ADMIN_EMAILS.has(email))
}

function contentHash(value) {
  const payload = stableJson(value)
  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `g5:${(h >>> 0).toString(16)}`
}

/** Deterministic JSON for fingerprints (sorted object keys). */
function stableJson(value) {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

function sha256Stable(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function markPlanningRunsStaleForBom(planning, finishedProductId, nextRef) {
  const fp = str(finishedProductId)
  const runs = (planning.planningRuns ?? []).map((r) => {
    if (r.stale === true) return r
    const refs = r.packagingBomRefs ?? []
    const hit = refs.find((x) => str(x.finishedProductId) === fp)
    if (!hit) return r
    if (
      str(hit.packagingBomId) !== str(nextRef.packagingBomId) ||
      num(hit.version) !== num(nextRef.version) ||
      str(hit.contentHash) !== str(nextRef.contentHash)
    ) {
      return { ...r, stale: true, staleReason: 'packaging_bom_changed' }
    }
    return r
  })
  return { ...planning, planningRuns: runs }
}

/** Re-check stored packagingBomRefs against current approved master data; mark stale if drift. */
function refreshPlanningRunBomStale(planning, masterData, asOfDate) {
  const runs = (planning.planningRuns ?? []).map((r) => {
    if (r.stale === true) return r
    const refs = r.packagingBomRefs ?? []
    if (refs.length === 0) return r
    for (const ref of refs) {
      const product = findById(masterData.finishedProducts, ref.finishedProductId)
      const current = product
        ? selectApprovedPackagingBom(masterData, product, asOfDate || r.calculatedAt)
        : null
      if (
        !current ||
        str(current.id) !== str(ref.packagingBomId) ||
        num(current.version) !== num(ref.version) ||
        str(current.contentHash) !== str(ref.contentHash)
      ) {
        return { ...r, stale: true, staleReason: 'packaging_bom_changed' }
      }
    }
    return r
  })
  return { ...planning, planningRuns: runs }
}

function stripClientTrusted(command) {
  const {
    roles: _roles,
    role: _role,
    roleId: _roleId,
    capabilities: _caps,
    actorUid: _actorUid,
    actorEmail: _actorEmail,
    criticalRevision: _rev,
    payloadJson: _pj,
    warehousePatch: _wp,
    fullStore: _fs,
    ...rest
  } = command && typeof command === 'object' ? command : {}
  return rest
}

function appendAudit(domain, entry) {
  return { ...domain, auditLog: [...(domain.auditLog ?? []), entry] }
}

function auditEntry(action, actor, now, detail, extra = {}) {
  return {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action,
    actorUid: actor.uid,
    detail: detail || undefined,
    ...extra,
  }
}

function ensureDomain(slot, emptyFactory) {
  return slot && typeof slot === 'object' ? structuredClone(slot) : emptyFactory()
}

function emptyMaster() {
  return { items: [], finishedProducts: [], suppliers: [], customers: [], packagingBoms: [], auditLog: [] }
}
function emptySales() {
  return { orders: [], auditLog: [] }
}
function emptyPlanning() {
  return {
    productionRecommendations: [],
    planningRuns: [],
    shortages: [],
    masterDataErrors: [],
    auditLog: [],
  }
}
function emptyProcurement() {
  return { orders: [], unassignedShortages: [], payments: [], auditLog: [] }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

async function loadPrincipal(dc, storeId, uid) {
  const { data } = await getFstPrincipalAccessByUidStore(dc, { firebaseUid: uid, storeId })
  return data?.fstPrincipalAccesses?.[0] ?? null
}

/**
 * Deny-by-default. FstPrincipalAccess only.
 * Sysadmin emergency: FST_ADMIN_EMAILS + non-empty emergencyReason (audited).
 */
export async function requirePrincipal(uid, storeId, capKey, { actor, emergencyReason } = {}) {
  const dc = getG1DataConnect()
  const row = await loadPrincipal(dc, storeId, uid)
  const reason = str(emergencyReason)
  const caps = row?.active === true ? parseCapabilities(row.capabilitiesJson) : {}
  const hasCap = caps[capKey] === true

  if (row?.active === true && hasCap) {
    return ok({
      principal: row,
      capabilities: { ...defaultG5Capabilities(caps), ...caps },
      emergency: false,
      principalAccessId: principalAccessId(storeId, uid),
    })
  }

  if (isAdminEmail(actor) && reason) {
    return ok({
      principal: row,
      capabilities: defaultG5Capabilities(caps),
      emergency: true,
      emergencyReason: reason,
      principalAccessId: row ? principalAccessId(storeId, uid) : null,
    })
  }

  if (!row || row.active !== true) return fail('forbidden', 403)
  return fail('forbidden', 403)
}

// ---------------------------------------------------------------------------
// Critical store + CAS
// ---------------------------------------------------------------------------

async function loadCritical(storeId, actorUid, { allowInitialize = false } = {}) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) {
    if (!allowInitialize) return fail('critical_store_missing', 409)
    const payload = emptyCriticalPayload()
    const json = serializeCriticalPayload(payload)
    await upsertFstCriticalStore(dc, {
      id: storeId,
      payloadJson: json,
      fingerprint: fingerprintCriticalPayload(json),
      revision: 0,
      updatedByUid: actorUid,
    })
    return ok({ revision: 0, payload, row: null })
  }
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)
  return ok({ revision, payload: parsed.payload, row })
}

async function loadReceipt(dc, idempotencyKey, storeId) {
  const { data } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const row = data?.fstCommandReceipt
  if (!row) return null
  if (row.storeId !== storeId) return { conflict: true }
  try {
    return {
      commandType: str(row.commandType),
      result: JSON.parse(row.resultJson),
      criticalRevision: row.criticalRevisionAfter,
    }
  } catch {
    return { corrupt: true }
  }
}

function embeddedReceipt(payload, idempotencyKey) {
  const row = payload?.commandReceipts?.[idempotencyKey]
  if (!row?.result) return null
  return {
    commandType: str(row.commandType),
    result: row.result,
    criticalRevision: row.criticalRevisionAfter,
    embedded: true,
  }
}

const G5_REPLAY_GUARD_VERSION = 'g5-replay-guard-v1'
const G5_REPLAY_DOMAINS = Object.freeze([
  'masterData',
  'sales',
  'planning',
  'procurement',
  'warehouse',
  'production',
])

function compactReceiptResult(result) {
  if (!result || typeof result !== 'object') return result
  const {
    masterData: _masterData,
    sales: _sales,
    planning: _planning,
    procurement: _procurement,
    warehouse: _warehouse,
    production: _production,
    ...compact
  } = result
  return compact
}

function collectionRowsById(value) {
  if (!Array.isArray(value)) return null
  const rows = value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
  if (rows.length !== value.length) return null
  const ids = rows.map((row) => str(row.id))
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null
  return new Map(rows.map((row, index) => [ids[index], row]))
}

function buildG5ReplayGuard(beforeDomains, afterDomains) {
  const entries = []
  for (const domain of G5_REPLAY_DOMAINS) {
    const before = beforeDomains?.[domain] ?? {}
    const after = afterDomains?.[domain] ?? {}
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    keys.delete('auditLog')
    for (const key of [...keys].sort()) {
      if (stableJson(before?.[key]) === stableJson(after?.[key])) continue
      const beforeRows = collectionRowsById(before?.[key])
      const afterRows = collectionRowsById(after?.[key])
      if (beforeRows && afterRows) {
        const ids = new Set([...beforeRows.keys(), ...afterRows.keys()])
        for (const id of [...ids].sort()) {
          const beforeRow = beforeRows.get(id)
          const afterRow = afterRows.get(id)
          if (stableJson(beforeRow) === stableJson(afterRow)) continue
          entries.push({
            kind: 'row',
            domain,
            key,
            id,
            present: afterRow !== undefined,
            hash: afterRow === undefined ? null : sha256Stable(afterRow),
          })
        }
      } else {
        entries.push({
          kind: 'field',
          domain,
          key,
          hash: sha256Stable(after?.[key]),
        })
      }
    }
  }
  return { version: G5_REPLAY_GUARD_VERSION, entries }
}

function appendG5ReplayDependencies(guard, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length === 0) return guard
  const entries = [...guard.entries]
  const seen = new Set(entries.map((entry) => stableJson(entry)))
  for (const dependency of dependencies) {
    const encoded = stableJson(dependency)
    if (seen.has(encoded)) continue
    seen.add(encoded)
    entries.push(dependency)
  }
  return { ...guard, entries }
}

function activationReplayGuard(domain) {
  return {
    version: G5_REPLAY_GUARD_VERSION,
    entries: [{ kind: 'activation', domain }],
  }
}

function validateG5ReplayGuard(payload, guard) {
  if (
    guard?.version !== G5_REPLAY_GUARD_VERSION ||
    !Array.isArray(guard.entries) ||
    guard.entries.length === 0
  ) {
    return false
  }
  for (const entry of guard.entries) {
    if (entry?.kind === 'activation') {
      const active =
        entry.domain === 'masterData'
          ? isMasterDataDomainActive(payload)
          : entry.domain === 'salesPlanning'
            ? isSalesPlanningActive(payload)
            : entry.domain === 'procurement'
              ? isProcurementDomainActive(payload)
              : false
      if (!active) return false
      continue
    }
    if (
      !entry ||
      !G5_REPLAY_DOMAINS.includes(entry.domain) ||
      !str(entry.key) ||
      str(entry.key) === 'auditLog'
    ) {
      return false
    }
    const domain = payload?.domains?.[entry.domain] ?? {}
    if (entry.kind === 'salesProductionLink') {
      if (entry.domain !== 'production' || entry.key !== 'orders') return false
      const rows = collectionRowsById(domain.orders)
      const order = rows?.get(str(entry.id))
      if (
        !order ||
        Number(order.wipContractVersion) !== 1 ||
        str(order.finishedProductId) !== str(entry.finishedProductId) ||
        (str(order.salesOrderId) && str(order.salesOrderId) !== str(entry.salesOrderId)) ||
        (str(order.salesLineId) && str(order.salesLineId) !== str(entry.salesLineId))
      ) {
        return false
      }
      continue
    }
    if (entry.kind === 'row') {
      const rows = collectionRowsById(domain?.[entry.key])
      if (!rows || !str(entry.id)) return false
      const matches = rows.has(str(entry.id)) ? [rows.get(str(entry.id))] : []
      if (entry.present !== true) {
        if (matches.length !== 0 || entry.hash !== null) return false
        continue
      }
      if (
        matches.length !== 1 ||
        !/^[a-f0-9]{64}$/.test(str(entry.hash)) ||
        sha256Stable(matches[0]) !== entry.hash
      ) {
        return false
      }
      continue
    }
    if (
      entry.kind !== 'field' ||
      !/^[a-f0-9]{64}$/.test(str(entry.hash)) ||
      sha256Stable(domain?.[entry.key]) !== entry.hash
    ) {
      return false
    }
  }
  return true
}

function currentG5ReplayProjection(receiptResult, critical, commandFingerprint, recovered) {
  const current = critical.payload.domains
  return {
    ...compactReceiptResult(receiptResult),
    commandFingerprint,
    criticalRevision: critical.revision,
    masterDataActive: isMasterDataDomainActive(critical.payload),
    salesPlanningActive: isSalesPlanningActive(critical.payload),
    procurementActive: isProcurementDomainActive(critical.payload),
    packagingQcActive: isPackagingQcFeatureActive(critical.payload),
    productionActive: isProductionDomainActive(critical.payload, critical.revision),
    warehouseActive: isWarehouseDomainActive(critical.payload, critical.revision),
    masterData: current.masterData,
    sales: current.sales,
    planning: current.planning,
    procurement: current.procurement,
    idempotent: true,
    ...(recovered ? { recoveredFromEmbeddedReceipt: true } : {}),
  }
}

async function saveReceipt(dc, idempotencyKey, storeId, commandType, actorUid, result, criticalRevision) {
  try {
    await insertFstCommandReceipt(dc, {
      id: idempotencyKey,
      storeId,
      commandType,
      actorUid,
      resultJson: JSON.stringify(compactReceiptResult(result)),
      criticalRevisionAfter: criticalRevision,
    })
  } catch (err) {
    console.warn('g5 receipt insert failed', err)
  }
}

/**
 * CAS that updates only passed domain slots; ALWAYS spreads existing domains so
 * warehouse / production / packaging fields are never dropped.
 */
async function casCommitG5(
  dc,
  storeId,
  critical,
  actorUid,
  {
    warehouse,
    production,
    masterData,
    sales,
    planning,
    procurement,
    idempotencyKey,
    commandType,
    result,
    activateMasterData = false,
    activateSalesPlanning = false,
    activateProcurement = false,
  } = {},
) {
  const prev = critical.payload.domains ?? {}
  let nextPayload = {
    ...critical.payload,
    schemaVersion: Math.max(Number(critical.payload.schemaVersion) || 0, 4),
    domains: {
      ...prev,
      warehouse: warehouse !== undefined ? warehouse : prev.warehouse,
      production: production !== undefined ? production : prev.production,
      masterData: masterData !== undefined ? masterData : prev.masterData,
      sales: sales !== undefined ? sales : prev.sales,
      planning: planning !== undefined ? planning : prev.planning,
      procurement: procurement !== undefined ? procurement : prev.procurement,
      // G6 — never drop capacity sibling
      capacity: prev.capacity,
    },
  }

  // bump schema so G6 capacity domain round-trips
  nextPayload.schemaVersion = Math.max(Number(nextPayload.schemaVersion) || 0, 5)

  if (activateMasterData || isMasterDataDomainActive(critical.payload)) {
    nextPayload = markMasterDataDomainActive(nextPayload, actorUid)
  }
  if (activateSalesPlanning || isSalesPlanningActive(critical.payload)) {
    nextPayload = markSalesPlanningActive(nextPayload, actorUid)
  }
  if (activateProcurement || isProcurementDomainActive(critical.payload)) {
    nextPayload = markProcurementDomainActive(nextPayload, actorUid)
  }
  if (
    critical.payload.domainMeta?.warehouse?.active === true ||
    (warehouse?.documents?.length > 0 && critical.revision > 0)
  ) {
    nextPayload = markWarehouseDomainActive(nextPayload, actorUid)
  }

  const nextRevision = critical.revision + 1
  if (idempotencyKey && result) {
    nextPayload = {
      ...nextPayload,
      commandReceipts: {
        ...(nextPayload.commandReceipts ?? {}),
        [idempotencyKey]: {
          commandType,
          actorUid,
          at: new Date().toISOString(),
          criticalRevisionAfter: nextRevision,
          result: compactReceiptResult({ ...result, criticalRevision: nextRevision }),
        },
      },
    }
  }

  const nextJson = serializeCriticalPayload(nextPayload)
  try {
    await updateFstCriticalStoreCas(dc, {
      id: storeId,
      expectedRevision: critical.revision,
      revision: nextRevision,
      payloadJson: nextJson,
      fingerprint: fingerprintCriticalPayload(nextJson),
      updatedByUid: actorUid,
    })
  } catch (err) {
    const msg = String(err?.message ?? err ?? '')
    if (msg.includes('revision_conflict') || msg.includes('FAILED_PRECONDITION')) {
      return fail('revision_conflict', 409)
    }
    throw err
  }
  return ok({
    criticalRevision: nextRevision,
    payload: nextPayload,
    warehouse: nextPayload.domains.warehouse,
    production: nextPayload.domains.production,
    masterData: nextPayload.domains.masterData,
    sales: nextPayload.domains.sales,
    planning: nextPayload.domains.planning,
    procurement: nextPayload.domains.procurement,
  })
}

// ---------------------------------------------------------------------------
// Master data helpers
// ---------------------------------------------------------------------------

function findById(list, id) {
  return (list ?? []).find((x) => x.id === id) ?? null
}

function codeTaken(list, code, exceptId) {
  const c = str(code).toLowerCase()
  if (!c) return false
  return (list ?? []).some((x) => x.id !== exceptId && str(x.code).toLowerCase() === c)
}

function nextWarehouseItemCode(items) {
  let max = 0
  const used = new Set()
  for (const item of items ?? []) {
    const code = str(item?.code).toUpperCase()
    if (!code) continue
    used.add(code)
    const match = code.match(/^FC-(\d{6})$/)
    if (match) max = Math.max(max, Number(match[1]) || 0)
  }
  for (let n = max + 1; n <= max + (items?.length ?? 0) + 10_000; n += 1) {
    const candidate = `FC-${String(n).padStart(6, '0')}`
    if (!used.has(candidate)) return candidate
  }
  return ''
}

function upsertById(list, entity) {
  const idx = (list ?? []).findIndex((x) => x.id === entity.id)
  if (idx < 0) return [...(list ?? []), entity]
  const next = [...list]
  next[idx] = entity
  return next
}

function archiveById(list, id, now, actorUid) {
  const row = findById(list, id)
  if (!row) return { ok: false, error: 'not_found', status: 404 }
  if (row.archived === true) {
    return { ok: true, list, entity: row, idempotent: true }
  }
  const entity = {
    ...row,
    archived: true,
    active: false,
    updatedAt: now,
    updatedBy: actorUid,
  }
  return { ok: true, list: upsertById(list, entity), entity }
}

export function applyItemUpsert(
  masterData,
  command,
  actor,
  now,
  { strict = false, warehouse = undefined } = {},
) {
  const id = str(command.id) || `item-${crypto.randomUUID()}`
  const existing = findById(masterData.items, id)
  const code = str(command.code) || str(existing?.code) || nextWarehouseItemCode(masterData.items)
  const name = str(command.name)
  const baseUnit = str(command.baseUnit)
  if (!code || !name || !baseUnit) return fail('invalid_input', 400)
  if (codeTaken(masterData.items, code, id)) return fail('duplicate_code', 409)
  if (existing && existing.archived === true && command.unarchive !== true) {
    return fail('archived', 409)
  }
  const categoryId =
    command.categoryId != null ? str(command.categoryId) : str(existing?.categoryId)
  const warehouseId =
    command.warehouseId != null ? str(command.warehouseId) : str(existing?.warehouseId)
  if (strict) {
    if (command.active === false) return fail('masterdata_item_active_required', 409)
    if (!categoryId) return fail('masterdata_item_category_required', 409)
    if (!warehouseId) return fail('masterdata_item_warehouse_required', 409)
    const categoryMatches = (warehouse?.categories ?? []).filter(
      (row) => str(row?.id) === categoryId,
    )
    if (categoryMatches.length === 0) return fail('masterdata_item_category_unavailable', 409)
    if (categoryMatches.length !== 1) return fail('masterdata_item_category_ambiguous', 409)
    if (categoryMatches[0].archived === true || categoryMatches[0].active === false) {
      return fail('masterdata_item_category_unavailable', 409)
    }
    const warehouseMatches = (warehouse?.locations ?? []).filter(
      (row) => str(row?.id) === warehouseId,
    )
    if (warehouseMatches.length === 0) return fail('masterdata_item_warehouse_unavailable', 409)
    if (warehouseMatches.length !== 1) return fail('masterdata_item_warehouse_ambiguous', 409)
    if (warehouseMatches[0].archived === true || warehouseMatches[0].active === false) {
      return fail('masterdata_item_warehouse_unavailable', 409)
    }
  }
  const item = {
    ...(existing ?? {}),
    id,
    code,
    name,
    categoryId: categoryId || undefined,
    warehouseId: warehouseId || undefined,
    baseUnit,
    conversions: Array.isArray(command.conversions) ? command.conversions : existing?.conversions,
    batchTracking: command.batchTracking ?? existing?.batchTracking,
    expiryTracking: command.expiryTracking ?? existing?.expiryTracking,
    safetyStock: command.safetyStock != null ? num(command.safetyStock) : existing?.safetyStock,
    minStock: command.minStock != null ? num(command.minStock) : existing?.minStock,
    defaultSupplierId:
      command.defaultSupplierId != null
        ? str(command.defaultSupplierId) || undefined
        : existing?.defaultSupplierId,
    alternativeSupplierIds: Array.isArray(command.alternativeSupplierIds)
      ? command.alternativeSupplierIds.map(str).filter(Boolean)
      : existing?.alternativeSupplierIds,
    leadTimeDays: command.leadTimeDays != null ? num(command.leadTimeDays) : existing?.leadTimeDays,
    moq: command.moq != null ? num(command.moq) : existing?.moq,
    orderMultiple: command.orderMultiple != null ? num(command.orderMultiple) : existing?.orderMultiple,
    packSize: command.packSize != null ? num(command.packSize) : existing?.packSize,
    archived: false,
    active: command.active === false ? false : true,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...masterData, items: upsertById(masterData.items, item) }
  next = appendAudit(next, auditEntry('masterdata_item_upsert', actor, now, id))
  return ok({ masterData: next, result: { id, code, item } })
}

function isAreaWarehouseUnit(unit) {
  return new Set(['m2', 'м2', 'м²', 'sqm']).has(str(unit).toLowerCase())
}

function applyProductUpsert(masterData, command, actor, now, { strict = false } = {}) {
  const id = str(command.id) || `fp-${crypto.randomUUID()}`
  const code = str(command.code)
  const name = str(command.name)
  if (!code || !name) return fail('invalid_input', 400)
  if (codeTaken(masterData.finishedProducts, code, id)) return fail('duplicate_code', 409)
  const existing = findById(masterData.finishedProducts, id)
  const warehouseItemId =
    command.warehouseItemId != null
      ? str(command.warehouseItemId) || undefined
      : existing?.warehouseItemId
  if (strict && !warehouseItemId) return fail('finished_goods_mapping_required', 409)
  if (warehouseItemId) {
    const itemMatches = (masterData.items ?? []).filter(
      (row) => str(row?.id) === warehouseItemId,
    )
    if (itemMatches.length === 0) return fail('finished_goods_item_unavailable', 409)
    if (itemMatches.length !== 1) return fail('finished_goods_item_ambiguous', 409)
    const item = itemMatches[0]
    if (item.archived === true || item.active === false) {
      return fail('finished_goods_item_unavailable', 409)
    }
    if (!isAreaWarehouseUnit(item.baseUnit ?? item.unit)) {
      return fail('finished_goods_item_area_unit_required', 409)
    }
  }
  const validProductionLineIds = Array.isArray(command.validProductionLineIds)
    ? command.validProductionLineIds.map(str).filter(Boolean)
    : existing?.validProductionLineIds
  const validPackagingLineIds = Array.isArray(command.validPackagingLineIds)
    ? command.validPackagingLineIds.map(str).filter(Boolean)
    : existing?.validPackagingLineIds
  // validLineIds is legacy-only storage for scan/preview — never the sole authoritative mapping write
  const validLineIds = Array.isArray(command.validLineIds)
    ? command.validLineIds.map(str).filter(Boolean)
    : existing?.validLineIds
  const product = {
    ...(existing ?? {}),
    id,
    code,
    name,
    baseUnit: 'm2',
    warehouseItemId,
    validProductionLineIds,
    validPackagingLineIds,
    validLineIds,
    formulationRecipeId:
      command.formulationRecipeId != null
        ? str(command.formulationRecipeId) || undefined
        : existing?.formulationRecipeId,
    packagingBomId:
      command.packagingBomId != null ? str(command.packagingBomId) || undefined : existing?.packagingBomId,
    packagingBomRequired:
      command.packagingBomRequired === false
        ? false
        : command.packagingBomRequired === true
          ? true
          : existing?.packagingBomRequired,
    archived: false,
    active: command.active === false ? false : true,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...masterData, finishedProducts: upsertById(masterData.finishedProducts, product) }
  next = appendAudit(next, auditEntry('masterdata_product_upsert', actor, now, id))
  return ok({ masterData: next, result: { id, code, warehouseItemId } })
}

function applyCustomerUpsert(masterData, command, actor, now) {
  const id = str(command.id) || `cust-${crypto.randomUUID()}`
  const name = str(command.name)
  if (!name) return fail('invalid_input', 400)
  const code = command.code != null ? str(command.code) : undefined
  if (code && codeTaken(masterData.customers, code, id)) return fail('duplicate_code', 409)
  const existing = findById(masterData.customers, id)
  const row = {
    ...(existing ?? {}),
    id,
    code: code || existing?.code,
    name,
    archived: false,
    active: command.active === false ? false : true,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...masterData, customers: upsertById(masterData.customers, row) }
  next = appendAudit(next, auditEntry('masterdata_customer_upsert', actor, now, id))
  return ok({ masterData: next, result: { id } })
}

function applySupplierUpsert(masterData, command, actor, now) {
  const id = str(command.id) || `sup-${crypto.randomUUID()}`
  const name = str(command.name)
  if (!name) return fail('invalid_input', 400)
  const code = command.code != null ? str(command.code) : undefined
  if (code && codeTaken(masterData.suppliers, code, id)) return fail('duplicate_code', 409)
  const existing = findById(masterData.suppliers, id)
  const row = {
    ...(existing ?? {}),
    id,
    code: code || existing?.code,
    name,
    leadTimeDays: command.leadTimeDays != null ? num(command.leadTimeDays) : existing?.leadTimeDays,
    paymentTerms: command.paymentTerms != null ? str(command.paymentTerms) : existing?.paymentTerms,
    suppliedItemIds: Array.isArray(command.suppliedItemIds)
      ? command.suppliedItemIds.map(str).filter(Boolean)
      : existing?.suppliedItemIds,
    archived: false,
    active: command.active === false ? false : true,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...masterData, suppliers: upsertById(masterData.suppliers, row) }
  next = appendAudit(next, auditEntry('masterdata_supplier_upsert', actor, now, id))
  return ok({ masterData: next, result: { id } })
}

function parseBomComponents(command, masterData) {
  const raw = Array.isArray(command.components)
    ? command.components
    : Array.isArray(command.lines)
      ? command.lines
      : []
  if (raw.length === 0) return { ok: false, error: 'empty_lines' }
  const components = []
  for (const ln of raw) {
    const itemId = str(ln.warehouseItemId || ln.itemId)
    const quantity = num(ln.quantity ?? ln.qty)
    const unit = str(ln.unit)
    if (!itemId || !unit || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: 'invalid_bom_line' }
    }
    if (!findById(masterData.items, itemId)) return { ok: false, error: 'item_not_found' }
    const row = {
      itemId,
      warehouseItemId: ln.warehouseItemId != null ? str(ln.warehouseItemId) || itemId : itemId,
      quantity: roundQty(quantity),
      unit,
    }
    if (ln.conversionFactor != null && Number.isFinite(num(ln.conversionFactor))) {
      row.conversionFactor = num(ln.conversionFactor)
    }
    if (ln.wasteFactor != null && Number.isFinite(num(ln.wasteFactor))) {
      row.wasteFactor = num(ln.wasteFactor)
    }
    if (ln.note != null && str(ln.note)) row.note = str(ln.note)
    components.push(row)
  }
  return { ok: true, components }
}

function nextBomVersionForProduct(masterData, finishedProductId) {
  let max = 0
  for (const b of masterData.packagingBoms ?? []) {
    if (str(b.finishedProductId) !== str(finishedProductId)) continue
    max = Math.max(max, num(b.version) || 0)
  }
  return max + 1
}

/**
 * masterdata.bom.upsert — create/update draft only.
 * Approved/retired rows are immutable (bom_immutable); use a new id for a new version.
 */
function applyBomUpsert(masterData, command, actor, now) {
  const id = str(command.id) || `bom-${crypto.randomUUID()}`
  const finishedProductId = str(command.finishedProductId)
  if (!finishedProductId) return fail('invalid_input', 400)
  if (!findById(masterData.finishedProducts, finishedProductId)) {
    return fail('product_not_found', 404)
  }
  const existing = findById(masterData.packagingBoms, id)
  if (existing) {
    const st = existing.status
    if (st === 'approved' || st === 'retired' || existing.archived === true) {
      return fail('bom_immutable', 409)
    }
    // Legacy pre-G5.3 rows (no status) are treated as sealed.
    if (st == null) return fail('bom_immutable', 409)
    if (st !== 'draft') return fail('bom_immutable', 409)
  }

  const parsed = parseBomComponents(command, masterData)
  if (!parsed.ok) {
    const status = parsed.error === 'item_not_found' ? 404 : 400
    return fail(parsed.error, status)
  }

  const baseOutputQty =
    command.baseOutputQty != null && Number.isFinite(num(command.baseOutputQty)) && num(command.baseOutputQty) > 0
      ? roundQty(num(command.baseOutputQty))
      : existing?.baseOutputQty != null
        ? roundQty(num(existing.baseOutputQty) || 1)
        : 1

  const version = existing
    ? num(existing.version) || 1
    : nextBomVersionForProduct(masterData, finishedProductId)

  const bom = {
    ...(existing ?? {}),
    id,
    packagingBomId: id,
    finishedProductId,
    version,
    status: 'draft',
    baseOutputQty,
    components: parsed.components,
    lines: parsed.components.map((c) => ({
      itemId: c.itemId,
      qty: c.quantity,
      unit: c.unit,
    })),
    effectiveFrom:
      command.effectiveFrom != null
        ? str(command.effectiveFrom).slice(0, 10) || undefined
        : existing?.effectiveFrom,
    effectiveTo:
      command.effectiveTo != null
        ? str(command.effectiveTo).slice(0, 10) || undefined
        : existing?.effectiveTo,
    archived: false,
    active: true,
    contentHash: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    updatedAt: now,
    updatedBy: actor.uid,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor.uid,
  }
  if (command.code != null) bom.code = str(command.code)
  if (command.name != null) bom.name = str(command.name)

  let next = { ...masterData, packagingBoms: upsertById(masterData.packagingBoms, bom) }
  next = appendAudit(next, auditEntry('masterdata_bom_upsert', actor, now, id, { version, status: 'draft' }))
  return ok({
    masterData: next,
    result: { id, packagingBomId: id, finishedProductId, version, status: 'draft' },
  })
}

function applyBomApprove(masterData, planning, command, actor, now) {
  const id = str(command.id ?? command.packagingBomId)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(masterData.packagingBoms, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'approved' && existing.approvedAt) {
    return ok({
      masterData,
      planning,
      result: {
        id,
        packagingBomId: id,
        version: existing.version,
        status: 'approved',
        contentHash: existing.contentHash,
        idempotent: true,
      },
    })
  }
  if (existing.status !== 'draft') return fail('bom_not_draft', 409)
  const components = bomComponentList(existing)
  if (components.length === 0) return fail('empty_lines', 400)

  const hash = packagingBomContentHash({
    finishedProductId: existing.finishedProductId,
    baseOutputQty: existing.baseOutputQty ?? 1,
    components,
  })

  const approved = {
    ...existing,
    packagingBomId: id,
    status: 'approved',
    contentHash: hash,
    approvedBy: actor.uid,
    approvedAt: now,
    archived: false,
    active: true,
    updatedAt: now,
    updatedBy: actor.uid,
  }

  let boms = upsertById(masterData.packagingBoms, approved)
  // Retire previous approved for same finished product (versioned history kept).
  boms = boms.map((b) => {
    if (b.id === id) return b
    if (str(b.finishedProductId) !== str(existing.finishedProductId)) return b
    if (b.status !== 'approved') return b
    return {
      ...b,
      status: 'retired',
      archived: true,
      active: false,
      effectiveTo: b.effectiveTo || now.slice(0, 10),
      updatedAt: now,
      updatedBy: actor.uid,
    }
  })

  let products = masterData.finishedProducts ?? []
  const product = findById(products, existing.finishedProductId)
  if (product) {
    products = upsertById(products, {
      ...product,
      packagingBomId: id,
      updatedAt: now,
      updatedBy: actor.uid,
    })
  }

  let next = { ...masterData, packagingBoms: boms, finishedProducts: products }
  next = appendAudit(
    next,
    auditEntry('masterdata_bom_approve', actor, now, id, { version: approved.version, contentHash: hash }),
  )

  const bomRef = {
    packagingBomId: id,
    version: approved.version,
    contentHash: hash,
  }
  let nextPlanning = markPlanningRunsStaleForBom(planning, existing.finishedProductId, bomRef)

  return ok({
    masterData: next,
    planning: nextPlanning,
    result: {
      id,
      packagingBomId: id,
      finishedProductId: existing.finishedProductId,
      version: approved.version,
      status: 'approved',
      contentHash: hash,
    },
  })
}

function applyBomArchive(masterData, command, actor, now) {
  const id = str(command.id ?? command.packagingBomId)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(masterData.packagingBoms, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'retired' || existing.archived === true) {
    return ok({
      masterData,
      result: { id, archived: true, status: 'retired', idempotent: true },
    })
  }
  const bom = {
    ...existing,
    status: 'retired',
    archived: true,
    active: false,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...masterData, packagingBoms: upsertById(masterData.packagingBoms, bom) }
  next = appendAudit(next, auditEntry('masterdata_bom_archive', actor, now, id))
  return ok({ masterData: next, result: { id, archived: true, status: 'retired' } })
}

function applyMasterArchive(masterData, kind, command, actor, now) {
  if (kind === 'bom') return applyBomArchive(masterData, command, actor, now)
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const key =
    kind === 'item'
      ? 'items'
      : kind === 'product'
        ? 'finishedProducts'
        : kind === 'customer'
          ? 'customers'
          : kind === 'supplier'
            ? 'suppliers'
            : 'packagingBoms'
  const archived = archiveById(masterData[key], id, now, actor.uid)
  if (!archived.ok) return fail(archived.error, archived.status)
  let next = { ...masterData, [key]: archived.list }
  next = appendAudit(next, auditEntry(`masterdata_${kind}_archive`, actor, now, id))
  return ok({ masterData: next, result: { id, archived: true, idempotent: archived.idempotent } })
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const SALES_ORDER_CONTRACT_VERSION = 'g5-sales-order-v1'
const SALES_ORDER_NUMBER_RE = /^ЗК-(\d{4})-(\d{3,})$/
const SALES_PRIORITY = new Set([1, 10])

function validIsoDate(value) {
  const raw = str(value)
  if (!DATE_RE.test(raw)) return false
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function nextSalesOrderNumber(orders, orderDate) {
  const year = Number(str(orderDate).slice(0, 4))
  let max = 0
  for (const order of orders ?? []) {
    const match = str(order?.orderNumber).match(SALES_ORDER_NUMBER_RE)
    if (!match || Number(match[1]) !== year) continue
    max = Math.max(max, Number(match[2]) || 0)
  }
  return `ЗК-${year}-${String(max + 1).padStart(3, '0')}`
}

function normalizeSalesPriority(value, fallback = 1) {
  if (value == null || value === '') return SALES_PRIORITY.has(Number(fallback)) ? Number(fallback) : 1
  const priority = num(value)
  return SALES_PRIORITY.has(priority) ? priority : null
}

function validateSalesProductionLinks(value, production, expected) {
  if (value == null) return { ok: true, ids: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_production_links', status: 400 }
  const ids = value.map(str)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return { ok: false, error: 'invalid_production_links', status: 400 }
  }
  for (const id of ids) {
    const matches = (production?.orders ?? []).filter((order) => str(order?.id) === id)
    if (matches.length === 0) {
      return { ok: false, error: 'production_order_not_found', status: 404 }
    }
    if (matches.length !== 1) {
      return { ok: false, error: 'production_order_link_ambiguous', status: 409 }
    }
    const order = matches[0]
    if (
      Number(order.wipContractVersion) !== 1 ||
      str(order.finishedProductId) !== str(expected.finishedProductId)
    ) {
      return { ok: false, error: 'production_order_lineage_mismatch', status: 409 }
    }
    if (
      (str(order.salesOrderId) && str(order.salesOrderId) !== str(expected.salesOrderId)) ||
      (str(order.salesLineId) && str(order.salesLineId) !== str(expected.salesLineId))
    ) {
      return { ok: false, error: 'production_order_sales_link_mismatch', status: 409 }
    }
  }
  return { ok: true, ids }
}

function salesProductionReplayDependencies(lines, salesOrderId) {
  return (lines ?? []).flatMap((line) =>
    (line.linkedProductionOrderIds ?? []).map((id) => ({
      kind: 'salesProductionLink',
      domain: 'production',
      key: 'orders',
      id,
      finishedProductId: line.finishedProductId,
      salesOrderId,
      salesLineId: line.lineId,
    })),
  )
}

function normalizeDraftLines(lines, masterData, production, existing, salesOrderId) {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'empty_lines' }
  const suppliedIds = lines.map((line) => str(line?.lineId)).filter(Boolean)
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    return { ok: false, error: 'duplicate_line_id' }
  }
  const existingById = new Map((existing?.lines ?? []).map((line) => [str(line.lineId), line]))
  const assignedIds = new Set()
  const out = []
  for (const ln of lines) {
    const finishedProductId = str(ln.finishedProductId)
    const quantity = num(ln.quantity)
    if (!finishedProductId) return { ok: false, error: 'product_required' }
    const product = findById(masterData.finishedProducts, finishedProductId)
    if (!product || product.archived === true || product.active === false) {
      return { ok: false, error: 'product_not_found' }
    }
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'invalid_quantity' }
    const roundedQuantity = roundQty(quantity)
    if (!finitePositive(roundedQuantity)) return { ok: false, error: 'invalid_quantity' }
    const canonicalUnit = str(product.baseUnit) || 'm2'
    const requestedUnit = str(ln.unit)
    if (requestedUnit && requestedUnit !== canonicalUnit) {
      return { ok: false, error: 'unit_mismatch' }
    }
    const requestedShipDate = ln.requestedShipDate != null ? str(ln.requestedShipDate) : ''
    if (requestedShipDate && !validIsoDate(requestedShipDate)) {
      return { ok: false, error: 'invalid_date' }
    }
    const linePriority = normalizeSalesPriority(ln.priority, undefined)
    if (ln.priority != null && linePriority == null) {
      return { ok: false, error: 'invalid_priority' }
    }
    const suppliedId = str(ln.lineId)
    const previous = suppliedId ? existingById.get(suppliedId) : null
    // Only an already-authoritative line id may be reused on edit. New ids are
    // allocated by the server; a browser-provided id is correlation input only.
    const lineId = previous ? suppliedId : `sol-${crypto.randomUUID()}`
    if (assignedIds.has(lineId)) return { ok: false, error: 'duplicate_line_id' }
    assignedIds.add(lineId)
    const linked = validateSalesProductionLinks(ln.linkedProductionOrderIds, production, {
      finishedProductId,
      salesOrderId,
      salesLineId: lineId,
    })
    if (!linked.ok) return linked
    out.push({
      lineId,
      finishedProductId,
      productCodeSnapshot: str(product.code),
      productNameSnapshot: str(product.name),
      unit: canonicalUnit,
      quantity: roundedQuantity,
      requestedShipDate: requestedShipDate || undefined,
      priority: linePriority ?? undefined,
      // Linkage is accepted only after the server validation above. Progress is
      // always initialized by the server and never copied from the draft form.
      linkedProductionOrderIds: linked.ids,
      producedQty: 0,
      releasedQty: 0,
      shippedQty: 0,
      remainingQty: roundedQuantity,
    })
  }
  return { ok: true, lines: out }
}

function applySalesDraftSave(sales, masterData, production, command, actor, now) {
  const id = str(command.id) || `so-${crypto.randomUUID()}`
  const existing = findById(sales.orders, id)
  if (existing && existing.status !== 'draft') return fail('not_draft', 409)
  const customerId = str(command.customerId)
  if (!customerId) return fail('customer_required', 400)
  const customer = findById(masterData.customers, customerId)
  if (!customer || customer.archived === true || customer.active === false) {
    return fail('customer_not_found', 404)
  }
  const linesIn = normalizeDraftLines(command.lines, masterData, production, existing, id)
  if (!linesIn.ok) return fail(linesIn.error, linesIn.status ?? 400)
  const explicitOrderDate = str(command.orderDate)
  if (explicitOrderDate && !validIsoDate(explicitOrderDate)) return fail('invalid_date', 400)
  const shipDates = [...new Set(linesIn.lines.map((line) => str(line.requestedShipDate)).filter(Boolean))]
  const orderDate = explicitOrderDate || (shipDates.length === 1 ? shipDates[0] : now.slice(0, 10))
  if (!validIsoDate(orderDate)) return fail('invalid_date', 400)
  const priority = normalizeSalesPriority(command.priority, existing?.priority)
  if (priority == null) return fail('invalid_priority', 400)
  const existingOrderNumber = str(existing?.orderNumber)
  if (existingOrderNumber && !SALES_ORDER_NUMBER_RE.test(existingOrderNumber)) {
    return fail('sales_order_number_invalid', 409)
  }
  const orderNumber = existingOrderNumber || nextSalesOrderNumber(sales.orders, orderDate)
  if (
    (sales.orders ?? []).some(
      (candidate) => candidate.id !== id && str(candidate.orderNumber) === orderNumber,
    )
  ) {
    return fail('duplicate_order_number', 409)
  }

  const order = {
    ...(existing ?? {}),
    salesOrderContractVersion: SALES_ORDER_CONTRACT_VERSION,
    id,
    orderNumber,
    status: 'draft',
    customerId,
    customerCodeSnapshot: str(customer.code),
    customerNameSnapshot: str(customer.name),
    priority,
    orderDate,
    revision: existing ? (Number(existing.revision) || 0) + 1 : 0,
    lines: linesIn.lines,
    updatedAt: now,
    updatedBy: actor.uid,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
  }
  let next = { ...sales, orders: upsertById(sales.orders, order) }
  next = appendAudit(next, auditEntry('sales_order_draft_save', actor, now, id))
  return ok({
    sales: next,
    replayDependencies: salesProductionReplayDependencies(order.lines, id),
    result: {
      id,
      orderNumber,
      status: 'draft',
      revision: order.revision,
      order,
    },
  })
}

function applySalesDraftDelete(sales, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(sales.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status !== 'draft') return fail('not_draft', 409)
  let next = { ...sales, orders: sales.orders.filter((o) => o.id !== id) }
  next = appendAudit(next, auditEntry('sales_order_draft_delete', actor, now, id))
  return ok({ sales: next, result: { id, deleted: true } })
}

function upsertRecommendation(planning, rec) {
  const list = [...(planning.productionRecommendations ?? [])]
  const idx = list.findIndex(
    (r) =>
      r.salesOrderId === rec.salesOrderId &&
      r.salesLineId === rec.salesLineId &&
      OPEN_REC.has(r.status),
  )
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...rec, id: list[idx].id }
  } else {
    list.push(rec)
  }
  return { ...planning, productionRecommendations: list }
}

function supersedeOpenRecommendations(planning, salesOrderId, now) {
  const list = (planning.productionRecommendations ?? []).map((r) => {
    if (r.salesOrderId === salesOrderId && r.status === 'open') {
      return { ...r, status: 'superseded', supersededAt: now }
    }
    return r
  })
  return { ...planning, productionRecommendations: list }
}

function applySalesConfirm(sales, masterData, planning, production, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(sales.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'confirmed' || OPEN_SALES.has(existing.status)) {
    // Idempotent confirm
    if (existing.status !== 'draft' && existing.status !== 'cancelled') {
      for (const line of existing.lines ?? []) {
        const linked = validateSalesProductionLinks(
          line.linkedProductionOrderIds,
          production,
          {
            finishedProductId: line.finishedProductId,
            salesOrderId: id,
            salesLineId: line.lineId,
          },
        )
        if (!linked.ok) return fail(linked.error, linked.status ?? 409)
      }
      return ok({
        sales,
        planning,
        result: {
          id,
          orderNumber: existing.orderNumber,
          status: existing.status,
          revision: existing.revision,
          order: existing,
          idempotent: true,
        },
      })
    }
  }
  if (existing.status !== 'draft') return fail('not_draft', 409)

  const customer = findById(masterData.customers, existing.customerId)
  if (!customer || customer.archived === true || customer.active === false) {
    return fail('customer_not_found', 404)
  }

  // Resolve referential targets before reporting a structural legacy-row error.
  // This keeps a planted/corrupt draft's first actionable blocker deterministic.
  for (const ln of existing.lines ?? []) {
    const product = findById(masterData.finishedProducts, ln.finishedProductId)
    if (!product || product.archived === true || product.active === false) {
      return fail('product_not_found', 404)
    }
  }
  if (
    !SALES_ORDER_NUMBER_RE.test(str(existing.orderNumber)) ||
    !validIsoDate(existing.orderDate) ||
    normalizeSalesPriority(existing.priority, undefined) == null ||
    !hasUniqueNonEmptyIds(existing.lines ?? [], (line) => line?.lineId)
  ) {
    return fail('sales_order_schema_mismatch', 409)
  }
  if (
    (sales.orders ?? []).some(
      (candidate) =>
        candidate.id !== id && str(candidate.orderNumber) === str(existing.orderNumber),
    )
  ) {
    return fail('duplicate_order_number', 409)
  }

  const lines = []
  let nextPlanning = planning
  for (const ln of existing.lines ?? []) {
    const product = findById(masterData.finishedProducts, ln.finishedProductId)
    if (!product || product.archived === true || product.active === false) {
      return fail('product_not_found', 404)
    }
    const qty = roundQty(num(ln.quantity))
    const canonicalUnit = str(product.baseUnit) || 'm2'
    if (
      !finitePositive(qty) ||
      str(ln.unit) !== canonicalUnit ||
      (ln.requestedShipDate != null && !validIsoDate(ln.requestedShipDate))
    ) {
      return fail('sales_order_schema_mismatch', 409)
    }
    const linked = validateSalesProductionLinks(ln.linkedProductionOrderIds, production, {
      finishedProductId: ln.finishedProductId,
      salesOrderId: id,
      salesLineId: ln.lineId,
    })
    if (!linked.ok) return fail(linked.error, linked.status ?? 409)
    const line = {
      ...ln,
      productCodeSnapshot: product.code,
      productNameSnapshot: product.name,
      unit: canonicalUnit,
      linkedProductionOrderIds: linked.ids,
      producedQty: 0,
      releasedQty: 0,
      shippedQty: 0,
      remainingQty: qty,
    }
    lines.push(line)
    const availableReleasedFg = 0
    const plannedOrProducedQty = line.producedQty
    const remainingDemand = roundQty(Math.max(0, qty - plannedOrProducedQty))
    const bom = selectApprovedPackagingBom(masterData, product, str(line.requestedShipDate || now).slice(0, 10))
    const bomRef = bom ? trustedBomRefFromBom(bom, product.id) : null
    const packagingRequirements = bom
      ? computePackagingRequirements(
          { ...bom, components: bomComponentList(bom) },
          remainingDemand > EPS ? remainingDemand : qty,
        )
      : []
    nextPlanning = upsertRecommendation(nextPlanning, {
      id: `pr-${crypto.randomUUID()}`,
      finishedProductId: line.finishedProductId,
      requiredQty: qty,
      dueDate: line.requestedShipDate,
      priority: line.priority ?? existing.priority,
      salesOrderId: id,
      salesLineId: line.lineId,
      availableReleasedFg,
      plannedOrProducedQty,
      remainingDemand,
      packagingBomId: bomRef?.packagingBomId,
      packagingBomVersion: bomRef?.packagingBomVersion,
      packagingBomContentHash: bomRef?.packagingBomContentHash,
      packagingRequirements,
      status: 'open',
      updatedAt: now,
    })
  }

  const order = {
    ...existing,
    status: 'confirmed',
    customerCodeSnapshot: customer.code,
    customerNameSnapshot: customer.name,
    lines,
    confirmedAt: now,
    confirmedBy: actor.uid,
    revision: (existing.revision ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextSales = { ...sales, orders: upsertById(sales.orders, order) }
  nextSales = appendAudit(nextSales, auditEntry('sales_order_confirm', actor, now, id))
  nextPlanning = appendAudit(nextPlanning, auditEntry('sales_confirm_recommendations', actor, now, id))
  return ok({
    sales: nextSales,
    planning: nextPlanning,
    replayDependencies: salesProductionReplayDependencies(order.lines, id),
    result: {
      id,
      orderNumber: order.orderNumber,
      status: 'confirmed',
      revision: order.revision,
      order,
    },
  })
}

function applySalesChange(sales, masterData, planning, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(sales.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'draft' || existing.status === 'cancelled' || existing.status === 'fulfilled') {
    return fail('invalid_status', 409)
  }
  const linesIn = Array.isArray(command.lines) ? command.lines : null
  if (!linesIn) return fail('invalid_input', 400)

  const byId = new Map((existing.lines ?? []).map((l) => [l.lineId, l]))
  const lines = []
  let nextPlanning = planning
  for (const ln of linesIn) {
    const lineId = str(ln.lineId)
    const prev = byId.get(lineId)
    if (!prev) return fail('line_not_found', 404)
    const quantity = ln.quantity != null ? roundQty(num(ln.quantity)) : prev.quantity
    if (!Number.isFinite(quantity) || quantity <= 0) return fail('invalid_quantity', 400)
    if (quantity + EPS < (prev.shippedQty || 0)) return fail('qty_below_shipped', 409)
    const product = findById(masterData.finishedProducts, prev.finishedProductId)
    if (!product) return fail('product_not_found', 404)
    const requestedShipDate =
      ln.requestedShipDate != null ? str(ln.requestedShipDate) : str(prev.requestedShipDate)
    if (requestedShipDate && !validIsoDate(requestedShipDate)) {
      return fail('invalid_date', 400)
    }
    const linePriority = normalizeSalesPriority(ln.priority, prev.priority ?? existing.priority)
    if (linePriority == null) return fail('invalid_priority', 400)
    const line = {
      ...prev,
      quantity,
      requestedShipDate: requestedShipDate || undefined,
      priority: linePriority,
      remainingQty: roundQty(Math.max(0, quantity - (prev.shippedQty || 0))),
    }
    lines.push(line)
    const remainingDemand = roundQty(Math.max(0, quantity - (line.producedQty || 0)))
    nextPlanning = upsertRecommendation(nextPlanning, {
      id: `pr-${crypto.randomUUID()}`,
      finishedProductId: line.finishedProductId,
      requiredQty: quantity,
      dueDate: line.requestedShipDate,
      priority: line.priority ?? existing.priority,
      salesOrderId: id,
      salesLineId: line.lineId,
      availableReleasedFg: 0,
      plannedOrProducedQty: line.producedQty || 0,
      remainingDemand,
      status: 'open',
      updatedAt: now,
    })
  }

  const priority = normalizeSalesPriority(command.priority, existing.priority)
  if (priority == null) return fail('invalid_priority', 400)
  const order = {
    ...existing,
    lines,
    priority,
    revision: (existing.revision ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextSales = { ...sales, orders: upsertById(sales.orders, order) }
  nextSales = appendAudit(nextSales, auditEntry('sales_order_change', actor, now, id))
  return ok({
    sales: nextSales,
    planning: nextPlanning,
    result: { id, revision: order.revision },
  })
}

function applySalesCancel(sales, planning, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(sales.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'cancelled') {
    return ok({ sales, planning, result: { id, status: 'cancelled', idempotent: true } })
  }
  if (existing.status === 'fulfilled') return fail('already_fulfilled', 409)
  const order = {
    ...existing,
    status: 'cancelled',
    cancelledAt: now,
    cancelledBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextSales = { ...sales, orders: upsertById(sales.orders, order) }
  nextSales = appendAudit(nextSales, auditEntry('sales_order_cancel', actor, now, id))
  const nextPlanning = appendAudit(
    supersedeOpenRecommendations(planning, id, now),
    auditEntry('sales_cancel_supersede_recs', actor, now, id),
  )
  return ok({ sales: nextSales, planning: nextPlanning, result: { id, status: 'cancelled' } })
}

function applySalesPriority(sales, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(sales.orders, id)
  if (!existing) return fail('not_found', 404)
  const priority = normalizeSalesPriority(command.priority, undefined)
  if (priority == null) return fail('invalid_priority', 400)
  const order = { ...existing, priority, updatedAt: now, updatedBy: actor.uid }
  let next = { ...sales, orders: upsertById(sales.orders, order) }
  next = appendAudit(next, auditEntry('sales_order_priority', actor, now, id, { priority }))
  return ok({ sales: next, result: { id, priority } })
}

function applyFulfillmentSync(sales, warehouse, command, actor, now) {
  const orderId = str(command.salesOrderId ?? command.id)
  if (!orderId) return fail('invalid_input', 400)
  const existing = findById(sales.orders, orderId)
  if (!existing) return fail('not_found', 404)
  if (existing.status === 'draft' || existing.status === 'cancelled') {
    return fail('invalid_status', 409)
  }

  const shipments = (warehouse.loadingShipments ?? []).filter(
    (s) =>
      str(s.salesOrderId) === orderId &&
      (s.status === 'posted' || s.status === 'confirmed') &&
      !s.cancelled,
  )
  const shippedByProduct = new Map()
  for (const s of shipments) {
    const fp = str(s.finishedProductId)
    if (!fp) continue
    shippedByProduct.set(fp, roundQty((shippedByProduct.get(fp) || 0) + (num(s.quantity) || 0)))
  }

  const lines = (existing.lines ?? []).map((ln) => {
    const shippedQty = roundQty(shippedByProduct.get(ln.finishedProductId) || 0)
    return {
      ...ln,
      shippedQty,
      remainingQty: roundQty(Math.max(0, (ln.quantity || 0) - shippedQty)),
    }
  })

  const allShipped = lines.every((l) => (l.shippedQty || 0) + EPS >= (l.quantity || 0))
  const anyShipped = lines.some((l) => (l.shippedQty || 0) > EPS)
  let status = existing.status
  if (allShipped) status = 'fulfilled'
  else if (anyShipped) status = 'partially_shipped'

  const order = {
    ...existing,
    lines,
    status,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...sales, orders: upsertById(sales.orders, order) }
  next = appendAudit(next, auditEntry('sales_fulfillment_sync', actor, now, orderId, { status }))
  return ok({ sales: next, result: { id: orderId, status, lines } })
}

// ---------------------------------------------------------------------------
// Planning / MRP
// ---------------------------------------------------------------------------

function materialNeedFromRecipeSnapshot(snapshot, totalQty) {
  const qty = Number(totalQty) || 0
  const comps = snapshot?.components ?? []
  return comps.map((c) => {
    let need = 0
    if (snapshot.normBase === 'per_m2') need = (Number(c.normQty) || 0) * qty
    else if (snapshot.normBase === 'per_batch') {
      const batch = Number(snapshot.batchSize) || 1
      need = (Number(c.normQty) || 0) * (qty / batch)
    } else need = (Number(c.normQty) || 0) * qty
    return {
      itemId: str(c.warehouseItemId ?? c.itemId),
      needQty: roundQty(need),
      unit: c.unitSnapshot,
    }
  })
}

/** Production-line warehouse ids — stock here is issued-to-line, not free supply. */
function collectLineWarehouseIds(warehouse, production) {
  const ids = new Set()
  const absorb = (list) => {
    for (const b of list ?? []) {
      const id = str(b.warehouseId || b.lineWarehouseId)
      if (id) ids.add(id)
    }
  }
  absorb(warehouse?.productionLineBindings)
  absorb(production?.lineBindings)
  return ids
}

/**
 * Free (non-line) on-hand / reserved / available by item.
 * Line warehouses are excluded so issued-to-line is not double-counted as free supply.
 */
function freeStockByItem(warehouse, lineWarehouseIds) {
  const map = new Map()
  const whIds = new Set()
  for (const m of warehouse.movements ?? []) {
    if (m.cancelled) continue
    if (m.warehouseId) whIds.add(m.warehouseId)
  }
  for (const d of warehouse.documents ?? []) {
    if (d.warehouseId) whIds.add(d.warehouseId)
  }
  for (const loc of warehouse.locations ?? []) {
    const id = str(loc.warehouseId || loc.id)
    if (id) whIds.add(id)
  }
  const itemIds = new Set()
  for (const m of warehouse.movements ?? []) {
    if (m.itemId) itemIds.add(m.itemId)
  }
  for (const whId of whIds) {
    if (lineWarehouseIds.has(whId)) continue
    for (const itemId of itemIds) {
      const bal = computeServerBalance(warehouse.movements, whId, itemId)
      const reserved = computeServerReserved(warehouse.movements, whId, itemId)
      const avail = computeServerAvailable(warehouse.movements, whId, itemId)
      const prev = map.get(itemId) || { onHand: 0, reserved: 0, available: 0 }
      map.set(itemId, {
        onHand: roundQty(prev.onHand + bal),
        reserved: roundQty(prev.reserved + reserved),
        available: roundQty(prev.available + avail),
      })
    }
  }
  return map
}

/**
 * Net qty already issued onto production-line warehouses per productionOrderId::itemId.
 * receipt/in +, issue/out −. Not free supply.
 */
function issuedToLineByOrderItem(warehouse, lineWarehouseIds) {
  const map = new Map()
  for (const m of warehouse.movements ?? []) {
    if (m.cancelled) continue
    const whId = str(m.warehouseId)
    const poId = str(m.productionOrderId)
    const itemId = str(m.itemId)
    if (!whId || !poId || !itemId || !lineWarehouseIds.has(whId)) continue
    const t = str(m.type).toLowerCase()
    let signed = 0
    if (t === 'receipt' || t === 'in') signed = num(m.quantity) || 0
    else if (t === 'issue' || t === 'out') signed = -(num(m.quantity) || 0)
    else continue
    const key = `${poId}::${itemId}`
    map.set(key, roundQty((map.get(key) || 0) + signed))
  }
  return map
}

function openProcurementInbound(procurement) {
  const map = new Map()
  for (const po of procurement.orders ?? []) {
    if (!INBOUND_PO_STATUSES.has(po.status)) continue
    for (const ln of po.lines ?? []) {
      const open = roundQty(Math.max(0, (num(ln.requestedQty) || 0) - (num(ln.receivedQty) || 0)))
      if (open <= EPS) continue
      const itemId = str(ln.itemId)
      map.set(itemId, roundQty((map.get(itemId) || 0) + open))
    }
  }
  return map
}

function productionQtyLeft(po) {
  return roundQty(
    Math.max(0, (num(po.totalQtyMp) || 0) - (num(po.producedQtyMp) || num(po.quantityProduced) || 0)),
  )
}

function isOpenProductionOrder(po) {
  if (!po || po.status === 'cancelled' || po.status === 'draft' || po.status === 'closed') {
    return false
  }
  if (OPEN_PROD.has(po.status)) return true
  // Treat unknown non-terminal statuses as open (legacy rows).
  return po.status !== 'fulfilled' && po.status !== 'cancelled'
}

function linkedProductionRemaining(production, linkedIds) {
  let sum = 0
  const ids = Array.isArray(linkedIds) ? linkedIds : []
  for (const id of ids) {
    const po = findById(production.orders, str(id))
    if (!po || !isOpenProductionOrder(po)) continue
    sum = roundQty(sum + productionQtyLeft(po))
  }
  return sum
}

function monthKey(dateStr) {
  const d = str(dateStr).slice(0, 7)
  return DATE_RE.test(str(dateStr).slice(0, 10)) ? d : null
}

function weekKey(dateStr) {
  const raw = str(dateStr).slice(0, 10)
  if (!DATE_RE.test(raw)) return null
  const d = new Date(`${raw}T00:00:00.000Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Horizon summary: months 0–2 detailed (daily/weekly), months 3–11 monthly aggregates.
 * Capacity is out of scope (G6).
 */
function buildMaterialDateBuckets(demandEvents, nowIso) {
  const anchor = str(nowIso).slice(0, 10)
  const base = DATE_RE.test(anchor) ? new Date(`${anchor}T00:00:00.000Z`) : new Date()
  const monthStarts = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1))
    monthStarts.push(d.toISOString().slice(0, 7))
  }
  const detailedSet = new Set(monthStarts.slice(0, 3))
  const aggregateSet = new Set(monthStarts.slice(3, 12))

  const detailedMonths = monthStarts.slice(0, 3).map((mk) => ({
    month: mk,
    daily: {},
    weekly: {},
    totalQty: 0,
  }))
  const aggregateMonths = monthStarts.slice(3, 12).map((mk) => ({
    month: mk,
    totalQty: 0,
  }))
  const detailedByMonth = new Map(detailedMonths.map((m) => [m.month, m]))
  const aggregateByMonth = new Map(aggregateMonths.map((m) => [m.month, m]))

  for (const ev of demandEvents ?? []) {
    const qty = roundQty(num(ev.qty) || 0)
    if (qty <= EPS) continue
    const due = ev.dueDate ? str(ev.dueDate).slice(0, 10) : null
    const mk = due ? monthKey(due) : monthStarts[0]
    if (!mk) continue
    if (detailedSet.has(mk)) {
      const row = detailedByMonth.get(mk)
      if (!row) continue
      row.totalQty = roundQty(row.totalQty + qty)
      if (due) {
        row.daily[due] = roundQty((row.daily[due] || 0) + qty)
        const wk = weekKey(due)
        if (wk) row.weekly[wk] = roundQty((row.weekly[wk] || 0) + qty)
      }
    } else if (aggregateSet.has(mk)) {
      const row = aggregateByMonth.get(mk)
      if (!row) continue
      row.totalQty = roundQty(row.totalQty + qty)
    }
  }

  return {
    detailedMonths,
    aggregateMonths,
    capacityNotCalculated: true,
  }
}

function applyMrpRun(domains, actor, now, criticalRevision, command = {}) {
  const { masterData, sales, planning, procurement, warehouse, production } = domains
  const errors = []
  const demandEvents = []
  const supplyEvents = []
  const shortageAgg = new Map() // itemId -> agg
  const packagingBomRefs = []
  const packagingBomRefKeys = new Set()
  const asOfDate = str(command.asOfDate || now).slice(0, 10)

  const lineWhIds = collectLineWarehouseIds(warehouse, production)
  const stock = freeStockByItem(warehouse, lineWhIds)
  const issuedMap = issuedToLineByOrderItem(warehouse, lineWhIds)
  const inbound = openProcurementInbound(procurement)

  for (const [itemId, s] of stock) {
    if (s.available > EPS || s.onHand > EPS) {
      supplyEvents.push({
        kind: 'warehouse_on_hand',
        itemId,
        qty: s.available,
        onHand: s.onHand,
        reserved: s.reserved,
      })
    }
  }
  for (const [itemId, qty] of inbound) {
    supplyEvents.push({ kind: 'procurement_inbound', itemId, qty })
  }
  for (const [key, issuedQty] of issuedMap) {
    if (Math.abs(issuedQty) <= EPS) continue
    const [productionOrderId, itemId] = key.split('::')
    supplyEvents.push({
      kind: 'issued_to_line',
      itemId,
      productionOrderId,
      qty: issuedQty,
    })
  }

  // Sales FG remaining — track full ship demand; explode packaging BOM only for uncovered FG
  for (const order of sales.orders ?? []) {
    if (!OPEN_SALES.has(order.status) && order.status !== 'confirmed') continue
    for (const ln of order.lines ?? []) {
      const remain = roundQty(
        num(ln.remainingQty) ?? Math.max(0, (ln.quantity || 0) - (ln.shippedQty || 0)),
      )
      if (remain <= EPS) continue
      const linkedProdRemaining = linkedProductionRemaining(production, ln.linkedProductionOrderIds)
      const fgDemand = roundQty(Math.max(0, remain - linkedProdRemaining))

      demandEvents.push({
        kind: 'sales_fg',
        salesOrderId: order.id,
        salesLineId: ln.lineId,
        finishedProductId: ln.finishedProductId,
        qty: remain,
        fgDemand,
        linkedProductionRemaining: linkedProdRemaining,
        dueDate: ln.requestedShipDate,
        priority: ln.priority ?? order.priority ?? 0,
        confirmedAt: order.confirmedAt,
      })

      if (fgDemand <= EPS) continue

      const product = findById(masterData.finishedProducts, ln.finishedProductId)
      if (!product) {
        errors.push({
          id: `mde-${crypto.randomUUID()}`,
          kind: 'missing_product',
          message: 'finished product missing for sales demand',
          entityId: ln.finishedProductId,
          at: now,
        })
        continue
      }
      // G5.3: only approved+effective BOM; drafts ignored. Incomplete product → errors, no packaging shortages.
      const bom = selectApprovedPackagingBom(masterData, product, asOfDate)
      if (!bom) {
        errors.push({
          id: `mde-${crypto.randomUUID()}`,
          kind: 'missing_bom',
          message: 'approved packaging BOM missing for asOfDate',
          entityId: product.id,
          at: now,
        })
        continue
      }

      const components = bomComponentList(bom)
      const baseOutputQty = Math.max(EPS, num(bom.baseOutputQty) || 1)
      const scale = fgDemand / baseOutputQty
      let bomIncomplete = false
      const pendingNeeds = []

      for (const bl of components) {
        const itemId = str(bl.warehouseItemId || bl.itemId)
        const unit = str(bl.unit)
        const qty = num(bl.quantity ?? bl.qty)
        if (!itemId || !unit || !Number.isFinite(qty) || qty <= 0) {
          errors.push({
            id: `mde-${crypto.randomUUID()}`,
            kind: 'invalid_bom_component',
            message: 'BOM component missing item/unit/quantity',
            entityId: itemId || bom.id,
            finishedProductId: product.id,
            at: now,
          })
          bomIncomplete = true
          break
        }
        const item = findById(masterData.items, itemId)
        if (!item || item.archived === true) {
          errors.push({
            id: `mde-${crypto.randomUUID()}`,
            kind: 'missing_item',
            message: 'BOM item missing',
            entityId: itemId,
            finishedProductId: product.id,
            at: now,
          })
          bomIncomplete = true
          break
        }
        const conversion =
          bl.conversionFactor != null && Number.isFinite(num(bl.conversionFactor))
            ? num(bl.conversionFactor)
            : 1
        const waste =
          bl.wasteFactor != null && Number.isFinite(num(bl.wasteFactor)) ? num(bl.wasteFactor) : 0
        // need = qty * (fgDemand/baseOutputQty) * conversion * (1+waste)
        const need = roundQty(qty * scale * conversion * (1 + waste))
        if (need <= EPS) continue
        pendingNeeds.push({
          itemId,
          need,
          leadTimeDays: item.leadTimeDays,
          supplierId: item.defaultSupplierId,
        })
      }

      if (bomIncomplete) {
        // Fail closed for this product demand: no packaging shortages / PO path.
        continue
      }

      const refKey = `${product.id}::${bom.id}::${bom.version}::${bom.contentHash || ''}`
      if (!packagingBomRefKeys.has(refKey)) {
        packagingBomRefKeys.add(refKey)
        packagingBomRefs.push({
          finishedProductId: product.id,
          packagingBomId: bom.id,
          version: bom.version,
          contentHash: bom.contentHash,
        })
      }

      for (const pn of pendingNeeds) {
        demandEvents.push({
          kind: 'packaging_bom',
          itemId: pn.itemId,
          qty: pn.need,
          salesOrderId: order.id,
          salesLineId: ln.lineId,
          finishedProductId: product.id,
          packagingBomId: bom.id,
          packagingBomVersion: bom.version,
          dueDate: ln.requestedShipDate,
          priority: ln.priority ?? order.priority ?? 0,
          confirmedAt: order.confirmedAt,
          leadTimeDays: pn.leadTimeDays,
          supplierId: pn.supplierId,
        })
        addShortageDemand(shortageAgg, pn.itemId, pn.need, {
          dueDate: ln.requestedShipDate,
          priority: ln.priority ?? order.priority ?? 0,
          orderId: order.id,
          leadTimeDays: pn.leadTimeDays,
          supplierId: pn.supplierId,
          confirmedAt: order.confirmedAt,
        })
      }
    }
  }

  // Production material: netNeed = max(0, recipeNeed - issuedToLine for that order/item)
  for (const po of production.orders ?? []) {
    if (!isOpenProductionOrder(po)) continue
    const snapshot = po.recipeSnapshot ?? po.approvedRecipeSnapshot
    const qtyLeft = productionQtyLeft(po)
    if (!snapshot || qtyLeft <= EPS) continue
    for (const need of materialNeedFromRecipeSnapshot(snapshot, qtyLeft)) {
      if (!need.itemId || need.needQty <= EPS) continue
      const item = findById(masterData.items, need.itemId)
      if (!item) {
        errors.push({
          id: `mde-${crypto.randomUUID()}`,
          kind: 'missing_item',
          message: 'production recipe item missing',
          entityId: need.itemId,
          at: now,
        })
        continue
      }
      const issuedFor = Math.max(0, issuedMap.get(`${po.id}::${need.itemId}`) || 0)
      const netNeed = roundQty(Math.max(0, need.needQty - issuedFor))
      demandEvents.push({
        kind: 'production_material',
        itemId: need.itemId,
        qty: netNeed,
        grossNeedQty: need.needQty,
        issuedToLineQty: issuedFor,
        productionOrderId: po.id,
        dueDate: po.dueDate,
        priority: po.priority ?? 0,
        leadTimeDays: item.leadTimeDays,
        supplierId: item.defaultSupplierId,
      })
      if (netNeed <= EPS) continue
      addShortageDemand(shortageAgg, need.itemId, netNeed, {
        dueDate: po.dueDate,
        priority: po.priority ?? 0,
        orderId: po.id,
        leadTimeDays: item.leadTimeDays,
        supplierId: item.defaultSupplierId,
        confirmedAt: po.confirmedAt,
      })
    }
  }

  const runId = `mrp-${crypto.randomUUID()}`
  const shortages = []
  const allItemIds = new Set([
    ...shortageAgg.keys(),
    ...stock.keys(),
    ...inbound.keys(),
  ])
  for (const itemId of allItemIds) {
    const agg = shortageAgg.get(itemId) || {
      demandQty: 0,
      priority: 0,
      orderIds: new Set(),
      firstShortageDate: null,
      leadTimeDays: undefined,
      supplierId: undefined,
      confirmedAt: undefined,
    }
    const item = findById(masterData.items, itemId)
    const stockRow = stock.get(itemId) || { onHand: 0, reserved: 0, available: 0 }
    const inb = inbound.get(itemId) || 0
    const safetyStock = Math.max(0, num(item?.safetyStock) || 0)
    const grossRequirement = roundQty(agg.demandQty || 0)
    const onHand = roundQty(stockRow.onHand || 0)
    const reserved = roundQty(stockRow.reserved || 0)
    const available = roundQty(stockRow.available || 0)
    const inboundByEta = roundQty(inb)
    // Free available already excludes reserved; do not subtract reserve again.
    const projectedAvailable = roundQty(available + inboundByEta - grossRequirement)
    // Safety stock is an extra demand floor: shortage when projected < safetyStock.
    const shortageQty = roundQty(Math.max(0, safetyStock - projectedAvailable))
    if (shortageQty <= EPS && grossRequirement <= EPS) continue
    if (shortageQty <= EPS) continue

    const supplierId = agg.supplierId || item?.defaultSupplierId
    if (supplierId && !findById(masterData.suppliers, supplierId)) {
      errors.push({
        id: `mde-${crypto.randomUUID()}`,
        kind: 'missing_supplier',
        message: 'default supplier missing',
        entityId: supplierId,
        at: now,
      })
    }
    const leadTimeDays = num(agg.leadTimeDays ?? item?.leadTimeDays) || 0
    const firstShortageDate = agg.firstShortageDate || now.slice(0, 10)
    let latestSafeOrderDate
    if (firstShortageDate && leadTimeDays > 0) {
      const d = new Date(`${firstShortageDate}T00:00:00.000Z`)
      d.setUTCDate(d.getUTCDate() - leadTimeDays)
      latestSafeOrderDate = d.toISOString().slice(0, 10)
    }
    shortages.push({
      id: `sh-${crypto.randomUUID()}`,
      planningRunId: runId,
      itemId,
      grossRequirement,
      onHand,
      reserved,
      available,
      inboundByEta,
      projectedAvailable,
      shortageQty,
      firstShortageDate,
      affectedOrderIds: [...(agg.orderIds ?? [])],
      priority: agg.priority ?? 0,
      supplierId: supplierId || undefined,
      leadTimeDays: leadTimeDays || undefined,
      latestSafeOrderDate,
      safetyStock: safetyStock || undefined,
      status: 'open',
      confirmedAt: agg.confirmedAt,
    })
  }

  shortages.sort((a, b) => {
    const d = str(a.firstShortageDate).localeCompare(str(b.firstShortageDate))
    if (d) return d
    const p = (b.priority || 0) - (a.priority || 0)
    if (p) return p
    const lt = (a.leadTimeDays || 0) - (b.leadTimeDays || 0)
    if (lt) return lt
    return str(a.confirmedAt).localeCompare(str(b.confirmedAt))
  })

  const horizon = buildMaterialDateBuckets(demandEvents, now)
  const runBody = {
    inputCriticalRevision: criticalRevision,
    demandEvents,
    supplyEvents,
    shortages,
    horizon,
    packagingBomRefs,
    warnings: [],
    errors,
  }
  const hash = contentHash(runBody)
  const run = {
    id: runId,
    inputCriticalRevision: criticalRevision,
    calculatedAt: now,
    asOfDate,
    contentHash: hash,
    demandEvents,
    supplyEvents,
    shortages,
    horizon,
    materialDateBuckets: horizon,
    packagingBomRefs,
    warnings: [],
    errors,
    stale: false,
  }

  const priorRuns = (planning.planningRuns ?? []).map((r) => ({ ...r, stale: true }))
  let nextPlanning = {
    ...planning,
    planningRuns: [...priorRuns, run],
    shortages: [
      ...(planning.shortages ?? []).map((s) =>
        s.status === 'open' ? { ...s, status: 'superseded' } : s,
      ),
      ...shortages,
    ],
    masterDataErrors: [...(planning.masterDataErrors ?? []), ...errors],
  }
  nextPlanning = appendAudit(nextPlanning, auditEntry('planning_mrp_run', actor, now, runId, { hash }))

  if (errors.length > 0) {
    return ok({
      planning: nextPlanning,
      result: {
        planningRunId: runId,
        contentHash: hash,
        shortageCount: shortages.length,
        masterDataErrorCount: errors.length,
        failClosed: true,
      },
    })
  }
  return ok({
    planning: nextPlanning,
    result: {
      planningRunId: runId,
      contentHash: hash,
      shortageCount: shortages.length,
      masterDataErrorCount: 0,
    },
  })
}

function addShortageDemand(map, itemId, qty, meta) {
  const prev = map.get(itemId) || {
    demandQty: 0,
    priority: 0,
    orderIds: new Set(),
    firstShortageDate: null,
    leadTimeDays: meta.leadTimeDays,
    supplierId: meta.supplierId,
    confirmedAt: meta.confirmedAt,
  }
  prev.demandQty = roundQty(prev.demandQty + qty)
  prev.priority = Math.max(prev.priority || 0, meta.priority || 0)
  if (meta.orderId) prev.orderIds.add(meta.orderId)
  const due = meta.dueDate ? str(meta.dueDate).slice(0, 10) : null
  if (due && (!prev.firstShortageDate || due < prev.firstShortageDate)) {
    prev.firstShortageDate = due
  }
  if (meta.leadTimeDays != null) prev.leadTimeDays = meta.leadTimeDays
  if (meta.supplierId) prev.supplierId = meta.supplierId
  if (meta.confirmedAt && (!prev.confirmedAt || meta.confirmedAt < prev.confirmedAt)) {
    prev.confirmedAt = meta.confirmedAt
  }
  map.set(itemId, prev)
}

function applyAcceptProductionDrafts(planning, masterData, command, actor, now) {
  // Never trust client-supplied BOM objects.
  if (command.packagingBom || command.packagingBomSnapshot || command.bom) {
    return fail('client_bom_forbidden', 400)
  }

  const asOfDate = str(command.asOfDate || now).slice(0, 10)
  let nextPlanning = refreshPlanningRunBomStale(planning, masterData, asOfDate)

  const runId = str(command.planningRunId)
  const runs = nextPlanning.planningRuns ?? []
  const run = runId ? findById(runs, runId) : runs.length ? runs[runs.length - 1] : null
  if (!run) return fail('planning_run_not_found', 404)
  if (run.stale === true) {
    return fail('planning_run_stale', 409, { planning: nextPlanning })
  }

  const ids = Array.isArray(command.recommendationIds)
    ? command.recommendationIds.map(str).filter(Boolean)
    : null
  const list = nextPlanning.productionRecommendations ?? []
  const targets = ids
    ? list.filter((r) => ids.includes(r.id) && r.status === 'open')
    : list.filter((r) => r.status === 'open')
  if (targets.length === 0) return fail('no_open_recommendations', 404)

  // Duplicate guard: already-accepted recommendations with a linked production draft id.
  for (const r of targets) {
    if (r.productionDraftCreated === true || r.g3DraftKey) {
      return fail('duplicate_production_draft', 409, { recommendationId: r.id })
    }
  }

  const drafts = []
  const acceptedIds = new Set()
  const enriched = list.map((r) => {
    if (!targets.some((t) => t.id === r.id)) return r

    const product = findById(masterData.finishedProducts, r.finishedProductId)
    if (!product || product.archived === true) {
      return { ...r, _acceptError: 'product_not_found' }
    }

    const bom = selectApprovedPackagingBom(masterData, product, asOfDate)
    const required = productRequiresPackagingBom(product)
    if (!bom && required) {
      return { ...r, _acceptError: 'packaging_bom_required' }
    }

    let trustedRef = null
    let packagingRequirements = []
    if (bom) {
      // Must match planning run packagingBomRefs when present for this product.
      const runRef = (run.packagingBomRefs ?? []).find(
        (x) => str(x.finishedProductId) === str(product.id),
      )
      if (
        runRef &&
        (str(runRef.packagingBomId) !== str(bom.id) ||
          num(runRef.version) !== num(bom.version) ||
          str(runRef.contentHash) !== str(bom.contentHash))
      ) {
        return { ...r, _acceptError: 'packaging_bom_stale' }
      }
      // Recommendation may already carry a trusted ref — re-verify.
      if (r.packagingBomId || r.packagingBomContentHash) {
        if (
          str(r.packagingBomId) !== str(bom.id) ||
          (r.packagingBomVersion != null && num(r.packagingBomVersion) !== num(bom.version)) ||
          (r.packagingBomContentHash && str(r.packagingBomContentHash) !== str(bom.contentHash))
        ) {
          return { ...r, _acceptError: 'packaging_bom_stale' }
        }
      }
      trustedRef = trustedBomRefFromBom(bom, product.id)
      const qty = r.remainingDemand > EPS ? r.remainingDemand : r.requiredQty
      packagingRequirements = computePackagingRequirements(
        {
          ...bom,
          baseOutputQty: bom.baseOutputQty,
          components: bomComponentList(bom),
        },
        qty,
      )
    }

    acceptedIds.add(r.id)
    const qty = r.remainingDemand > EPS ? r.remainingDemand : r.requiredQty
    drafts.push({
      finishedProductId: r.finishedProductId,
      totalQtyMp: qty,
      dueDate: r.dueDate,
      priority: r.priority,
      salesOrderId: r.salesOrderId,
      salesLineId: r.salesLineId,
      recommendationId: r.id,
      planningRunId: run.id,
      planningRunSourceRevision: run.inputCriticalRevision,
      packagingBomId: trustedRef?.packagingBomId,
      packagingBomVersion: trustedRef?.packagingBomVersion,
      packagingBomContentHash: trustedRef?.packagingBomContentHash,
      packagingRequirements,
      salesDemandLinks: [
        {
          salesOrderId: r.salesOrderId,
          salesLineId: r.salesLineId,
        },
      ].filter((l) => l.salesOrderId),
      // Client / G3 must create the real production.order.draft — G5 does not.
    })

    return {
      ...r,
      status: 'accepted',
      acceptedAt: now,
      acceptedBy: actor.uid,
      planningRunId: run.id,
      planningRunSourceRevision: run.inputCriticalRevision,
      packagingBomId: trustedRef?.packagingBomId,
      packagingBomVersion: trustedRef?.packagingBomVersion,
      packagingBomContentHash: trustedRef?.packagingBomContentHash,
      packagingRequirements,
      productionDraftCreated: true,
    }
  })

  const failed = enriched.find((r) => r._acceptError)
  if (failed) {
    return fail(failed._acceptError, failed._acceptError === 'product_not_found' ? 404 : 409, {
      planning: nextPlanning,
      recommendationId: failed.id,
    })
  }

  nextPlanning = {
    ...nextPlanning,
    productionRecommendations: enriched.map(({ _acceptError, ...rest }) => rest),
  }
  nextPlanning = appendAudit(
    nextPlanning,
    auditEntry('planning_accept_production_drafts', actor, now, String(acceptedIds.size), {
      planningRunId: run.id,
    }),
  )
  return ok({
    planning: nextPlanning,
    result: {
      acceptedCount: acceptedIds.size,
      planningRunId: run.id,
      productionOrderDrafts: drafts,
    },
  })
}

function applyShortageStatus(planning, command, actor, now, status) {
  const id = str(command.shortageId ?? command.id)
  if (!id) return fail('invalid_input', 400)
  const row = findById(planning.shortages, id)
  if (!row) return fail('not_found', 404)
  const nextRow = {
    ...row,
    status,
    updatedAt: now,
    updatedBy: actor.uid,
    note: command.note != null ? str(command.note) : row.note,
  }
  let next = {
    ...planning,
    shortages: upsertById(planning.shortages, nextRow),
  }
  next = appendAudit(next, auditEntry(`planning_shortage_${status}`, actor, now, id))
  return ok({ planning: next, result: { id, status } })
}

function applyManualRecommendation(planning, masterData, command, actor, now) {
  const reason = str(command.reason)
  if (!reason) return fail('reason_required', 400)
  const finishedProductId = str(command.finishedProductId)
  const requiredQty = roundQty(num(command.requiredQty))
  if (!finishedProductId || !Number.isFinite(requiredQty) || requiredQty <= 0) {
    return fail('invalid_input', 400)
  }
  if (!findById(masterData.finishedProducts, finishedProductId)) {
    return fail('product_not_found', 404)
  }
  const product = findById(masterData.finishedProducts, finishedProductId)
  const asOf = command.dueDate != null ? str(command.dueDate).slice(0, 10) : now.slice(0, 10)
  const bom = selectApprovedPackagingBom(masterData, product, asOf)
  if (!bom && productRequiresPackagingBom(product)) {
    return fail('packaging_bom_required', 409)
  }
  const bomRef = bom ? trustedBomRefFromBom(bom, finishedProductId) : null
  const packagingRequirements = bom
    ? computePackagingRequirements({ ...bom, components: bomComponentList(bom) }, requiredQty)
    : []
  const rec = {
    id: str(command.id) || `pr-${crypto.randomUUID()}`,
    finishedProductId,
    requiredQty,
    dueDate: command.dueDate != null ? str(command.dueDate).slice(0, 10) : undefined,
    priority: command.priority != null ? num(command.priority) : undefined,
    salesOrderId: command.salesOrderId != null ? str(command.salesOrderId) : undefined,
    salesLineId: command.salesLineId != null ? str(command.salesLineId) : undefined,
    availableReleasedFg: 0,
    plannedOrProducedQty: 0,
    remainingDemand: requiredQty,
    packagingBomId: bomRef?.packagingBomId,
    packagingBomVersion: bomRef?.packagingBomVersion,
    packagingBomContentHash: bomRef?.packagingBomContentHash,
    packagingRequirements,
    status: 'open',
    manual: true,
    reason,
    createdAt: now,
    createdBy: actor.uid,
  }
  let next = {
    ...planning,
    productionRecommendations: [...(planning.productionRecommendations ?? []), rec],
  }
  next = appendAudit(next, auditEntry('planning_manual_recommendation', actor, now, rec.id, { reason }))
  return ok({ planning: next, result: { id: rec.id } })
}

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

const PROCUREMENT_ORDER_NUMBER_RE = /^ЗЗ-(\d{4})-(\d+)$/

function nextProcurementOrderNumber(orders, dateValue, additionalOrders = []) {
  const date = str(dateValue)
  const year = DATE_RE.test(date) ? Number(date.slice(0, 4)) : new Date().getUTCFullYear()
  let max = 0
  for (const order of [...(orders ?? []), ...(additionalOrders ?? [])]) {
    const match = str(order?.orderNumber).match(PROCUREMENT_ORDER_NUMBER_RE)
    if (!match || Number(match[1]) !== year) continue
    max = Math.max(max, Number(match[2]) || 0)
  }
  return `ЗЗ-${year}-${String(max + 1).padStart(4, '0')}`
}

function procurementCreateSemantic(command) {
  const orderDate = str(command.orderDate)
  const lines = (Array.isArray(command.lines) ? command.lines : [])
    .map((line) => ({
      itemId: str(line?.itemId),
      requestedQty: num(line?.requestedQty ?? line?.quantity),
      unit: str(line?.unit),
      ...(line?.requiredDate != null
        ? { requiredDate: str(line.requiredDate).slice(0, 10) }
        : {}),
      ...(line?.unitPrice != null ? { unitPrice: num(line.unitPrice) } : {}),
    }))
    .sort((left, right) =>
      stableJson(left).localeCompare(stableJson(right)),
    )
  return {
    id: str(command.id),
    supplierId: str(command.supplierId),
    destinationWarehouseId: str(command.destinationWarehouseId ?? command.warehouseId),
    orderDate: orderDate ? orderDate.slice(0, 10) : '',
    ...(command.requestedDeliveryDate != null
      ? { requestedDeliveryDate: str(command.requestedDeliveryDate).slice(0, 10) }
      : {}),
    ...(command.scope != null ? { scope: str(command.scope) } : {}),
    ...(command.category != null ? { category: str(command.category) } : {}),
    ...(command.categoryId != null ? { categoryId: str(command.categoryId) } : {}),
    ...(command.currency != null ? { currency: str(command.currency) } : {}),
    lines,
  }
}

function procurementReceiptSemantic(command) {
  const lines = (Array.isArray(command.lines) ? command.lines : [])
    .map((line) => ({
      lineId: str(line?.lineId),
      ...(line?.itemId != null ? { itemId: str(line.itemId) } : {}),
      quantity: num(line?.quantity ?? line?.receivedQty),
      ...(line?.unit != null ? { unit: str(line.unit) } : {}),
      ...(line?.locationId != null ? { locationId: str(line.locationId) } : {}),
      ...(line?.batchNo != null ? { batchNo: str(line.batchNo) } : {}),
      ...(line?.expiryDate != null
        ? { expiryDate: str(line.expiryDate).slice(0, 10) }
        : {}),
    }))
    .sort((left, right) => left.lineId.localeCompare(right.lineId))
  return {
    purchaseOrderId: str(command.purchaseOrderId ?? command.orderId ?? command.id),
    warehouseId: str(command.warehouseId),
    date: str(command.date).slice(0, 10),
    lines,
  }
}

function explicitProcurementCommandFingerprint(commandType, command) {
  const semantic =
    commandType === 'procurement.draft.create'
      ? procurementCreateSemantic(command)
      : commandType === 'procurement.receipt.post'
        ? procurementReceiptSemantic(command)
        : null
  return semantic
    ? `procurement:${commandType}:v1:sha256:${sha256Stable(semantic)}`
    : null
}

function procurementDestinationKnown(warehouse, destinationWarehouseId) {
  const id = str(destinationWarehouseId)
  if (!id) return false
  if (
    (warehouse.locations ?? []).some(
      (location) => str(location.id) === id || str(location.warehouseId) === id,
    )
  ) {
    return true
  }
  return (warehouse.accountingByWarehouse ?? []).some(
    (row) =>
      str(row.warehouseId ?? row.id) === id &&
      row.status !== 'inactive' &&
      row.active !== false,
  )
}

function validProcurementOrderNumber(value) {
  return PROCUREMENT_ORDER_NUMBER_RE.test(str(value))
}

function procurementDraftMatchesSemantic(order, semantic, commandFingerprint) {
  if (
    order?.status !== 'draft' ||
    str(order.commandFingerprint) !== commandFingerprint ||
    str(order.supplierId) !== semantic.supplierId ||
    str(order.destinationWarehouseId) !== semantic.destinationWarehouseId ||
    str(order.orderDate).slice(0, 10) !== semantic.orderDate ||
    !validProcurementOrderNumber(order.orderNumber)
  ) {
    return false
  }
  const rows = Array.isArray(order.lines) ? order.lines : []
  if (!hasUniqueNonEmptyIds(rows, (line) => line?.lineId) || rows.length !== semantic.lines.length) {
    return false
  }
  const actual = rows
    .map((line) => ({
      itemId: str(line.itemId),
      requestedQty: num(line.requestedQty),
      unit: str(line.unit),
      ...(line.requiredDate != null
        ? { requiredDate: str(line.requiredDate).slice(0, 10) }
        : {}),
      ...(line.unitPrice != null ? { unitPrice: num(line.unitPrice) } : {}),
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  if (
    actual.some(
      (line) =>
        !line.itemId ||
        !line.unit ||
        !finitePositive(line.requestedQty),
    )
  ) {
    return false
  }
  return stableJson(actual) === stableJson(semantic.lines)
}

function applyProcurementDraftCreate(procurement, warehouse, masterData, command, actor, now) {
  const semantic = procurementCreateSemantic(command)
  const commandFingerprint = explicitProcurementCommandFingerprint(
    'procurement.draft.create',
    command,
  )
  if (
    !semantic.id ||
    !semantic.supplierId ||
    !semantic.destinationWarehouseId ||
    !DATE_RE.test(semantic.orderDate) ||
    semantic.lines.length === 0 ||
    !commandFingerprint
  ) {
    return fail('invalid_input', 400)
  }

  const existingMatches = (procurement.orders ?? []).filter(
    (order) => str(order.id) === semantic.id,
  )
  if (existingMatches.length > 0) {
    if (
      existingMatches.length !== 1 ||
      !procurementDraftMatchesSemantic(existingMatches[0], semantic, commandFingerprint)
    ) {
      return fail('procurement_draft_create_idempotency_conflict', 409)
    }
    return ok({
      procurement,
      result: {
        id: semantic.id,
        orderNumber: existingMatches[0].orderNumber,
        status: 'draft',
        revision: existingMatches[0].revision,
        order: existingMatches[0],
        commandFingerprint,
        idempotent: true,
      },
    })
  }

  const supplier = findById(masterData.suppliers, semantic.supplierId)
  if (!supplier || supplier.archived === true || supplier.active === false) {
    return fail('supplier_not_found', 404)
  }
  if (!procurementDestinationKnown(warehouse, semantic.destinationWarehouseId)) {
    return fail('warehouse_not_found', 404)
  }

  const seenItems = new Set()
  const lines = []
  for (const line of semantic.lines) {
    if (
      !line.itemId ||
      !line.unit ||
      !finitePositive(line.requestedQty) ||
      (line.unitPrice != null && !finiteNonNegative(line.unitPrice)) ||
      (line.requiredDate != null && !DATE_RE.test(line.requiredDate))
    ) {
      return fail('invalid_quantity', 400)
    }
    if (seenItems.has(line.itemId)) return fail('duplicate_item_line', 409)
    seenItems.add(line.itemId)
    const item = findById(masterData.items, line.itemId)
    if (!item || item.archived === true || item.active === false) {
      return fail('item_not_found', 404)
    }
    if (!str(item.baseUnit) || str(item.baseUnit) !== line.unit) {
      return fail('unit_mismatch', 409)
    }
    const suppliedItemIds = Array.isArray(supplier.suppliedItemIds)
      ? supplier.suppliedItemIds.map(str).filter(Boolean)
      : []
    if (suppliedItemIds.length > 0 && !suppliedItemIds.includes(line.itemId)) {
      return fail('supplier_item_mismatch', 409)
    }
    lines.push({
      lineId: `pol-${crypto.randomUUID()}`,
      itemId: line.itemId,
      itemCodeSnapshot: item.code,
      itemNameSnapshot: item.name,
      unit: line.unit,
      requestedQty: roundQty(line.requestedQty),
      receivedQty: 0,
      requiredDate: line.requiredDate,
      unitPrice: line.unitPrice != null ? roundQty(line.unitPrice) : undefined,
      sourceShortageIds: [],
    })
  }

  const orderNumber = nextProcurementOrderNumber(
    procurement.orders,
    semantic.orderDate,
  )
  const order = {
    id: semantic.id,
    orderNumber,
    status: 'draft',
    supplierId: semantic.supplierId,
    supplierNameSnapshot: supplier.name,
    destinationWarehouseId: semantic.destinationWarehouseId,
    orderDate: semantic.orderDate,
    requestedDeliveryDate: semantic.requestedDeliveryDate,
    scope: semantic.scope || 'domestic',
    category: semantic.category || 'raw_material',
    categoryId: semantic.categoryId || undefined,
    currency: semantic.currency || undefined,
    lines,
    revision: 0,
    commandFingerprint,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...procurement, orders: [...(procurement.orders ?? []), order] }
  next = appendAudit(
    next,
    auditEntry('procurement_draft_create', actor, now, semantic.id, {
      orderNumber,
      commandFingerprint,
    }),
  )
  return ok({
    procurement: next,
    result: {
      id: semantic.id,
      orderNumber,
      status: 'draft',
      revision: order.revision,
      order,
      commandFingerprint,
    },
  })
}

function roundUpMultiple(qty, multiple, moq) {
  let q = Math.max(qty, moq || 0)
  const m = Number(multiple) || 0
  if (m > EPS) {
    q = Math.ceil(q / m - EPS) * m
  }
  return roundQty(q)
}

function applyGenerateDraftsFromMrp(procurement, planning, masterData, command, actor, now) {
  const runId = str(command.planningRunId)
  if (!runId) return fail('invalid_input', 400)
  let nextPlanning = refreshPlanningRunBomStale(planning, masterData, str(command.asOfDate || now).slice(0, 10))
  const run = findById(nextPlanning.planningRuns, runId)
  if (!run) return fail('planning_run_not_found', 404)
  if (run.stale === true) {
    return fail('planning_run_stale', 409, { planning: nextPlanning })
  }

  // Idempotent: if drafts already sourced from this run, return them
  const existingFromRun = (procurement.orders ?? []).filter(
    (o) => o.sourcePlanningRunId === runId && o.status === 'draft',
  )
  if (existingFromRun.length > 0) {
    return ok({
      procurement,
      planning: nextPlanning,
      result: {
        planningRunId: runId,
        draftIds: existingFromRun.map((o) => o.id),
        idempotent: true,
        unassignedShortages: procurement.unassignedShortages ?? [],
      },
    })
  }

  const openShortages = (nextPlanning.shortages ?? planning.shortages ?? []).filter(
    (s) => s.planningRunId === runId && s.status === 'open',
  )
  const groups = new Map() // key = supplierId|requiredDate
  const unassigned = []

  for (const sh of openShortages) {
    const item = findById(masterData.items, sh.itemId)
    if (!item || item.archived === true) {
      unassigned.push({ shortageId: sh.id, itemId: sh.itemId, reason: 'item_missing' })
      continue
    }
    const supplierId = str(sh.supplierId || item.defaultSupplierId)
    if (!supplierId || !findById(masterData.suppliers, supplierId)) {
      unassigned.push({ shortageId: sh.id, itemId: sh.itemId, reason: 'no_supplier' })
      continue
    }
    const requiredDate = sh.firstShortageDate || now.slice(0, 10)
    const key = `${supplierId}|${requiredDate}`
    if (!groups.has(key)) {
      groups.set(key, { supplierId, requiredDate, lines: new Map() })
    }
    const g = groups.get(key)
    const prev = g.lines.get(sh.itemId) || {
      itemId: sh.itemId,
      qty: 0,
      sourceShortageIds: [],
      unit: item.baseUnit,
    }
    prev.qty = roundQty(prev.qty + sh.shortageQty)
    prev.sourceShortageIds.push(sh.id)
    g.lines.set(sh.itemId, prev)
  }

  const drafts = []
  for (const g of groups.values()) {
    const supplier = findById(masterData.suppliers, g.supplierId)
    const lines = []
    for (const row of g.lines.values()) {
      const item = findById(masterData.items, row.itemId)
      const requestedQty = roundUpMultiple(row.qty, item?.orderMultiple, item?.moq)
      lines.push({
        lineId: `pol-${crypto.randomUUID()}`,
        itemId: row.itemId,
        itemCodeSnapshot: item?.code,
        itemNameSnapshot: item?.name,
        unit: row.unit || item?.baseUnit || 'kg',
        requestedQty,
        receivedQty: 0,
        requiredDate: g.requiredDate,
        proposedOrderDate: now.slice(0, 10),
        sourceShortageIds: row.sourceShortageIds,
      })
    }
    if (lines.length === 0) continue
    const destinations = [
      ...new Set(
        lines
          .map((line) => str(findById(masterData.items, line.itemId)?.warehouseId))
          .filter(Boolean),
      ),
    ]
    const orderNumber = nextProcurementOrderNumber(
      procurement.orders,
      now.slice(0, 10),
      drafts,
    )
    drafts.push({
      id: `po-${crypto.randomUUID()}`,
      orderNumber,
      status: 'draft',
      supplierId: g.supplierId,
      supplierNameSnapshot: supplier?.name,
      scope: 'domestic',
      category: 'raw_material',
      orderDate: now.slice(0, 10),
      requestedDeliveryDate: g.requiredDate,
      destinationWarehouseId: destinations.length === 1 ? destinations[0] : undefined,
      lines,
      sourcePlanningRunId: runId,
      revision: 0,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    })
  }

  let next = {
    ...procurement,
    orders: [...(procurement.orders ?? []), ...drafts],
    unassignedShortages: [
      ...(procurement.unassignedShortages ?? []).filter((u) => {
        // drop prior unassigned for shortages covered by this run's new drafts
        return !openShortages.some((s) => s.id === u.shortageId)
      }),
      ...unassigned,
    ],
  }
  next = appendAudit(
    next,
    auditEntry('procurement_generate_drafts', actor, now, runId, { draftCount: drafts.length }),
  )
  return ok({
    procurement: next,
    planning: nextPlanning,
    result: {
      planningRunId: runId,
      draftIds: drafts.map((d) => d.id),
      unassignedShortages: unassigned,
    },
  })
}

function applyProcurementDraftEdit(procurement, warehouse, masterData, command, actor, now) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(procurement.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status !== 'draft') return fail('not_draft', 409)

  // Reject free-text item/supplier invent
  if (command.supplierName && !command.supplierId && !existing.supplierId) {
    return fail('free_text_supplier_forbidden', 400)
  }
  const supplierId = command.supplierId != null ? str(command.supplierId) : existing.supplierId
  const supplier = supplierId ? findById(masterData.suppliers, supplierId) : null
  if (!supplier || supplier.archived === true || supplier.active === false) {
    return fail('supplier_not_found', 404)
  }

  const destinationWarehouseId =
    command.destinationWarehouseId != null
      ? str(command.destinationWarehouseId)
      : str(existing.destinationWarehouseId)
  if (!procurementDestinationKnown(warehouse, destinationWarehouseId)) {
    return fail('warehouse_not_found', 404)
  }

  let lines = existing.lines
  if (Array.isArray(command.lines)) {
    lines = []
    const seenLineIds = new Set()
    const seenItemIds = new Set()
    for (const ln of command.lines) {
      const lineId = str(ln.lineId)
      if (!lineId || seenLineIds.has(lineId)) return fail('duplicate_line_id', 409)
      seenLineIds.add(lineId)
      const itemId = str(ln.itemId)
      if (!itemId) return fail('item_required', 400)
      const item = findById(masterData.items, itemId)
      if (!item || item.archived === true || item.active === false) return fail('item_not_found', 404)
      if (seenItemIds.has(itemId)) return fail('duplicate_item_line', 409)
      seenItemIds.add(itemId)
      if (ln.itemName && !ln.itemId) return fail('free_text_item_forbidden', 400)
      const requestedQty = roundQty(num(ln.requestedQty))
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) return fail('invalid_quantity', 400)
      const unit = str(ln.unit) || str(item.baseUnit)
      if (!unit || unit !== str(item.baseUnit)) return fail('unit_mismatch', 409)
      const previousLine = (existing.lines ?? []).find((row) => str(row.lineId) === lineId)
      if (!previousLine || str(previousLine.itemId) !== itemId) {
        return fail('po_line_not_found', 404)
      }
      lines.push({
        ...previousLine,
        lineId,
        itemId,
        itemCodeSnapshot: item.code,
        itemNameSnapshot: item.name,
        unit,
        requestedQty,
        receivedQty: roundQty(num(previousLine.receivedQty) || 0),
        requiredDate: ln.requiredDate != null ? str(ln.requiredDate).slice(0, 10) : undefined,
        proposedOrderDate: ln.proposedOrderDate != null ? str(ln.proposedOrderDate).slice(0, 10) : undefined,
        unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
        sourceShortageIds: Array.isArray(ln.sourceShortageIds) ? ln.sourceShortageIds.map(str) : [],
      })
    }
  }

  const order = {
    ...existing,
    supplierId,
    supplierNameSnapshot: supplier?.name ?? existing.supplierNameSnapshot,
    destinationWarehouseId,
    orderDate:
      command.orderDate != null ? str(command.orderDate).slice(0, 10) : existing.orderDate,
    requestedDeliveryDate:
      command.requestedDeliveryDate != null
        ? str(command.requestedDeliveryDate).slice(0, 10)
        : existing.requestedDeliveryDate,
    currency: command.currency != null ? str(command.currency) : existing.currency,
    lines,
    revision: (existing.revision ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...procurement, orders: upsertById(procurement.orders, order) }
  next = appendAudit(next, auditEntry('procurement_draft_edit', actor, now, id))
  return ok({
    procurement: next,
    result: { id, orderNumber: order.orderNumber, status: order.status, revision: order.revision, order },
  })
}

/**
 * Revision change for approved/ordered POs. Cannot change supplierId or line itemId;
 * cannot reduce requestedQty below receivedQty. Requires reason.
 */
function applyProcurementOrderChange(procurement, masterData, command, actor, now) {
  const id = str(command.id)
  const reason = str(command.reason ?? command.changeReason)
  if (!id) return fail('invalid_input', 400)
  if (!reason) return fail('reason_required', 400)
  const existing = findById(procurement.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status !== 'approved' && existing.status !== 'ordered') {
    return fail('invalid_status', 409)
  }

  if (command.supplierId != null && str(command.supplierId) !== str(existing.supplierId)) {
    return fail('supplier_immutable', 409)
  }

  let lines = existing.lines
  if (Array.isArray(command.lines)) {
    const byLineId = new Map((existing.lines ?? []).map((l) => [l.lineId, l]))
    lines = []
    for (const ln of command.lines) {
      const lineId = str(ln.lineId)
      const prev = byLineId.get(lineId)
      if (!prev) return fail('po_line_not_found', 404)
      if (ln.itemId != null && str(ln.itemId) !== str(prev.itemId)) {
        return fail('item_immutable', 409)
      }
      const requestedQty =
        ln.requestedQty != null ? roundQty(num(ln.requestedQty)) : roundQty(num(prev.requestedQty) || 0)
      const receivedQty = roundQty(num(prev.receivedQty) || 0)
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) return fail('invalid_quantity', 400)
      if (requestedQty + EPS < receivedQty) return fail('qty_below_received', 409)
      const item = findById(masterData.items, prev.itemId)
      lines.push({
        ...prev,
        itemId: prev.itemId,
        itemCodeSnapshot: prev.itemCodeSnapshot ?? item?.code,
        itemNameSnapshot: prev.itemNameSnapshot ?? item?.name,
        unit: prev.unit,
        requestedQty,
        receivedQty,
        requiredDate:
          ln.requiredDate != null ? str(ln.requiredDate).slice(0, 10) : prev.requiredDate,
        proposedOrderDate:
          ln.proposedOrderDate != null
            ? str(ln.proposedOrderDate).slice(0, 10)
            : prev.proposedOrderDate,
        unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : prev.unitPrice,
      })
    }
  }

  const order = {
    ...existing,
    currency: command.currency != null ? str(command.currency) : existing.currency,
    lines,
    revision: (existing.revision ?? 0) + 1,
    changeReason: reason,
    changedAt: now,
    changedBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let next = { ...procurement, orders: upsertById(procurement.orders, order) }
  next = appendAudit(next, auditEntry('procurement_order_change', actor, now, id, { reason }))
  return ok({
    procurement: next,
    result: {
      id,
      orderNumber: order.orderNumber,
      status: order.status,
      revision: order.revision,
      order,
      reason,
    },
  })
}

function applyProcurementStatus(procurement, command, actor, now, nextStatus, fromStatuses) {
  const id = str(command.id)
  if (!id) return fail('invalid_input', 400)
  const existing = findById(procurement.orders, id)
  if (!existing) return fail('not_found', 404)
  if (existing.status === nextStatus) {
    return ok({
      procurement,
      result: {
        id,
        orderNumber: existing.orderNumber,
        status: nextStatus,
        revision: existing.revision,
        order: existing,
        idempotent: true,
      },
    })
  }
  if (!fromStatuses.has(existing.status)) return fail('invalid_status', 409)
  const order = {
    ...existing,
    status: nextStatus,
    revision: (existing.revision ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
    ...(nextStatus === 'submitted' ? { submittedAt: now, submittedBy: actor.uid } : {}),
    ...(nextStatus === 'approved' ? { approvedAt: now, approvedBy: actor.uid } : {}),
    ...(nextStatus === 'ordered' ? { orderedAt: now, orderedBy: actor.uid } : {}),
    ...(nextStatus === 'cancelled' ? { cancelledAt: now, cancelledBy: actor.uid } : {}),
  }
  let next = { ...procurement, orders: upsertById(procurement.orders, order) }
  next = appendAudit(next, auditEntry(`procurement_order_${nextStatus}`, actor, now, id))
  return ok({
    procurement: next,
    result: {
      id,
      orderNumber: order.orderNumber,
      status: nextStatus,
      revision: order.revision,
      order,
    },
  })
}

function warehouseIdKnown(warehouse, warehouseId) {
  const id = str(warehouseId)
  if (!id) return false
  const locations = warehouse.locations ?? []
  if (locations.length > 0) {
    return locations.some((loc) => str(loc.warehouseId) === id || str(loc.id) === id)
  }
  const accounting = warehouse.accountingByWarehouse ?? []
  if (accounting.some((a) => str(a.warehouseId || a.id) === id)) return true
  if ((warehouse.documents ?? []).some((d) => str(d.warehouseId) === id)) return true
  if ((warehouse.movements ?? []).some((m) => str(m.warehouseId) === id)) return true
  // Empty catalog / no history — allow first receipt to establish warehouse.
  return true
}

function locationIdKnown(warehouse, locationId) {
  const id = str(locationId)
  if (!id) return true
  const locations = warehouse.locations ?? []
  if (locations.length === 0) return true
  return locations.some((loc) => str(loc.id) === id || str(loc.locationId) === id)
}

function procurementReceiptStateMismatch(detail) {
  return fail('procurement_receipt_authoritative_state_mismatch', 409, { detail })
}

function validateExistingProcurementReceipt(
  procurement,
  warehouse,
  semantic,
  commandFingerprint,
) {
  const poMatches = (procurement.orders ?? []).filter(
    (row) => str(row.id) === semantic.purchaseOrderId,
  )
  if (poMatches.length !== 1) return procurementReceiptStateMismatch('po_cardinality')
  const po = poMatches[0]
  const poLines = Array.isArray(po.lines) ? po.lines : []
  if (!hasUniqueNonEmptyIds(poLines, (row) => row?.lineId)) {
    return procurementReceiptStateMismatch('po_line_cardinality')
  }

  const documentMatches = (warehouse.documents ?? []).filter(
    (row) =>
      str(row.purchaseOrderId) === semantic.purchaseOrderId &&
      str(row.commandFingerprint) === commandFingerprint,
  )
  if (documentMatches.length !== 1) {
    return procurementReceiptStateMismatch('document_cardinality')
  }
  const document = documentMatches[0]
  const documentLines = Array.isArray(document.lines) ? document.lines : []
  if (
    document.status !== 'posted' ||
    document.type !== 'receipt' ||
    document.purpose !== 'purchase' ||
    document.docRole !== 'procurement_receipt' ||
    str(document.warehouseId) !== semantic.warehouseId ||
    str(document.date).slice(0, 10) !== semantic.date ||
    !str(document.id) ||
    !str(document.number) ||
    documentLines.length !== semantic.lines.length ||
    !hasUniqueNonEmptyIds(documentLines, (row) => row?.lineId)
  ) {
    return procurementReceiptStateMismatch('document_tuple')
  }

  const expectedByPoLine = new Map(semantic.lines.map((line) => [line.lineId, line]))
  const seenPoLines = new Set()
  for (const line of documentLines) {
    const purchaseOrderLineId = str(line.purchaseOrderLineId)
    const expected = expectedByPoLine.get(purchaseOrderLineId)
    const poLine = poLines.find((row) => str(row.lineId) === purchaseOrderLineId)
    if (
      !expected ||
      !poLine ||
      seenPoLines.has(purchaseOrderLineId) ||
      str(line.itemId) !== str(poLine.itemId) ||
      (expected.itemId != null && str(line.itemId) !== expected.itemId) ||
      !finitePositive(line.quantity) ||
      !qtyEqual(line.quantity, expected.quantity) ||
      str(line.unitSnapshot) !== str(poLine.unit) ||
      str(line.locationId) !== str(expected.locationId) ||
      str(line.batchNo) !== str(expected.batchNo) ||
      str(line.expiryDate) !== str(expected.expiryDate)
    ) {
      return procurementReceiptStateMismatch('document_line_tuple')
    }
    seenPoLines.add(purchaseOrderLineId)
  }
  if (seenPoLines.size !== semantic.lines.length) {
    return procurementReceiptStateMismatch('document_line_cardinality')
  }

  const movements = (warehouse.movements ?? []).filter(
    (row) => str(row.documentId) === str(document.id),
  )
  if (
    movements.length !== documentLines.length ||
    !hasUniqueNonEmptyIds(movements) ||
    movements.some((row) => row.cancelled === true)
  ) {
    return procurementReceiptStateMismatch('movement_cardinality')
  }
  for (const documentLine of documentLines) {
    const movementMatches = movements.filter(
      (row) => str(row.documentLineId) === str(documentLine.lineId),
    )
    if (movementMatches.length !== 1) {
      return procurementReceiptStateMismatch('movement_document_line')
    }
    const movement = movementMatches[0]
    if (
      movement.type !== 'receipt' ||
      str(movement.purchaseOrderId) !== semantic.purchaseOrderId ||
      str(movement.purchaseOrderLineId) !== str(documentLine.purchaseOrderLineId) ||
      str(movement.warehouseId) !== semantic.warehouseId ||
      str(movement.itemId) !== str(documentLine.itemId) ||
      str(movement.locationId) !== str(documentLine.locationId) ||
      str(movement.batchNo) !== str(documentLine.batchNo) ||
      str(movement.expiryDate) !== str(documentLine.expiryDate) ||
      str(movement.unitSnapshot) !== str(documentLine.unitSnapshot) ||
      str(movement.date).slice(0, 10) !== semantic.date ||
      str(movement.commandFingerprint) !== commandFingerprint ||
      !finitePositive(movement.quantity) ||
      !qtyEqual(movement.quantity, documentLine.quantity)
    ) {
      return procurementReceiptStateMismatch('movement_tuple')
    }
  }

  for (const poLine of poLines) {
    const totalReceived = roundQty(
      (warehouse.movements ?? [])
        .filter(
          (movement) =>
            movement.cancelled !== true &&
            movement.type === 'receipt' &&
            str(movement.purchaseOrderId) === semantic.purchaseOrderId &&
            str(movement.purchaseOrderLineId) === str(poLine.lineId),
        )
        .reduce((sum, movement) => sum + num(movement.quantity), 0),
    )
    if (
      !finiteNonNegative(poLine.receivedQty) ||
      !finitePositive(poLine.requestedQty) ||
      !qtyEqual(totalReceived, poLine.receivedQty) ||
      totalReceived > num(poLine.requestedQty) + EPS
    ) {
      return procurementReceiptStateMismatch('po_received_conservation')
    }
  }

  const allReceived = poLines.every(
    (line) => num(line.receivedQty) + EPS >= num(line.requestedQty),
  )
  const anyReceived = poLines.some((line) => num(line.receivedQty) > EPS)
  const expectedStatus = allReceived
    ? 'received'
    : anyReceived
      ? 'partially_received'
      : po.status
  if (po.status !== expectedStatus) {
    return procurementReceiptStateMismatch('po_status')
  }

  return ok({
    procurement,
    warehouse,
    result: {
      purchaseOrderId: semantic.purchaseOrderId,
      documentId: str(document.id),
      number: str(document.number),
      status: po.status,
      movementsCount: movements.length,
      movementIds: movements.map((movement) => str(movement.id)),
      order: po,
      document,
      movements,
      commandFingerprint,
      idempotent: true,
    },
  })
}

function applyProcurementReceipt(procurement, warehouse, masterData, command, actor, now) {
  const purchaseOrderId = str(command.purchaseOrderId ?? command.id)
  if (!purchaseOrderId) return fail('invalid_input', 400)
  const po = findById(procurement.orders, purchaseOrderId)
  if (!po) return fail('not_found', 404)
  const warehouseId = str(command.warehouseId)
  if (!warehouseId) return fail('warehouse_required', 400)
  if (
    isStagingIsolatedRuntime()
      ? !procurementDestinationKnown(warehouse, warehouseId)
      : !warehouseIdKnown(warehouse, warehouseId)
  ) {
    return fail('warehouse_not_found', 404)
  }
  const date = str(command.date ?? now).slice(0, 10)
  if (!DATE_RE.test(date)) return fail('invalid_date', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  if (
    str(po.destinationWarehouseId) &&
    str(po.destinationWarehouseId) !== warehouseId
  ) {
    return fail('warehouse_mismatch', 409)
  }

  const recvLines = Array.isArray(command.lines) ? command.lines : []
  if (recvLines.length === 0) return fail('empty_lines', 400)

  const semantic = procurementReceiptSemantic({ ...command, purchaseOrderId, warehouseId, date })
  const commandFingerprint = explicitProcurementCommandFingerprint(
    'procurement.receipt.post',
    { ...command, purchaseOrderId, warehouseId, date },
  )
  if (!commandFingerprint) return fail('invalid_input', 400)
  const existingReceiptDocuments = (warehouse.documents ?? []).filter(
    (row) =>
      str(row.purchaseOrderId) === purchaseOrderId &&
      str(row.commandFingerprint) === commandFingerprint,
  )
  if (existingReceiptDocuments.length > 0) {
    return validateExistingProcurementReceipt(
      procurement,
      warehouse,
      semantic,
      commandFingerprint,
    )
  }
  if (!OPEN_PO.has(po.status)) {
    return fail('invalid_status', 409)
  }

  const poLineById = new Map((po.lines ?? []).map((l) => [l.lineId, l]))
  const docLines = []
  const receivedByLine = new Map()
  const seenLineIds = new Set()

  for (const rl of recvLines) {
    const lineId = str(rl.lineId)
    if (!lineId || seenLineIds.has(lineId)) return fail('duplicate_line_id', 409)
    seenLineIds.add(lineId)
    const poLine = poLineById.get(lineId)
    if (!poLine) return fail('po_line_not_found', 404)
    const qty = roundQty(num(rl.quantity ?? rl.receivedQty))
    if (!Number.isFinite(qty) || qty <= 0) return fail('invalid_quantity', 400)

    if (
      (isStagingIsolatedRuntime() || rl.itemId != null) &&
      str(rl.itemId) !== str(poLine.itemId)
    ) {
      return fail('item_mismatch', 400)
    }
    if (
      (isStagingIsolatedRuntime() || rl.unit != null) &&
      str(rl.unit) !== str(poLine.unit)
    ) {
      return fail('unit_mismatch', 409)
    }

    const openQty = roundQty(
      Math.max(0, (num(poLine.requestedQty) || 0) - (num(poLine.receivedQty) || 0)),
    )
    const alreadyInCmd = receivedByLine.get(lineId) || 0
    if (qty + alreadyInCmd > openQty + EPS) {
      return fail('over_receipt', 409, { lineId, openQty, requested: qty })
    }

    const item = findById(masterData.items, poLine.itemId)
    if (!item) return fail('item_not_found', 404)

    const batchNo = rl.batchNo != null ? str(rl.batchNo) : undefined
    const expiryDate = rl.expiryDate != null ? str(rl.expiryDate).slice(0, 10) : undefined
    if (item.batchTracking === true && !batchNo) return fail('batch_required', 400)
    if (item.expiryTracking === true) {
      if (!expiryDate || !DATE_RE.test(expiryDate)) return fail('expiry_required', 400)
    }

    const locationId = rl.locationId != null ? str(rl.locationId) : undefined
    if (
      locationId &&
      (isStagingIsolatedRuntime()
        ? !(warehouse.locations ?? []).some(
            (location) => str(location.id ?? location.locationId) === locationId,
          )
        : !locationIdKnown(warehouse, locationId))
    ) {
      return fail('location_not_found', 404)
    }

    docLines.push({
      lineId: `wdl-${crypto.randomUUID()}`,
      purchaseOrderLineId: lineId,
      itemId: poLine.itemId,
      quantity: qty,
      itemCodeSnapshot: item.code,
      itemNameSnapshot: item.name,
      unitSnapshot: poLine.unit,
      batchNo,
      expiryDate,
      locationId,
    })
    receivedByLine.set(lineId, roundQty(alreadyInCmd + qty))
  }

  const sanitized = sanitizeDocumentLines(docLines)
  if (!sanitized.ok) return fail(sanitized.error, 400)
  const authoritativeLines = sanitized.lines.map((line, index) => ({
    ...line,
    purchaseOrderLineId: docLines[index].purchaseOrderLineId,
  }))

  const documentId = `wh-doc-${crypto.randomUUID()}`
  const number = nextServerDocumentNumber(warehouse.documents, 'receipt', warehouseId, date)
  const doc = {
    id: documentId,
    type: 'receipt',
    purpose: 'purchase',
    docRole: 'procurement_receipt',
    warehouseId,
    date,
    number,
    lines: authoritativeLines,
    status: 'posted',
    purchaseOrderId,
    commandFingerprint,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  const movements = authoritativeLines.map((line) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId,
    documentLineId: line.lineId,
    warehouseId,
    itemId: line.itemId,
    quantity: Number(line.quantity),
    type: 'receipt',
    at: now,
    date,
    receivedAt: now,
    actorUid: actor.uid,
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    unitSnapshot: line.unitSnapshot,
    locationId: line.locationId,
    purchaseOrderId,
    purchaseOrderLineId: line.purchaseOrderLineId,
    commandFingerprint,
  }))

  let nextWh = {
    ...warehouse,
    documents: [...(warehouse.documents ?? []), doc],
    movements: [...(warehouse.movements ?? []), ...movements],
  }
  nextWh = appendAudit(
    nextWh,
    auditEntry('procurement_receipt_post', actor, now, documentId, { purchaseOrderId }),
  )

  const nextPoLines = (po.lines ?? []).map((ln) => {
    const add = receivedByLine.get(ln.lineId) || 0
    if (add <= EPS) return ln
    return { ...ln, receivedQty: roundQty((num(ln.receivedQty) || 0) + add) }
  })
  const allReceived = nextPoLines.every(
    (ln) => (num(ln.receivedQty) || 0) + EPS >= (num(ln.requestedQty) || 0),
  )
  const anyReceived = nextPoLines.some((ln) => (num(ln.receivedQty) || 0) > EPS)
  const status = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status

  const nextPo = {
    ...po,
    lines: nextPoLines,
    status,
    warehouseDocumentIds: [
      ...new Set([...(Array.isArray(po.warehouseDocumentIds) ? po.warehouseDocumentIds : []), documentId]),
    ],
    revision: (po.revision ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextProc = { ...procurement, orders: upsertById(procurement.orders, nextPo) }
  nextProc = appendAudit(
    nextProc,
    auditEntry('procurement_receipt_applied', actor, now, purchaseOrderId, { documentId, status }),
  )

  const validated = validateExistingProcurementReceipt(
    nextProc,
    nextWh,
    semantic,
    commandFingerprint,
  )
  if (!validated.ok) return validated
  return ok({
    procurement: nextProc,
    warehouse: nextWh,
    result: { ...validated.result, idempotent: false },
  })
}

function applyPaymentRecord(procurement, command, actor, now) {
  const purchaseOrderId = str(command.purchaseOrderId)
  const amount = num(command.amount)
  const currency = str(command.currency) || 'GEL'
  if (!purchaseOrderId || !Number.isFinite(amount) || amount <= 0) return fail('invalid_input', 400)
  const po = findById(procurement.orders, purchaseOrderId)
  if (!po) return fail('not_found', 404)
  if (po.status === 'draft' || po.status === 'cancelled') return fail('invalid_status', 409)

  const payment = {
    id: str(command.id) || `pay-${crypto.randomUUID()}`,
    purchaseOrderId,
    amount: roundQty(amount),
    currency,
    paidAt: str(command.paidAt) || now,
    recordedBy: actor.uid,
    note: command.note != null ? str(command.note) : undefined,
  }
  let next = {
    ...procurement,
    payments: [...(procurement.payments ?? []), payment],
  }
  next = appendAudit(next, auditEntry('procurement_payment_record', actor, now, payment.id))
  return ok({ procurement: next, result: { paymentId: payment.id, purchaseOrderId } })
}

// ---------------------------------------------------------------------------
// Sales shipment CAS (G5.1) — mirrors G4 lot gates + updates sales line
// ---------------------------------------------------------------------------

function findFgLot(production, lotId) {
  const id = str(lotId)
  if (!id) return null
  return (production.finishedGoodsLots ?? production.lots ?? []).find((l) => l.id === id) ?? null
}

function replaceFgLot(production, lot) {
  const key = Array.isArray(production.finishedGoodsLots) ? 'finishedGoodsLots' : 'lots'
  const list = [...(production[key] ?? [])]
  const idx = list.findIndex((l) => l.id === lot.id)
  if (idx >= 0) list[idx] = lot
  else list.push(lot)
  return { ...production, [key]: list }
}

function findLoadingShipment(warehouse, shipmentId) {
  const id = str(shipmentId)
  if (!id) return null
  return (warehouse.loadingShipments ?? []).find((s) => s.id === id) ?? null
}

function replaceLoadingShipment(warehouse, shipment) {
  const list = [...(warehouse.loadingShipments ?? [])]
  const idx = list.findIndex((s) => s.id === shipment.id)
  if (idx >= 0) list[idx] = shipment
  else list.push(shipment)
  return { ...warehouse, loadingShipments: list }
}

function lotHistoryEntry(lot, entry) {
  return [...(lot.history ?? []), entry]
}

function qtyEqual(left, right) {
  const a = num(left)
  const b = num(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(roundQty(a) - roundQty(b)) <= EPS
}

function finiteNonNegative(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    return false
  }
  const parsed = num(value)
  return Number.isFinite(parsed) && parsed >= 0
}

function finitePositive(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    return false
  }
  const parsed = num(value)
  return Number.isFinite(parsed) && parsed > EPS
}

function hasUniqueNonEmptyIds(rows, idOf = (row) => row?.id) {
  const ids = (rows ?? []).map((row) => str(idOf(row)))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function shipmentCommandFingerprint(canonical) {
  return sha256Stable(canonical)
}

function explicitShipmentCommandFingerprint(commandType, command) {
  if (commandType === 'sales.shipment.post') {
    const canonical = canonicalG5ShipmentPost(command)
    if (
      !canonical.shipmentId ||
      !canonical.salesOrderId ||
      !canonical.salesLineId ||
      !canonical.finishedProductId ||
      !canonical.finishedGoodsLotId ||
      canonical.quantity == null ||
      !canonical.warehouseId ||
      !canonical.date ||
      !canonical.counterpartyId
    ) {
      return null
    }
    return shipmentCommandFingerprint(canonical)
  }
  if (commandType === 'sales.shipment.cancel') {
    const canonical = canonicalG5ShipmentCancel(command)
    if (!canonical.shipmentId || !canonical.reason || !canonical.date) return null
    return shipmentCommandFingerprint(canonical)
  }
  return null
}

function effectiveShipmentPostSemantic(command, { shipment, order, line, lot, now }) {
  return canonicalG5ShipmentPost({
    shipmentId: str(command.shipmentId) || str(shipment?.id),
    salesOrderId: str(command.salesOrderId) || str(shipment?.salesOrderId),
    salesLineId: str(command.salesLineId) || str(shipment?.salesLineId),
    finishedProductId:
      str(command.finishedProductId) ||
      str(shipment?.finishedProductId) ||
      str(line?.finishedProductId),
    finishedGoodsLotId:
      str(command.finishedGoodsLotId ?? command.lotId) || str(shipment?.finishedGoodsLotId),
    quantity: command.quantity ?? shipment?.quantity,
    warehouseId:
      str(command.warehouseId) || str(shipment?.warehouseId) || str(lot?.warehouseId),
    date: str(command.date) || str(shipment?.date) || str(now).slice(0, 10),
    counterpartyId:
      str(command.counterpartyId) || str(shipment?.counterpartyId) || str(order?.customerId),
  })
}

function effectiveShipmentCancelSemantic(command, shipment, now) {
  return canonicalG5ShipmentCancel({
    shipmentId: str(command.shipmentId) || str(shipment?.id),
    reason: str(command.reason ?? command.cancellationReason) || str(shipment?.cancellationReason),
    date:
      str(command.date) ||
      str(shipment?.cancellationDate) ||
      str(shipment?.cancelledAt).slice(0, 10) ||
      str(now).slice(0, 10),
  })
}

function expectedShipmentSalesStatus(lines) {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.some(
      (line) =>
        !finiteNonNegative(line?.quantity) ||
        !finiteNonNegative(line?.shippedQty) ||
        !finiteNonNegative(line?.remainingQty) ||
        num(line.shippedQty) > num(line.quantity) + EPS ||
        !qtyEqual(line.remainingQty, Math.max(0, num(line.quantity) - num(line.shippedQty))),
    )
  ) {
    return null
  }
  const allShipped = lines.every(
    (line) => num(line.shippedQty) + EPS >= num(line.quantity),
  )
  if (allShipped) return 'fulfilled'
  if (lines.some((line) => num(line.shippedQty) > EPS)) {
    return 'partially_shipped'
  }
  return 'confirmed'
}

function shipmentStateMismatch(detail) {
  return fail('sales_shipment_authoritative_state_mismatch', 409, { detail })
}

function validatePostedShipmentState(domains, semantic, commandFingerprint, { idempotent = false } = {}) {
  const { sales, production, warehouse } = domains
  const shipments = (warehouse.loadingShipments ?? []).filter(
    (row) => str(row.id) === semantic.shipmentId,
  )
  if (shipments.length !== 1) return shipmentStateMismatch('shipment_cardinality')
  const shipment = shipments[0]
  if (
    shipment.status !== 'posted' ||
    !str(shipment.warehouseItemId) ||
    !str(shipment.unitSnapshot) ||
    !str(shipment.lotNumber) ||
    !finitePositive(shipment.quantity)
  ) {
    return shipmentStateMismatch('shipment_status')
  }
  const storedFingerprint = str(shipment.postCommandFingerprint ?? shipment.commandFingerprint)
  if (!storedFingerprint || storedFingerprint !== commandFingerprint) {
    return fail('sales_shipment_idempotency_conflict', 409)
  }
  if (
    str(shipment.salesOrderId) !== semantic.salesOrderId ||
    str(shipment.salesLineId) !== semantic.salesLineId ||
    str(shipment.finishedProductId) !== semantic.finishedProductId ||
    str(shipment.finishedGoodsLotId) !== semantic.finishedGoodsLotId ||
    !qtyEqual(shipment.quantity, semantic.quantity) ||
    str(shipment.warehouseId) !== semantic.warehouseId ||
    str(shipment.date).slice(0, 10) !== semantic.date ||
    str(shipment.counterpartyId) !== semantic.counterpartyId
  ) {
    return shipmentStateMismatch('shipment_tuple')
  }

  const orderMatches = (sales.orders ?? []).filter((row) => str(row.id) === semantic.salesOrderId)
  if (orderMatches.length !== 1) return shipmentStateMismatch('sales_order_cardinality')
  const order = orderMatches[0]
  const lineMatches = (order.lines ?? []).filter(
    (row) => str(row.lineId ?? row.id) === semantic.salesLineId,
  )
  if (
    lineMatches.length !== 1 ||
    !hasUniqueNonEmptyIds(order.lines, (row) => row?.lineId ?? row?.id)
  ) {
    return shipmentStateMismatch('sales_line_cardinality')
  }
  const line = lineMatches[0]
  if (str(line.finishedProductId) !== semantic.finishedProductId) {
    return shipmentStateMismatch('sales_line_product')
  }

  const lotMatches = (production.finishedGoodsLots ?? production.lots ?? []).filter(
    (row) => str(row.id) === semantic.finishedGoodsLotId,
  )
  if (lotMatches.length !== 1) return shipmentStateMismatch('lot_cardinality')
  const lot = lotMatches[0]
  if (
    str(lot.finishedProductId) !== semantic.finishedProductId ||
    str(lot.warehouseId) !== semantic.warehouseId ||
    str(lot.warehouseItemId ?? lot.itemId ?? semantic.finishedProductId) !==
      str(shipment.warehouseItemId) ||
    str(lot.locationId) !== str(shipment.locationId) ||
    str(lot.lotNumber) !== str(shipment.lotNumber) ||
    lot.qcStatus !== 'released' ||
    str(lot.currentDecisionId) !== str(shipment.qcDecisionId) ||
    !Number.isInteger(Number(lot.lotRevision)) ||
    Number(lot.lotRevision) <= 0 ||
    !Number.isInteger(Number(shipment.lotRevisionAtPost)) ||
    Number(shipment.lotRevisionAtPost) <= 0 ||
    Number(lot.lotRevision) !== Number(shipment.lotRevisionAtPost)
  ) {
    return shipmentStateMismatch('lot_tuple')
  }

  const decisionMatches = (production.qcDecisions ?? []).filter(
    (row) => str(row.id) === str(shipment.qcDecisionId),
  )
  if (
    decisionMatches.length !== 1 ||
    decisionMatches[0].status !== 'released' ||
    str(decisionMatches[0].lotId) !== semantic.finishedGoodsLotId ||
    Number(decisionMatches[0].lotRevision) !== Number(shipment.lotRevisionAtPost)
  ) {
    return shipmentStateMismatch('qc_decision')
  }

  const documentIds = Array.isArray(shipment.documentIds)
    ? shipment.documentIds.map(str).filter(Boolean)
    : []
  if (documentIds.length !== 1 || new Set(documentIds).size !== 1) {
    return shipmentStateMismatch('shipment_document_cardinality')
  }
  const documentMatches = (warehouse.documents ?? []).filter(
    (row) => str(row.id) === documentIds[0],
  )
  const shipmentDocuments = (warehouse.documents ?? []).filter(
    (row) => str(row.shipmentId) === semantic.shipmentId,
  )
  if (
    documentMatches.length !== 1 ||
    shipmentDocuments.length !== 1 ||
    str(shipmentDocuments[0].id) !== documentIds[0]
  ) {
    return shipmentStateMismatch('shipment_document_missing')
  }
  const document = documentMatches[0]
  const documentLines = Array.isArray(document.lines) ? document.lines : []
  if (
    document.status !== 'posted' ||
    document.type !== 'issue' ||
    document.docRole !== 'finished_goods_shipment' ||
    str(document.shipmentId) !== semantic.shipmentId ||
    str(document.salesOrderId) !== semantic.salesOrderId ||
    str(document.salesLineId) !== semantic.salesLineId ||
    str(document.finishedGoodsLotId) !== semantic.finishedGoodsLotId ||
    str(document.warehouseId) !== semantic.warehouseId ||
    str(document.date).slice(0, 10) !== semantic.date ||
    str(document.counterpartyId) !== semantic.counterpartyId ||
    str(document.commandFingerprint) !== commandFingerprint ||
    documentLines.length !== 1
  ) {
    return shipmentStateMismatch('shipment_document_tuple')
  }
  const documentLine = documentLines[0]
  if (
    !str(documentLine.lineId) ||
    str(documentLine.itemId) !== str(lot.warehouseItemId ?? lot.itemId ?? semantic.finishedProductId) ||
    !qtyEqual(documentLine.quantity, semantic.quantity) ||
    str(documentLine.batchNo) !== str(lot.lotNumber) ||
    str(documentLine.locationId) !== str(lot.locationId) ||
    str(documentLine.unitSnapshot) !== str(shipment.unitSnapshot)
  ) {
    return shipmentStateMismatch('shipment_document_line')
  }

  const movements = (warehouse.movements ?? []).filter(
    (row) => str(row.documentId) === str(document.id),
  )
  const shipmentMovements = (warehouse.movements ?? []).filter(
    (row) => str(row.shipmentId) === semantic.shipmentId,
  )
  if (
    movements.length !== 1 ||
    shipmentMovements.length !== 1 ||
    str(shipmentMovements[0].id) !== str(movements[0].id) ||
    movements[0].cancelled === true
  ) {
    return shipmentStateMismatch('shipment_movement_cardinality')
  }
  const movement = movements[0]
  const movementIdentityMatches = (warehouse.movements ?? []).filter(
    (row) => str(row.id) === str(movement.id),
  )
  if (
    !str(movement.id) ||
    movementIdentityMatches.length !== 1 ||
    movement.type !== 'issue' ||
    str(movement.documentLineId) !== str(documentLine.lineId) ||
    str(movement.shipmentId) !== semantic.shipmentId ||
    str(movement.salesOrderId) !== semantic.salesOrderId ||
    str(movement.salesLineId) !== semantic.salesLineId ||
    str(movement.finishedGoodsLotId) !== semantic.finishedGoodsLotId ||
    str(movement.warehouseId) !== semantic.warehouseId ||
    str(movement.locationId) !== str(lot.locationId) ||
    str(movement.itemId) !== str(documentLine.itemId) ||
    str(movement.batchNo) !== str(lot.lotNumber) ||
    str(movement.unitSnapshot) !== str(shipment.unitSnapshot) ||
    str(movement.date).slice(0, 10) !== semantic.date ||
    !qtyEqual(movement.quantity, semantic.quantity) ||
    str(movement.commandFingerprint) !== commandFingerprint
  ) {
    return shipmentStateMismatch('shipment_movement_tuple')
  }

  const postedLotQuantity = roundQty(
    (warehouse.loadingShipments ?? [])
      .filter(
        (row) =>
          row.status === 'posted' &&
          str(row.finishedGoodsLotId) === semantic.finishedGoodsLotId,
      )
      .reduce((sum, row) => sum + (num(row.quantity) || 0), 0),
  )
  const postedLineQuantity = roundQty(
    (warehouse.loadingShipments ?? [])
      .filter(
        (row) =>
          row.status === 'posted' &&
          str(row.salesOrderId) === semantic.salesOrderId &&
          str(row.salesLineId) === semantic.salesLineId,
      )
      .reduce((sum, row) => sum + (num(row.quantity) || 0), 0),
  )
  const quantityReleased = roundQty(num(lot.quantityQcReleased) || 0)
  const quantityShipped = roundQty(num(lot.quantityShipped) || 0)
  const quantityRemaining = roundQty(num(lot.quantityRemaining) || 0)
  const salesLineShipped = roundQty(num(line.shippedQty) || 0)
  const salesLineRemaining = roundQty(num(line.remainingQty) || 0)
  const postedLotShipments = (warehouse.loadingShipments ?? []).filter(
    (row) => row.status === 'posted' && str(row.finishedGoodsLotId) === semantic.finishedGoodsLotId,
  )
  const postedLineShipments = (warehouse.loadingShipments ?? []).filter(
    (row) =>
      row.status === 'posted' &&
      str(row.salesOrderId) === semantic.salesOrderId &&
      str(row.salesLineId) === semantic.salesLineId,
  )
  if (
    !hasUniqueNonEmptyIds(postedLotShipments) ||
    !hasUniqueNonEmptyIds(postedLineShipments) ||
    postedLotShipments.some((row) => !finitePositive(row.quantity)) ||
    postedLineShipments.some((row) => !finitePositive(row.quantity)) ||
    !finiteNonNegative(lot.quantityQcReleased) ||
    !finiteNonNegative(lot.quantityShipped) ||
    !finiteNonNegative(lot.quantityRemaining) ||
    !finiteNonNegative(line.quantity) ||
    !finiteNonNegative(line.shippedQty) ||
    !finiteNonNegative(line.remainingQty) ||
    !qtyEqual(postedLotQuantity, quantityShipped) ||
    !qtyEqual(quantityRemaining, quantityReleased - quantityShipped) ||
    !qtyEqual(postedLineQuantity, salesLineShipped) ||
    !qtyEqual(salesLineRemaining, Math.max(0, (num(line.quantity) || 0) - salesLineShipped)) ||
    !expectedShipmentSalesStatus(order.lines) ||
    order.status !== expectedShipmentSalesStatus(order.lines)
  ) {
    return shipmentStateMismatch('shipment_conservation')
  }

  return ok({
    sales,
    production,
    warehouse,
    result: {
      shipmentId: semantic.shipmentId,
      status: 'posted',
      salesOrderId: semantic.salesOrderId,
      salesLineId: semantic.salesLineId,
      finishedProductId: semantic.finishedProductId,
      finishedGoodsLotId: semantic.finishedGoodsLotId,
      warehouseItemId: str(lot.warehouseItemId ?? lot.itemId ?? semantic.finishedProductId),
      unitSnapshot: str(shipment.unitSnapshot),
      lotNumber: str(lot.lotNumber),
      warehouseId: semantic.warehouseId,
      locationId: str(lot.locationId) || undefined,
      counterpartyId: semantic.counterpartyId || undefined,
      date: semantic.date,
      quantity: semantic.quantity,
      quantityQcReleased: quantityReleased,
      quantityShipped,
      quantityRemaining,
      salesLineQuantity: roundQty(num(line.quantity) || 0),
      salesLineQuantityShipped: salesLineShipped,
      salesLineQuantityRemaining: salesLineRemaining,
      salesStatus: order.status,
      qcDecisionId: str(shipment.qcDecisionId),
      lotRevisionAtPost: Number(shipment.lotRevisionAtPost),
      documentId: str(document.id),
      movementIds: [str(movement.id)],
      commandFingerprint,
      idempotent,
    },
  })
}

function validateCancelledShipmentState(domains, semantic, commandFingerprint, { idempotent = false } = {}) {
  const { sales, production, warehouse } = domains
  const shipmentMatches = (warehouse.loadingShipments ?? []).filter(
    (row) => str(row.id) === semantic.shipmentId,
  )
  if (shipmentMatches.length !== 1) return shipmentStateMismatch('shipment_cardinality')
  const shipment = shipmentMatches[0]
  if (
    shipment.status !== 'cancelled' ||
    !str(shipment.salesOrderId) ||
    !str(shipment.salesLineId) ||
    !str(shipment.finishedProductId) ||
    !str(shipment.finishedGoodsLotId) ||
    !str(shipment.warehouseId) ||
    !str(shipment.warehouseItemId) ||
    !str(shipment.unitSnapshot) ||
    !str(shipment.lotNumber) ||
    !finitePositive(shipment.quantity)
  ) {
    return shipmentStateMismatch('shipment_status')
  }
  if (str(shipment.cancelCommandFingerprint) !== commandFingerprint) {
    return fail('sales_shipment_cancel_idempotency_conflict', 409)
  }
  if (
    str(shipment.cancellationReason) !== semantic.reason ||
    str(shipment.cancellationDate).slice(0, 10) !== semantic.date
  ) {
    return shipmentStateMismatch('shipment_cancel_tuple')
  }

  const postFingerprint = str(shipment.postCommandFingerprint ?? shipment.commandFingerprint)
  if (!/^[a-f0-9]{64}$/.test(postFingerprint)) {
    return shipmentStateMismatch('shipment_post_fingerprint')
  }
  const sourceIds = Array.isArray(shipment.documentIds)
    ? shipment.documentIds.map(str).filter(Boolean)
    : []
  const reversalIds = Array.isArray(shipment.reversalDocumentIds)
    ? shipment.reversalDocumentIds.map(str).filter(Boolean)
    : []
  if (
    sourceIds.length !== 1 ||
    reversalIds.length !== 1 ||
    new Set(sourceIds).size !== 1 ||
    new Set(reversalIds).size !== 1
  ) {
    return shipmentStateMismatch('shipment_cancel_document_cardinality')
  }
  const sourceMatches = (warehouse.documents ?? []).filter((row) => str(row.id) === sourceIds[0])
  const reversalMatches = (warehouse.documents ?? []).filter(
    (row) => str(row.id) === reversalIds[0],
  )
  const shipmentDocuments = (warehouse.documents ?? []).filter(
    (row) => str(row.shipmentId) === semantic.shipmentId,
  )
  if (
    sourceMatches.length !== 1 ||
    reversalMatches.length !== 1 ||
    shipmentDocuments.length !== 2 ||
    !shipmentDocuments.every(
      (row) => str(row.id) === sourceIds[0] || str(row.id) === reversalIds[0],
    )
  ) {
    return shipmentStateMismatch('shipment_cancel_document_missing')
  }
  const source = sourceMatches[0]
  const reversal = reversalMatches[0]
  const sourceLines = Array.isArray(source.lines) ? source.lines : []
  const reversalLines = Array.isArray(reversal.lines) ? reversal.lines : []
  if (
    source.status !== 'posted' ||
    source.type !== 'issue' ||
    source.docRole !== 'finished_goods_shipment' ||
    str(source.shipmentId) !== semantic.shipmentId ||
    str(source.salesOrderId) !== str(shipment.salesOrderId) ||
    str(source.salesLineId) !== str(shipment.salesLineId) ||
    str(source.finishedGoodsLotId) !== str(shipment.finishedGoodsLotId) ||
    str(source.warehouseId) !== str(shipment.warehouseId) ||
    str(source.date).slice(0, 10) !== str(shipment.date).slice(0, 10) ||
    str(source.counterpartyId) !== str(shipment.counterpartyId) ||
    str(source.commandFingerprint) !== postFingerprint ||
    sourceLines.length !== 1 ||
    reversal.status !== 'posted' ||
    reversal.type !== 'receipt' ||
    reversal.docRole !== 'finished_goods_shipment_cancel' ||
    str(reversal.reversesDocumentId) !== str(source.id) ||
    str(reversal.shipmentId) !== semantic.shipmentId ||
    str(reversal.salesOrderId) !== str(shipment.salesOrderId) ||
    str(reversal.salesLineId) !== str(shipment.salesLineId) ||
    str(reversal.finishedGoodsLotId) !== str(shipment.finishedGoodsLotId) ||
    str(reversal.warehouseId) !== str(shipment.warehouseId) ||
    str(reversal.cancellationReason) !== semantic.reason ||
    str(reversal.date).slice(0, 10) !== semantic.date ||
    str(reversal.commandFingerprint) !== commandFingerprint ||
    reversalLines.length !== 1
  ) {
    return shipmentStateMismatch('shipment_cancel_document_tuple')
  }
  if (
    !str(sourceLines[0].lineId) ||
    !str(reversalLines[0].lineId) ||
    str(reversalLines[0].lineId) === str(sourceLines[0].lineId) ||
    str(sourceLines[0].itemId) !== str(shipment.warehouseItemId) ||
    str(sourceLines[0].batchNo) !== str(shipment.lotNumber) ||
    str(sourceLines[0].locationId) !== str(shipment.locationId) ||
    str(reversalLines[0].itemId) !== str(sourceLines[0].itemId) ||
    str(reversalLines[0].batchNo) !== str(sourceLines[0].batchNo) ||
    str(reversalLines[0].locationId) !== str(sourceLines[0].locationId) ||
    str(reversalLines[0].unitSnapshot) !== str(sourceLines[0].unitSnapshot) ||
    str(sourceLines[0].unitSnapshot) !== str(shipment.unitSnapshot) ||
    !qtyEqual(reversalLines[0].quantity, sourceLines[0].quantity) ||
    !qtyEqual(reversalLines[0].quantity, shipment.quantity)
  ) {
    return shipmentStateMismatch('shipment_cancel_document_line')
  }

  const sourceMovements = (warehouse.movements ?? []).filter(
    (row) => str(row.documentId) === str(source.id),
  )
  const reversalMovements = (warehouse.movements ?? []).filter(
    (row) => str(row.documentId) === str(reversal.id),
  )
  const shipmentMovements = (warehouse.movements ?? []).filter(
    (row) => str(row.shipmentId) === semantic.shipmentId,
  )
  if (
    sourceMovements.length !== 1 ||
    reversalMovements.length !== 1 ||
    shipmentMovements.length !== 2 ||
    sourceMovements[0].cancelled === true ||
    reversalMovements[0].cancelled === true ||
    !shipmentMovements.every(
      (row) =>
        str(row.id) === str(sourceMovements[0].id) ||
        str(row.id) === str(reversalMovements[0].id),
    )
  ) {
    return shipmentStateMismatch('shipment_cancel_movement_cardinality')
  }
  const sourceMovement = sourceMovements[0]
  const reversalMovement = reversalMovements[0]
  const sourceMovementIdentityMatches = (warehouse.movements ?? []).filter(
    (row) => str(row.id) === str(sourceMovement.id),
  )
  const reversalMovementIdentityMatches = (warehouse.movements ?? []).filter(
    (row) => str(row.id) === str(reversalMovement.id),
  )
  if (
    !str(sourceMovement.id) ||
    !str(reversalMovement.id) ||
    str(reversalMovement.id) === str(sourceMovement.id) ||
    sourceMovementIdentityMatches.length !== 1 ||
    reversalMovementIdentityMatches.length !== 1 ||
    sourceMovement.type !== 'issue' ||
    str(sourceMovement.documentLineId) !== str(sourceLines[0].lineId) ||
    str(sourceMovement.shipmentId) !== semantic.shipmentId ||
    str(sourceMovement.salesOrderId) !== str(shipment.salesOrderId) ||
    str(sourceMovement.salesLineId) !== str(shipment.salesLineId) ||
    str(sourceMovement.finishedGoodsLotId) !== str(shipment.finishedGoodsLotId) ||
    str(sourceMovement.warehouseId) !== str(shipment.warehouseId) ||
    str(sourceMovement.locationId) !== str(shipment.locationId) ||
    str(sourceMovement.itemId) !== str(shipment.warehouseItemId) ||
    str(sourceMovement.batchNo) !== str(shipment.lotNumber) ||
    str(sourceMovement.unitSnapshot) !== str(shipment.unitSnapshot) ||
    str(sourceMovement.date).slice(0, 10) !== str(shipment.date).slice(0, 10) ||
    !qtyEqual(sourceMovement.quantity, shipment.quantity) ||
    str(sourceMovement.commandFingerprint) !== postFingerprint ||
    reversalMovement.type !== 'receipt' ||
    str(reversalMovement.documentLineId) !== str(reversalLines[0].lineId) ||
    str(reversalMovement.reversesMovementId) !== str(sourceMovement.id) ||
    str(reversalMovement.shipmentId) !== semantic.shipmentId ||
    str(reversalMovement.finishedGoodsLotId) !== str(shipment.finishedGoodsLotId) ||
    str(reversalMovement.salesOrderId) !== str(shipment.salesOrderId) ||
    str(reversalMovement.salesLineId) !== str(shipment.salesLineId) ||
    str(reversalMovement.warehouseId) !== str(shipment.warehouseId) ||
    str(reversalMovement.locationId) !== str(shipment.locationId) ||
    str(reversalMovement.itemId) !== str(shipment.warehouseItemId) ||
    str(reversalMovement.batchNo) !== str(shipment.lotNumber) ||
    str(reversalMovement.unitSnapshot) !== str(shipment.unitSnapshot) ||
    str(reversalMovement.date).slice(0, 10) !== semantic.date ||
    !qtyEqual(reversalMovement.quantity, shipment.quantity) ||
    str(reversalMovement.commandFingerprint) !== commandFingerprint
  ) {
    return shipmentStateMismatch('shipment_cancel_movement_tuple')
  }

  const lotMatches = (production.finishedGoodsLots ?? production.lots ?? []).filter(
    (row) => str(row.id) === str(shipment.finishedGoodsLotId),
  )
  if (lotMatches.length !== 1) return shipmentStateMismatch('lot_cardinality')
  const lot = lotMatches[0]
  const orderMatches = (sales.orders ?? []).filter((row) => str(row.id) === str(shipment.salesOrderId))
  if (orderMatches.length !== 1) return shipmentStateMismatch('sales_order_cardinality')
  const order = orderMatches[0]
  const lineMatches = (order.lines ?? []).filter(
    (row) => str(row.lineId ?? row.id) === str(shipment.salesLineId),
  )
  if (
    lineMatches.length !== 1 ||
    !hasUniqueNonEmptyIds(order.lines, (row) => row?.lineId ?? row?.id)
  ) {
    return shipmentStateMismatch('sales_line_cardinality')
  }
  const line = lineMatches[0]
  if (
    str(lot.finishedProductId) !== str(shipment.finishedProductId) ||
    str(lot.warehouseId) !== str(shipment.warehouseId) ||
    str(lot.warehouseItemId ?? lot.itemId ?? shipment.finishedProductId) !==
      str(shipment.warehouseItemId) ||
    str(lot.locationId) !== str(shipment.locationId) ||
    str(lot.lotNumber) !== str(shipment.lotNumber) ||
    lot.qcStatus !== 'released' ||
    str(line.finishedProductId) !== str(shipment.finishedProductId)
  ) {
    return shipmentStateMismatch('shipment_cancel_business_tuple')
  }

  const postedLotQuantity = roundQty(
    (warehouse.loadingShipments ?? [])
      .filter(
        (row) => row.status === 'posted' && str(row.finishedGoodsLotId) === str(lot.id),
      )
      .reduce((sum, row) => sum + (num(row.quantity) || 0), 0),
  )
  const postedLineQuantity = roundQty(
    (warehouse.loadingShipments ?? [])
      .filter(
        (row) =>
          row.status === 'posted' &&
          str(row.salesOrderId) === str(shipment.salesOrderId) &&
          str(row.salesLineId) === str(shipment.salesLineId),
      )
      .reduce((sum, row) => sum + (num(row.quantity) || 0), 0),
  )
  const quantityReleased = roundQty(num(lot.quantityQcReleased) || 0)
  const quantityShipped = roundQty(num(lot.quantityShipped) || 0)
  const quantityRemaining = roundQty(num(lot.quantityRemaining) || 0)
  const salesLineShipped = roundQty(num(line.shippedQty) || 0)
  const salesLineRemaining = roundQty(num(line.remainingQty) || 0)
  const postedLotShipments = (warehouse.loadingShipments ?? []).filter(
    (row) => row.status === 'posted' && str(row.finishedGoodsLotId) === str(lot.id),
  )
  const postedLineShipments = (warehouse.loadingShipments ?? []).filter(
    (row) =>
      row.status === 'posted' &&
      str(row.salesOrderId) === str(shipment.salesOrderId) &&
      str(row.salesLineId) === str(shipment.salesLineId),
  )
  if (
    !hasUniqueNonEmptyIds(postedLotShipments) ||
    !hasUniqueNonEmptyIds(postedLineShipments) ||
    postedLotShipments.some((row) => !finitePositive(row.quantity)) ||
    postedLineShipments.some((row) => !finitePositive(row.quantity)) ||
    !finiteNonNegative(lot.quantityQcReleased) ||
    !finiteNonNegative(lot.quantityShipped) ||
    !finiteNonNegative(lot.quantityRemaining) ||
    !finiteNonNegative(line.quantity) ||
    !finiteNonNegative(line.shippedQty) ||
    !finiteNonNegative(line.remainingQty) ||
    !qtyEqual(postedLotQuantity, quantityShipped) ||
    !qtyEqual(quantityRemaining, quantityReleased - quantityShipped) ||
    !qtyEqual(postedLineQuantity, salesLineShipped) ||
    !qtyEqual(salesLineRemaining, Math.max(0, (num(line.quantity) || 0) - salesLineShipped)) ||
    !expectedShipmentSalesStatus(order.lines) ||
    order.status !== expectedShipmentSalesStatus(order.lines)
  ) {
    return shipmentStateMismatch('shipment_cancel_conservation')
  }

  return ok({
    sales,
    production,
    warehouse,
    result: {
      shipmentId: semantic.shipmentId,
      status: 'cancelled',
      salesOrderId: str(shipment.salesOrderId),
      salesLineId: str(shipment.salesLineId),
      finishedProductId: str(shipment.finishedProductId),
      finishedGoodsLotId: str(shipment.finishedGoodsLotId),
      warehouseItemId: str(shipment.warehouseItemId),
      unitSnapshot: str(shipment.unitSnapshot),
      lotNumber: str(shipment.lotNumber),
      warehouseId: str(shipment.warehouseId),
      locationId: str(shipment.locationId) || undefined,
      counterpartyId: str(shipment.counterpartyId) || undefined,
      date: semantic.date,
      quantity: roundQty(shipment.quantity),
      quantityQcReleased: quantityReleased,
      quantityShipped,
      quantityRemaining,
      salesLineQuantity: roundQty(num(line.quantity) || 0),
      salesLineQuantityShipped: salesLineShipped,
      salesLineQuantityRemaining: salesLineRemaining,
      salesStatus: order.status,
      documentId: str(source.id),
      reversalDocumentIds: [str(reversal.id)],
      reversalMovementIds: [str(reversalMovement.id)],
      reason: semantic.reason,
      commandFingerprint,
      postCommandFingerprint: postFingerprint,
      idempotent,
    },
  })
}

function balanceAtLot(movements, { warehouseId, locationId, itemId, batchNo }) {
  const filtered = (movements ?? []).filter((m) => {
    if (m.cancelled) return false
    if (m.warehouseId !== warehouseId) return false
    if (locationId != null && locationId !== '' && (m.locationId ?? '') !== locationId) return false
    if (batchNo != null && batchNo !== '' && str(m.batchNo) !== str(batchNo)) return false
    return true
  })
  return computeServerBalance(filtered, warehouseId, itemId)
}

function postSalesIssueDoc(warehouse, spec, actor, now) {
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const date = str(spec.date).slice(0, 10)
  const documents = warehouse.documents ?? []
  const number = nextServerDocumentNumber(documents, 'issue', spec.warehouseId, date)
  const lines = (spec.lines ?? []).map((line) => ({
    lineId: `wdl-${crypto.randomUUID()}`,
    itemId: line.itemId,
    quantity: roundQty(line.quantity),
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    locationId: line.locationId,
    unitSnapshot: line.unitSnapshot,
  }))
  const doc = {
    id: documentId,
    type: 'issue',
    purpose: 'loading',
    docRole: 'finished_goods_shipment',
    warehouseId: spec.warehouseId,
    date,
    number,
    lines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    shipmentId: spec.shipmentId,
    salesOrderId: spec.salesOrderId,
    salesLineId: spec.salesLineId,
    finishedGoodsLotId: spec.finishedGoodsLotId,
    ...(spec.docExtra ?? {}),
  }
  const movements = lines.map((line) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId,
    documentLineId: line.lineId,
    warehouseId: spec.warehouseId,
    locationId: line.locationId,
    itemId: line.itemId,
    quantity: line.quantity,
    type: 'issue',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    unitSnapshot: line.unitSnapshot,
    shipmentId: spec.shipmentId,
    finishedGoodsLotId: spec.finishedGoodsLotId,
    salesOrderId: spec.salesOrderId,
    salesLineId: spec.salesLineId,
    commandFingerprint: spec.commandFingerprint,
    isFinishedGoods: true,
  }))
  return {
    warehouse: {
      ...warehouse,
      documents: [...documents, doc],
      movements: [...(warehouse.movements ?? []), ...movements],
    },
    documentId,
    number,
  }
}

function reverseMovementType(type) {
  if (type === 'issue' || type === 'out') return 'receipt'
  if (type === 'receipt' || type === 'in') return 'issue'
  return null
}

function reverseSalesShipmentDoc(
  warehouse,
  doc,
  actor,
  now,
  { reason, date = now.slice(0, 10), commandFingerprint } = {},
) {
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const related = (warehouse.movements ?? []).filter((m) => m.documentId === doc.id && !m.cancelled)
  const reversed = []
  for (const mov of related) {
    const type = reverseMovementType(mov.type)
    if (!type) continue
    const quantity = Math.abs(Number(mov.quantity) || 0)
    if (quantity <= EPS) continue
    reversed.push({ mov, type, quantity })
  }
  if (reversed.length === 0) {
    return { warehouse, reverseDocumentId: null, skipped: true }
  }
  const reversalLines = reversed.map((r) => ({
    lineId: `wdl-${crypto.randomUUID()}`,
    itemId: r.mov.itemId,
    quantity: r.quantity,
    batchNo: r.mov.batchNo,
    expiryDate: r.mov.expiryDate,
    locationId: r.mov.locationId,
    unitSnapshot: r.mov.unitSnapshot,
  }))
  const revDoc = {
    id: documentId,
    type: doc.type === 'issue' ? 'receipt' : doc.type,
    purpose: doc.purpose,
    docRole: 'finished_goods_shipment_cancel',
    warehouseId: doc.warehouseId,
    date,
    number: `${doc.number || 'DOC'}-R`,
    lines: reversalLines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    reversesDocumentId: doc.id,
    shipmentId: doc.shipmentId,
    salesOrderId: doc.salesOrderId,
    salesLineId: doc.salesLineId,
    finishedGoodsLotId: doc.finishedGoodsLotId,
    cancellationReason: reason,
    commandFingerprint,
  }
  const movements = reversed.map((r, index) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId,
    documentLineId: reversalLines[index].lineId,
    warehouseId: doc.warehouseId,
    locationId: r.mov.locationId,
    itemId: r.mov.itemId,
    quantity: r.quantity,
    type: r.type,
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: r.mov.batchNo,
    expiryDate: r.mov.expiryDate,
    unitSnapshot: r.mov.unitSnapshot,
    reversesMovementId: r.mov.id,
    shipmentId: doc.shipmentId,
    finishedGoodsLotId: r.mov.finishedGoodsLotId,
    salesOrderId: r.mov.salesOrderId ?? doc.salesOrderId,
    salesLineId: r.mov.salesLineId ?? doc.salesLineId,
    commandFingerprint,
    isFinishedGoods: true,
  }))
  return {
    warehouse: {
      ...warehouse,
      documents: [...(warehouse.documents ?? []), revDoc],
      movements: [...(warehouse.movements ?? []), ...movements],
    },
    reverseDocumentId: documentId,
  }
}

function applySalesShipmentPost(domains, command, actor, now) {
  const { sales, production, warehouse } = domains
  const salesOrderId = str(command.salesOrderId)
  const salesLineId = str(command.salesLineId)
  const shipmentId = str(command.shipmentId)
  if (!shipmentId || !salesOrderId || !salesLineId) return fail('invalid_input', 400)

  const existingMatches = (warehouse.loadingShipments ?? []).filter(
    (row) => str(row.id) === shipmentId,
  )
  if (existingMatches.length > 1) return shipmentStateMismatch('shipment_cardinality')
  const existingShp = existingMatches[0] ?? null
  if (existingShp?.status === 'posted' || existingShp?.status === 'cancelled') {
    const existingOrder = findById(sales.orders, existingShp.salesOrderId)
    const existingLine = (existingOrder?.lines ?? []).find(
      (line) => str(line.lineId ?? line.id) === str(existingShp.salesLineId),
    )
    const existingLot = findFgLot(production, existingShp.finishedGoodsLotId)
    const replaySemantic = effectiveShipmentPostSemantic(command, {
      shipment: existingShp,
      order: existingOrder,
      line: existingLine,
      lot: existingLot,
      now,
    })
    const replayFingerprint = shipmentCommandFingerprint(replaySemantic)
    if (existingShp.status === 'posted') {
      return validatePostedShipmentState(domains, replaySemantic, replayFingerprint, {
        idempotent: true,
      })
    }
    if (
      str(existingShp.postCommandFingerprint ?? existingShp.commandFingerprint) !==
      replayFingerprint
    ) {
      return fail('sales_shipment_idempotency_conflict', 409)
    }
    return fail('shipment_immutable', 409)
  }

  const order = findById(sales.orders, salesOrderId)
  if (!order) return fail('sales_order_not_found', 404)
  const line = (order.lines ?? []).find((l) => str(l.lineId) === salesLineId)
  if (!line) return fail('sales_line_not_found', 404)
  if (
    !finiteNonNegative(line.quantity) ||
    !finiteNonNegative(line.shippedQty) ||
    !finiteNonNegative(line.remainingQty)
  ) {
    return shipmentStateMismatch('sales_line_quantities')
  }

  const finishedProductId = str(command.finishedProductId || line.finishedProductId)
  const lotId = str(command.finishedGoodsLotId ?? command.lotId)
  const quantityRaw = num(command.quantity)
  if (!finishedProductId || !lotId) return fail('invalid_input', 400)

  const lot = findFgLot(production, lotId)
  if (!lot) return fail('lot_not_found', 404)
  if (
    !finiteNonNegative(lot.quantityQcReleased) ||
    !finiteNonNegative(lot.quantityShipped) ||
    !finiteNonNegative(lot.quantityRemaining)
  ) {
    return shipmentStateMismatch('lot_quantities')
  }
  const semantic = effectiveShipmentPostSemantic(command, {
    shipment: existingShp,
    order,
    line,
    lot,
    now,
  })
  const commandFingerprint = shipmentCommandFingerprint(semantic)
  if (!semantic.counterpartyId || semantic.counterpartyId !== str(order.customerId)) {
    return fail('counterparty_mismatch', 400)
  }

  if (order.status === 'draft' || order.status === 'cancelled' || order.status === 'fulfilled') {
    return fail('invalid_status', 409)
  }
  if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return fail('invalid_quantity', 400)
  const quantity = roundQty(quantityRaw)
  if (quantity <= EPS) return fail('invalid_quantity', 400)
  if (!DATE_RE.test(semantic.date)) return fail('invalid_date', 400)

  if (str(line.finishedProductId) !== finishedProductId) {
    return fail('finished_product_mismatch', 400)
  }

  const explicitRemaining = num(line.remainingQty)
  const remainLine = roundQty(
    Number.isFinite(explicitRemaining)
      ? explicitRemaining
      : Math.max(0, (num(line.quantity) || 0) - (num(line.shippedQty) || 0)),
  )
  if (quantity > remainLine + EPS) {
    return fail('quantity_exceeds_sales_remaining', 400, { remaining: remainLine })
  }

  if (str(lot.finishedProductId) !== finishedProductId) return fail('lot_item_mismatch', 400)

  if (lot.qcStatus !== 'released') return fail('lot_not_released', 400, { qcStatus: lot.qcStatus })
  const decision = (production.qcDecisions ?? []).find((d) => d.id === str(lot.currentDecisionId))
  if (!decision || decision.status !== 'released') return fail('qc_decision_missing', 409)
  if (Number(decision.lotRevision) !== Number(lot.lotRevision)) {
    return fail('qc_decision_stale', 409, {
      decisionLotRevision: decision.lotRevision,
      lotRevision: lot.lotRevision,
    })
  }
  if (str(decision.lotId) !== str(lot.id)) return fail('qc_decision_missing', 409)

  const released = roundQty(num(lot.quantityQcReleased) || 0)
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  const remainingLot = roundQty(released - shipped)
  if (remainingLot <= EPS) return fail('quantity_exceeds_remaining', 400, { remaining: 0 })
  if (quantity > remainingLot + EPS) {
    return fail('quantity_exceeds_remaining', 400, { remaining: remainingLot })
  }

  const date = semantic.date
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const warehouseId = semantic.warehouseId
  if (!warehouseId) return fail('invalid_warehouse', 400)
  if (warehouseId !== str(lot.warehouseId)) return fail('lot_warehouse_mismatch', 400)
  const locationId = str(lot.locationId) || undefined
  const stockItemId = str(lot.warehouseItemId || lot.itemId || finishedProductId)
  const stockItem = findById(warehouse.items, stockItemId)
  const unitSnapshot = str(lot.unitSnapshot ?? stockItem?.unit ?? stockItem?.baseUnit) || 'm2'
  const onHand = balanceAtLot(warehouse.movements, {
    warehouseId,
    locationId,
    itemId: stockItemId,
    batchNo: lot.lotNumber,
  })
  if (quantity > onHand + EPS) {
    return fail('insufficient_stock', 400, { available: roundQty(onHand), requested: quantity })
  }

  const posted = postSalesIssueDoc(
    warehouse,
    {
      warehouseId,
      date,
      shipmentId,
      salesOrderId,
      salesLineId,
      finishedGoodsLotId: lot.id,
      commandFingerprint,
      lines: [
        {
          itemId: stockItemId,
          quantity,
          batchNo: lot.lotNumber,
          locationId,
          unitSnapshot,
        },
      ],
      docExtra: {
        qcDecisionId: decision.id,
        isFinishedGoods: true,
        counterpartyId: semantic.counterpartyId || undefined,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  let wh = posted.warehouse

  const nextShippedLot = roundQty(shipped + quantity)
  const nextLot = {
    ...lot,
    quantityShipped: nextShippedLot,
    quantityRemaining: roundQty(released - nextShippedLot),
    lastShipmentId: shipmentId,
    lastShippedAt: now,
    history: lotHistoryEntry(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'shipped',
      message: `${quantity} via ${shipmentId} (sales ${salesOrderId}/${salesLineId})`,
      actorUid: actor.uid,
    }),
  }

  const shipment = {
    ...(existingShp ?? {}),
    id: shipmentId,
    status: 'posted',
    kind: 'finished_goods_shipment',
    groupKind: 'finished_goods_shipment',
    date,
    warehouseId,
    locationId,
    finishedProductId,
    warehouseItemId: stockItemId,
    unitSnapshot,
    finishedGoodsLotId: lot.id,
    lotNumber: lot.lotNumber,
    quantity,
    salesOrderId,
    salesLineId,
    counterpartyId: semantic.counterpartyId || undefined,
    qcDecisionId: decision.id,
    lotRevisionAtPost: Number(lot.lotRevision) || 1,
    commandFingerprint,
    postCommandFingerprint: commandFingerprint,
    documentIds: [posted.documentId],
    createdAt: existingShp?.createdAt ?? now,
    createdBy: existingShp?.createdBy ?? actor.uid,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    updatedAt: now,
  }
  wh = replaceLoadingShipment(wh, shipment)
  wh = appendAudit(
    wh,
    auditEntry('sales_shipment_post', actor, now, shipmentId, { salesOrderId, salesLineId, quantity }),
  )

  let prod = replaceFgLot(production, nextLot)
  prod = appendAudit(
    prod,
    auditEntry('sales_shipment_post', actor, now, shipmentId, { lotId: lot.id, quantity }),
  )

  const nextShippedLine = roundQty((num(line.shippedQty) || 0) + quantity)
  const nextRemainingLine = roundQty(Math.max(0, (num(line.quantity) || 0) - nextShippedLine))
  const nextLines = (order.lines ?? []).map((ln) =>
    str(ln.lineId) === salesLineId
      ? { ...ln, shippedQty: nextShippedLine, remainingQty: nextRemainingLine }
      : ln,
  )
  const allShipped = nextLines.every(
    (l) => (num(l.shippedQty) || 0) + EPS >= (num(l.quantity) || 0),
  )
  const anyShipped = nextLines.some((l) => (num(l.shippedQty) || 0) > EPS)
  let nextStatus = order.status
  if (allShipped) nextStatus = 'fulfilled'
  else if (anyShipped) nextStatus = 'partially_shipped'

  const nextOrder = {
    ...order,
    lines: nextLines,
    status: nextStatus,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextSales = { ...sales, orders: upsertById(sales.orders, nextOrder) }
  nextSales = appendAudit(
    nextSales,
    auditEntry('sales_shipment_post', actor, now, salesOrderId, { shipmentId, salesLineId, quantity }),
  )

  return validatePostedShipmentState(
    { sales: nextSales, production: prod, warehouse: wh },
    semantic,
    commandFingerprint,
  )
}

function applySalesShipmentCancel(domains, command, actor, now) {
  const { sales, production, warehouse } = domains
  const shipmentId = str(command.shipmentId)
  const reason = str(command.reason ?? command.cancellationReason)
  if (!shipmentId) return fail('invalid_input', 400)
  if (!reason) return fail('cancel_reason_required', 400)

  const shipmentMatches = (warehouse.loadingShipments ?? []).filter(
    (row) => str(row.id) === shipmentId,
  )
  if (shipmentMatches.length === 0) return fail('not_found', 404)
  if (shipmentMatches.length !== 1) return shipmentStateMismatch('shipment_cardinality')
  const shipment = shipmentMatches[0]
  const semantic = effectiveShipmentCancelSemantic(command, shipment, now)
  const commandFingerprint = shipmentCommandFingerprint(semantic)
  if (shipment.status === 'cancelled') {
    return validateCancelledShipmentState(domains, semantic, commandFingerprint, {
      idempotent: true,
    })
  }
  if (shipment.status !== 'posted') return fail('shipment_not_posted', 409)

  const date = semantic.date
  if (!DATE_RE.test(date)) return fail('invalid_date', 400)
  if (isPeriodClosed(warehouse, shipment.date || date) || isPeriodClosed(warehouse, date)) {
    return fail('period_closed', 403)
  }

  const lot = findFgLot(production, shipment.finishedGoodsLotId)
  if (!lot) return fail('lot_not_found', 404)
  if (lot.qcStatus !== 'released') {
    return fail('shipment_cancel_incompatible', 409, { qcStatus: lot.qcStatus })
  }
  const quantity = roundQty(num(shipment.quantity) || 0)
  if (quantity <= EPS) return fail('invalid_quantity', 400)
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  if (quantity > shipped + EPS) return fail('quantity_exceeds_shipped', 400)

  const documentIds = Array.isArray(shipment.documentIds)
    ? shipment.documentIds.map(str).filter(Boolean)
    : []
  if (documentIds.length !== 1 || new Set(documentIds).size !== 1) {
    return fail('sales_shipment_single_lot_required', 409)
  }
  const sourceDocuments = (warehouse.documents ?? []).filter(
    (doc) => str(doc.id) === documentIds[0] && str(doc.shipmentId) === shipmentId,
  )
  const shipmentDocuments = (warehouse.documents ?? []).filter(
    (doc) => str(doc.shipmentId) === shipmentId,
  )
  if (
    sourceDocuments.length !== 1 ||
    shipmentDocuments.length !== 1 ||
    str(shipmentDocuments[0].id) !== documentIds[0] ||
    sourceDocuments[0].status !== 'posted' ||
    sourceDocuments[0].docRole !== 'finished_goods_shipment' ||
    (warehouse.documents ?? []).some((doc) => str(doc.reversesDocumentId) === documentIds[0])
  ) {
    return fail('shipment_documents_missing', 409)
  }
  const sourceMovements = (warehouse.movements ?? []).filter(
    (movement) => str(movement.documentId) === documentIds[0],
  )
  const shipmentMovements = (warehouse.movements ?? []).filter(
    (movement) => str(movement.shipmentId) === shipmentId,
  )
  if (
    sourceMovements.length !== 1 ||
    shipmentMovements.length !== 1 ||
    str(shipmentMovements[0].id) !== str(sourceMovements[0].id) ||
    sourceMovements[0].cancelled === true ||
    !finitePositive(sourceMovements[0].quantity)
  ) {
    return fail('sales_shipment_single_lot_required', 409)
  }

  const salesOrderId = str(shipment.salesOrderId)
  const salesLineId = str(shipment.salesLineId)
  const order = findById(sales.orders, salesOrderId)
  if (!order || order.status === 'cancelled') return shipmentStateMismatch('sales_order')
  const salesLine = (order.lines ?? []).find((line) => str(line.lineId ?? line.id) === salesLineId)
  if (!salesLine) return shipmentStateMismatch('sales_line')

  const rev = reverseSalesShipmentDoc(warehouse, sourceDocuments[0], actor, now, {
    reason,
    date,
    commandFingerprint,
  })
  if (!rev.reverseDocumentId) return fail('shipment_documents_missing', 409)
  let wh = rev.warehouse
  const reversalDocumentIds = [rev.reverseDocumentId]

  const released = roundQty(num(lot.quantityQcReleased) || 0)
  const nextShippedLot = roundQty(shipped - quantity)
  const nextLot = {
    ...lot,
    quantityShipped: nextShippedLot,
    quantityRemaining: roundQty(released - nextShippedLot),
    history: lotHistoryEntry(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'shipment_cancelled',
      message: `${quantity} via ${shipmentId}: ${reason}`,
      actorUid: actor.uid,
    }),
  }

  const cancelled = {
    ...shipment,
    status: 'cancelled',
    groupKind: 'finished_goods_shipment_cancel',
    reversalDocumentIds,
    cancelledAt: now,
    cancelledBy: actor.uid,
    cancelledByName: actor.email ?? actor.uid,
    cancellationReason: reason,
    cancellationDate: date,
    cancelCommandFingerprint: commandFingerprint,
    updatedAt: now,
  }
  wh = replaceLoadingShipment(wh, cancelled)
  wh = appendAudit(wh, auditEntry('sales_shipment_cancel', actor, now, shipmentId, { reason }))

  let prod = replaceFgLot(production, nextLot)
  prod = appendAudit(prod, auditEntry('sales_shipment_cancel', actor, now, shipmentId, { reason }))

  const nextLines = (order.lines ?? []).map((ln) => {
    if (str(ln.lineId ?? ln.id) !== salesLineId) return ln
    const nextShipped = roundQty(Math.max(0, (num(ln.shippedQty) || 0) - quantity))
    return {
      ...ln,
      shippedQty: nextShipped,
      remainingQty: roundQty(Math.max(0, (num(ln.quantity) || 0) - nextShipped)),
    }
  })
  const nextStatus = expectedShipmentSalesStatus(nextLines)
  const nextOrder = {
    ...order,
    lines: nextLines,
    status: nextStatus,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  let nextSales = { ...sales, orders: upsertById(sales.orders, nextOrder) }
  nextSales = appendAudit(
    nextSales,
    auditEntry('sales_shipment_cancel', actor, now, salesOrderId, { shipmentId, reason }),
  )

  return validateCancelledShipmentState(
    { sales: nextSales, production: prod, warehouse: wh },
    semantic,
    commandFingerprint,
  )
}

// ---------------------------------------------------------------------------
// Domain activation
// ---------------------------------------------------------------------------

function applyActivate(domain, label, actor, now, reason) {
  let next = appendAudit(domain, auditEntry(`${label}_domain_activate`, actor, now, reason || 'activate'))
  return next
}

function genericG5CommandFingerprint(commandType, command) {
  return `g5:${commandType}:v1:sha256:${sha256Stable(command)}`
}

function g5ReplayConflictError(commandType) {
  if (commandType === 'sales.shipment.cancel') return 'sales_shipment_cancel_idempotency_conflict'
  if (commandType === 'sales.shipment.post') return 'sales_shipment_idempotency_conflict'
  if (commandType === 'procurement.draft.create') {
    return 'procurement_draft_create_idempotency_conflict'
  }
  if (commandType === 'procurement.receipt.post') {
    return 'procurement_receipt_idempotency_conflict'
  }
  return 'g5_idempotency_conflict'
}

function g5ReceiptMatches(receipt, commandType, commandFingerprint) {
  if (
    (commandType === 'sales.shipment.post' || commandType === 'sales.shipment.cancel') &&
    !commandFingerprint
  ) {
    // Some visible UI commands omit authority-owned tuple fields (for example
    // counterpartyId). The shipment revalidator derives and compares the full
    // canonical fingerprint from current state below.
    return receipt?.commandType === commandType
  }
  return (
    receipt?.commandType === commandType &&
    Boolean(commandFingerprint) &&
    receipt?.result?.commandFingerprint === commandFingerprint
  )
}

// ---------------------------------------------------------------------------
// executeG5Command
// ---------------------------------------------------------------------------

export async function executeG5Command(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = str(input.storeId)
  const idempotencyKey = str(input.idempotencyKey)
  const commandType = str(input.commandType)
  const rawCommand = stripClientTrusted(input.command)
  const strictShipmentReplay =
    commandType === 'sales.shipment.post' || commandType === 'sales.shipment.cancel'
  const strictProcurementReplay =
    commandType === 'procurement.draft.create' ||
    commandType === 'procurement.receipt.post'
  const explicitShipmentFingerprint = strictShipmentReplay
    ? explicitShipmentCommandFingerprint(commandType, rawCommand)
    : null
  const explicitProcurementFingerprint = strictProcurementReplay
    ? explicitProcurementCommandFingerprint(commandType, rawCommand)
    : null
  const expectedCommandFingerprint = strictShipmentReplay
    ? explicitShipmentFingerprint
    : strictProcurementReplay
      ? explicitProcurementFingerprint
      : genericG5CommandFingerprint(commandType, rawCommand)

  if (!storeId || !idempotencyKey || !commandType) return fail('invalid_input', 400)
  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }
  if (input.command?.roleId != null || input.roleId != null) {
    return fail('client_role_forbidden', 400)
  }

  const needed = CAP_BY_COMMAND[commandType]
  if (!needed) return fail('unknown_command', 400)

  const perm = await requirePrincipal(actor.uid, storeId, needed, {
    actor,
    emergencyReason: rawCommand.emergencyReason,
  })
  if (!perm.ok) return perm

  const dc = getG1DataConnect()
  const receipt = await loadReceipt(dc, idempotencyKey, storeId)
  if (receipt?.conflict) return fail('not_found', 404)
  if (receipt?.corrupt) return fail('receipt_corrupt', 500)
  if (receipt?.result && !g5ReceiptMatches(receipt, commandType, expectedCommandFingerprint)) {
    return fail(g5ReplayConflictError(commandType), 409)
  }

  const critical = await loadCritical(storeId, actor.uid, {
    allowInitialize:
      commandType === 'masterdata.domain.activate' ||
      commandType === 'sales.domain.activate' ||
      commandType === 'procurement.domain.activate',
  })
  if (!critical.ok) return critical

  const embedded = embeddedReceipt(critical.payload, idempotencyKey)
  if (embedded?.result && !g5ReceiptMatches(embedded, commandType, expectedCommandFingerprint)) {
    return fail(g5ReplayConflictError(commandType), 409)
  }
  if (!strictShipmentReplay && !strictProcurementReplay && (receipt?.result || embedded?.result)) {
    const source = receipt?.result ?? embedded?.result
    if (!validateG5ReplayGuard(critical.payload, source?.replayGuard)) {
      return fail('g5_receipt_state_mismatch', 409)
    }
    const recovered = !receipt?.result && Boolean(embedded?.result)
    const result = currentG5ReplayProjection(
      source,
      critical,
      expectedCommandFingerprint,
      recovered,
    )
    if (recovered) {
      await saveReceipt(
        dc,
        idempotencyKey,
        storeId,
        commandType,
        actor.uid,
        result,
        critical.revision,
      )
    }
    return ok(result)
  }

  let warehouse = structuredClone(critical.payload.domains.warehouse)
  let production = structuredClone(critical.payload.domains.production)
  let masterData = ensureDomain(critical.payload.domains.masterData, emptyMaster)
  let sales = ensureDomain(critical.payload.domains.sales, emptySales)
  let planning = ensureDomain(critical.payload.domains.planning, emptyPlanning)
  let procurement = ensureDomain(critical.payload.domains.procurement, emptyProcurement)

  const now = new Date().toISOString()
  const masterActive = isMasterDataDomainActive(critical.payload)
  const salesActive = isSalesPlanningActive(critical.payload)
  const procActive = isProcurementDomainActive(critical.payload)
  const whActive = isWarehouseDomainActive(critical.payload, critical.revision)

  // PHASE R1 — frozen domains reject writes (activate included; already-active+frozen)
  if (commandType.startsWith('masterdata.') && isDomainFrozen(critical.payload, 'masterData')) {
    return fail('domain_frozen', 409)
  }
  if (
    (commandType.startsWith('sales.') || commandType.startsWith('planning.')) &&
    isDomainFrozen(critical.payload, 'salesPlanning')
  ) {
    return fail('domain_frozen', 409)
  }
  if (commandType.startsWith('procurement.') && isDomainFrozen(critical.payload, 'procurement')) {
    return fail('domain_frozen', 409)
  }

  if (perm.emergency) {
    // Audit emergency use on the primary domain being mutated
    const note = `emergency:${perm.emergencyReason}`
    if (commandType.startsWith('masterdata.')) {
      masterData = appendAudit(masterData, auditEntry('g5_emergency', actor, now, note))
    } else if (commandType.startsWith('sales.') || commandType.startsWith('planning.')) {
      sales = appendAudit(sales, auditEntry('g5_emergency', actor, now, note))
    } else if (commandType.startsWith('procurement.')) {
      procurement = appendAudit(procurement, auditEntry('g5_emergency', actor, now, note))
    }
  }

  // --- Activation commands ---
  if (commandType === 'masterdata.domain.activate') {
    const reason = str(rawCommand.reason ?? rawCommand.emergencyReason)
    if (perm.emergency && !reason) return fail('emergency_reason_required', 400)
    if (masterActive) {
      return ok({
        criticalRevision: critical.revision,
        masterDataActive: true,
        idempotent: true,
        masterData,
      })
    }
    masterData = applyActivate(masterData, 'masterdata', actor, now, reason)
    const resultPreview = {
      masterDataActive: true,
      reason: reason || undefined,
      commandFingerprint: expectedCommandFingerprint,
      replayGuard: activationReplayGuard('masterData'),
      masterData,
    }
    const committed = await casCommitG5(dc, storeId, critical, actor.uid, {
      masterData,
      warehouse,
      production,
      sales,
      planning,
      procurement,
      idempotencyKey,
      commandType,
      result: resultPreview,
      activateMasterData: true,
    })
    if (!committed.ok) return committed
    const result = { ...resultPreview, criticalRevision: committed.criticalRevision }
    await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
    return ok(result)
  }

  if (commandType === 'sales.domain.activate') {
    const reason = str(rawCommand.reason ?? rawCommand.emergencyReason)
    if (perm.emergency && !reason) return fail('emergency_reason_required', 400)
    if (salesActive) {
      return ok({
        criticalRevision: critical.revision,
        salesPlanningActive: true,
        idempotent: true,
        sales,
        planning,
      })
    }
    sales = applyActivate(sales, 'sales', actor, now, reason)
    planning = applyActivate(planning, 'planning', actor, now, reason)
    const resultPreview = {
      salesPlanningActive: true,
      reason: reason || undefined,
      commandFingerprint: expectedCommandFingerprint,
      replayGuard: activationReplayGuard('salesPlanning'),
      sales,
      planning,
    }
    const committed = await casCommitG5(dc, storeId, critical, actor.uid, {
      masterData,
      warehouse,
      production,
      sales,
      planning,
      procurement,
      idempotencyKey,
      commandType,
      result: resultPreview,
      activateSalesPlanning: true,
    })
    if (!committed.ok) return committed
    const result = { ...resultPreview, criticalRevision: committed.criticalRevision }
    await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
    return ok(result)
  }

  if (commandType === 'procurement.domain.activate') {
    const reason = str(rawCommand.reason ?? rawCommand.emergencyReason)
    if (perm.emergency && !reason) return fail('emergency_reason_required', 400)
    if (procActive) {
      return ok({
        criticalRevision: critical.revision,
        procurementActive: true,
        idempotent: true,
        procurement,
      })
    }
    procurement = applyActivate(procurement, 'procurement', actor, now, reason)
    const resultPreview = {
      procurementActive: true,
      reason: reason || undefined,
      commandFingerprint: expectedCommandFingerprint,
      replayGuard: activationReplayGuard('procurement'),
      procurement,
    }
    const committed = await casCommitG5(dc, storeId, critical, actor.uid, {
      masterData,
      warehouse,
      production,
      sales,
      planning,
      procurement,
      idempotencyKey,
      commandType,
      result: resultPreview,
      activateProcurement: true,
    })
    if (!committed.ok) return committed
    const result = { ...resultPreview, criticalRevision: committed.criticalRevision }
    await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
    return ok(result)
  }

  // --- Domain gates ---
  if (commandType.startsWith('masterdata.') && !masterActive) {
    return fail('masterdata_domain_inactive', 409)
  }
  if (
    (commandType.startsWith('sales.') || commandType.startsWith('planning.')) &&
    !salesActive
  ) {
    return fail('sales_planning_inactive', 409)
  }
  if (commandType.startsWith('procurement.') && !procActive) {
    return fail('procurement_domain_inactive', 409)
  }
  if (commandType === 'procurement.receipt.post' && !whActive) {
    return fail('warehouse_domain_inactive', 409)
  }
  if (
    (commandType === 'sales.shipment.post' || commandType === 'sales.shipment.cancel') &&
    !whActive
  ) {
    return fail('warehouse_domain_inactive', 409)
  }
  if (
    (commandType === 'procurement.receipt.post' ||
      commandType === 'sales.shipment.post' ||
      commandType === 'sales.shipment.cancel') &&
    isDomainFrozen(critical.payload, 'warehouse', critical.revision)
  ) {
    return fail('domain_frozen', 409)
  }

  let applied
  let touchWarehouse = false
  let touchProduction = false
  let activateFlags = {}

  if (commandType === 'masterdata.item.upsert') {
    applied = applyItemUpsert(masterData, rawCommand, actor, now, {
      strict: isStagingIsolatedRuntime(),
      warehouse,
    })
  } else if (commandType === 'masterdata.item.archive') {
    applied = applyMasterArchive(masterData, 'item', rawCommand, actor, now)
  } else if (commandType === 'masterdata.product.upsert') {
    applied = applyProductUpsert(masterData, rawCommand, actor, now, {
      strict: isStagingIsolatedRuntime(),
    })
  } else if (commandType === 'masterdata.product.archive') {
    applied = applyMasterArchive(masterData, 'product', rawCommand, actor, now)
  } else if (commandType === 'masterdata.customer.upsert') {
    applied = applyCustomerUpsert(masterData, rawCommand, actor, now)
  } else if (commandType === 'masterdata.customer.archive') {
    applied = applyMasterArchive(masterData, 'customer', rawCommand, actor, now)
  } else if (commandType === 'masterdata.supplier.upsert') {
    applied = applySupplierUpsert(masterData, rawCommand, actor, now)
  } else if (commandType === 'masterdata.supplier.archive') {
    applied = applyMasterArchive(masterData, 'supplier', rawCommand, actor, now)
  } else if (commandType === 'masterdata.bom.upsert') {
    applied = applyBomUpsert(masterData, rawCommand, actor, now)
  } else if (commandType === 'masterdata.bom.approve') {
    applied = applyBomApprove(masterData, planning, rawCommand, actor, now)
  } else if (commandType === 'masterdata.bom.archive' || commandType === 'masterdata.bom.retire') {
    applied = applyBomArchive(masterData, rawCommand, actor, now)
  } else if (commandType === 'sales.order.draft.save') {
    applied = applySalesDraftSave(sales, masterData, production, rawCommand, actor, now)
  } else if (commandType === 'sales.order.draft.delete') {
    applied = applySalesDraftDelete(sales, rawCommand, actor, now)
  } else if (commandType === 'sales.order.confirm') {
    applied = applySalesConfirm(sales, masterData, planning, production, rawCommand, actor, now)
  } else if (commandType === 'sales.order.change') {
    applied = applySalesChange(sales, masterData, planning, rawCommand, actor, now)
  } else if (commandType === 'sales.order.cancel') {
    applied = applySalesCancel(sales, planning, rawCommand, actor, now)
  } else if (commandType === 'sales.order.priority.set') {
    applied = applySalesPriority(sales, rawCommand, actor, now)
  } else if (commandType === 'sales.fulfillment.syncFromShipments') {
    applied = applyFulfillmentSync(sales, warehouse, rawCommand, actor, now)
  } else if (commandType === 'sales.shipment.post') {
    applied = applySalesShipmentPost(
      { sales, production, warehouse },
      rawCommand,
      actor,
      now,
    )
    touchWarehouse = true
    touchProduction = true
  } else if (commandType === 'sales.shipment.cancel') {
    applied = applySalesShipmentCancel(
      { sales, production, warehouse },
      rawCommand,
      actor,
      now,
    )
    touchWarehouse = true
    touchProduction = true
  } else if (commandType === 'planning.mrp.run') {
    applied = applyMrpRun(
      { masterData, sales, planning, procurement, warehouse, production },
      actor,
      now,
      critical.revision,
      rawCommand,
    )
  } else if (commandType === 'planning.mrp.acceptProductionDrafts') {
    applied = applyAcceptProductionDrafts(planning, masterData, rawCommand, actor, now)
  } else if (commandType === 'planning.shortage.acknowledge') {
    applied = applyShortageStatus(planning, rawCommand, actor, now, 'acknowledged')
  } else if (commandType === 'planning.shortage.resolveManual') {
    applied = applyShortageStatus(planning, rawCommand, actor, now, 'resolved')
  } else if (commandType === 'planning.productionRecommendation.createManual') {
    applied = applyManualRecommendation(planning, masterData, rawCommand, actor, now)
  } else if (commandType === 'procurement.generateDraftsFromMrp') {
    applied = applyGenerateDraftsFromMrp(procurement, planning, masterData, rawCommand, actor, now)
  } else if (commandType === 'procurement.draft.create') {
    applied = applyProcurementDraftCreate(
      procurement,
      warehouse,
      masterData,
      rawCommand,
      actor,
      now,
    )
  } else if (commandType === 'procurement.draft.edit') {
    applied = applyProcurementDraftEdit(procurement, warehouse, masterData, rawCommand, actor, now)
  } else if (commandType === 'procurement.order.change') {
    applied = applyProcurementOrderChange(procurement, masterData, rawCommand, actor, now)
  } else if (commandType === 'procurement.order.submit') {
    applied = applyProcurementStatus(procurement, rawCommand, actor, now, 'submitted', new Set(['draft']))
  } else if (commandType === 'procurement.order.approve') {
    applied = applyProcurementStatus(
      procurement,
      rawCommand,
      actor,
      now,
      'approved',
      new Set(['submitted']),
    )
  } else if (commandType === 'procurement.order.markOrdered') {
    applied = applyProcurementStatus(
      procurement,
      rawCommand,
      actor,
      now,
      'ordered',
      new Set(['approved']),
    )
  } else if (commandType === 'procurement.order.cancel') {
    applied = applyProcurementStatus(
      procurement,
      rawCommand,
      actor,
      now,
      'cancelled',
      new Set(['draft', 'submitted', 'approved', 'ordered', 'partially_received']),
    )
  } else if (commandType === 'procurement.receipt.post') {
    applied = applyProcurementReceipt(procurement, warehouse, masterData, rawCommand, actor, now)
    touchWarehouse = true
  } else if (commandType === 'procurement.payment.record') {
    applied = applyPaymentRecord(procurement, rawCommand, actor, now)
  } else {
    return fail('unknown_command', 400)
  }

  if (!applied.ok) {
    if (
      strictShipmentReplay &&
      (receipt?.result || embedded?.result) &&
      applied.error !== 'sales_shipment_idempotency_conflict' &&
      applied.error !== 'sales_shipment_cancel_idempotency_conflict'
    ) {
      return fail('sales_shipment_receipt_state_mismatch', 409)
    }
    return applied
  }

  if (applied.masterData) masterData = applied.masterData
  if (applied.sales) sales = applied.sales
  if (applied.planning) planning = applied.planning
  if (applied.procurement) procurement = applied.procurement
  if (applied.production) {
    production = applied.production
    touchProduction = true
  }
  if (applied.warehouse) {
    warehouse = applied.warehouse
    touchWarehouse = true
  }

  const warehouseBeforeHash = stableDomainHash(critical.payload.domains.warehouse)
  const touchesWarehouse =
    touchWarehouse || warehouseBeforeHash !== stableDomainHash(warehouse)
  const replayGuard = appendG5ReplayDependencies(
    buildG5ReplayGuard(critical.payload.domains, {
      ...critical.payload.domains,
      warehouse,
      production,
      masterData,
      sales,
      planning,
      procurement,
    }),
    applied.replayDependencies,
  )

  const resultPreview = {
    ...applied.result,
    commandFingerprint:
      applied.result?.commandFingerprint ?? expectedCommandFingerprint,
    replayGuard,
    masterDataActive: masterActive || activateFlags.activateMasterData,
    salesPlanningActive: salesActive,
    procurementActive: procActive,
    packagingQcActive: isPackagingQcFeatureActive(critical.payload),
    productionActive: isProductionDomainActive(critical.payload, critical.revision),
    warehouseActive: whActive,
    masterData,
    sales,
    planning,
    procurement,
    ...(touchProduction ? { production } : {}),
    ...(touchesWarehouse
      ? {
          warehouse: {
            documents: warehouse.documents,
            movements: warehouse.movements,
            loadingShipments: warehouse.loadingShipments,
            auditLog: warehouse.auditLog,
            closedMonths: warehouse.closedMonths,
          },
        }
      : {}),
  }

  if (
    !strictShipmentReplay &&
    !strictProcurementReplay &&
    applied.result?.idempotent === true &&
    replayGuard.entries.length === 0
  ) {
    return ok(
      currentG5ReplayProjection(
        resultPreview,
        critical,
        expectedCommandFingerprint,
        false,
      ),
    )
  }

  const shipmentReplayReceipt = strictShipmentReplay
    ? (receipt?.result ?? embedded?.result)
    : null
  if (
    shipmentReplayReceipt?.commandFingerprint &&
    applied.result?.commandFingerprint &&
    shipmentReplayReceipt.commandFingerprint !== applied.result.commandFingerprint
  ) {
    return fail(
      commandType === 'sales.shipment.cancel'
        ? 'sales_shipment_cancel_idempotency_conflict'
        : 'sales_shipment_idempotency_conflict',
      409,
    )
  }

  const procurementReplayReceipt = strictProcurementReplay
    ? (receipt?.result ?? embedded?.result)
    : null
  if (
    procurementReplayReceipt?.commandFingerprint &&
    applied.result?.commandFingerprint &&
    procurementReplayReceipt.commandFingerprint !== applied.result.commandFingerprint
  ) {
    return fail(
      commandType === 'procurement.draft.create'
        ? 'procurement_draft_create_idempotency_conflict'
        : 'procurement_receipt_idempotency_conflict',
      409,
    )
  }

  if ((strictShipmentReplay || strictProcurementReplay) && applied.result?.idempotent === true) {
    const result = {
      ...resultPreview,
      criticalRevision: critical.revision,
      touchesWarehouse:
        strictShipmentReplay || commandType === 'procurement.receipt.post',
      idempotent: true,
      ...(embedded?.result && !receipt?.result ? { recoveredFromEmbeddedReceipt: true } : {}),
    }
    if (!receipt?.result) {
      await saveReceipt(
        dc,
        idempotencyKey,
        storeId,
        commandType,
        actor.uid,
        result,
        critical.revision,
      )
    }
    return ok(result)
  }

  if (
    (strictShipmentReplay || strictProcurementReplay) &&
    (receipt?.result || embedded?.result)
  ) {
    return fail(
      strictShipmentReplay
        ? 'sales_shipment_receipt_state_mismatch'
        : 'procurement_receipt_state_mismatch',
      409,
    )
  }

  const committed = await casCommitG5(dc, storeId, critical, actor.uid, {
    warehouse: touchesWarehouse ? warehouse : undefined,
    production,
    masterData,
    sales,
    planning,
    procurement,
    idempotencyKey,
    commandType,
    result: resultPreview,
    ...activateFlags,
  })
  if (!committed.ok) return committed

  const result = {
    ...resultPreview,
    criticalRevision: committed.criticalRevision,
    touchesWarehouse,
  }
  await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
  return ok(result)
}

export async function getAuthoritativeG5Domains(storeId) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: str(storeId) })
  const row = data?.fstCriticalStore
  if (!row) {
    return ok({
      revision: 0,
      masterData: null,
      sales: null,
      planning: null,
      procurement: null,
      masterDataActive: false,
      salesPlanningActive: false,
      procurementActive: false,
      packagingQcActive: false,
      warehouseActive: false,
      productionActive: false,
      source: 'missing',
    })
  }
  const parsed = parseCriticalPayload(row.payloadJson, { revision: Number(row.revision) || 0 })
  if (!parsed.ok) return fail(parsed.error, 500)
  const revision = Number(row.revision) || 0
  return ok({
    revision,
    masterData: parsed.payload.domains.masterData,
    sales: parsed.payload.domains.sales,
    planning: parsed.payload.domains.planning,
    procurement: parsed.payload.domains.procurement,
    warehouse: parsed.payload.domains.warehouse,
    production: parsed.payload.domains.production,
    domainMeta: parsed.payload.domainMeta,
    masterDataActive: isMasterDataDomainActive(parsed.payload),
    salesPlanningActive: isSalesPlanningActive(parsed.payload),
    procurementActive: isProcurementDomainActive(parsed.payload),
    source: revision > 0 ? 'fst_critical_store' : 'legacy_empty',
  })
}

export {
  G5_CAPS,
  applyProductUpsert,
  defaultG5Capabilities,
  casCommitG5,
  contentHash,
  packagingBomContentHash,
  loadCritical,
  selectApprovedPackagingBom,
  buildPackagingBomSnapshot,
  computePackagingRequirements,
  bomComponentList,
}
