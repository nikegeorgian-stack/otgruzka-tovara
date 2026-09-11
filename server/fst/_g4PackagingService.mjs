/**
 * PHASE G4 — authoritative packaging / finished-goods lots / QC / shipment gateway.
 *
 * Atomicity: mutate domains.warehouse + domains.production, then ONE
 * UpdateFstCriticalStoreCas (shared `casCommitDomains` with G3).
 *
 * Trust model:
 * - Capabilities come from FstPrincipalAccess.capabilitiesJson only.
 * - Client-sent qcStatus / availableForShipment / movements / roles are stripped.
 * - QC release gate = server-side FstCriticalStore lot + qcDecisions snapshot.
 *   SQL QcLotDecision / QcFinishedGoodsLot rows are read-model projections written
 *   best-effort AFTER a successful CAS; they are never the shipment gate.
 */
import { FST_ADMIN_EMAILS } from './_adminAuth.mjs'
import {
  getFstCommandReceipt,
  getFstCriticalStore,
  getFstPrincipalAccessByUidStore,
  getG1DataConnect,
  insertFstCommandReceipt,
} from './_g1DataConnect.mjs'
import {
  computeServerBalance,
  emptyProductionStore,
  isPackagingQcFeatureActive,
  isPeriodClosed,
  isProductionDomainActive,
  isMasterDataDomainActive,
  isSalesPlanningActive,
  isDomainFrozen,
  markPackagingQcFeatureActive,
  nextReversalNumber,
  nextServerDocumentNumber,
  parseCapabilities,
  parseCriticalPayload,
  stableDomainHash,
} from './_g1CriticalHelpers.mjs'
import {
  allocateBatchesFefoFifo,
  buildBatchLotsFromMovements,
  ordinaryAvailableQty,
} from './_g2BatchAllocation.mjs'
import { hasCapability, normalizeCapabilities } from './_g2Capabilities.mjs'
import { hasLineScope } from './_g3Capabilities.mjs'
import { casCommitDomains } from './_g3ProductionService.mjs'
import { G4_CAPS, hasWarehouseScope } from './_g4Capabilities.mjs'
import {
  canonicalPackagingCommandFingerprint,
  resolveCanonicalPackBinding,
  validateCanonicalFinishedGoodsMapping,
  validateCanonicalPackagingCorrectionBoundary,
  validateCanonicalPackagingWipLineage,
} from './_g4PackagingIntegrity.mjs'
import { comparePackagingActualToNorm } from './_g5PackagingBomHelpers.mjs'
import { isStagingIsolatedRuntime } from './_dataConnectRuntime.mjs'
import {
  g4CriticalMutationCommandFingerprint,
  isG4CriticalMutationCommand,
} from '../../src/lib/production/g4CriticalMutationIntegrityCore.mjs'
import {
  getQcDataConnect,
  insertQcLotDecision,
  listVerifiedLotAttachments,
  upsertQcFinishedGoodsLot,
} from './_qcDataConnect.mjs'
import { buildQcStoragePath, verifyStorageObject } from './_qcStorage.mjs'

const EPS = 1e-9
const PACK_LINE_ID = 'pack'
const PACK_LINE_ALIASES = new Set(['pack', 'packing', 'packaging', 'pack-line', 'line-pack'])

/** Lot statuses that may still be sent to QC review/release. */
const QC_RELEASABLE_STATUSES = new Set(['pending', 'in_review', 'regrade_pending'])

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

function optionalNonNegativeInteger(value, error) {
  if (value === undefined) return ok({ value: undefined })
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return fail(error, 400)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return fail(error, 400)
  }
  return ok({ value: parsed })
}

function optionalPositiveFinite(value, error) {
  if (value === undefined) return ok({ value: undefined })
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return fail(error, 400)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fail(error, 400)
  return ok({ value: parsed })
}

function resolvePackagingOutputQuantity(command, fallback = {}, { allowMissingZero = false } = {}) {
  const outputM2 = optionalPositiveFinite(command?.outputM2, 'invalid_output')
  if (!outputM2.ok) return outputM2
  const outputMp = optionalPositiveFinite(command?.outputMp, 'invalid_output')
  if (!outputMp.ok) return outputMp
  if (
    outputM2.value !== undefined &&
    outputMp.value !== undefined &&
    Math.abs(outputM2.value - outputMp.value) > EPS
  ) {
    return fail('invalid_output', 400)
  }
  const claimed = outputM2.value ?? outputMp.value
  if (claimed !== undefined) return ok({ value: claimed })

  const fallbackValue = fallback?.outputM2 ?? fallback?.outputMp
  if (fallbackValue === undefined) {
    return allowMissingZero ? ok({ value: 0 }) : fail('invalid_output', 400)
  }
  if (
    (typeof fallbackValue !== 'number' && typeof fallbackValue !== 'string') ||
    (typeof fallbackValue === 'string' && !fallbackValue.trim())
  ) {
    return fail('invalid_output', 400)
  }
  const parsedFallback = Number(fallbackValue)
  if (
    !Number.isFinite(parsedFallback) ||
    (allowMissingZero ? parsedFallback < 0 : parsedFallback <= 0)
  ) {
    return fail('invalid_output', 400)
  }
  return ok({ value: parsedFallback })
}

/** Validate count aliases without truncating/clamping a malformed client claim. */
function resolvePackagingOutputCounts(command, fallback = {}) {
  const rolls = optionalNonNegativeInteger(command?.outputRolls, 'invalid_output_rolls')
  if (!rolls.ok) return rolls
  const fallbackRolls = optionalNonNegativeInteger(
    fallback?.outputRolls,
    'invalid_output_rolls',
  )
  if (!fallbackRolls.ok) return fallbackRolls

  const pallets = optionalNonNegativeInteger(command?.outputPallets, 'invalid_output_pallets')
  if (!pallets.ok) return pallets
  const palletAlias = optionalNonNegativeInteger(command?.palletCount, 'invalid_output_pallets')
  if (!palletAlias.ok) return palletAlias
  if (
    pallets.value !== undefined &&
    palletAlias.value !== undefined &&
    pallets.value !== palletAlias.value
  ) {
    return fail('invalid_output_pallets', 400)
  }
  const fallbackPallets = optionalNonNegativeInteger(
    fallback?.outputPallets,
    'invalid_output_pallets',
  )
  if (!fallbackPallets.ok) return fallbackPallets

  return ok({
    outputRolls: rolls.value ?? fallbackRolls.value ?? 0,
    outputPallets: pallets.value ?? palletAlias.value ?? fallbackPallets.value ?? 0,
  })
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6
}

function isSysadminActor(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '').trim().toLowerCase()
  return Boolean(actor?.claims?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

function normalizePackLineId(value) {
  const raw = str(value)
  if (!raw) return ''
  return PACK_LINE_ALIASES.has(raw.toLowerCase()) ? PACK_LINE_ID : raw
}

/**
 * Server-owned fields. A client may not declare its own status, ledger rows,
 * QC verdict, shipment availability, role set or lot arithmetic.
 */
function stripClientTrusted(command) {
  const {
    roles: _roles,
    role: _role,
    roleId: _roleId,
    capabilities: _caps,
    qcStatus: _qcStatus,
    availableForShipment: _available,
    movements: _movements,
    documents: _documents,
    actorUid: _actorUid,
    actorEmail: _actorEmail,
    status: _status,
    postedAt: _postedAt,
    postedBy: _postedBy,
    confirmedAt: _confirmedAt,
    confirmedBy: _confirmedBy,
    criticalRevision: _criticalRevision,
    lotNumber: _lotNumber,
    lotRevision: _lotRevision,
    currentDecisionId: _currentDecisionId,
    decisionId: _decisionId,
    quantityProduced: _quantityProduced,
    quantityQcReleased: _quantityQcReleased,
    quantityShipped: _quantityShipped,
    quantityRemaining: _quantityRemaining,
    finishedGoodsLots: _lots,
    qcDecisions: _decisions,
    packagingReports: _reports,
    loadingShipments: _shipments,
    packagingBomSnapshot: _pbs,
    packagingBomId: _pbi,
    packagingBomVersion: _pbv,
    packagingBomContentHash: _pbh,
    componentNorms: _cn,
    ...rest
  } = command && typeof command === 'object' ? command : {}
  return rest
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

async function loadPrincipal(dc, storeId, uid) {
  const { data } = await getFstPrincipalAccessByUidStore(dc, { firebaseUid: uid, storeId })
  return data?.fstPrincipalAccesses?.[0] ?? null
}

/**
 * Deny-by-default G4 gate. Line/warehouse scopes are read from the principal row,
 * never from the client command or AppStore payload.
 */
export async function requireG4Capability(
  uid,
  storeId,
  capability,
  { lineId, warehouseId, requireLineScope = false } = {},
) {
  const dc = getG1DataConnect()
  const row = await loadPrincipal(dc, storeId, uid)
  if (!row || row.active !== true) return fail('forbidden', 403)
  const raw = parseCapabilities(row.capabilitiesJson)
  const caps = normalizeCapabilities(raw)
  for (const [key, value] of Object.entries(raw)) {
    if (value === true) caps[key] = true
  }
  if (Array.isArray(raw.productionLineIds)) caps.productionLineIds = raw.productionLineIds
  if (Array.isArray(raw.scopes?.productionLineIds)) {
    caps.productionLineIds = raw.scopes.productionLineIds
  }
  if (Array.isArray(raw.warehouseIds)) caps.warehouseIds = raw.warehouseIds
  if (Array.isArray(raw.scopes?.warehouseIds)) caps.warehouseIds = raw.scopes.warehouseIds

  if (caps[capability] !== true && !hasCapability(caps, capability)) {
    return fail('forbidden', 403)
  }
  if (requireLineScope && lineId && !hasLineScope(caps, lineId)) {
    return fail('forbidden_line_scope', 403)
  }
  if (warehouseId && !hasWarehouseScope(caps, warehouseId)) {
    return fail('forbidden_warehouse_scope', 403)
  }
  return ok({ principal: row, capabilities: caps })
}

// ---------------------------------------------------------------------------
// Critical store + idempotency
// ---------------------------------------------------------------------------

async function loadCritical(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  // G4 is not a bootstrap gateway. In particular, a denied/read/confirm command
  // must never create a revision-0 critical row as a side effect. G3 activation
  // owns the production-domain bootstrap; G4 activation only CASes an existing
  // production-active row.
  if (!row) return ok({ missing: true, revision: 0, payload: null, row: null })
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)
  if (!parsed.payload.domains.production) {
    parsed.payload.domains.production = emptyProductionStore()
  }
  return ok({ revision, payload: parsed.payload, row })
}

async function loadReceipt(dc, idempotencyKey, storeId) {
  const { data } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const row = data?.fstCommandReceipt
  if (!row) return null
  if (row.storeId !== storeId) return { conflict: true }
  try {
    return {
      result: JSON.parse(row.resultJson),
      commandType: row.commandType,
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
    result: row.result,
    commandType: row.commandType,
    criticalRevision: row.criticalRevisionAfter,
    embedded: true,
  }
}

const PAYLOAD_BOUND_IDEMPOTENCY_COMMANDS = new Set([
  'packaging.report.confirm',
  'packaging.report.confirmCorrection',
])

function idempotencyReplayConflict(receipt, commandType, commandFingerprint, { strict = false } = {}) {
  if (
    !PAYLOAD_BOUND_IDEMPOTENCY_COMMANDS.has(commandType) &&
    !isG4CriticalMutationCommand(commandType)
  ) {
    return false
  }
  if (receipt?.commandType && receipt.commandType !== commandType) return true
  const storedFingerprint = str(
    isG4CriticalMutationCommand(commandType)
      ? receipt?.result?.commandFingerprint
      : receipt?.result?.idempotencyFingerprint,
  )
  // A canonical/staging replay without a cryptographic payload fingerprint is
  // unverifiable. Historical soft receipts remain compatible only outside the
  // strict path.
  if (strict && !storedFingerprint) return true
  return Boolean(storedFingerprint && storedFingerprint !== commandFingerprint)
}

function strictPackagingReplayRequired(commandType, command, production) {
  if (!PAYLOAD_BOUND_IDEMPOTENCY_COMMANDS.has(commandType)) return false
  if (isStagingIsolatedRuntime()) return true

  const orderIds = new Set([
    str(command?.productionOrderId ?? command?.orderId),
  ].filter(Boolean))
  const originalReportId = str(command?.originalReportId ?? command?.correctsReportId)
  const reportKey = str(command?.reportKey)
  if (originalReportId) {
    for (const report of production?.packagingReports ?? []) {
      if (str(report?.id) !== originalReportId) continue
      if (Number(report?.wipContractVersion) >= 1) return true
      const orderId = str(report?.productionOrderId)
      if (orderId) orderIds.add(orderId)
    }
  }
  if (reportKey) {
    for (const report of production?.packagingReports ?? []) {
      if (str(report?.idempotencyKey) !== reportKey) continue
      if (Number(report?.wipContractVersion) >= 1) return true
      const orderId = str(report?.productionOrderId)
      if (orderId) orderIds.add(orderId)
    }
  }
  return (production?.orders ?? []).some(
    (order) => orderIds.has(str(order?.id)) && Number(order?.wipContractVersion) >= 1,
  )
}

function strictPackagingReplayStateValid({ reportId, lotId, fingerprint }, production) {
  reportId = str(reportId)
  lotId = str(lotId)
  fingerprint = str(fingerprint)
  if (!fingerprint || !reportId || !lotId) return false
  const reports = (production?.packagingReports ?? []).filter(
    (report) => str(report?.id) === reportId,
  )
  const lots = (production?.finishedGoodsLots ?? []).filter((lot) => str(lot?.id) === lotId)
  return (
    reports.length === 1 &&
    lots.length === 1 &&
    reports[0]?.status === 'confirmed' &&
    str(reports[0]?.idempotencyFingerprint) === fingerprint &&
    str(reports[0]?.finishedGoodsLotId) === lotId &&
    str(lots[0]?.packagingReportId) === reportId
  )
}

function strictEmbeddedPackagingReplayValid(receipt, production) {
  return strictPackagingReplayStateValid(
    {
      reportId: receipt?.result?.reportId,
      lotId: receipt?.result?.finishedGoodsLotId,
      fingerprint: receipt?.result?.idempotencyFingerprint,
    },
    production,
  )
}

function exactOneById(rows, id) {
  id = str(id)
  if (!id) return null
  const matches = (rows ?? []).filter((row) => str(row?.id) === id)
  return matches.length === 1 ? matches[0] : null
}

function exactFingerprintRows(rows, fingerprint) {
  return (rows ?? []).filter((row) => str(row?.commandFingerprint) === fingerprint)
}

/**
 * Re-enter the irreversible mutation's authoritative state reducer on replay.
 * The SQL receipt is deliberately insufficient: the embedded CAS receipt,
 * current lot/decision and every claimed ledger row must still agree.
 */
function reenterStrictCriticalMutationReducer(commandType, receipt, production, warehouse) {
  const result = receipt?.result ?? {}
  const fingerprint = str(result.commandFingerprint)
  if (!fingerprint) return fail('g4_idempotency_state_mismatch', 409)

  const lot = exactOneById(production?.finishedGoodsLots, result.finishedGoodsLotId)
  if (!lot) return fail('g4_idempotency_state_mismatch', 409)
  const decision = result.decisionId
    ? exactOneById(production?.qcDecisions, result.decisionId)
    : null
  const decisionMatches = (status) =>
    Boolean(
      decision &&
        str(lot.currentDecisionId) === str(decision.id) &&
        str(decision.lotId ?? decision.finishedGoodsLotId) === str(lot.id) &&
        decision.status === status &&
        str(decision.commandFingerprint) === fingerprint &&
        Number(decision.lotRevision) === Number(lot.lotRevision),
    )
  const exactIds = (left, right) => {
    const a = Array.isArray(left) ? left.map(str).filter(Boolean) : []
    const b = Array.isArray(right) ? right.map(str).filter(Boolean) : []
    return (
      a.length === b.length &&
      new Set(a).size === a.length &&
      a.every((id, index) => id === b[index])
    )
  }
  const ledgerMatches = (expectedDocumentCount) => {
    const resultDocumentIds =
      commandType === 'shipment.cancel' ? result.reversalDocumentIds : result.documentIds
    const resultMovementIds =
      commandType === 'shipment.cancel' ? result.reversalMovementIds : result.movementIds
    const documentIds = Array.isArray(resultDocumentIds)
      ? resultDocumentIds.map(str).filter(Boolean)
      : str(result.documentId)
        ? [str(result.documentId)]
        : []
    const movementIds = Array.isArray(resultMovementIds)
      ? resultMovementIds.map(str).filter(Boolean)
      : str(result.movementId)
        ? [str(result.movementId)]
        : []
    if (
      documentIds.length !== expectedDocumentCount ||
      movementIds.length !== expectedDocumentCount ||
      new Set(documentIds).size !== expectedDocumentCount ||
      new Set(movementIds).size !== expectedDocumentCount ||
      exactFingerprintRows(warehouse?.documents, fingerprint).length !== expectedDocumentCount ||
      exactFingerprintRows(warehouse?.movements, fingerprint).length !== expectedDocumentCount
    ) {
      return false
    }
    const graphExpectations = {
      'qc.regrade': [
        { role: 'qc_regrade_issue', type: 'issue', lotId: str(result.finishedGoodsLotId) },
        {
          role: 'qc_regrade_receipt',
          type: 'receipt',
          lotId: str(result.newFinishedGoodsLotId),
        },
      ],
      'qc.reject': [
        { role: 'qc_reject_issue', type: 'issue', lotId: str(result.finishedGoodsLotId) },
        {
          role: 'qc_reject_scrap_receipt',
          type: 'receipt',
          lotId: str(result.finishedGoodsLotId),
        },
      ],
      'qc.scrap.writeoff': [
        { role: 'qc_scrap_writeoff', type: 'issue', lotId: str(result.finishedGoodsLotId) },
      ],
      'shipment.post': [
        {
          role: 'finished_goods_shipment',
          type: 'issue',
          lotId: str(result.finishedGoodsLotId),
          shipmentId: str(result.shipmentId),
        },
      ],
      'shipment.cancel': [
        {
          role: 'finished_goods_shipment_cancel',
          type: 'receipt',
          lotId: str(result.finishedGoodsLotId),
          shipmentId: str(result.shipmentId),
        },
      ],
    }[commandType]
    if (!Array.isArray(graphExpectations) || graphExpectations.length !== documentIds.length) {
      return false
    }
    return documentIds.every((documentId, index) => {
      const document = exactOneById(warehouse?.documents, documentId)
      const expected = graphExpectations[index]
      if (
        !document ||
        document.status !== 'posted' ||
        str(document.docRole) !== expected.role ||
        str(document.type) !== expected.type ||
        str(document.finishedGoodsLotId) !== expected.lotId ||
        (expected.shipmentId && str(document.shipmentId) !== expected.shipmentId)
      ) {
        return false
      }
      const lines = Array.isArray(document.lines) ? document.lines : []
      if (lines.length !== 1 || !str(lines[0]?.lineId)) return false
      const movements = (warehouse?.movements ?? []).filter(
        (movement) => str(movement?.documentId) === documentId,
      )
      return (
        movements.length === 1 &&
        movementIds.includes(str(movements[0]?.id)) &&
        str(movements[0]?.documentLineId) === str(lines[0]?.lineId) &&
        str(document.commandFingerprint) === fingerprint &&
        str(movements[0]?.commandFingerprint) === fingerprint &&
        str(movements[0]?.type) === expected.type &&
        str(document.finishedGoodsLotId) === str(movements[0]?.finishedGoodsLotId) &&
        str(document.warehouseId) === str(movements[0]?.warehouseId) &&
        str(lines[0]?.itemId) === str(movements[0]?.itemId) &&
        str(lines[0]?.locationId) === str(movements[0]?.locationId) &&
        str(lines[0]?.batchNo) === str(movements[0]?.batchNo) &&
        Math.abs(num(lines[0]?.quantity) - num(movements[0]?.quantity)) <= EPS
      )
    })
  }

  if (commandType === 'qc.review.start') {
    return lot.qcStatus === 'in_review' &&
      str(lot.reviewCommandFingerprint) === fingerprint &&
      decisionMatches('in_review')
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }
  if (commandType === 'qc.release') {
    return lot.qcStatus === 'released' &&
      str(lot.releaseCommandFingerprint) === fingerprint &&
      decisionMatches('released')
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }
  if (commandType === 'qc.regrade') {
    const child = exactOneById(production?.finishedGoodsLots, result.newFinishedGoodsLotId)
    return lot.qcStatus === 'regrade_pending' &&
      str(lot.regradeCommandFingerprint) === fingerprint &&
      str(lot.regradedToLotId) === str(child?.id) &&
      str(child?.parentLotId) === str(lot.id) &&
      exactIds(lot.regradeDocumentIds, result.documentIds) &&
      exactIds(lot.regradeMovementIds, result.movementIds) &&
      decisionMatches('regrade_pending') &&
      ledgerMatches(2)
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }
  if (commandType === 'qc.reject') {
    return lot.qcStatus === 'scrap_pending' &&
      str(lot.rejectCommandFingerprint) === fingerprint &&
      exactIds(lot.rejectDocumentIds, result.documentIds) &&
      exactIds(lot.rejectMovementIds, result.movementIds) &&
      decisionMatches('rejected') &&
      ledgerMatches(2)
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }
  if (commandType === 'qc.scrap.writeoff') {
    return lot.qcStatus === 'written_off' &&
      str(lot.writeoffCommandFingerprint) === fingerprint &&
      str(lot.writeoffDocumentId) === str(result.documentId) &&
      str(lot.writeoffMovementId) === str(result.movementId) &&
      decisionMatches('written_off') &&
      ledgerMatches(1)
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }

  const shipment = exactOneById(warehouse?.loadingShipments, result.shipmentId)
  if (!shipment || str(shipment.finishedGoodsLotId) !== str(lot.id)) {
    return fail('g4_idempotency_state_mismatch', 409)
  }
  if (commandType === 'shipment.post') {
    return shipment.status === 'posted' &&
      str(shipment.postCommandFingerprint ?? shipment.commandFingerprint) === fingerprint &&
      exactIds(shipment.documentIds, [result.documentId]) &&
      exactIds(shipment.movementIds, [result.movementId]) &&
      ledgerMatches(1)
      ? ok({ result })
      : fail('g4_idempotency_state_mismatch', 409)
  }
  return shipment.status === 'cancelled' &&
    str(shipment.cancelCommandFingerprint) === fingerprint &&
    exactIds(shipment.reversalDocumentIds, result.reversalDocumentIds) &&
    exactIds(shipment.reversalMovementIds, result.reversalMovementIds) &&
    ledgerMatches(1)
    ? ok({ result })
    : fail('g4_idempotency_state_mismatch', 409)
}

async function saveReceipt(dc, idempotencyKey, storeId, commandType, actorUid, result, criticalRevision) {
  try {
    await insertFstCommandReceipt(dc, {
      id: idempotencyKey,
      storeId,
      commandType,
      actorUid,
      resultJson: JSON.stringify(result),
      criticalRevisionAfter: criticalRevision,
    })
  } catch (err) {
    console.warn('g4 receipt insert failed', err)
  }
}

function appendProdAudit(production, entry) {
  return { ...production, auditLog: [...(production.auditLog ?? []), entry] }
}

function appendWhAudit(warehouse, entry) {
  return { ...warehouse, auditLog: [...(warehouse.auditLog ?? []), entry] }
}

function audit(action, actor, detail, now) {
  return {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action,
    actorUid: actor.uid,
    actorEmail: actor.email ?? undefined,
    detail,
  }
}

// ---------------------------------------------------------------------------
// Warehouse ledger helpers
// ---------------------------------------------------------------------------

/**
 * Physical balance narrowed to a location / batch / production order before the
 * shared `computeServerBalance` reducer runs. Client balances are never read.
 */
function balanceAt(movements, { warehouseId, locationId, itemId, batchNo, productionOrderId }) {
  const filtered = (movements ?? []).filter((m) => {
    if (m.warehouseId !== warehouseId) return false
    if (locationId != null && locationId !== '' && (m.locationId ?? '') !== locationId) return false
    if (batchNo != null && batchNo !== '' && str(m.batchNo) !== str(batchNo)) return false
    if (productionOrderId != null && productionOrderId !== '' && m.productionOrderId !== productionOrderId) {
      return false
    }
    return true
  })
  return computeServerBalance(filtered, warehouseId, itemId)
}

function postWarehouseDoc(warehouse, spec, actor, now) {
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const date = str(spec.date).slice(0, 10)
  const documents = warehouse.documents ?? []
  const movementsIn = warehouse.movements ?? []
  const number = spec.number ?? nextServerDocumentNumber(documents, spec.type, spec.warehouseId, date)
  const lines = (spec.lines ?? []).map((line) => ({
    lineId: crypto.randomUUID(),
    itemId: line.itemId,
    quantity: roundQty(line.quantity),
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    locationId: line.locationId,
    unitSnapshot: line.unitSnapshot,
    sourceDocumentId: line.sourceDocumentId,
    sourceDocumentLineId: line.sourceDocumentLineId,
    sourceShiftReportId: line.sourceShiftReportId,
    sourceWipBatchId: line.sourceWipBatchId,
  }))
  const doc = {
    id: documentId,
    type: spec.type,
    purpose: spec.purpose,
    docRole: spec.docRole,
    warehouseId: spec.warehouseId,
    date,
    number,
    lines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
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
    type: spec.movementType,
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    unitSnapshot: line.unitSnapshot,
    sourceDocumentId: line.sourceDocumentId,
    sourceDocumentLineId: line.sourceDocumentLineId,
    sourceShiftReportId: line.sourceShiftReportId,
    sourceWipBatchId: line.sourceWipBatchId,
    shiftReportId: line.shiftReportId ?? line.sourceShiftReportId,
    ...(spec.movementExtra ?? {}),
  }))
  return {
    warehouse: {
      ...warehouse,
      documents: [...documents, doc],
      movements: [...movementsIn, ...movements],
    },
    documentId,
    number,
    doc,
    movements,
  }
}

function reverseMovementType(type) {
  if (type === 'issue' || type === 'out') return 'receipt'
  if (type === 'receipt' || type === 'in') return 'issue'
  if (type === 'reserve') return 'unreserve'
  if (type === 'unreserve') return 'reserve'
  return null
}

/**
 * Storno of an already posted document. `keepQtyByItem` lets a correction keep the
 * part of a finished-goods receipt that was already shipped out of the ledger.
 */
function reverseDocument(
  warehouse,
  doc,
  actor,
  now,
  { reason, docRole, keepQtyByItem, commandFingerprint } = {},
) {
  const date = now.slice(0, 10)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const related = (warehouse.movements ?? []).filter((m) => m.documentId === doc.id && !m.cancelled)
  const keep = keepQtyByItem instanceof Map ? new Map(keepQtyByItem) : new Map()

  const reversed = []
  for (const mov of related) {
    const type = reverseMovementType(mov.type)
    if (!type) continue
    let quantity = Math.abs(Number(mov.quantity) || 0)
    const keptLeft = keep.get(mov.itemId)
    if (Number.isFinite(keptLeft) && keptLeft > EPS) {
      const hold = Math.min(keptLeft, quantity)
      quantity = roundQty(quantity - hold)
      keep.set(mov.itemId, roundQty(keptLeft - hold))
    }
    if (quantity <= EPS) continue
    reversed.push({ mov, type, quantity })
  }
  if (reversed.length === 0) {
    return { warehouse, reverseDocumentId: null, skipped: true }
  }

  const reversedLines = reversed.map((r) => ({
    lineId: crypto.randomUUID(),
    itemId: r.mov.itemId,
    quantity: r.quantity,
    batchNo: r.mov.batchNo,
    expiryDate: r.mov.expiryDate,
    locationId: r.mov.locationId,
  }))
  const revDoc = {
    id: documentId,
    type: reverseMovementType(doc.type) ?? doc.type,
    purpose: doc.purpose,
    docRole: docRole ?? 'packaging_correction_reversal',
    warehouseId: doc.warehouseId,
    date,
    number: nextReversalNumber(doc.number),
    lines: reversedLines,
    status: 'posted',
    reversesDocumentId: doc.id,
    packagingReportId: doc.packagingReportId,
    finishedGoodsLotId: doc.finishedGoodsLotId,
    shipmentId: doc.shipmentId,
    productionOrderId: doc.productionOrderId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    cancellationReason: reason,
    commandFingerprint: str(commandFingerprint) || undefined,
  }
  const movements = reversed.map((r, index) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId,
    documentLineId: reversedLines[index].lineId,
    warehouseId: r.mov.warehouseId,
    locationId: r.mov.locationId,
    itemId: r.mov.itemId,
    quantity: r.quantity,
    type: r.type,
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: r.mov.batchNo,
    expiryDate: r.mov.expiryDate,
    productionOrderId: r.mov.productionOrderId,
    packagingReportId: r.mov.packagingReportId,
    finishedGoodsLotId: r.mov.finishedGoodsLotId,
    shipmentId: r.mov.shipmentId,
    reversesMovementId: r.mov.id,
    isWip: r.mov.isWip,
    isScrap: r.mov.isScrap,
    commandFingerprint: str(commandFingerprint) || undefined,
  }))
  return {
    warehouse: {
      ...warehouse,
      documents: [...(warehouse.documents ?? []), revDoc],
      movements: [...(warehouse.movements ?? []), ...movements],
    },
    reverseDocumentId: documentId,
    skipped: false,
  }
}

function resolvePackBinding(warehouse, command, options = {}) {
  return resolveCanonicalPackBinding(warehouse, command, options)
}

function nextLotNumber(lots, dateIso) {
  const date = str(dateIso).slice(0, 10).replace(/-/g, '') || '00000000'
  const pattern = new RegExp(`^LOT-${date}-(\\d+)$`)
  let max = 0
  for (const lot of lots ?? []) {
    const match = str(lot.lotNumber).match(pattern)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }
  return `LOT-${date}-${String(max + 1).padStart(3, '0')}`
}

/**
 * Human-readable packaging report number owned by the authoritative G4 reducer.
 * CAS serialises concurrent confirms, so scanning the current critical snapshot is
 * sufficient to keep the daily sequence unique without trusting a client number.
 */
function nextPackagingReportNumber(reports, dateIso) {
  const date = str(dateIso).slice(0, 10).replace(/-/g, '') || '00000000'
  const prefix = `УП-${date}-`
  let max = 0
  for (const report of reports ?? []) {
    const number = str(report?.number)
    if (!number.startsWith(prefix)) continue
    const sequence = Number(number.slice(prefix.length))
    if (Number.isInteger(sequence) && sequence > max) max = sequence
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function findLot(production, lotId) {
  const id = str(lotId)
  if (!id) return null
  return (production.finishedGoodsLots ?? []).find((lot) => lot.id === id || lot.lotNumber === id) ?? null
}

function replaceLot(production, lot) {
  const list = [...(production.finishedGoodsLots ?? [])]
  const idx = list.findIndex((l) => l.id === lot.id)
  if (idx >= 0) list[idx] = lot
  else list.push(lot)
  return { ...production, finishedGoodsLots: list }
}

function appendDecision(production, decision) {
  return { ...production, qcDecisions: [...(production.qcDecisions ?? []), decision] }
}

function lotHistory(lot, entry) {
  return [...(lot.history ?? []), entry]
}

function buildDecision({
  lot,
  status,
  actor,
  now,
  reason,
  attachments,
  targetFinishedProductId,
  quantity,
  idempotencyKey,
  commandFingerprint,
}) {
  const decisionId = `qcd-${crypto.randomUUID()}`
  return {
    id: decisionId,
    decisionId,
    lotId: lot.id,
    lotNumber: lot.lotNumber,
    lotRevision: Number(lot.lotRevision) || 1,
    status,
    actorUid: actor.uid,
    actorEmail: actor.email ?? undefined,
    at: now,
    decidedAt: now,
    reason: reason || undefined,
    targetFinishedProductId: targetFinishedProductId || undefined,
    quantity: Number.isFinite(quantity) ? roundQty(quantity) : undefined,
    passportAttachmentId: attachments?.passport?.id,
    passportChecksum: attachments?.passport?.checksum,
    passportGeneration: attachments?.passport?.generation,
    passportStoragePath: attachments?.passport?.storagePath,
    protocolAttachmentId: attachments?.protocol?.id,
    protocolChecksum: attachments?.protocol?.checksum,
    protocolGeneration: attachments?.protocol?.generation,
    protocolStoragePath: attachments?.protocol?.storagePath,
    idempotencyKey: idempotencyKey || undefined,
    commandFingerprint: str(commandFingerprint) || undefined,
  }
}

// ---------------------------------------------------------------------------
// Packaging reports
// ---------------------------------------------------------------------------

function sanitizePackagingLines(rawLines, { itemKey, preserveWipLineage = false }) {
  if (!Array.isArray(rawLines)) return { ok: true, lines: [] }
  const out = []
  const lineIds = new Set()
  for (const raw of rawLines) {
    const itemId = str(raw?.[itemKey] ?? raw?.itemId ?? raw?.warehouseItemId)
    const quantity = num(raw?.quantity ?? raw?.qty)
    if (!itemId) return { ok: false, error: 'invalid_line_item' }
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'invalid_quantity' }
    const suppliedLineId = str(raw?.lineId)
    if (suppliedLineId && lineIds.has(suppliedLineId)) {
      return { ok: false, error: 'duplicate_line_id' }
    }
    const lineId = suppliedLineId || crypto.randomUUID()
    lineIds.add(lineId)
    const line = {
      lineId,
      itemId,
      quantity: roundQty(quantity),
      unitSnapshot: raw?.unitSnapshot != null ? String(raw.unitSnapshot) : undefined,
      wipBatchId:
        raw?.wipBatchId != null
          ? str(raw.wipBatchId)
          : raw?.batchNo != null
            ? str(raw.batchNo)
            : undefined,
      note: raw?.note != null ? String(raw.note) : undefined,
    }
    if (preserveWipLineage) {
      line.productionOrderId = str(raw?.productionOrderId) || undefined
      line.shiftReportId = str(raw?.shiftReportId) || undefined
      line.receiptDocumentId = str(raw?.receiptDocumentId) || undefined
    }
    out.push(line)
  }
  return { ok: true, lines: out }
}

function applyPackagingDraftSave(production, command, actor, now) {
  const reportId = str(command.reportId) || `pkr-${crypto.randomUUID()}`
  const existing = (production.packagingReports ?? []).find((r) => r.id === reportId)
  if (existing && existing.status !== 'draft' && existing.status !== 'correction_draft') {
    return fail('packaging_report_immutable', 409)
  }
  const lineId = normalizePackLineId(command.lineId ?? PACK_LINE_ID)
  if (lineId !== PACK_LINE_ID) return fail('invalid_pack_line', 400)
  const wip = sanitizePackagingLines(command.wipLines, {
    itemKey: 'semiFinishedItemId',
    preserveWipLineage: true,
  })
  if (!wip.ok) return fail(wip.error, 400)
  const materials = sanitizePackagingLines(command.materialLines, { itemKey: 'itemId' })
  if (!materials.ok) return fail(materials.error, 400)
  const outputCounts = resolvePackagingOutputCounts(command, existing ?? {})
  if (!outputCounts.ok) return outputCounts
  const outputQuantity = resolvePackagingOutputQuantity(command, existing ?? {}, {
    allowMissingZero: true,
  })
  if (!outputQuantity.ok) return outputQuantity

  const draft = {
    ...(existing ?? {}),
    id: reportId,
    status: existing?.status === 'correction_draft' ? 'correction_draft' : 'draft',
    productionOrderId: str(command.productionOrderId ?? command.orderId ?? existing?.productionOrderId),
    lineId,
    reportDate: str(command.reportDate ?? command.date ?? existing?.reportDate ?? now).slice(0, 10),
    shiftSlot: command.shiftSlot === 'night' ? 'night' : 'day',
    finishedProductId: str(command.finishedProductId ?? existing?.finishedProductId),
    warehouseItemId: str(command.warehouseItemId ?? existing?.warehouseItemId),
    outputM2: roundQty(outputQuantity.value),
    outputRolls: outputCounts.outputRolls,
    outputPallets: outputCounts.outputPallets,
    wipLines: wip.lines,
    materialLines: materials.lines,
    note: command.note != null ? String(command.note) : existing?.note,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  if (!draft.productionOrderId) return fail('invalid_input', 400)

  const list = [...(production.packagingReports ?? [])]
  const idx = list.findIndex((r) => r.id === reportId)
  if (idx >= 0) list[idx] = draft
  else list.push(draft)
  return ok({
    production: { ...production, packagingReports: list },
    warehouse: null,
    result: { reportId, status: draft.status },
  })
}

function applyPackagingDraftDelete(production, command, actor, now) {
  const reportId = str(command.reportId ?? command.draftId)
  if (!reportId) return fail('invalid_input', 400)
  const report = (production.packagingReports ?? []).find((r) => r.id === reportId)
  if (!report) return fail('not_found', 404)
  if (report.status !== 'draft' && report.status !== 'correction_draft') {
    return fail('packaging_report_immutable', 409)
  }
  const list = (production.packagingReports ?? []).filter((r) => r.id !== reportId)
  const next = appendProdAudit(
    { ...production, packagingReports: list },
    audit('packaging_report_draft_delete', actor, reportId, now),
  )
  return ok({ production: next, warehouse: null, result: { reportId, deleted: true } })
}

/**
 * Confirm a packaging report: consume WIP + packaging materials, receive finished
 * goods, and open a `pending` QC lot. `options.correction` carries the already
 * shipped quantity that must stay in the ledger when correcting.
 */
function applyPackagingConfirm(production, warehouse, command, actor, now, options = {}) {
  const correction = options.correction ?? null
  const masterDataActive = options.masterDataActive === true
  const enforceCanonicalLineage = options.enforceCanonicalLineage === true
  const masterData = options.masterData ?? null
  const idempotencyFingerprint = str(options.idempotencyFingerprint)
  const orderId = str(command.productionOrderId ?? command.orderId)
  const lineId = normalizePackLineId(command.lineId ?? PACK_LINE_ID)
  const reportDate = str(command.reportDate ?? command.date ?? now).slice(0, 10)
  const shiftSlot = command.shiftSlot === 'night' ? 'night' : 'day'
  const idempotencyKey =
    str(command.reportKey) || `${orderId}::${lineId}::${reportDate}::${shiftSlot}`
  const outputCounts = resolvePackagingOutputCounts(command)
  if (!outputCounts.ok) return outputCounts
  const outputQuantity = resolvePackagingOutputQuantity(command)
  if (!outputQuantity.ok) return outputQuantity
  const replayOrder = (production.orders ?? []).find((candidate) => str(candidate?.id) === orderId)
  const strictIdempotency =
    enforceCanonicalLineage || Number(replayOrder?.wipContractVersion) >= 1
  const claimedReportId = str(command.reportId)

  const alreadyMatches = (production.packagingReports ?? []).filter(
    (r) => r.idempotencyKey === idempotencyKey && r.status === 'confirmed',
  )
  if (alreadyMatches.length > 1) return fail('packaging_report_ambiguous', 409)
  const already = alreadyMatches[0]
  if (already) {
    if (claimedReportId && str(already.id) !== claimedReportId) {
      return fail('packaging_report_id_conflict', 409)
    }
    if (strictIdempotency && !str(already.idempotencyFingerprint)) {
      return fail('packaging_idempotency_conflict', 409)
    }
    if (
      already.idempotencyFingerprint &&
      str(already.idempotencyFingerprint) !== idempotencyFingerprint
    ) {
      return fail('packaging_idempotency_conflict', 409)
    }
    if (
      strictIdempotency &&
      !strictPackagingReplayStateValid(
        {
          reportId: already.id,
          lotId: already.finishedGoodsLotId,
          fingerprint: already.idempotencyFingerprint,
        },
        production,
      )
    ) {
      return fail('packaging_idempotency_state_mismatch', 409)
    }
    const alreadyLot = findLot(production, already.finishedGoodsLotId)
    return ok({
      production,
      warehouse,
      result: {
        reportId: already.id,
        finishedGoodsLotId: already.finishedGoodsLotId ?? null,
        reportNumber: already.number ?? null,
        lotNumber: alreadyLot?.lotNumber ?? already.lotNumber ?? null,
        quantityProduced: alreadyLot?.quantityProduced ?? null,
        documentIds: already.documentIds ?? [],
        qcStatus: alreadyLot?.qcStatus,
        status: 'confirmed',
        idempotent: true,
      },
    })
  }

  // A caller-supplied report ID is an identity claim, never an upsert key. Only
  // the exact draft lineage may be promoted; another confirmed/correction report
  // must be rejected before any warehouse effect is built.
  if (claimedReportId) {
    const idMatches = (production.packagingReports ?? []).filter(
      (report) => str(report?.id) === claimedReportId,
    )
    if (idMatches.length > 1) return fail('packaging_report_ambiguous', 409)
    const draft = idMatches[0]
    if (draft) {
      const expectedStatus = correction ? 'correction_draft' : 'draft'
      const expectedCorrectionId = correction ? str(correction.originalReportId) : ''
      if (
        draft.status !== expectedStatus ||
        str(draft.productionOrderId) !== orderId ||
        normalizePackLineId(draft.lineId) !== lineId ||
        str(draft.correctsReportId) !== expectedCorrectionId
      ) {
        return fail('packaging_report_id_conflict', 409)
      }
    }
  }

  if (!orderId) return fail('invalid_input', 400)
  if (lineId !== PACK_LINE_ID) return fail('invalid_pack_line', 400)

  const orderSnap =
    command.orderSnapshot && str(command.orderSnapshot.id) === orderId
      ? command.orderSnapshot
      : null
  let order = (production.orders ?? []).find((o) => o.id === orderId) ?? null
  let productionWithOrder = production
  if (!order && enforceCanonicalLineage) {
    return fail('authoritative_packaging_order_required', 409)
  }
  if (!order && orderSnap) {
    const status = str(orderSnap.status) || 'active'
    order = {
      id: orderId,
      status: status === 'paused' ? 'active' : status,
      finishedProductId: str(orderSnap.finishedProductId),
      warehouseItemId: str(orderSnap.warehouseItemId || orderSnap.finishedProductId),
      semiFinishedItemId: str(orderSnap.semiFinishedItemId) || undefined,
      lineId: str(orderSnap.lineId) || PACK_LINE_ID,
      orderNumber: str(orderSnap.orderNumber) || orderId,
      packagingBomSnapshot: orderSnap.packagingBomSnapshot ?? undefined,
    }
    productionWithOrder = {
      ...production,
      orders: [...(production.orders ?? []), order],
    }
  }
  if (!order) return fail('not_found', 404)
  if (order.status !== 'active') return fail('order_not_active', 409)
  if (enforceCanonicalLineage && Number(order.wipContractVersion) < 1) {
    return fail('canonical_wip_contract_required', 409)
  }
  if (isPeriodClosed(warehouse, reportDate)) return fail('period_closed', 403)

  const binding = resolvePackBinding(warehouse, command, {
    strict: enforceCanonicalLineage || Number(order.wipContractVersion) >= 1,
  })
  if (!binding.ok) return fail(binding.error, binding.status || 400, binding)
  if (enforceCanonicalLineage && binding.fromCommand === true) {
    return fail('canonical_pack_binding_required', 409)
  }

  const finishedGoodsMapping = validateCanonicalFinishedGoodsMapping({
    order,
    command,
    warehouse,
    masterData,
    masterDataActive,
    enforceCanonical: enforceCanonicalLineage,
  })
  if (!finishedGoodsMapping.ok) {
    return fail(
      finishedGoodsMapping.error,
      finishedGoodsMapping.status || 409,
      finishedGoodsMapping,
    )
  }

  // Prefer productionWithOrder for the rest of confirm so soft orderSnapshot persists.
  production = productionWithOrder

  let whSeed = warehouse
  if (binding.fromCommand) {
    const hasPack = (whSeed.productionLineBindings ?? []).some((b) => {
      const byLine = normalizePackLineId(b.lineId)
      const byId = normalizePackLineId(b.id)
      return byLine === PACK_LINE_ID || byId === PACK_LINE_ID
    })
    if (!hasPack) {
      whSeed = {
        ...whSeed,
        productionLineBindings: [
          ...(whSeed.productionLineBindings ?? []),
          {
            id: PACK_LINE_ID,
            lineId: PACK_LINE_ID,
            productionWarehouseId: binding.packagingWarehouseId,
            productionLocationId: binding.packagingLocationId,
          },
        ],
      }
    }
  }
  warehouse = whSeed

  const finishedProductId = finishedGoodsMapping.canonical
    ? finishedGoodsMapping.finishedProductId
    : str(command.finishedProductId)
  if (!finishedProductId) return fail('finished_product_required', 400)
  if (order.finishedProductId && order.finishedProductId !== finishedProductId) {
    return fail('finished_product_mismatch', 400)
  }
  const warehouseItemId = finishedGoodsMapping.canonical
    ? finishedGoodsMapping.warehouseItemId
    : str(command.warehouseItemId) || finishedProductId

  const outputM2 = outputQuantity.value
  const { outputRolls, outputPallets } = outputCounts

  const carryShipped = Math.max(0, roundQty(num(correction?.carryShippedQty) || 0))
  if (carryShipped > 0 && outputM2 + EPS < carryShipped) {
    return fail('fg_below_shipped', 409)
  }
  const fgQty = roundQty(outputM2 - carryShipped)

  const wip = sanitizePackagingLines(command.wipLines, {
    itemKey: 'semiFinishedItemId',
    preserveWipLineage: true,
  })
  if (!wip.ok) return fail(wip.error, 400)
  if (wip.lines.length === 0) return fail('wip_lines_required', 400)
  const materials = sanitizePackagingLines(command.materialLines, { itemKey: 'itemId' })
  if (!materials.ok) return fail(materials.error, 400)

  const canonicalLineage = validateCanonicalPackagingWipLineage({
    production,
    warehouse,
    order,
    binding,
    wipLines: wip.lines,
    outputM2,
  })
  if (!canonicalLineage.ok) {
    return fail(canonicalLineage.error, canonicalLineage.status || 409, canonicalLineage)
  }

  // G5.4: when masterData active, norms come ONLY from order.packagingBomSnapshot
  // (never live BOM, never client snapshot). Corrections inherit original report BOM.
  let packagingBomAnalysis = null
  const packagingBomRequired = order.packagingBomRequired !== false
  if (masterDataActive || canonicalLineage.canonical) {
    const snap = correction?.packagingBomSnapshot ?? order.packagingBomSnapshot ?? null
    if (!snap || !str(snap.packagingBomId) || !str(snap.contentHash)) {
      if (packagingBomRequired) return fail('packaging_bom_snapshot_required', 409)
    } else {
      const compared = comparePackagingActualToNorm(snap, outputM2, materials.lines, {
        excessReason: command.excessReason ?? command.deviationReason ?? command.reason,
        requireComplete: canonicalLineage.canonical,
      })
      if (!compared.ok) {
        return fail(compared.error, compared.status || 400, {
          itemId: compared.itemId,
          expectedUnit: compared.expectedUnit,
          actualUnit: compared.actualUnit,
          expected: compared.expected,
          actual: compared.actual,
          components: compared.components,
        })
      }
      packagingBomAnalysis = {
        packagingBomId: compared.packagingBomId,
        version: compared.version,
        contentHash: compared.contentHash,
        componentNorms: compared.components,
        excessReason: compared.excessReason,
        snapshotAsOfDate: snap.asOfDate,
      }
    }
  }

  // WIP availability is recomputed from the ledger at the pack location and bound to
  // the production order; the report's own WIP status claims are ignored.
  let working = [...(warehouse.movements ?? [])]
  const wipConsumption = []
  for (const line of wip.lines) {
    const available = balanceAt(working, {
      warehouseId: binding.packagingWarehouseId,
      locationId: binding.packagingLocationId,
      itemId: line.itemId,
      batchNo: line.wipBatchId,
      productionOrderId: orderId,
    })
    if (line.quantity > available + EPS) {
      return fail('insufficient_wip', 400, {
        itemId: line.itemId,
        available: roundQty(available),
        requested: line.quantity,
      })
    }
    wipConsumption.push({
      itemId: line.itemId,
      quantity: line.quantity,
      batchNo: line.wipBatchId,
      locationId: binding.packagingLocationId,
      unitSnapshot: line.unitSnapshot,
      sourceDocumentId: line.receiptDocumentId,
      sourceDocumentLineId: line.lineId,
      sourceShiftReportId: line.shiftReportId,
      sourceWipBatchId: line.wipBatchId,
      shiftReportId: line.shiftReportId,
    })
    working = [
      ...working,
      {
        id: `sim-${crypto.randomUUID()}`,
        warehouseId: binding.packagingWarehouseId,
        locationId: binding.packagingLocationId,
        itemId: line.itemId,
        quantity: line.quantity,
        type: 'issue',
        at: now,
        batchNo: line.wipBatchId,
        productionOrderId: orderId,
        isWip: true,
      },
    ]
  }

  // Packaging materials: FEFO/FIFO over physical lots at the pack location.
  const materialConsumption = []
  for (const line of materials.lines) {
    const lots = buildBatchLotsFromMovements(working, {
      itemId: line.itemId,
      warehouseId: binding.packagingWarehouseId,
      locationId: binding.packagingLocationId,
    }).map((lot) => ({ ...lot, available: Math.max(0, lot.physical - lot.reserved) }))
    const allocation = allocateBatchesFefoFifo(lots, line.quantity, { today: reportDate })
    if (!allocation.ok) {
      return fail('insufficient_stock', 400, {
        itemId: line.itemId,
        available: roundQty(
          ordinaryAvailableQty(working, line.itemId, binding.packagingWarehouseId),
        ),
        requested: line.quantity,
      })
    }
    for (const part of allocation.allocations) {
      materialConsumption.push({
        itemId: line.itemId,
        quantity: roundQty(part.quantity),
        batchNo: part.batchNo,
        expiryDate: part.expiryDate,
        locationId: part.locationId ?? binding.packagingLocationId,
        unitSnapshot: line.unitSnapshot,
      })
      working = [
        ...working,
        {
          id: `sim-${crypto.randomUUID()}`,
          warehouseId: binding.packagingWarehouseId,
          locationId: part.locationId ?? binding.packagingLocationId,
          itemId: line.itemId,
          quantity: part.quantity,
          type: 'issue',
          at: now,
          batchNo: part.batchNo,
          expiryDate: part.expiryDate,
          productionOrderId: orderId,
        },
      ]
    }
  }

  const reportId = claimedReportId || `pkr-${crypto.randomUUID()}`
  const lotId = `fgl-${crypto.randomUUID()}`
  const lotNumber = nextLotNumber(production.finishedGoodsLots, reportDate)
  const reportNumber = nextPackagingReportNumber(production.packagingReports, reportDate)

  let wh = warehouse
  const documentIds = []

  const wipDoc = postWarehouseDoc(
    wh,
    {
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'production_wip_pack_consumption',
      warehouseId: binding.packagingWarehouseId,
      date: reportDate,
      lines: wipConsumption,
      movementType: 'issue',
      docExtra: {
        productionOrderId: orderId,
        productionLineId: lineId,
        packagingReportId: reportId,
        finishedGoodsLotId: lotId,
        isWip: true,
      },
      movementExtra: {
        productionOrderId: orderId,
        productionLineId: lineId,
        packagingReportId: reportId,
        finishedGoodsLotId: lotId,
        isWip: true,
      },
    },
    actor,
    now,
  )
  wh = wipDoc.warehouse
  documentIds.push(wipDoc.documentId)

  if (materialConsumption.length) {
    const materialDoc = postWarehouseDoc(
      wh,
      {
        type: 'issue',
        purpose: 'production_issue',
        docRole: 'packaging_material_consumption',
        warehouseId: binding.packagingWarehouseId,
        date: reportDate,
        lines: materialConsumption,
        movementType: 'issue',
        docExtra: {
          productionOrderId: orderId,
          productionLineId: lineId,
          packagingReportId: reportId,
          finishedGoodsLotId: lotId,
        },
        movementExtra: {
          productionOrderId: orderId,
          productionLineId: lineId,
          packagingReportId: reportId,
          finishedGoodsLotId: lotId,
        },
      },
      actor,
      now,
    )
    wh = materialDoc.warehouse
    documentIds.push(materialDoc.documentId)
  }

  if (fgQty > EPS) {
    const fgDoc = postWarehouseDoc(
      wh,
      {
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'production_fg_receipt',
        warehouseId: binding.fgWarehouseId,
        date: reportDate,
        lines: [
          {
            itemId: warehouseItemId,
            quantity: fgQty,
            batchNo: lotNumber,
            locationId: binding.fgLocationId,
            unitSnapshot: finishedGoodsMapping.canonical
              ? finishedGoodsMapping.unitSnapshot
              : command.unitSnapshot != null
                ? String(command.unitSnapshot)
                : undefined,
          },
        ],
        movementType: 'receipt',
        docExtra: {
          productionOrderId: orderId,
          productionLineId: lineId,
          packagingReportId: reportId,
          finishedGoodsLotId: lotId,
          isFinishedGoods: true,
        },
        movementExtra: {
          productionOrderId: orderId,
          productionLineId: lineId,
          packagingReportId: reportId,
          finishedGoodsLotId: lotId,
          isFinishedGoods: true,
        },
      },
      actor,
      now,
    )
    wh = fgDoc.warehouse
    documentIds.push(fgDoc.documentId)
  }

  const lot = {
    id: lotId,
    lotNumber,
    packagingReportId: reportId,
    productionOrderId: orderId,
    sourceShiftReportIds: canonicalLineage.sourceShiftReportIds,
    sourceWipBatchIds: canonicalLineage.sourceWipBatchIds,
    wipContractVersion: canonicalLineage.canonical ? 1 : undefined,
    lineId,
    finishedProductId,
    warehouseItemId,
    warehouseId: binding.fgWarehouseId,
    locationId: binding.fgLocationId,
    qcStatus: 'pending',
    outputRolls,
    outputPallets,
    quantityProduced: fgQty,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    lotRevision: 1,
    currentDecisionId: null,
    correctsLotId: correction?.supersededLotId ?? undefined,
    producedAt: reportDate,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.uid,
    createdByName: actor.email ?? actor.uid,
    history: [
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'created',
        message: `lot ${lotNumber} qty ${fgQty}`,
        actorUid: actor.uid,
      },
    ],
  }

  const report = {
    id: reportId,
    number: reportNumber,
    idempotencyKey,
    idempotencyFingerprint: idempotencyFingerprint || undefined,
    status: 'confirmed',
    productionOrderId: orderId,
    lineId,
    reportDate,
    shiftSlot,
    finishedProductId,
    warehouseItemId,
    semiFinishedItemId: str(order.semiFinishedItemId) || undefined,
    outputM2: roundQty(outputM2),
    outputRolls,
    outputPallets,
    lotNumber: fgQty > EPS ? lotNumber : undefined,
    wipLines: wip.lines,
    sourceShiftReportIds: canonicalLineage.sourceShiftReportIds,
    sourceWipBatchIds: canonicalLineage.sourceWipBatchIds,
    wipContractVersion: canonicalLineage.canonical ? 1 : undefined,
    materialLines: materials.lines,
    materialAllocations: materialConsumption,
    packagingWarehouseId: binding.packagingWarehouseId,
    packagingLocationId: binding.packagingLocationId,
    finishedGoodsWarehouseId: binding.fgWarehouseId,
    finishedGoodsLocationId: binding.fgLocationId,
    finishedGoodsLotId: fgQty > EPS ? lotId : null,
    documentIds,
    note: command.note != null ? String(command.note) : undefined,
    correctsReportId: correction?.originalReportId ?? undefined,
    correctionReason: correction?.reason ?? undefined,
    reverseDocumentIds: correction?.reverseDocumentIds ?? undefined,
    carriedShippedQty: carryShipped > 0 ? carryShipped : undefined,
    packagingBomId: packagingBomAnalysis?.packagingBomId,
    packagingBomVersion: packagingBomAnalysis?.version,
    packagingBomContentHash: packagingBomAnalysis?.contentHash,
    packagingComponentNorms: packagingBomAnalysis?.componentNorms,
    packagingExcessReason: packagingBomAnalysis?.excessReason,
    packagingBomSnapshotAsOfDate: packagingBomAnalysis?.snapshotAsOfDate,
    packagingBomSnapshot:
      packagingBomAnalysis != null
        ? (correction?.packagingBomSnapshot ?? order.packagingBomSnapshot)
        : undefined,
    packagingBomRequired,
    confirmedAt: now,
    confirmedBy: actor.uid,
    confirmedByName: actor.email ?? actor.uid,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.uid,
  }

  const reports = [...(production.packagingReports ?? [])]
  const reportIdx = reports.findIndex((r) => r.id === reportId)
  if (reportIdx >= 0) reports[reportIdx] = report
  else reports.push(report)

  let prod = { ...production, packagingReports: reports }
  if (fgQty > EPS) {
    prod = { ...prod, finishedGoodsLots: [...(prod.finishedGoodsLots ?? []), lot] }
  }
  prod = appendProdAudit(
    prod,
    audit(
      correction ? 'packaging_report_confirm_correction' : 'packaging_report_confirm',
      actor,
      `report ${reportId} lot ${fgQty > EPS ? lotNumber : 'none'}`,
      now,
    ),
  )
  wh = appendWhAudit(
    wh,
    audit('packaging_fg_receipt', actor, `report ${reportId} qty ${fgQty}`, now),
  )

  return ok({
    production: prod,
    warehouse: wh,
    result: {
      reportId,
      status: 'confirmed',
      finishedGoodsLotId: fgQty > EPS ? lotId : null,
      lotNumber: fgQty > EPS ? lotNumber : null,
      reportNumber,
      quantityProduced: fgQty,
      documentIds,
      qcStatus: fgQty > EPS ? 'pending' : undefined,
    },
  })
}

function applyPackagingCreateCorrection(production, command, actor, now) {
  const originalReportId = str(command.originalReportId ?? command.correctsReportId)
  const reason = str(command.correctionReason ?? command.reason)
  if (!originalReportId || !reason) return fail('correction_reason_required', 400)
  const originalMatches = (production.packagingReports ?? []).filter(
    (report) => str(report?.id) === originalReportId,
  )
  if (originalMatches.length === 0) return fail('not_found', 404)
  if (originalMatches.length !== 1) return fail('packaging_report_ambiguous', 409)
  const original = originalMatches[0]
  if (original.status !== 'confirmed') return fail('packaging_report_immutable', 409)
  const outputCounts = resolvePackagingOutputCounts(command, original)
  if (!outputCounts.ok) return outputCounts
  const outputQuantity = resolvePackagingOutputQuantity(command, original)
  if (!outputQuantity.ok) return outputQuantity

  const draftId = str(command.draftId ?? command.reportId) || `pkc-${crypto.randomUUID()}`
  const existing = (production.packagingReports ?? []).find((r) => r.id === draftId)
  if (existing?.status === 'confirmed') {
    return ok({
      production,
      warehouse: null,
      result: { draftId, status: 'confirmed', idempotent: true },
    })
  }

  const wip = Array.isArray(command.wipLines)
    ? sanitizePackagingLines(command.wipLines, {
        itemKey: 'semiFinishedItemId',
        preserveWipLineage: true,
      })
    : { ok: true, lines: original.wipLines ?? [] }
  if (!wip.ok) return fail(wip.error, 400)
  const materials = Array.isArray(command.materialLines)
    ? sanitizePackagingLines(command.materialLines, { itemKey: 'itemId' })
    : { ok: true, lines: original.materialLines ?? [] }
  if (!materials.ok) return fail(materials.error, 400)

  const draft = {
    id: draftId,
    status: 'correction_draft',
    correctsReportId: originalReportId,
    correctionReason: reason,
    productionOrderId: str(command.productionOrderId ?? original.productionOrderId),
    lineId: normalizePackLineId(command.lineId ?? original.lineId ?? PACK_LINE_ID),
    reportDate: str(command.reportDate ?? original.reportDate).slice(0, 10),
    shiftSlot: command.shiftSlot === 'night' ? 'night' : (original.shiftSlot ?? 'day'),
    finishedProductId: str(command.finishedProductId ?? original.finishedProductId),
    warehouseItemId: str(command.warehouseItemId ?? original.warehouseItemId),
    outputM2: roundQty(outputQuantity.value),
    outputRolls: outputCounts.outputRolls,
    outputPallets: outputCounts.outputPallets,
    wipLines: wip.lines,
    materialLines: materials.lines,
    note: command.note != null ? String(command.note) : original.note,
    createdAt: now,
    createdBy: actor.uid,
  }

  const list = [...(production.packagingReports ?? [])]
  const idx = list.findIndex((r) => r.id === draftId)
  if (idx >= 0) list[idx] = draft
  else list.push(draft)
  const next = appendProdAudit(
    { ...production, packagingReports: list },
    audit('packaging_report_correction_draft', actor, `${originalReportId}: ${reason}`, now),
  )
  return ok({
    production: next,
    warehouse: null,
    result: { draftId, status: 'correction_draft', correctsReportId: originalReportId },
  })
}

function applyPackagingConfirmCorrection(production, warehouse, command, actor, now, options = {}) {
  const masterDataActive = options.masterDataActive === true
  const enforceCanonicalLineage = options.enforceCanonicalLineage === true
  const masterData = options.masterData ?? null
  const idempotencyFingerprint = str(options.idempotencyFingerprint)
  const originalReportId = str(command.originalReportId ?? command.correctsReportId)
  const reason = str(command.correctionReason ?? command.reason)
  if (!originalReportId || !reason) return fail('correction_reason_required', 400)
  if (isSysadminActor(actor) && !str(command.emergencyReason ?? reason)) {
    return fail('emergency_reason_required', 400)
  }
  const originalMatches = (production.packagingReports ?? []).filter(
    (report) => str(report?.id) === originalReportId,
  )
  if (originalMatches.length === 0) return fail('not_found', 404)
  if (originalMatches.length !== 1) return fail('packaging_report_ambiguous', 409)
  const original = originalMatches[0]
  if (original.status !== 'confirmed') return fail('packaging_report_immutable', 409)
  const outputCounts = resolvePackagingOutputCounts(command, original)
  if (!outputCounts.ok) return outputCounts
  const outputQuantity = resolvePackagingOutputQuantity(command, original)
  if (!outputQuantity.ok) return outputQuantity
  const originalOrder = (production.orders ?? []).find(
    (candidate) => str(candidate?.id) === str(original.productionOrderId),
  )
  const strictIdempotency =
    enforceCanonicalLineage ||
    Number(original?.wipContractVersion) >= 1 ||
    Number(originalOrder?.wipContractVersion) >= 1

  const correctionKey =
    str(command.reportKey) || `pkgcorr::${originalReportId}::${str(command.idempotencySuffix) || reason}`
  const alreadyMatches = (production.packagingReports ?? []).filter(
    (r) => r.idempotencyKey === correctionKey && r.status === 'confirmed',
  )
  if (alreadyMatches.length > 1) return fail('packaging_report_ambiguous', 409)
  const already = alreadyMatches[0]
  if (already) {
    if (strictIdempotency && !str(already.idempotencyFingerprint)) {
      return fail('packaging_idempotency_conflict', 409)
    }
    if (
      already.idempotencyFingerprint &&
      str(already.idempotencyFingerprint) !== idempotencyFingerprint
    ) {
      return fail('packaging_idempotency_conflict', 409)
    }
    if (
      strictIdempotency &&
      !strictPackagingReplayStateValid(
        {
          reportId: already.id,
          lotId: already.finishedGoodsLotId,
          fingerprint: already.idempotencyFingerprint,
        },
        production,
      )
    ) {
      return fail('packaging_idempotency_state_mismatch', 409)
    }
    const alreadyLot = findLot(production, already.finishedGoodsLotId)
    return ok({
      production,
      warehouse,
      result: {
        reportId: already.id,
        finishedGoodsLotId: already.finishedGoodsLotId ?? null,
        reportNumber: already.number ?? null,
        lotNumber: alreadyLot?.lotNumber ?? already.lotNumber ?? null,
        quantityProduced: alreadyLot?.quantityProduced ?? null,
        documentIds: already.documentIds ?? [],
        qcStatus: alreadyLot?.qcStatus,
        status: 'confirmed',
        idempotent: true,
      },
    })
  }
  if (isPeriodClosed(warehouse, original.reportDate || now.slice(0, 10))) {
    return fail('period_closed', 403)
  }

  const originalLotId = str(original.finishedGoodsLotId)
  const oldLotMatches = (production.finishedGoodsLots ?? []).filter(
    (lot) => str(lot?.id) === originalLotId,
  )
  if (!originalLotId || oldLotMatches.length === 0) {
    return fail('packaging_correction_lot_missing', 409)
  }
  if (oldLotMatches.length !== 1) return fail('packaging_correction_lot_ambiguous', 409)
  const oldLot = oldLotMatches[0]
  if (
    str(oldLot.packagingReportId) !== originalReportId ||
    str(oldLot.productionOrderId) !== str(original.productionOrderId)
  ) {
    return fail('packaging_correction_lot_mismatch', 409)
  }
  const correctionBoundary = validateCanonicalPackagingCorrectionBoundary({
    production,
    warehouse,
    report: original,
    lot: oldLot,
    enforceCanonical: enforceCanonicalLineage,
  })
  if (!correctionBoundary.ok) {
    return fail(
      correctionBoundary.error,
      correctionBoundary.status || 409,
      correctionBoundary,
    )
  }
  const shippedQty = Math.max(0, roundQty(num(oldLot?.quantityShipped) || 0))
  const nextOutput = outputQuantity.value
  // A correction equal to shipped quantity would reverse/supersede the original
  // graph but create no replacement FG lot. G4 has no canonical zero-lot flow,
  // and its ACK/replay contract requires one exact replacement lot.
  if (nextOutput <= shippedQty + EPS) return fail('fg_below_shipped', 409)

  // Storno of the original postings. The already shipped finished-goods quantity stays
  // in the ledger, so the correction only re-posts the still-owned remainder.
  let wh = warehouse
  const reverseDocumentIds = []
  for (const doc of warehouse.documents ?? []) {
    if (doc.packagingReportId !== originalReportId) continue
    if (doc.status !== 'posted') continue
    if (doc.reversesDocumentId) continue
    const keep =
      doc.docRole === 'production_fg_receipt' && shippedQty > EPS && oldLot
        ? new Map([[oldLot.warehouseItemId, shippedQty]])
        : undefined
    const rev = reverseDocument(wh, doc, actor, now, {
      reason,
      docRole: 'packaging_correction_reversal',
      keepQtyByItem: keep,
    })
    wh = rev.warehouse
    if (rev.reverseDocumentId) reverseDocumentIds.push(rev.reverseDocumentId)
  }

  let prod = production
  let supersededDecisionId
  if (oldLot) {
    const wasReleased = oldLot.qcStatus === 'released'
    let supersededLot = {
      ...oldLot,
      quantityProduced: shippedQty,
      quantityQcReleased: 0,
      quantityRemaining: 0,
      qcStatus: 'pending',
      lotRevision: (Number(oldLot.lotRevision) || 1) + 1,
      updatedAt: now,
      correctedAt: now,
      correctedBy: actor.uid,
      correctionReason: reason,
      history: lotHistory(oldLot, {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'superseded_by_correction',
        message: reason,
        actorUid: actor.uid,
      }),
    }
    if (wasReleased) {
      const superseded = buildDecision({
        lot: supersededLot,
        status: 'superseded',
        actor,
        now,
        reason,
      })
      superseded.supersedesDecisionId = oldLot.currentDecisionId ?? undefined
      supersededDecisionId = superseded.id
      supersededLot = { ...supersededLot, currentDecisionId: superseded.id }
      prod = appendDecision(prod, superseded)
    } else {
      supersededLot = { ...supersededLot, currentDecisionId: null }
    }
    prod = replaceLot(prod, supersededLot)
  }

  const reports = (prod.packagingReports ?? []).map((r) =>
    r.id === originalReportId
      ? {
          ...r,
          correctedAt: now,
          updatedAt: now,
          correctedBy: actor.uid,
          correctionOpen: true,
          correctionReason: reason,
        }
      : r,
  )
  prod = { ...prod, packagingReports: reports }

  const confirmed = applyPackagingConfirm(
    prod,
    wh,
    {
      reportId: str(command.reportId ?? command.draftId) || undefined,
      reportKey: correctionKey,
      productionOrderId: command.productionOrderId ?? original.productionOrderId,
      lineId: command.lineId ?? original.lineId,
      reportDate: command.reportDate ?? original.reportDate,
      shiftSlot: command.shiftSlot ?? original.shiftSlot,
      finishedProductId: command.finishedProductId ?? original.finishedProductId,
      warehouseItemId: command.warehouseItemId ?? original.warehouseItemId,
      outputM2: nextOutput,
      outputRolls: outputCounts.outputRolls,
      outputPallets: outputCounts.outputPallets,
      wipLines: Array.isArray(command.wipLines) ? command.wipLines : original.wipLines,
      materialLines: Array.isArray(command.materialLines)
        ? command.materialLines
        : original.materialLines,
      note: command.note ?? original.note,
      unitSnapshot: command.unitSnapshot,
    },
    actor,
    now,
    {
      masterDataActive,
      masterData,
      enforceCanonicalLineage,
      idempotencyFingerprint,
      correction: {
        originalReportId,
        reason,
        carryShippedQty: shippedQty,
        reverseDocumentIds,
        supersededLotId: oldLot?.id,
        // Keep the original report/order BOM version — never switch to a newer live BOM.
        packagingBomSnapshot:
          original.packagingBomSnapshot ??
          (production.orders ?? []).find((o) => o.id === original.productionOrderId)
            ?.packagingBomSnapshot,
      },
    },
  )
  if (!confirmed.ok) return confirmed

  return ok({
    production: confirmed.production,
    warehouse: confirmed.warehouse,
    result: {
      ...confirmed.result,
      correctsReportId: originalReportId,
      reverseDocumentIds,
      supersededLotId: oldLot?.id ?? null,
      supersededDecisionId: supersededDecisionId ?? null,
      requiresNewQc: true,
    },
  })
}

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

function applyQcReviewStart(production, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const lot = findLot(production, command.finishedGoodsLotId ?? command.lotId)
  if (!lot) return fail('not_found', 404)
  if (lot.qcStatus === 'in_review') {
    const decision = exactOneById(production.qcDecisions, lot.currentDecisionId)
    if (
      !commandFingerprint ||
      str(lot.reviewCommandFingerprint) !== commandFingerprint ||
      !decision ||
      decision.status !== 'in_review' ||
      str(decision.commandFingerprint) !== commandFingerprint
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse: null,
      result: {
        finishedGoodsLotId: lot.id,
        qcStatus: 'in_review',
        decisionId: decision.id,
        idempotent: true,
      },
    })
  }
  if (lot.qcStatus !== 'pending' && lot.qcStatus !== 'regrade_pending') {
    return fail('lot_status_invalid', 409, { qcStatus: lot.qcStatus })
  }
  const decision = buildDecision({
    lot,
    status: 'in_review',
    actor,
    now,
    reason: str(command.reason) || undefined,
    commandFingerprint,
  })
  const nextLot = {
    ...lot,
    qcStatus: 'in_review',
    updatedAt: now,
    currentDecisionId: decision.id,
    reviewStartedAt: now,
    reviewStartedBy: actor.uid,
    reviewCommandFingerprint: commandFingerprint,
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'qc_review_started',
      message: decision.id,
      actorUid: actor.uid,
    }),
  }
  let prod = replaceLot(production, nextLot)
  prod = appendDecision(prod, decision)
  prod = appendProdAudit(prod, audit('qc_review_start', actor, `lot ${lot.lotNumber}`, now))
  return ok({
    production: prod,
    warehouse: null,
    result: { finishedGoodsLotId: lot.id, qcStatus: 'in_review', decisionId: decision.id },
  })
}

async function loadVerifiedAttachments(storeId, lotId) {
  const dc = getQcDataConnect()
  const { data } = await listVerifiedLotAttachments(dc, { storeId, lotId })
  const rows = data?.qcAttachmentRecords ?? []
  return {
    passport: rows.find((row) => row.documentKind === 'passport') ?? null,
    protocol: rows.find((row) => row.documentKind === 'protocol') ?? null,
  }
}

/**
 * Re-verify the Storage object behind a verified attachment row. A record whose
 * storagePath is not the canonical QC path is rejected: the path is what binds the
 * PDF bytes to (storeId, lotId, attachmentId).
 */
async function verifyAttachment(record, storeId, lotId) {
  if (!record) return { ok: false, error: 'qc_attachments_required' }
  const expectedPath = buildQcStoragePath(storeId, lotId, record.id)
  if (str(record.storagePath) !== expectedPath) {
    return { ok: false, error: 'attachment_path_mismatch' }
  }
  const verification = await verifyStorageObject({
    storagePath: record.storagePath,
    expectedContentType: record.contentType,
    expectedSizeBytes: record.sizeBytes,
    expectedChecksum: record.checksum,
  })
  if (!verification.ok) return { ok: false, error: verification.error }
  if (
    record.objectGeneration &&
    verification.generation &&
    String(record.objectGeneration) !== String(verification.generation)
  ) {
    return { ok: false, error: 'generation_mismatch' }
  }
  return {
    ok: true,
    attachment: {
      id: record.id,
      storagePath: record.storagePath,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      checksum: record.checksum,
      generation: String(verification.generation ?? record.objectGeneration ?? ''),
    },
  }
}

async function applyQcRelease(production, command, actor, now, context) {
  const { storeId, capabilities, idempotencyKey } = context
  const commandFingerprint = str(context.commandFingerprint)
  // Release is never delegated to sysadmin emergency rights: the capability is required.
  if (
    capabilities[G4_CAPS.QC_RELEASE] !== true &&
    !hasCapability(capabilities, G4_CAPS.QC_RELEASE)
  ) {
    return fail('forbidden', 403)
  }

  const lot = findLot(production, command.finishedGoodsLotId ?? command.lotId)
  if (!lot) return fail('not_found', 404)
  if (lot.qcStatus === 'released') {
    const decision = exactOneById(production.qcDecisions, lot.currentDecisionId)
    if (
      !commandFingerprint ||
      str(lot.releaseCommandFingerprint) !== commandFingerprint ||
      !decision ||
      decision.status !== 'released' ||
      str(decision.commandFingerprint) !== commandFingerprint
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse: null,
      result: {
        finishedGoodsLotId: lot.id,
        lotNumber: lot.lotNumber,
        qcStatus: 'released',
        decisionId: decision.id,
        lotRevision: lot.lotRevision,
        quantityQcReleased: lot.quantityQcReleased,
        quantityRemaining: lot.quantityRemaining,
        passportAttachmentId: decision.passportAttachmentId,
        protocolAttachmentId: decision.protocolAttachmentId,
        idempotent: true,
      },
    })
  }
  if (!QC_RELEASABLE_STATUSES.has(str(lot.qcStatus))) {
    return fail('lot_status_invalid', 409, { qcStatus: lot.qcStatus })
  }
  const quantityProduced = roundQty(num(lot.quantityProduced) || 0)
  if (quantityProduced <= EPS) return fail('invalid_quantity', 400)

  const verified = await loadVerifiedAttachments(storeId, lot.id)
  if (!verified.passport || !verified.protocol) return fail('qc_attachments_required', 400)
  const passport = await verifyAttachment(verified.passport, storeId, lot.id)
  if (!passport.ok) return fail(passport.error, 400)
  const protocol = await verifyAttachment(verified.protocol, storeId, lot.id)
  if (!protocol.ok) return fail(protocol.error, 400)

  const nextRevision = (Number(lot.lotRevision) || 1) + 1
  const decision = buildDecision({
    lot: { ...lot, lotRevision: nextRevision },
    status: 'released',
    actor,
    now,
    reason: str(command.reason) || undefined,
    attachments: { passport: passport.attachment, protocol: protocol.attachment },
    quantity: quantityProduced,
    idempotencyKey,
    commandFingerprint,
  })
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  const nextLot = {
    ...lot,
    qcStatus: 'released',
    updatedAt: now,
    quantityQcReleased: quantityProduced,
    quantityRemaining: roundQty(quantityProduced - shipped),
    currentDecisionId: decision.id,
    lotRevision: nextRevision,
    releasedAt: now,
    releasedBy: actor.uid,
    releasedByName: actor.email ?? actor.uid,
    releaseCommandFingerprint: commandFingerprint,
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'qc_released',
      message: `${decision.id} passport=${passport.attachment.id} protocol=${protocol.attachment.id}`,
      actorUid: actor.uid,
    }),
  }

  let prod = replaceLot(production, nextLot)
  prod = appendDecision(prod, decision)
  prod = appendProdAudit(prod, audit('qc_release', actor, `lot ${lot.lotNumber}`, now))

  return ok({
    production: prod,
    warehouse: null,
    projection: { lot: nextLot, decision },
    result: {
      finishedGoodsLotId: lot.id,
      lotNumber: lot.lotNumber,
      qcStatus: 'released',
      decisionId: decision.id,
      lotRevision: nextRevision,
      quantityQcReleased: quantityProduced,
      quantityRemaining: nextLot.quantityRemaining,
      passportAttachmentId: passport.attachment.id,
      protocolAttachmentId: protocol.attachment.id,
    },
  })
}

function applyQcRegrade(production, warehouse, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const reason = str(command.reason ?? command.regradeReason)
  if (!reason) return fail('regrade_reason_required', 400)
  const targetFinishedProductId = str(command.targetFinishedProductId)
  if (!targetFinishedProductId) return fail('target_finished_product_required', 400)
  // Regrade must point at a catalogue id; a typed product name is not a target.
  if (/\s/.test(targetFinishedProductId)) return fail('invalid_target_product', 400)
  if (
    str(command.targetFinishedProductName) ||
    str(command.targetProductName) ||
    str(command.targetProduct)
  ) {
    return fail('free_text_product_forbidden', 400)
  }

  const lot = findLot(production, command.finishedGoodsLotId ?? command.lotId)
  if (!lot) return fail('not_found', 404)
  if (lot.qcStatus === 'regrade_pending' && str(lot.regradeCommandFingerprint)) {
    const decision = exactOneById(production.qcDecisions, lot.currentDecisionId)
    const child = exactOneById(production.finishedGoodsLots, lot.regradedToLotId)
    if (
      !commandFingerprint ||
      str(lot.regradeCommandFingerprint) !== commandFingerprint ||
      !decision ||
      decision.status !== 'regrade_pending' ||
      str(decision.commandFingerprint) !== commandFingerprint ||
      !child ||
      str(child.parentLotId) !== str(lot.id)
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        finishedGoodsLotId: lot.id,
        qcStatus: 'regrade_pending',
        decisionId: decision.id,
        newFinishedGoodsLotId: child.id,
        newLotNumber: child.lotNumber,
        targetFinishedProductId: child.finishedProductId,
        quantity: child.quantityProduced,
        documentIds: lot.regradeDocumentIds ?? [],
        movementIds: lot.regradeMovementIds ?? [],
        idempotent: true,
      },
    })
  }
  if (lot.qcStatus === 'written_off' || lot.qcStatus === 'scrap_pending') {
    return fail('lot_status_invalid', 409, { qcStatus: lot.qcStatus })
  }
  const produced = roundQty(num(lot.quantityProduced) || 0)
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  const regradable = roundQty(produced - shipped)
  if (regradable <= EPS) return fail('nothing_to_regrade', 409)

  const requested = command.quantity != null ? num(command.quantity) : regradable
  if (!Number.isFinite(requested) || requested <= 0) return fail('invalid_quantity', 400)
  if (requested > regradable + EPS) return fail('quantity_exceeds_remaining', 400)
  const quantity = roundQty(requested)

  const date = str(command.date ?? now).slice(0, 10)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const warehouseId = str(lot.warehouseId)
  const locationId = str(lot.locationId)
  if (!warehouseId) return fail('lot_location_unknown', 409)
  const onHand = balanceAt(warehouse.movements, {
    warehouseId,
    locationId,
    itemId: lot.warehouseItemId,
    batchNo: lot.lotNumber,
  })
  if (quantity > onHand + EPS) {
    return fail('insufficient_stock', 400, { available: roundQty(onHand), requested: quantity })
  }

  const targetWarehouseItemId = str(command.targetWarehouseItemId) || targetFinishedProductId
  const newLotId = `fgl-${crypto.randomUUID()}`
  const newLotNumber = nextLotNumber(production.finishedGoodsLots, date)
  const transferPairId = crypto.randomUUID()

  let wh = warehouse
  const issue = postWarehouseDoc(
    wh,
    {
      type: 'issue',
      purpose: 'transfer',
      docRole: 'qc_regrade_issue',
      warehouseId,
      date,
      lines: [{ itemId: lot.warehouseItemId, quantity, batchNo: lot.lotNumber, locationId }],
      movementType: 'issue',
      docExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        cancellationReason: reason,
        isFinishedGoods: true,
        commandFingerprint,
      },
      movementExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        isFinishedGoods: true,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  wh = issue.warehouse
  const receipt = postWarehouseDoc(
    wh,
    {
      type: 'receipt',
      purpose: 'transfer',
      docRole: 'qc_regrade_receipt',
      warehouseId,
      date,
      lines: [{ itemId: targetWarehouseItemId, quantity, batchNo: newLotNumber, locationId }],
      movementType: 'receipt',
      docExtra: {
        finishedGoodsLotId: newLotId,
        parentFinishedGoodsLotId: lot.id,
        transferPairId,
        isFinishedGoods: true,
        commandFingerprint,
      },
      movementExtra: {
        finishedGoodsLotId: newLotId,
        transferPairId,
        isFinishedGoods: true,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  wh = receipt.warehouse

  const nextRevision = (Number(lot.lotRevision) || 1) + 1
  const decision = buildDecision({
    lot: { ...lot, lotRevision: nextRevision },
    status: 'regrade_pending',
    actor,
    now,
    reason,
    targetFinishedProductId,
    quantity,
    commandFingerprint,
  })
  const sourceLot = {
    ...lot,
    // regrade_pending fails the release gate, so the source lot can no longer ship.
    qcStatus: 'regrade_pending',
    updatedAt: now,
    quantityProduced: roundQty(produced - quantity),
    quantityQcReleased: 0,
    quantityRemaining: 0,
    currentDecisionId: decision.id,
    lotRevision: nextRevision,
    regradedAt: now,
    regradedBy: actor.uid,
    regradeReason: reason,
    regradedToLotId: newLotId,
    regradeCommandFingerprint: commandFingerprint,
    regradeDocumentIds: [issue.documentId, receipt.documentId],
    regradeMovementIds: [...issue.movements, ...receipt.movements].map((movement) => movement.id),
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'qc_regrade',
      message: `${quantity} → ${targetFinishedProductId} (${newLotNumber})`,
      actorUid: actor.uid,
    }),
  }
  const childLot = {
    id: newLotId,
    lotNumber: newLotNumber,
    packagingReportId: lot.packagingReportId,
    productionOrderId: lot.productionOrderId,
    lineId: lot.lineId,
    finishedProductId: targetFinishedProductId,
    warehouseItemId: targetWarehouseItemId,
    warehouseId,
    locationId,
    qcStatus: 'pending',
    outputRolls: 0,
    outputPallets: 0,
    quantityProduced: quantity,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    lotRevision: 1,
    currentDecisionId: null,
    parentLotId: lot.id,
    regradeReason: reason,
    producedAt: date,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.uid,
    createdByName: actor.email ?? actor.uid,
    history: [
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'created_by_regrade',
        message: `from ${lot.lotNumber}: ${reason}`,
        actorUid: actor.uid,
      },
    ],
  }

  let prod = replaceLot(production, sourceLot)
  prod = { ...prod, finishedGoodsLots: [...(prod.finishedGoodsLots ?? []), childLot] }
  prod = appendDecision(prod, decision)
  prod = appendProdAudit(
    prod,
    audit('qc_regrade', actor, `lot ${lot.lotNumber} → ${newLotNumber}: ${reason}`, now),
  )
  wh = appendWhAudit(wh, audit('qc_regrade_transfer', actor, `lot ${lot.lotNumber}`, now))

  return ok({
    production: prod,
    warehouse: wh,
    result: {
      finishedGoodsLotId: lot.id,
      qcStatus: 'regrade_pending',
      decisionId: decision.id,
      newFinishedGoodsLotId: newLotId,
      newLotNumber,
      targetFinishedProductId,
      quantity,
      documentIds: [issue.documentId, receipt.documentId],
      movementIds: [...issue.movements, ...receipt.movements].map((movement) => movement.id),
    },
  })
}

function applyQcReject(production, warehouse, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const reason = str(command.reason ?? command.rejectReason)
  if (!reason) return fail('reject_reason_required', 400)
  const lot = findLot(production, command.finishedGoodsLotId ?? command.lotId)
  if (!lot) return fail('not_found', 404)
  if (lot.qcStatus === 'scrap_pending') {
    const decision = exactOneById(production.qcDecisions, lot.currentDecisionId)
    if (
      !commandFingerprint ||
      str(lot.rejectCommandFingerprint) !== commandFingerprint ||
      !decision ||
      decision.status !== 'rejected' ||
      str(decision.commandFingerprint) !== commandFingerprint
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        finishedGoodsLotId: lot.id,
        qcStatus: 'scrap_pending',
        decisionId: decision.id,
        scrapLocationId: lot.scrapLocationId,
        quantity: lot.scrapQuantity,
        documentIds: lot.rejectDocumentIds ?? [],
        movementIds: lot.rejectMovementIds ?? [],
        idempotent: true,
      },
    })
  }
  if (lot.qcStatus === 'written_off') return fail('lot_status_invalid', 409, { qcStatus: lot.qcStatus })

  const produced = roundQty(num(lot.quantityProduced) || 0)
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  const quantity = roundQty(produced - shipped)
  if (quantity <= EPS) return fail('nothing_to_reject', 409)

  const date = str(command.date ?? now).slice(0, 10)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const scrapLocationId = str(command.scrapLocationId ?? warehouse.scrapLocationId)
  if (!scrapLocationId) return fail('scrap_location_not_configured', 400)
  const warehouseId = str(lot.warehouseId)
  const locationId = str(lot.locationId)
  if (!warehouseId) return fail('lot_location_unknown', 409)
  if (scrapLocationId === locationId) return fail('scrap_location_invalid', 400)

  const onHand = balanceAt(warehouse.movements, {
    warehouseId,
    locationId,
    itemId: lot.warehouseItemId,
    batchNo: lot.lotNumber,
  })
  if (quantity > onHand + EPS) {
    return fail('insufficient_stock', 400, { available: roundQty(onHand), requested: quantity })
  }

  const transferPairId = crypto.randomUUID()
  let wh = warehouse
  const issue = postWarehouseDoc(
    wh,
    {
      type: 'issue',
      purpose: 'transfer',
      docRole: 'qc_reject_issue',
      warehouseId,
      date,
      lines: [{ itemId: lot.warehouseItemId, quantity, batchNo: lot.lotNumber, locationId }],
      movementType: 'issue',
      docExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        cancellationReason: reason,
        isFinishedGoods: true,
        commandFingerprint,
      },
      movementExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        isFinishedGoods: true,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  wh = issue.warehouse
  const receipt = postWarehouseDoc(
    wh,
    {
      type: 'receipt',
      purpose: 'transfer',
      docRole: 'qc_reject_scrap_receipt',
      warehouseId,
      date,
      lines: [
        { itemId: lot.warehouseItemId, quantity, batchNo: lot.lotNumber, locationId: scrapLocationId },
      ],
      movementType: 'receipt',
      docExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        isScrap: true,
        commandFingerprint,
      },
      movementExtra: {
        finishedGoodsLotId: lot.id,
        transferPairId,
        isScrap: true,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  wh = receipt.warehouse

  const nextRevision = (Number(lot.lotRevision) || 1) + 1
  const decision = buildDecision({
    lot: { ...lot, lotRevision: nextRevision },
    status: 'rejected',
    actor,
    now,
    reason,
    quantity,
    commandFingerprint,
  })
  // No automatic write-off: scrap stock stays on the books until qc.scrap.writeoff.
  const nextLot = {
    ...lot,
    qcStatus: 'scrap_pending',
    updatedAt: now,
    quantityQcReleased: 0,
    quantityRemaining: 0,
    locationId: scrapLocationId,
    scrapLocationId,
    scrapQuantity: quantity,
    currentDecisionId: decision.id,
    lotRevision: nextRevision,
    rejectedAt: now,
    rejectedBy: actor.uid,
    rejectReason: reason,
    rejectCommandFingerprint: commandFingerprint,
    rejectDocumentIds: [issue.documentId, receipt.documentId],
    rejectMovementIds: [...issue.movements, ...receipt.movements].map((movement) => movement.id),
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'qc_rejected',
      message: reason,
      actorUid: actor.uid,
    }),
  }

  let prod = replaceLot(production, nextLot)
  prod = appendDecision(prod, decision)
  prod = appendProdAudit(prod, audit('qc_reject', actor, `lot ${lot.lotNumber}: ${reason}`, now))
  wh = appendWhAudit(wh, audit('qc_reject_transfer', actor, `lot ${lot.lotNumber}`, now))

  return ok({
    production: prod,
    warehouse: wh,
    result: {
      finishedGoodsLotId: lot.id,
      qcStatus: 'scrap_pending',
      decisionId: decision.id,
      scrapLocationId,
      quantity,
      documentIds: [issue.documentId, receipt.documentId],
      movementIds: [...issue.movements, ...receipt.movements].map((movement) => movement.id),
    },
  })
}

function applyQcScrapWriteoff(production, warehouse, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const reason = str(command.reason ?? command.writeoffReason)
  if (!reason) return fail('writeoff_reason_required', 400)
  const lot = findLot(production, command.finishedGoodsLotId ?? command.lotId)
  if (!lot) return fail('not_found', 404)
  if (lot.qcStatus === 'written_off') {
    const decision = exactOneById(production.qcDecisions, lot.currentDecisionId)
    if (
      !commandFingerprint ||
      str(lot.writeoffCommandFingerprint) !== commandFingerprint ||
      !decision ||
      decision.status !== 'written_off' ||
      str(decision.commandFingerprint) !== commandFingerprint
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        finishedGoodsLotId: lot.id,
        qcStatus: 'written_off',
        decisionId: decision.id,
        quantity: lot.quantityWrittenOff,
        documentId: lot.writeoffDocumentId,
        movementId: lot.writeoffMovementId,
        idempotent: true,
      },
    })
  }
  if (lot.qcStatus !== 'scrap_pending') return fail('lot_status_invalid', 409, { qcStatus: lot.qcStatus })

  const date = str(command.date ?? now).slice(0, 10)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const warehouseId = str(lot.warehouseId)
  const scrapLocationId = str(lot.scrapLocationId ?? lot.locationId ?? warehouse.scrapLocationId)
  if (!warehouseId || !scrapLocationId) return fail('scrap_location_not_configured', 400)

  const onHand = balanceAt(warehouse.movements, {
    warehouseId,
    locationId: scrapLocationId,
    itemId: lot.warehouseItemId,
    batchNo: lot.lotNumber,
  })
  const requested =
    command.quantity != null ? num(command.quantity) : roundQty(num(lot.scrapQuantity) || onHand)
  if (!Number.isFinite(requested) || requested <= 0) return fail('invalid_quantity', 400)
  const quantity = roundQty(requested)
  if (quantity > onHand + EPS) {
    return fail('insufficient_stock', 400, { available: roundQty(onHand), requested: quantity })
  }

  const writeoff = postWarehouseDoc(
    warehouse,
    {
      type: 'issue',
      purpose: 'writeoff',
      docRole: 'qc_scrap_writeoff',
      warehouseId,
      date,
      lines: [
        {
          itemId: lot.warehouseItemId,
          quantity,
          batchNo: lot.lotNumber,
          locationId: scrapLocationId,
        },
      ],
      movementType: 'issue',
      docExtra: {
        finishedGoodsLotId: lot.id,
        cancellationReason: reason,
        isScrap: true,
        commandFingerprint,
      },
      movementExtra: { finishedGoodsLotId: lot.id, isScrap: true, commandFingerprint },
    },
    actor,
    now,
  )
  let wh = writeoff.warehouse

  const nextRevision = (Number(lot.lotRevision) || 1) + 1
  const decision = buildDecision({
    lot: { ...lot, lotRevision: nextRevision },
    status: 'written_off',
    actor,
    now,
    reason,
    quantity,
    commandFingerprint,
  })
  const nextLot = {
    ...lot,
    qcStatus: 'written_off',
    updatedAt: now,
    quantityQcReleased: 0,
    quantityRemaining: 0,
    quantityWrittenOff: quantity,
    currentDecisionId: decision.id,
    lotRevision: nextRevision,
    writtenOffAt: now,
    writtenOffBy: actor.uid,
    writeoffReason: reason,
    writeoffCommandFingerprint: commandFingerprint,
    writeoffDocumentId: writeoff.documentId,
    writeoffMovementId: writeoff.movements[0]?.id,
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'qc_written_off',
      message: reason,
      actorUid: actor.uid,
    }),
  }

  let prod = replaceLot(production, nextLot)
  prod = appendDecision(prod, decision)
  prod = appendProdAudit(
    prod,
    audit('qc_scrap_writeoff', actor, `lot ${lot.lotNumber}: ${reason}`, now),
  )
  wh = appendWhAudit(wh, audit('qc_scrap_writeoff', actor, `lot ${lot.lotNumber}`, now))

  return ok({
    production: prod,
    warehouse: wh,
    result: {
      finishedGoodsLotId: lot.id,
      qcStatus: 'written_off',
      decisionId: decision.id,
      quantity,
      documentId: writeoff.documentId,
      movementId: writeoff.movements[0]?.id,
    },
  })
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

function findShipment(warehouse, shipmentId) {
  const id = str(shipmentId)
  if (!id) return null
  return (warehouse.loadingShipments ?? []).find((s) => s.id === id) ?? null
}

function replaceShipment(warehouse, shipment) {
  const list = [...(warehouse.loadingShipments ?? [])]
  const idx = list.findIndex((s) => s.id === shipment.id)
  if (idx >= 0) list[idx] = shipment
  else list.push(shipment)
  return { ...warehouse, loadingShipments: list }
}

function applyShipmentDraftSave(warehouse, command, actor, now) {
  const shipmentId = str(command.shipmentId ?? command.draftId) || `shp-${crypto.randomUUID()}`
  const existing = findShipment(warehouse, shipmentId)
  if (existing && existing.status !== 'draft') return fail('shipment_immutable', 409)

  const quantity = command.quantity != null ? num(command.quantity) : undefined
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) {
    return fail('invalid_quantity', 400)
  }
  const draft = {
    ...(existing ?? {}),
    id: shipmentId,
    status: 'draft',
    kind: 'finished_goods_shipment',
    groupKind: 'finished_goods_shipment',
    date: str(command.date ?? existing?.date ?? now).slice(0, 10),
    warehouseId: str(command.warehouseId ?? existing?.warehouseId),
    locationId: str(command.locationId ?? existing?.locationId) || undefined,
    finishedProductId: str(command.finishedProductId ?? existing?.finishedProductId) || undefined,
    finishedGoodsLotId:
      str(command.finishedGoodsLotId ?? command.lotId ?? existing?.finishedGoodsLotId) || undefined,
    quantity: quantity != null ? roundQty(quantity) : existing?.quantity,
    counterpartyId: str(command.counterpartyId ?? existing?.counterpartyId) || undefined,
    // Reference only — never part of the release/shipment authorization.
    salesOrderId: str(command.salesOrderId ?? existing?.salesOrderId) || undefined,
    vehicle: command.vehicle != null ? String(command.vehicle) : existing?.vehicle,
    note: command.note != null ? String(command.note) : existing?.note,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  return ok({
    production: null,
    warehouse: replaceShipment(warehouse, draft),
    result: { shipmentId, status: 'draft' },
  })
}

function applyShipmentDraftDelete(warehouse, command, actor, now) {
  const shipmentId = str(command.shipmentId ?? command.draftId)
  if (!shipmentId) return fail('invalid_input', 400)
  const existing = findShipment(warehouse, shipmentId)
  if (!existing) return fail('not_found', 404)
  if (existing.status !== 'draft') return fail('shipment_immutable', 409)
  const list = (warehouse.loadingShipments ?? []).filter((s) => s.id !== shipmentId)
  const wh = appendWhAudit(
    { ...warehouse, loadingShipments: list },
    audit('shipment_draft_delete', actor, shipmentId, now),
  )
  return ok({ production: null, warehouse: wh, result: { shipmentId, deleted: true } })
}

function applyShipmentPost(production, warehouse, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const shipmentId = str(command.shipmentId) || `shp-${crypto.randomUUID()}`
  const existing = findShipment(warehouse, shipmentId)
  if (existing?.status === 'posted') {
    const lot = findLot(production, existing.finishedGoodsLotId)
    const documentIds = Array.isArray(existing.documentIds) ? existing.documentIds : []
    const movementIds = Array.isArray(existing.movementIds) ? existing.movementIds : []
    if (
      !commandFingerprint ||
      str(existing.postCommandFingerprint ?? existing.commandFingerprint) !== commandFingerprint ||
      !lot ||
      documentIds.length !== 1 ||
      movementIds.length !== 1
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        shipmentId,
        status: 'posted',
        finishedGoodsLotId: existing.finishedGoodsLotId,
        finishedProductId: existing.finishedProductId,
        warehouseId: existing.warehouseId,
        locationId: existing.locationId,
        date: existing.date,
        counterpartyId: existing.counterpartyId,
        salesOrderId: existing.salesOrderId,
        quantity: existing.quantity,
        quantityShipped: lot.quantityShipped,
        quantityRemaining: lot.quantityRemaining,
        qcDecisionId: existing.qcDecisionId,
        documentId: documentIds[0],
        movementId: movementIds[0],
        idempotent: true,
      },
    })
  }
  if (existing?.status === 'cancelled') return fail('shipment_immutable', 409)

  const finishedProductId = str(command.finishedProductId)
  const lotId = str(command.finishedGoodsLotId ?? command.lotId)
  const quantityRaw = num(command.quantity)
  if (!finishedProductId || !lotId) return fail('invalid_input', 400)
  if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) return fail('invalid_quantity', 400)
  const quantity = roundQty(quantityRaw)

  const lot = findLot(production, lotId)
  if (!lot) return fail('not_found', 404)
  if (str(lot.finishedProductId) !== finishedProductId) return fail('lot_item_mismatch', 400)

  if (lot.qcStatus !== 'released') return fail('lot_not_released', 400, { qcStatus: lot.qcStatus })
  // Authoritative gate: the lot's current decision snapshot must itself be a release
  // for exactly this lot revision. A decision left behind by an earlier revision is stale.
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
  const remaining = roundQty(released - shipped)
  if (remaining <= EPS) return fail('quantity_exceeds_remaining', 400, { remaining: 0 })
  if (quantity > remaining + EPS) return fail('quantity_exceeds_remaining', 400, { remaining })

  const date = str(command.date ?? existing?.date ?? now).slice(0, 10)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const warehouseId = str(command.warehouseId ?? lot.warehouseId)
  if (!warehouseId) return fail('invalid_warehouse', 400)
  if (warehouseId !== str(lot.warehouseId)) return fail('lot_warehouse_mismatch', 400)
  const locationId = str(lot.locationId)

  const onHand = balanceAt(warehouse.movements, {
    warehouseId,
    locationId,
    itemId: lot.warehouseItemId,
    batchNo: lot.lotNumber,
  })
  if (quantity > onHand + EPS) {
    return fail('insufficient_stock', 400, { available: roundQty(onHand), requested: quantity })
  }

  const posted = postWarehouseDoc(
    warehouse,
    {
      type: 'issue',
      purpose: 'loading',
      docRole: 'finished_goods_shipment',
      warehouseId,
      date,
      lines: [
        {
          itemId: lot.warehouseItemId,
          quantity,
          batchNo: lot.lotNumber,
          locationId,
          unitSnapshot: command.unitSnapshot != null ? String(command.unitSnapshot) : undefined,
        },
      ],
      movementType: 'issue',
      docExtra: {
        finishedGoodsLotId: lot.id,
        shipmentId,
        counterpartyId: str(command.counterpartyId) || undefined,
        salesOrderId: str(command.salesOrderId) || undefined,
        qcDecisionId: decision.id,
        isFinishedGoods: true,
        commandFingerprint,
      },
      movementExtra: {
        finishedGoodsLotId: lot.id,
        shipmentId,
        isFinishedGoods: true,
        commandFingerprint,
      },
    },
    actor,
    now,
  )
  let wh = posted.warehouse

  const nextShipped = roundQty(shipped + quantity)
  const nextLot = {
    ...lot,
    quantityShipped: nextShipped,
    quantityRemaining: roundQty(released - nextShipped),
    updatedAt: now,
    lastShipmentId: shipmentId,
    lastShippedAt: now,
    history: lotHistory(lot, {
      id: `h-${crypto.randomUUID()}`,
      at: now,
      type: 'shipped',
      message: `${quantity} via ${shipmentId}`,
      actorUid: actor.uid,
    }),
  }

  const shipment = {
    ...(existing ?? {}),
    id: shipmentId,
    status: 'posted',
    kind: 'finished_goods_shipment',
    groupKind: 'finished_goods_shipment',
    date,
    warehouseId,
    locationId: locationId || undefined,
    finishedProductId,
    warehouseItemId: lot.warehouseItemId,
    finishedGoodsLotId: lot.id,
    lotNumber: lot.lotNumber,
    quantity,
    counterpartyId: str(command.counterpartyId) || existing?.counterpartyId,
    salesOrderId: str(command.salesOrderId) || existing?.salesOrderId,
    vehicle: command.vehicle != null ? String(command.vehicle) : existing?.vehicle,
    note: command.note != null ? String(command.note) : existing?.note,
    qcDecisionId: decision.id,
    lotRevisionAtPost: Number(lot.lotRevision) || 1,
    documentIds: [posted.documentId],
    movementIds: posted.movements.map((movement) => movement.id),
    commandFingerprint,
    postCommandFingerprint: commandFingerprint,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    updatedAt: now,
  }
  wh = replaceShipment(wh, shipment)
  wh = appendWhAudit(
    wh,
    audit('finished_goods_shipment_post', actor, `lot ${lot.lotNumber} qty ${quantity}`, now),
  )

  let prod = replaceLot(production, nextLot)
  prod = appendProdAudit(
    prod,
    audit('finished_goods_shipment_post', actor, `lot ${lot.lotNumber} qty ${quantity}`, now),
  )

  return ok({
    production: prod,
    warehouse: wh,
    projection: { lot: nextLot },
    result: {
      shipmentId,
      status: 'posted',
      finishedGoodsLotId: lot.id,
      finishedProductId,
      lotNumber: lot.lotNumber,
      warehouseId,
      locationId,
      date,
      counterpartyId: str(command.counterpartyId) || existing?.counterpartyId,
      salesOrderId: str(command.salesOrderId) || existing?.salesOrderId,
      quantity,
      quantityShipped: nextShipped,
      quantityRemaining: nextLot.quantityRemaining,
      qcDecisionId: decision.id,
      documentId: posted.documentId,
      movementId: posted.movements[0]?.id,
    },
  })
}

function applyShipmentCancel(production, warehouse, command, actor, now, options = {}) {
  const commandFingerprint = str(options.commandFingerprint)
  const shipmentId = str(command.shipmentId)
  const reason = str(command.reason ?? command.cancellationReason)
  if (!shipmentId) return fail('invalid_input', 400)
  if (!reason) return fail('cancel_reason_required', 400)

  const shipment = findShipment(warehouse, shipmentId)
  if (!shipment) return fail('not_found', 404)
  if (shipment.status === 'cancelled') {
    const lot = findLot(production, shipment.finishedGoodsLotId)
    if (
      !commandFingerprint ||
      str(shipment.cancelCommandFingerprint) !== commandFingerprint ||
      !lot ||
      !Array.isArray(shipment.reversalDocumentIds) ||
      !Array.isArray(shipment.reversalMovementIds)
    ) {
      return fail('g4_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        shipmentId,
        status: 'cancelled',
        finishedGoodsLotId: shipment.finishedGoodsLotId,
        quantity: shipment.quantity,
        quantityShipped: lot.quantityShipped,
        quantityRemaining: lot.quantityRemaining,
        reason: shipment.cancellationReason,
        date: shipment.cancellationDate,
        reversalDocumentIds: shipment.reversalDocumentIds,
        reversalMovementIds: shipment.reversalMovementIds,
        idempotent: true,
      },
    })
  }
  if (shipment.status !== 'posted') return fail('shipment_not_posted', 409)

  const date = str(command.date ?? now).slice(0, 10)
  // Both the original shipment month and the storno month must be open.
  if (isPeriodClosed(warehouse, shipment.date || date) || isPeriodClosed(warehouse, date)) {
    return fail('period_closed', 403)
  }

  const lot = findLot(production, shipment.finishedGoodsLotId)
  if (!lot) return fail('not_found', 404)
  // Cancelling returns finished goods to the lot; that is only meaningful while the
  // lot still exists as sellable stock.
  if (lot.qcStatus === 'written_off' || lot.qcStatus === 'scrap_pending') {
    return fail('shipment_cancel_incompatible', 409, { qcStatus: lot.qcStatus })
  }
  const quantity = roundQty(num(shipment.quantity) || 0)
  if (quantity <= EPS) return fail('invalid_quantity', 400)
  const shipped = Math.max(0, roundQty(num(lot.quantityShipped) || 0))
  if (quantity > shipped + EPS) return fail('quantity_exceeds_shipped', 400)

  let wh = warehouse
  const reversalDocumentIds = []
  const docIds = new Set([
    ...(Array.isArray(shipment.documentIds) ? shipment.documentIds : []),
  ])
  for (const doc of warehouse.documents ?? []) {
    if (doc.shipmentId !== shipmentId && !docIds.has(doc.id)) continue
    if (doc.status !== 'posted') continue
    if (doc.reversesDocumentId) continue
    if (doc.docRole === 'finished_goods_shipment_cancel') continue
    const rev = reverseDocument(wh, doc, actor, now, {
      reason,
      docRole: 'finished_goods_shipment_cancel',
      commandFingerprint,
    })
    wh = rev.warehouse
    if (rev.reverseDocumentId) reversalDocumentIds.push(rev.reverseDocumentId)
  }
  if (reversalDocumentIds.length === 0) return fail('shipment_documents_missing', 409)
  const reversalMovementIds = (wh.movements ?? [])
    .filter((movement) => reversalDocumentIds.includes(str(movement.documentId)))
    .map((movement) => str(movement.id))
    .filter(Boolean)
  if (reversalMovementIds.length !== reversalDocumentIds.length) {
    return fail('shipment_movements_missing', 409)
  }

  const released = roundQty(num(lot.quantityQcReleased) || 0)
  const nextShipped = roundQty(shipped - quantity)
  const nextLot = {
    ...lot,
    quantityShipped: nextShipped,
    quantityRemaining: roundQty(released - nextShipped),
    updatedAt: now,
    history: lotHistory(lot, {
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
    reversalMovementIds,
    cancelledAt: now,
    cancelledBy: actor.uid,
    cancelledByName: actor.email ?? actor.uid,
    cancellationReason: reason,
    cancellationDate: date,
    cancelCommandFingerprint: commandFingerprint,
    updatedAt: now,
  }
  wh = replaceShipment(wh, cancelled)
  wh = appendWhAudit(
    wh,
    audit('finished_goods_shipment_cancel', actor, `${shipmentId}: ${reason}`, now),
  )

  let prod = replaceLot(production, nextLot)
  prod = appendProdAudit(
    prod,
    audit('finished_goods_shipment_cancel', actor, `lot ${lot.lotNumber}: ${reason}`, now),
  )

  return ok({
    production: prod,
    warehouse: wh,
    projection: { lot: nextLot },
    result: {
      shipmentId,
      status: 'cancelled',
      finishedGoodsLotId: lot.id,
      quantity,
      quantityShipped: nextShipped,
      quantityRemaining: nextLot.quantityRemaining,
      reason,
      date,
      reversalDocumentIds,
      reversalMovementIds,
    },
  })
}

// ---------------------------------------------------------------------------
// Projections (best-effort, AFTER a successful CAS)
// ---------------------------------------------------------------------------

async function writeQcProjections({ storeId, actor, idempotencyKey, lot, decision }) {
  if (!lot) return
  try {
    const dc = getQcDataConnect()
    if (decision) {
      await insertQcLotDecision(dc, {
        id: decision.id,
        storeId,
        lotId: lot.id,
        lotRevision: Math.trunc(Number(decision.lotRevision) || 1),
        decisionVersion: Math.trunc(Number(decision.lotRevision) || 1),
        status: decision.status,
        passportAttachmentId: decision.passportAttachmentId ?? null,
        protocolAttachmentId: decision.protocolAttachmentId ?? null,
        targetFinishedProductId: decision.targetFinishedProductId ?? null,
        reason: decision.reason ?? null,
        decidedByUid: actor.uid,
        decidedAt: decision.at,
        revision: 1,
        idempotencyKey: idempotencyKey || decision.id,
      })
    }
    await upsertQcFinishedGoodsLot(dc, {
      id: lot.id,
      storeId,
      finishedProductId: str(lot.finishedProductId),
      warehouseItemId: str(lot.warehouseItemId),
      batchNo: str(lot.lotNumber),
      quantityProduced: Number(lot.quantityProduced) || 0,
      quantityShipped: Number(lot.quantityShipped) || 0,
      packagingReportId: str(lot.packagingReportId),
      status: str(lot.qcStatus) || 'pending',
      revision: Math.trunc(Number(lot.lotRevision) || 1),
      updatedByUid: actor.uid,
    })
  } catch (err) {
    console.warn('g4 qc projection failed', err)
  }
}

/**
 * PHASE G4.1 — rebuild the SQL read model from FstCriticalStore truth.
 *
 * The projection writes in `writeQcProjections` are best-effort, so a Data Connect
 * outage can leave QcFinishedGoodsLot / QcLotDecision behind the critical store.
 * This helper re-pushes every lot and its current decision; the critical store is
 * never modified and a per-row failure never aborts the sweep.
 *
 * Callers must authorize first — this is a server-side maintenance routine, not an
 * HTTP handler.
 */
export async function reconcileQcProjectionsFromCritical(storeId, actorUid) {
  const id = str(storeId)
  if (!id) return fail('invalid_input', 400)

  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id })
  const row = data?.fstCriticalStore
  if (!row) return fail('not_found', 404)
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)

  const production = parsed.payload.domains.production ?? emptyProductionStore()
  const lots = production.finishedGoodsLots ?? []
  const decisions = production.qcDecisions ?? []
  const actor = { uid: str(actorUid) || str(row.updatedByUid) || 'system' }

  const qc = getQcDataConnect()
  let lotsWritten = 0
  let decisionsWritten = 0
  let decisionsSkipped = 0
  const failures = []

  for (const lot of lots) {
    const decision = decisions.find((d) => str(d.id) === str(lot.currentDecisionId)) ?? null
    if (decision) {
      try {
        await insertQcLotDecision(qc, {
          id: decision.id,
          storeId: id,
          lotId: lot.id,
          lotRevision: Math.trunc(Number(decision.lotRevision) || 1),
          decisionVersion: Math.trunc(Number(decision.lotRevision) || 1),
          status: decision.status,
          passportAttachmentId: decision.passportAttachmentId ?? null,
          protocolAttachmentId: decision.protocolAttachmentId ?? null,
          targetFinishedProductId: decision.targetFinishedProductId ?? null,
          reason: decision.reason ?? null,
          decidedByUid: str(decision.actorUid) || actor.uid,
          decidedAt: decision.at ?? decision.decidedAt,
          revision: 1,
          idempotencyKey: str(decision.idempotencyKey) || decision.id,
        })
        decisionsWritten++
      } catch {
        // Already projected (unique id / idempotency key) — reconcile stays idempotent.
        decisionsSkipped++
      }
    }
    try {
      await upsertQcFinishedGoodsLot(qc, {
        id: lot.id,
        storeId: id,
        finishedProductId: str(lot.finishedProductId),
        warehouseItemId: str(lot.warehouseItemId),
        batchNo: str(lot.lotNumber),
        quantityProduced: Number(lot.quantityProduced) || 0,
        quantityShipped: Number(lot.quantityShipped) || 0,
        packagingReportId: str(lot.packagingReportId),
        status: str(lot.qcStatus) || 'pending',
        revision: Math.trunc(Number(lot.lotRevision) || 1),
        updatedByUid: actor.uid,
      })
      lotsWritten++
    } catch (err) {
      failures.push({ lotId: str(lot.id), error: String(err?.message ?? err ?? 'unknown') })
    }
  }

  return ok({
    storeId: id,
    criticalRevision: revision,
    lots: lots.length,
    lotsWritten,
    decisionsWritten,
    decisionsSkipped,
    failures,
  })
}

// ---------------------------------------------------------------------------
// Command gateway
// ---------------------------------------------------------------------------

const CAP_BY_COMMAND = Object.freeze({
  'packaging.domain.activate': G4_CAPS.PACKAGING_REPORT_CONFIRM,
  'packaging.report.draft.save': G4_CAPS.PACKAGING_REPORT_EDIT,
  'packaging.report.draft.delete': G4_CAPS.PACKAGING_REPORT_EDIT,
  'packaging.report.confirm': G4_CAPS.PACKAGING_REPORT_CONFIRM,
  'packaging.report.createCorrection': G4_CAPS.PACKAGING_REPORT_CORRECT,
  'packaging.report.confirmCorrection': G4_CAPS.PACKAGING_REPORT_CORRECT,
  'packaging.read': G4_CAPS.PACKAGING_READ,
  'qc.review.start': G4_CAPS.QC_REVIEW,
  'qc.release': G4_CAPS.QC_RELEASE,
  'qc.regrade': G4_CAPS.QC_REGRADE,
  'qc.reject': G4_CAPS.QC_REJECT,
  'qc.scrap.writeoff': G4_CAPS.QC_SCRAP_WRITEOFF,
  'shipment.draft.save': G4_CAPS.SHIPMENT_DRAFT_EDIT,
  'shipment.draft.delete': G4_CAPS.SHIPMENT_DRAFT_EDIT,
  'shipment.post': G4_CAPS.SHIPMENT_POST,
  'shipment.cancel': G4_CAPS.SHIPMENT_CANCEL,
})

const LINE_SCOPED_COMMANDS = new Set([
  'packaging.report.draft.save',
  'packaging.report.confirm',
  'packaging.report.createCorrection',
  'packaging.report.confirmCorrection',
])

function warehouseSnapshot(warehouse) {
  return {
    documents: warehouse.documents,
    movements: warehouse.movements,
    loadingShipments: warehouse.loadingShipments,
    auditLog: warehouse.auditLog,
    closedMonths: warehouse.closedMonths,
    productionLineBindings: warehouse.productionLineBindings,
    scrapLocationId: warehouse.scrapLocationId,
  }
}

function productionSnapshot(production) {
  return {
    orders: production.orders,
    shiftReports: production.shiftReports,
    wipBatches: production.wipBatches,
    packagingReports: production.packagingReports,
    finishedGoodsLots: production.finishedGoodsLots,
    qcDecisions: production.qcDecisions,
    auditLog: production.auditLog,
  }
}

/**
 * Unified G4 gateway — one idempotencyKey, one CAS over warehouse + production.
 */
export async function executeG4Command(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = str(input.storeId)
  const idempotencyKey = str(input.idempotencyKey)
  const commandType = str(input.commandType)
  const rawCommand = stripClientTrusted(input.command)
  if (!storeId || !idempotencyKey || !commandType) return fail('invalid_input', 400)
  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }

  const needed = CAP_BY_COMMAND[commandType]
  if (!needed) return fail('unknown_command', 400)
  const commandFingerprint = PAYLOAD_BOUND_IDEMPOTENCY_COMMANDS.has(commandType)
    ? canonicalPackagingCommandFingerprint(commandType, rawCommand)
    : isG4CriticalMutationCommand(commandType)
      ? g4CriticalMutationCommandFingerprint(commandType, rawCommand)
      : ''

  const requireLineScope = LINE_SCOPED_COMMANDS.has(commandType)
  const claimedLineId = normalizePackLineId(
    rawCommand.lineId ?? (requireLineScope ? PACK_LINE_ID : ''),
  )
  const claimedWarehouseId = str(
    rawCommand.warehouseId ?? rawCommand.packagingWarehouseId ?? '',
  )
  const perm = await requireG4Capability(actor.uid, storeId, needed, {
    lineId: claimedLineId,
    warehouseId: claimedWarehouseId || undefined,
    requireLineScope: requireLineScope && Boolean(claimedLineId),
  })
  if (!perm.ok) return perm

  const dc = getG1DataConnect()
  // Always establish current critical truth before considering a SQL receipt.
  // The receipt table is a best-effort projection and cannot resurrect a
  // missing/deactivated/corrupt authoritative store.
  const critical = await loadCritical(dc, storeId)
  if (!critical.ok) return critical
  if (critical.missing) {
    if (commandType === 'packaging.read') {
      return ok({
        criticalRevision: 0,
        productionActive: false,
        packagingQcActive: false,
        source: 'critical_store_missing',
      })
    }
    if (commandType === 'packaging.domain.activate') {
      return fail('production_domain_inactive', 409)
    }
    return fail('critical_store_missing', 409)
  }

  let warehouse = structuredClone(critical.payload.domains.warehouse)
  let production = structuredClone(critical.payload.domains.production ?? emptyProductionStore())
  const warehouseBeforeHash = stableDomainHash(warehouse)
  const now = new Date().toISOString()
  const productionActive = isProductionDomainActive(critical.payload, critical.revision)
  const packagingActive = isPackagingQcFeatureActive(critical.payload)
  const strictCriticalReplay = isG4CriticalMutationCommand(commandType)
  const strictReplay =
    strictCriticalReplay || strictPackagingReplayRequired(commandType, rawCommand, production)

  if (strictReplay && (!productionActive || !packagingActive)) {
    return fail(productionActive ? 'packaging_qc_inactive' : 'production_domain_inactive', 409)
  }

  const receipt = await loadReceipt(dc, idempotencyKey, storeId)
  if (receipt?.conflict) return fail('not_found', 404)
  if (receipt?.corrupt) return fail('receipt_corrupt', 500)

  const embedded = embeddedReceipt(critical.payload, idempotencyKey)

  if (strictReplay) {
    // Strict replay is anchored in the receipt embedded by the same critical
    // CAS as the business effects. A pre-R3.1C SQL-only receipt is not proof.
    if (
      (receipt?.result &&
        idempotencyReplayConflict(receipt, commandType, commandFingerprint, { strict: true })) ||
      (embedded?.result &&
        idempotencyReplayConflict(embedded, commandType, commandFingerprint, { strict: true }))
    ) {
      return fail(
        strictCriticalReplay ? 'g4_idempotency_conflict' : 'packaging_idempotency_conflict',
        409,
      )
    }
    if (receipt?.result && !embedded?.result) {
      return fail(
        strictCriticalReplay
          ? 'g4_receipt_not_authoritative'
          : 'packaging_receipt_not_authoritative',
        409,
      )
    }
    if (embedded?.result) {
      const replayValidation = strictCriticalReplay
        ? reenterStrictCriticalMutationReducer(commandType, embedded, production, warehouse)
        : strictEmbeddedPackagingReplayValid(embedded, production)
          ? ok()
          : fail('packaging_idempotency_state_mismatch', 409)
      if (!replayValidation.ok) {
        return replayValidation
      }
      const replayResult = {
        ...embedded.result,
        criticalRevision: critical.revision,
        ...(strictCriticalReplay
          ? { commandFingerprint }
          : { idempotencyFingerprint: commandFingerprint }),
        productionActive,
        packagingQcActive: packagingActive,
        warehouse: warehouseSnapshot(warehouse),
        production: productionSnapshot(production),
        idempotent: true,
        recoveredFromEmbeddedReceipt: !receipt?.result,
      }
      if (!receipt?.result) {
        await saveReceipt(
          dc,
          idempotencyKey,
          storeId,
          commandType,
          actor.uid,
          replayResult,
          critical.revision,
        )
      }
      return ok(replayResult)
    }
  } else if (receipt?.result) {
    if (idempotencyReplayConflict(receipt, commandType, commandFingerprint)) {
      return fail('packaging_idempotency_conflict', 409)
    }
    return ok({ ...receipt.result, idempotent: true })
  } else if (embedded?.result) {
    if (idempotencyReplayConflict(embedded, commandType, commandFingerprint)) {
      return fail('packaging_idempotency_conflict', 409)
    }
    await saveReceipt(
      dc,
      idempotencyKey,
      storeId,
      commandType,
      actor.uid,
      embedded.result,
      embedded.criticalRevision ?? critical.revision,
    )
    return ok({
      ...embedded.result,
      criticalRevision: embedded.result.criticalRevision ?? embedded.criticalRevision,
      idempotent: true,
      recoveredFromEmbeddedReceipt: true,
    })
  }

  if (commandType === 'packaging.read') {
    return ok({
      criticalRevision: critical.revision,
      warehouse,
      production,
      productionActive,
      packagingQcActive: packagingActive,
      domainMeta: critical.payload.domainMeta,
      source: packagingActive ? 'fst_critical_store' : 'legacy_or_inactive',
    })
  }

  // PHASE R1 — frozen packagingQc blocks writes; read still allowed above
  if (isDomainFrozen(critical.payload, 'packagingQc', critical.revision)) {
    return fail('domain_frozen', 409)
  }

  // Packaging/QC/shipment truth is only authoritative once the feature was explicitly
  // activated. Login/pull never activates it.
  if (commandType !== 'packaging.domain.activate' && !packagingActive) {
    return fail('packaging_qc_inactive', 409)
  }

  if (commandType === 'packaging.domain.activate') {
    if (!productionActive) return fail('production_domain_inactive', 409)
    if (
      !isSysadminActor(actor) &&
      perm.capabilities[G4_CAPS.PACKAGING_REPORT_CONFIRM] !== true &&
      !hasCapability(perm.capabilities, G4_CAPS.PACKAGING_REPORT_CONFIRM)
    ) {
      return fail('forbidden', 403)
    }
    const reason = str(rawCommand.reason)
    if (isSysadminActor(actor) && !reason) return fail('emergency_reason_required', 400)
    if (packagingActive) {
      return ok({
        criticalRevision: critical.revision,
        packagingQcActive: true,
        productionActive: true,
        idempotent: true,
        production: productionSnapshot(production),
        warehouse: warehouseSnapshot(warehouse),
      })
    }
    production = appendProdAudit(
      production,
      audit('packaging_qc_activate', actor, reason || 'activate', now),
    )
    const resultPreview = {
      packagingQcActive: true,
      productionActive: true,
      reason: reason || undefined,
      domainMeta: markPackagingQcFeatureActive(critical.payload, actor.uid).domainMeta,
      production: productionSnapshot(production),
      warehouse: warehouseSnapshot(warehouse),
    }
    const committed = await casCommitDomains(
      dc,
      storeId,
      critical,
      warehouse,
      production,
      actor.uid,
      {
        idempotencyKey,
        commandType,
        result: resultPreview,
        activatePackagingQc: true,
      },
    )
    if (!committed.ok) return committed
    const result = { ...resultPreview, criticalRevision: committed.criticalRevision }
    await saveReceipt(
      dc,
      idempotencyKey,
      storeId,
      commandType,
      actor.uid,
      result,
      committed.criticalRevision,
    )
    return ok(result)
  }

  if (requireLineScope && !hasLineScope(perm.capabilities, claimedLineId || PACK_LINE_ID)) {
    return fail('forbidden_line_scope', 403)
  }

  let applied
  if (commandType === 'packaging.report.draft.save') {
    applied = applyPackagingDraftSave(production, rawCommand, actor, now)
  } else if (commandType === 'packaging.report.draft.delete') {
    applied = applyPackagingDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'packaging.report.confirm') {
    applied = applyPackagingConfirm(production, warehouse, rawCommand, actor, now, {
      masterDataActive: isMasterDataDomainActive(critical.payload),
      masterData: critical.payload.domains.masterData,
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      idempotencyFingerprint: commandFingerprint,
    })
  } else if (commandType === 'packaging.report.createCorrection') {
    applied = applyPackagingCreateCorrection(production, rawCommand, actor, now)
  } else if (commandType === 'packaging.report.confirmCorrection') {
    applied = applyPackagingConfirmCorrection(production, warehouse, rawCommand, actor, now, {
      masterDataActive: isMasterDataDomainActive(critical.payload),
      masterData: critical.payload.domains.masterData,
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      idempotencyFingerprint: commandFingerprint,
    })
  } else if (commandType === 'qc.review.start') {
    applied = applyQcReviewStart(production, rawCommand, actor, now, { commandFingerprint })
  } else if (commandType === 'qc.release') {
    applied = await applyQcRelease(production, rawCommand, actor, now, {
      storeId,
      capabilities: perm.capabilities,
      idempotencyKey,
      commandFingerprint,
    })
  } else if (commandType === 'qc.regrade') {
    applied = applyQcRegrade(production, warehouse, rawCommand, actor, now, {
      commandFingerprint,
    })
  } else if (commandType === 'qc.reject') {
    applied = applyQcReject(production, warehouse, rawCommand, actor, now, {
      commandFingerprint,
    })
  } else if (commandType === 'qc.scrap.writeoff') {
    applied = applyQcScrapWriteoff(production, warehouse, rawCommand, actor, now, {
      commandFingerprint,
    })
  } else if (commandType === 'shipment.draft.save') {
    applied = applyShipmentDraftSave(warehouse, rawCommand, actor, now)
  } else if (commandType === 'shipment.draft.delete') {
    applied = applyShipmentDraftDelete(warehouse, rawCommand, actor, now)
  } else if (commandType === 'shipment.post' || commandType === 'shipment.cancel') {
    // PHASE G5.1 — after salesPlanning activation, sales-linked shipments use G5 CAS.
    // Standalone emergency still allowed for sysadmin with emergencyReason.
    if (isSalesPlanningActive(critical.payload)) {
      const emergency =
        isSysadminActor(actor) && String(rawCommand.emergencyReason ?? '').trim().length >= 8
      if (!emergency) {
        return fail('use_g5_gateway', 409)
      }
    }
    applied =
      commandType === 'shipment.post'
        ? applyShipmentPost(production, warehouse, rawCommand, actor, now, {
            commandFingerprint,
          })
        : applyShipmentCancel(production, warehouse, rawCommand, actor, now, {
            commandFingerprint,
          })
  } else {
    return fail('unknown_command', 400)
  }

  if (!applied.ok) return applied
  production = applied.production ?? production
  warehouse = applied.warehouse ?? warehouse

  // Warehouse scope is re-checked against the resolved (server-side) warehouse ids,
  // not only against whatever the client claimed in the command body.
  const touchedWarehouseIds = new Set()
  for (const doc of warehouse.documents ?? []) {
    if (doc.postedAt === now && doc.warehouseId) touchedWarehouseIds.add(doc.warehouseId)
  }
  for (const warehouseId of touchedWarehouseIds) {
    if (!hasWarehouseScope(perm.capabilities, warehouseId)) {
      return fail('forbidden_warehouse_scope', 403)
    }
  }

  const touchesWarehouse = warehouseBeforeHash !== stableDomainHash(warehouse)
  const { projection, ...appliedResult } = applied
  const resultPreview = {
    ...appliedResult.result,
    ...(PAYLOAD_BOUND_IDEMPOTENCY_COMMANDS.has(commandType) && commandFingerprint
      ? { idempotencyFingerprint: commandFingerprint }
      : {}),
    ...(strictCriticalReplay && commandFingerprint ? { commandFingerprint } : {}),
    productionActive,
    packagingQcActive: packagingActive,
    touchesWarehouse,
    warehouse: warehouseSnapshot(warehouse),
    production: productionSnapshot(production),
  }

  const committed = await casCommitDomains(
    dc,
    storeId,
    critical,
    warehouse,
    production,
    actor.uid,
    { idempotencyKey, commandType, result: resultPreview },
  )
  if (!committed.ok) return committed

  const result = {
    ...resultPreview,
    criticalRevision: committed.criticalRevision,
    touchesWarehouse,
  }

  // Read-model projections are informational; a failure here must not undo the CAS.
  if (projection?.lot) {
    await writeQcProjections({
      storeId,
      actor,
      idempotencyKey,
      lot: projection.lot,
      decision: projection.decision,
    })
  }

  await saveReceipt(
    dc,
    idempotencyKey,
    storeId,
    commandType,
    actor.uid,
    result,
    committed.criticalRevision,
  )
  return ok(result)
}

export async function getAuthoritativePackagingDomains(storeId) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: str(storeId) })
  const row = data?.fstCriticalStore
  if (!row) {
    return ok({ revision: 0, warehouse: null, production: null, source: 'missing' })
  }
  const parsed = parseCriticalPayload(row.payloadJson, { revision: Number(row.revision) || 0 })
  if (!parsed.ok) return fail(parsed.error, 500)
  const revision = Number(row.revision) || 0
  const production = parsed.payload.domains.production ?? emptyProductionStore()
  return ok({
    revision,
    warehouse: parsed.payload.domains.warehouse,
    production,
    packagingQcActive: isPackagingQcFeatureActive(parsed.payload),
    source: isPackagingQcFeatureActive(parsed.payload) ? 'fst_critical_store' : 'legacy_or_inactive',
  })
}

export { G4_CAPS }
