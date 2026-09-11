/**
 * PHASE G3 — authoritative production lifecycle (recipes, orders, reserve, handoff, shift).
 * Atomicity: mutate domains.warehouse + domains.production, then ONE UpdateFstCriticalStoreCas.
 * Client snapshots / movements / roles from FstStore.payloadJson are not trusted.
 */
import { createHash } from 'node:crypto'
import { FST_ADMIN_EMAILS } from './_adminAuth.mjs'
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
  emptyCriticalPayload,
  emptyProductionStore,
  fingerprintCriticalPayload,
  isMasterDataDomainActive,
  isPeriodClosed,
  isProductionDomainActive,
  isDomainFrozen,
  markPackagingQcFeatureActive,
  markProductionDomainActive,
  markWarehouseDomainActive,
  nextServerDocumentNumber,
  parseCapabilities,
  parseCriticalPayload,
  serializeCriticalPayload,
  stableDomainHash,
} from './_g1CriticalHelpers.mjs'
import {
  allocateBatchesFefoFifo,
  buildBatchLotsFromMovements,
  ordinaryAvailableQty,
} from './_g2BatchAllocation.mjs'
import { G2_CAPS, hasCapability, normalizeCapabilities } from './_g2Capabilities.mjs'
import { G3_CAPS, defaultProductionCapabilities, hasLineScope, parseLineScope } from './_g3Capabilities.mjs'
import {
  applyProductionRequestPost,
  normalizeRequestPostIdempotencyKey,
} from './_g3RequestPost.mjs'
import {
  LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN,
  guardCanonicalOrderChange,
  resolveCompletedLegacyRequestPostReplay,
} from './_g3CanonicalLineage.mjs'
import {
  bomIsApprovedEffective,
  buildPackagingBomSnapshot,
  findById,
  productRequiresPackagingBom,
  selectApprovedPackagingBom,
} from './_g5PackagingBomHelpers.mjs'
import {
  resolveProductionLineBinding,
  resolveScrapReadiness,
} from '../../src/lib/production/lineReadinessCore.mjs'
import {
  applyProductionLineBindingConfig,
  canonicalProductionLineBindingPayload,
  LINE_BINDING_CONFIG_STAGING_ONLY,
} from '../../src/lib/warehouse/g3LineBindingConfigCore.mjs'
import {
  canonicalG3MaterialHandoffLines,
  canonicalG3MaterialHandoffPayload,
  formatG3MaterialHandoffFingerprint,
  validateG3MaterialHandoffProjection,
} from '../../src/lib/warehouse/g3MaterialHandoffIntegrityCore.mjs'
import {
  applyImpregnationQcDecision,
  resolveConfirmedMixerBatch,
} from './_g3ImpregnationQc.mjs'
import {
  aggregateShiftActualInputs,
  canonicalShiftBusinessKey,
  shiftCommandFingerprint,
  shiftLineStockBalance,
  shiftStockLineage,
  shiftStockTupleKey,
} from './_g3ShiftIntegrity.mjs'
import { isStagingIsolatedRuntime } from './_dataConnectRuntime.mjs'

function ok(data = {}) {
  return { ok: true, ...data }
}
function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function isSysadminActor(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '').trim().toLowerCase()
  return Boolean(actor?.claims?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

async function loadPrincipal(dc, storeId, uid) {
  const { data } = await getFstPrincipalAccessByUidStore(dc, { firebaseUid: uid, storeId })
  return data?.fstPrincipalAccesses?.[0] ?? null
}

export async function requireG3Capability(uid, storeId, capability, { lineId, requireLineScope = false } = {}) {
  const dc = getG1DataConnect()
  const row = await loadPrincipal(dc, storeId, uid)
  if (!row || row.active !== true) return fail('forbidden', 403)
  const raw = parseCapabilities(row.capabilitiesJson)
  const caps = normalizeCapabilities(raw)
  for (const [k, v] of Object.entries(raw)) {
    if (v === true) caps[k] = true
  }
  if (Array.isArray(raw.productionLineIds)) caps.productionLineIds = raw.productionLineIds
  if (Array.isArray(raw.scopes?.productionLineIds)) {
    caps.productionLineIds = raw.scopes.productionLineIds
  }
  if (caps[capability] !== true && !hasCapability(caps, capability)) {
    return fail('forbidden', 403)
  }
  if (requireLineScope && lineId) {
    if (!hasLineScope(caps, lineId)) return fail('forbidden_line_scope', 403)
  }
  return ok({ principal: row, capabilities: caps })
}

function hashRecipeContent(input) {
  const payload = JSON.stringify({
    recipeId: input.recipeId,
    versionNumber: input.versionNumber,
    normBase: input.normBase,
    batchSize: input.batchSize ?? null,
    components: (input.components ?? []).map((c) => ({
      warehouseItemId: c.warehouseItemId,
      unitSnapshot: c.unitSnapshot,
      normQty: Math.round(Number(c.normQty) * 1e6) / 1e6,
      tolerancePct: c.tolerancePct,
    })),
  })
  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `rv_${(h >>> 0).toString(16)}`
}

function materialHandoffCommandFingerprint(commandType, command) {
  return formatG3MaterialHandoffFingerprint(
    createHash('sha256')
      .update(canonicalG3MaterialHandoffPayload(commandType, command))
      .digest('hex'),
  )
}

async function loadOrInitCritical(dc, storeId, actorUid) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) {
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
  if (!parsed.payload.domains.production) {
    parsed.payload.domains.production = emptyProductionStore()
  }
  return ok({ revision, payload: parsed.payload, row })
}

async function loadExistingCriticalForLegacyReplay(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) {
    return fail(LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN, 409, {
      reason: 'critical_store_absent',
    })
  }
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)
  return ok({ revision, payload: parsed.payload, row })
}

async function loadExistingCriticalForCommand(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) return fail('critical_store_not_initialized', 409)
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)
  if (!parsed.payload.domains.production) {
    parsed.payload.domains.production = emptyProductionStore()
  }
  return ok({ revision, payload: parsed.payload, row })
}

async function loadReceipt(dc, idempotencyKey) {
  const { data } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const row = data?.fstCommandReceipt
  if (!row) return null
  try {
    return {
      storeId: row.storeId,
      commandType: row.commandType,
      actorUid: row.actorUid,
      result: JSON.parse(row.resultJson),
      criticalRevision: row.criticalRevisionAfter,
      external: true,
    }
  } catch {
    return { corrupt: true }
  }
}

function embeddedReceipt(payload, idempotencyKey) {
  const row = payload?.commandReceipts?.[idempotencyKey]
  if (!row?.result) return null
  return {
    storeId: row.storeId,
    commandType: row.commandType,
    actorUid: row.actorUid,
    commandFingerprint: row.commandFingerprint,
    result: row.result,
    criticalRevision: row.criticalRevisionAfter,
    embedded: true,
  }
}

/**
 * Single CAS for warehouse + production.
 * Idempotency result is stored INSIDE the same CAS payload (commandReceipts).
 * External FstCommandReceipt insert is best-effort only — not required for safe retry.
 */
async function casCommitDomains(
  dc,
  storeId,
  critical,
  nextWarehouse,
  nextProduction,
  actorUid,
  {
    idempotencyKey,
    commandType,
    result,
    receiptBinding,
    activateProduction = false,
    activatePackagingQc = false,
  } = {},
) {
  let nextPayload = {
    ...critical.payload,
    schemaVersion: Math.max(Number(critical.payload.schemaVersion) || 0, 3),
    domains: {
      ...critical.payload.domains,
      warehouse: nextWarehouse,
      production: nextProduction,
    },
  }
  // Preserve warehouse activation; never auto-activate production except explicit flag
  if (isProductionDomainActive(critical.payload, critical.revision) || activateProduction) {
    nextPayload = markProductionDomainActive(nextPayload, actorUid)
  }
  if (activatePackagingQc) {
    nextPayload = markPackagingQcFeatureActive(nextPayload, actorUid)
  }
  if (
    critical.payload.domainMeta?.warehouse?.active === true ||
    (nextWarehouse?.documents?.length > 0 && critical.revision > 0)
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
          storeId: receiptBinding?.storeId,
          commandType,
          actorUid,
          commandFingerprint: receiptBinding?.commandFingerprint,
          at: new Date().toISOString(),
          criticalRevisionAfter: nextRevision,
          result: { ...result, criticalRevision: nextRevision },
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
    warehouse: nextWarehouse,
    production: nextProduction,
    payload: nextPayload,
  })
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
    console.warn('g3 receipt insert failed', err)
  }
}

function appendProdAudit(production, entry) {
  return { ...production, auditLog: [...(production.auditLog ?? []), entry] }
}
function appendWhAudit(warehouse, entry) {
  return { ...warehouse, auditLog: [...(warehouse.auditLog ?? []), entry] }
}

function stripClientTrusted(command) {
  const {
    status: _s,
    postedAt: _pa,
    movements: _m,
    recipeNormSnapshot: _snap,
    packagingBomSnapshot: _pbs,
    actorUid: _au,
    criticalRevision: _cr,
    contentHash: _ch,
    approvedAt: _aa,
    confirmedAt: _ca,
    ...rest
  } = command && typeof command === 'object' ? command : {}
  return rest
}

const G3_RECEIPT_BINDING_VERSION = 'g3-command-receipt:v1'

function stableCommandJson(value, stack = new Set()) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_command_value')
    return JSON.stringify(value)
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }
  if (typeof value !== 'object' || stack.has(value)) {
    throw new TypeError('invalid_command_value')
  }
  stack.add(value)
  let serialized
  if (Array.isArray(value)) {
    serialized = `[${value
      .map((entry) => stableCommandJson(entry, stack) ?? 'null')
      .join(',')}]`
  } else {
    const fields = []
    for (const key of Object.keys(value).sort()) {
      const entry = stableCommandJson(value[key], stack)
      if (entry !== undefined) fields.push(`${JSON.stringify(key)}:${entry}`)
    }
    serialized = `{${fields.join(',')}}`
  }
  stack.delete(value)
  return serialized
}

function g3CommandReceiptFingerprint(commandType, command) {
  const canonical = stableCommandJson({ commandType, command })
  return `${G3_RECEIPT_BINDING_VERSION}:${createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex')}`
}

function buildG3ReceiptBinding(storeId, actorUid, commandType, commandFingerprint) {
  return {
    version: G3_RECEIPT_BINDING_VERSION,
    storeId,
    actorUid,
    commandType,
    commandFingerprint,
  }
}

function bindG3ReceiptResult(result, receiptBinding) {
  return { ...result, receiptBinding }
}

function validateG3ReceiptBinding(
  receipt,
  expected,
  { allowLegacyUnbound = false, conflictError = 'idempotency_conflict' } = {},
) {
  if (!receipt?.result) return ok()
  const exactMetadata = [
    ['storeId', receipt.storeId, expected.storeId],
    ['commandType', receipt.commandType, expected.commandType],
    ['actorUid', receipt.actorUid, expected.actorUid],
  ]
  for (const [, actual, wanted] of exactMetadata) {
    if (actual != null && String(actual).trim() !== wanted) {
      return fail(conflictError, 409)
    }
  }
  if (
    receipt.commandFingerprint != null &&
    String(receipt.commandFingerprint).trim() !== expected.commandFingerprint
  ) {
    return fail(conflictError, 409)
  }
  const binding = receipt.result?.receiptBinding
  if (binding == null) {
    return allowLegacyUnbound ? ok({ legacyUnbound: true }) : fail(conflictError, 409)
  }
  if (
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    binding.version !== G3_RECEIPT_BINDING_VERSION ||
    String(binding.storeId ?? '').trim() !== expected.storeId ||
    String(binding.actorUid ?? '').trim() !== expected.actorUid ||
    String(binding.commandType ?? '').trim() !== expected.commandType ||
    String(binding.commandFingerprint ?? '').trim() !== expected.commandFingerprint
  ) {
    return fail(conflictError, 409)
  }
  return ok()
}

function getApprovedVersion(production, recipeId, atIso) {
  const at = (atIso ?? new Date().toISOString()).slice(0, 10)
  return (production.recipeVersions ?? [])
    .filter((v) => v.recipeId === recipeId && v.status === 'approved')
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .find((v) => {
      if (v.effectiveFrom && v.effectiveFrom > at) return false
      if (v.effectiveTo && v.effectiveTo < at) return false
      return true
    })
}

function buildSnapshot(version, now) {
  return {
    recipeId: version.recipeId,
    recipeVersionId: version.id,
    versionNumber: version.versionNumber,
    contentHash: version.contentHash,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt,
    normBase: version.normBase,
    batchSize: version.batchSize,
    components: structuredClone(version.components ?? []),
    snappedAt: now,
  }
}

function materialNeedFromSnapshot(snapshot, totalQtyMp) {
  const qty = Number(totalQtyMp) || 0
  const comps = snapshot?.components ?? []
  return comps.map((c) => {
    let need = 0
    if (snapshot.normBase === 'per_m2') need = (Number(c.normQty) || 0) * qty
    else if (snapshot.normBase === 'per_batch') {
      const batch = Number(snapshot.batchSize) || 1
      need = (Number(c.normQty) || 0) * (qty / batch)
    } else need = (Number(c.normQty) || 0) * qty
    return {
      warehouseItemId: c.warehouseItemId,
      unitSnapshot: c.unitSnapshot,
      needQty: Math.round(need * 1e6) / 1e6,
      tolerancePct: Number(c.tolerancePct) || 0,
    }
  })
}

function resolveLineBinding(warehouse, lineId, { strict = false } = {}) {
  if (strict) {
    const resolved = resolveProductionLineBinding(warehouse, lineId, {
      requireActiveAccounting: true,
    })
    return resolved.ok ? resolved : { ok: false, error: resolved.error }
  }
  const binding = (warehouse.productionLineBindings ?? []).find(
    (candidate) => candidate.lineId === lineId || candidate.id === lineId,
  )
  if (!binding?.productionWarehouseId || !binding?.productionLocationId) {
    return { ok: false, error: 'line_location_not_configured' }
  }
  return {
    ok: true,
    productionWarehouseId: binding.productionWarehouseId,
    productionLocationId: binding.productionLocationId,
  }
}

function isAreaUnit(unit) {
  return new Set(['m2', 'м2', 'м²', 'sqm']).has(String(unit ?? '').trim().toLowerCase())
}

function isMassUnit(unit) {
  return new Set(['kg', 'кг', 'kilogram', 'kilograms']).has(
    String(unit ?? '').trim().toLowerCase(),
  )
}

function validateOrderWipMapping(order, warehouse, ctx = {}) {
  const semiFinishedItemId = String(order?.semiFinishedItemId ?? '').trim()
  if (!semiFinishedItemId) return fail('wip_item_required', 409)
  const finishedGoodsItemId = String(order?.warehouseItemId ?? '').trim()
  if (!finishedGoodsItemId) return fail('finished_goods_item_required', 409)
  if (
    semiFinishedItemId === String(order?.finishedProductId ?? '').trim() ||
    (finishedGoodsItemId && semiFinishedItemId === finishedGoodsItemId)
  ) {
    return fail('wip_item_must_differ_from_finished_goods', 409)
  }
  const catalogue = ctx.masterDataActive
    ? ctx.masterData?.items ?? []
    : warehouse?.items ?? []
  const matches = catalogue.filter(
    (row) => String(row?.id ?? '').trim() === semiFinishedItemId,
  )
  if (matches.length !== 1) {
    return fail(matches.length === 0 ? 'wip_item_unavailable' : 'wip_item_ambiguous', 409)
  }
  const item = matches[0]
  if (!item || item.archived === true || item.active === false) {
    return fail('wip_item_unavailable', 409)
  }
  const semiFinishedUnitSnapshot = String(item.baseUnit ?? item.unit ?? '').trim()
  if (!isAreaUnit(semiFinishedUnitSnapshot)) return fail('wip_item_area_unit_required', 409)
  return ok({ semiFinishedItemId, finishedGoodsItemId, semiFinishedUnitSnapshot })
}

function validateOrderFinishedGoodsMapping(order, ctx = {}) {
  if (ctx.masterDataActive !== true) {
    return fail('finished_goods_master_data_required', 409)
  }
  const finishedProductId = String(order?.finishedProductId ?? '').trim()
  const claimedWarehouseItemId = String(order?.warehouseItemId ?? '').trim()
  if (!finishedProductId || !claimedWarehouseItemId) {
    return fail('finished_goods_mapping_required', 409)
  }
  const products = (ctx.masterData?.finishedProducts ?? []).filter(
    (row) => String(row?.id ?? '').trim() === finishedProductId,
  )
  if (products.length === 0) return fail('finished_product_not_found', 404)
  if (products.length !== 1) return fail('finished_product_ambiguous', 409)
  const product = products[0]
  if (product.archived === true || product.active === false) {
    return fail('finished_product_unavailable', 409)
  }
  const mappedWarehouseItemId = String(product.warehouseItemId ?? '').trim()
  if (!mappedWarehouseItemId) return fail('finished_goods_mapping_required', 409)
  if (mappedWarehouseItemId !== claimedWarehouseItemId) {
    return fail('finished_goods_mapping_mismatch', 409)
  }
  const items = (ctx.masterData?.items ?? []).filter(
    (row) => String(row?.id ?? '').trim() === mappedWarehouseItemId,
  )
  if (items.length === 0) return fail('finished_goods_item_unavailable', 409)
  if (items.length !== 1) return fail('finished_goods_item_ambiguous', 409)
  const item = items[0]
  if (item.archived === true || item.active === false) {
    return fail('finished_goods_item_unavailable', 409)
  }
  if (!isAreaUnit(item.baseUnit ?? item.unit)) {
    return fail('finished_goods_item_area_unit_required', 409)
  }
  if (String(order?.semiFinishedItemId ?? '').trim() === mappedWarehouseItemId) {
    return fail('wip_item_must_differ_from_finished_goods', 409)
  }
  return ok({ finishedProductId, finishedGoodsItemId: mappedWarehouseItemId })
}

function validateOrderImpregnationOutputMapping(order, warehouse) {
  const impregnationOutputItemId = String(order?.impregnationOutputItemId ?? '').trim()
  if (!impregnationOutputItemId) {
    return fail('impregnation_output_mapping_required', 409)
  }
  // Formulation recipes point at the G2 warehouse catalogue; validate against
  // that same authoritative identity source even when G5 master data is active.
  const catalogue = warehouse?.items ?? []
  const matches = catalogue.filter(
    (row) => String(row?.id ?? '').trim() === impregnationOutputItemId,
  )
  if (matches.length === 0) return fail('impregnation_output_item_unavailable', 409)
  if (matches.length !== 1) return fail('impregnation_output_item_ambiguous', 409)
  const item = matches[0]
  if (item.archived === true || item.active === false) {
    return fail('impregnation_output_item_unavailable', 409)
  }
  if (
    impregnationOutputItemId === String(order?.semiFinishedItemId ?? '').trim() ||
    impregnationOutputItemId === String(order?.warehouseItemId ?? '').trim()
  ) {
    return fail('impregnation_output_must_differ_from_wip_and_finished_goods', 409)
  }
  if (!isMassUnit(item.baseUnit ?? item.unit)) {
    return fail('impregnation_output_mass_unit_required', 409)
  }
  return ok({ impregnationOutputItemId })
}

function orderUsesWipContractV1(order, ctx = {}) {
  return ctx.enforceCanonicalLineage === true && Number(order?.wipContractVersion) >= 1
}

function resolveShiftWip(order, warehouse, command, ctx = {}) {
  if (orderUsesWipContractV1(order, ctx)) {
    const frozen = ctx.preserveStrictWipSnapshot
    if (frozen) {
      const semiFinishedItemId = String(frozen.semiFinishedItemId ?? '').trim()
      const semiFinishedUnitSnapshot = String(
        frozen.semiFinishedUnitSnapshot ?? '',
      ).trim()
      const orderItemId = String(order?.semiFinishedItemId ?? '').trim()
      const claimed = String(command.semiFinishedItemId ?? semiFinishedItemId).trim()
      if (
        !semiFinishedItemId ||
        !isAreaUnit(semiFinishedUnitSnapshot) ||
        orderItemId !== semiFinishedItemId ||
        claimed !== semiFinishedItemId
      ) {
        return fail('wip_item_mismatch', 409)
      }
      return ok({ strict: true, semiFinishedItemId, semiFinishedUnitSnapshot })
    }
    const ready = validateOrderWipMapping(order, warehouse, ctx)
    if (!ready.ok) return ready
    const claimed = String(command.semiFinishedItemId ?? '').trim()
    if (claimed && claimed !== ready.semiFinishedItemId) {
      return fail('wip_item_mismatch', 409)
    }
    return ok({
      strict: true,
      semiFinishedItemId: ready.semiFinishedItemId,
      semiFinishedUnitSnapshot: ready.semiFinishedUnitSnapshot,
    })
  }

  const semiFinishedItemId = String(
    command.semiFinishedItemId ?? order?.semiFinishedItemId ?? order?.finishedProductId ?? '',
  ).trim()
  if (!semiFinishedItemId) return fail('semi_finished_required', 400)
  return ok({ strict: false, semiFinishedItemId, semiFinishedUnitSnapshot: undefined })
}

function resolveApprovedImpregnationQc(production, warehouse, command, order, ctx = {}) {
  if (!orderUsesWipContractV1(order, ctx)) return ok({ decision: null, batch: null })

  const decisionId = String(command.impregnationQcDecisionId ?? '').trim()
  const batchRunId = String(command.batchRunId ?? '').trim()
  if (!decisionId) return fail('impregnation_qc_decision_required', 409)
  if (!batchRunId) return fail('batch_run_id_required', 409)

  const decisions = production.impregnationQcDecisions ?? []
  const matches = decisions.filter(
    (row) => String(row?.id ?? row?.decisionId ?? '').trim() === decisionId,
  )
  if (matches.length === 0) return fail('impregnation_qc_decision_not_found', 404)
  if (matches.length !== 1) return fail('impregnation_qc_decision_ambiguous', 409)
  const decision = matches[0]
  const batchHistory = decisions.filter(
    (row) => String(row?.batchRunId ?? '').trim() === batchRunId,
  )
  const orderedHistory = [...batchHistory].sort(
    (left, right) => Number(left?.decisionRevision) - Number(right?.decisionRevision),
  )
  const revisionSet = new Set(
    orderedHistory.map((row) => Number(row?.decisionRevision)),
  )
  if (
    orderedHistory.length === 0 ||
    revisionSet.size !== orderedHistory.length ||
    orderedHistory.some(
      (row, index) =>
        !Number.isInteger(Number(row?.decisionRevision)) ||
        Number(row?.decisionRevision) !== index + 1,
    )
  ) {
    return fail('impregnation_qc_revision_history_invalid', 409)
  }
  const currentDecisions = orderedHistory.filter(
    (row) => row?.effective === true && !String(row?.supersededByDecisionId ?? '').trim(),
  )
  const latestDecision = orderedHistory[orderedHistory.length - 1]
  if (
    currentDecisions.length !== 1 ||
    currentDecisions[0] !== latestDecision ||
    latestDecision !== decision
  ) {
    return fail('impregnation_qc_decision_not_current', 409)
  }
  if (decision.decision !== 'approved') return fail('impregnation_qc_not_approved', 409)
  if (String(decision.productionOrderId ?? '').trim() !== String(order.id).trim()) {
    return fail('impregnation_qc_order_mismatch', 409)
  }
  if (String(decision.productionLineId ?? '').trim() !== String(order.lineId).trim()) {
    return fail('impregnation_qc_line_mismatch', 409)
  }
  if (String(decision.batchRunId ?? '').trim() !== batchRunId) {
    return fail('impregnation_qc_batch_mismatch', 409)
  }

  const batch = resolveConfirmedMixerBatch(warehouse, {
    batchRunId,
    batchReceiptDocumentId: decision.batchReceiptDocumentId,
    productionOrderId: order.id,
    productionLineId: order.lineId,
    outputWarehouseItemId: decision.outputWarehouseItemId,
    allowDownstreamBatchEffects: true,
    allowedDownstreamShiftReportIds: (production.shiftReports ?? [])
      .filter(
        (report) =>
          report?.status === 'confirmed' &&
          String(report?.batchRunId ?? '').trim() === batchRunId &&
          String(report?.impregnationQcDecisionId ?? '').trim() === decisionId &&
          String(report?.productionOrderId ?? report?.orderId ?? '').trim() ===
            String(order.id ?? '').trim() &&
          String(report?.lineId ?? report?.productionLineId ?? '').trim() ===
            String(order.lineId ?? '').trim(),
      )
      .map((report) => String(report?.id ?? '').trim())
      .filter(Boolean),
  })
  if (!batch.ok) return batch

  const receiptBatchNumbers = [
    ...new Set(
      (batch.receiptDocument?.lines ?? [])
        .map((line) => String(line?.batchNo ?? '').trim())
        .filter(Boolean),
    ),
  ]
  if (receiptBatchNumbers.length !== 1) {
    return fail('impregnation_batch_number_ambiguous', 409)
  }
  const batchNumber = receiptBatchNumbers[0]
  const matchingActuals = (Array.isArray(command.actualInputs) ? command.actualInputs : []).filter(
    (line) =>
      String(line?.itemId ?? '').trim() === String(decision.outputWarehouseItemId ?? '').trim() &&
      String(line?.batchNo ?? '').trim() === batchNumber &&
      String(line?.batchRunId ?? '').trim() === batchRunId,
  )
  if (matchingActuals.length === 0) return fail('impregnation_input_not_linked_to_qc_batch', 409)
  const requested = matchingActuals.reduce((sum, line) => sum + Number(line?.quantity ?? 0), 0)
  if (!Number.isFinite(requested) || requested <= 0 || requested > Number(batch.outputQuantity) + 1e-9) {
    return fail('impregnation_input_quantity_invalid', 409)
  }

  return ok({ decision, batch, batchNumber })
}

function shiftTupleQuantities(rows) {
  const quantities = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const itemId = String(row?.itemId ?? '').trim()
    const quantity = Number(row?.quantity)
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return null
    const key = shiftStockTupleKey(row)
    quantities.set(key, (quantities.get(key) ?? 0) + quantity)
  }
  return quantities
}

function sameShiftTupleQuantities(left, right) {
  if (!left || !right || left.size !== right.size) return false
  for (const [key, quantity] of left.entries()) {
    if (Math.abs(quantity - (right.get(key) ?? Number.NaN)) > 1e-9) return false
  }
  return true
}

function documentMovementsMatchLines(
  warehouse,
  document,
  expectedType,
  { orderId, lineId, reservationDocumentId, transferPairId, consumesReserve = false },
) {
  const lines = Array.isArray(document?.lines) ? document.lines : []
  const movements = (warehouse?.movements ?? []).filter(
    (movement) =>
      String(movement?.documentId ?? '').trim() === String(document?.id ?? '').trim(),
  )
  if (lines.length === 0 || movements.length !== lines.length) return false
  const seenLineIds = new Set()
  for (const line of lines) {
    const documentLineId = String(line?.lineId ?? '').trim()
    if (!documentLineId || seenLineIds.has(documentLineId)) return false
    seenLineIds.add(documentLineId)
    const matches = movements.filter(
      (movement) => String(movement?.documentLineId ?? '').trim() === documentLineId,
    )
    if (matches.length !== 1) return false
    const movement = matches[0]
    const lineQuantity = Number(line?.quantity)
    const movementQuantity = Number(movement?.quantity)
    if (
      !Number.isFinite(lineQuantity) ||
      lineQuantity <= 0 ||
      !Number.isFinite(movementQuantity) ||
      movementQuantity <= 0 ||
      movement?.cancelled === true ||
      String(line?.locationId ?? '').trim() === '' ||
      String(movement?.type ?? '').trim() !== expectedType ||
      String(movement?.warehouseId ?? '').trim() !==
        String(document?.warehouseId ?? '').trim() ||
      String(movement?.locationId ?? '').trim() !== String(line?.locationId ?? '').trim() ||
      shiftStockTupleKey(movement) !== shiftStockTupleKey(line) ||
      Math.abs(movementQuantity - lineQuantity) > 1e-9 ||
      String(movement?.productionOrderId ?? '').trim() !== orderId ||
      String(movement?.productionLineId ?? '').trim() !== lineId ||
      String(movement?.reservationDocumentId ?? '').trim() !== reservationDocumentId ||
      String(movement?.transferPairId ?? '').trim() !== transferPairId ||
      (consumesReserve && movement?.consumesReserve !== true)
    ) {
      return false
    }
  }
  return true
}

function resolveExactShiftDocumentGraph(warehouse, documentId, expected = {}) {
  const documents = (warehouse?.documents ?? []).filter(
    (document) => String(document?.id ?? '').trim() === String(documentId ?? '').trim(),
  )
  if (documents.length !== 1) return null
  const document = documents[0]
  const lines = Array.isArray(document?.lines) ? document.lines : []
  const movements = (warehouse?.movements ?? []).filter(
    (movement) =>
      String(movement?.documentId ?? '').trim() === String(documentId ?? '').trim(),
  )
  if (
    document?.status !== 'posted' ||
    lines.length === 0 ||
    movements.length !== lines.length ||
    (expected.docRole && document?.docRole !== expected.docRole) ||
    (expected.type && document?.type !== expected.type) ||
    (expected.orderId &&
      String(document?.productionOrderId ?? '').trim() !== expected.orderId) ||
    (expected.lineId &&
      String(document?.productionLineId ?? '').trim() !== expected.lineId) ||
    (expected.shiftReportId &&
      String(document?.shiftReportId ?? '').trim() !== expected.shiftReportId)
  ) {
    return null
  }
  const seenLineIds = new Set()
  for (const line of lines) {
    const lineId = String(line?.lineId ?? '').trim()
    const lineQuantity = Number(line?.quantity)
    if (
      !lineId ||
      seenLineIds.has(lineId) ||
      !Number.isFinite(lineQuantity) ||
      lineQuantity <= 0
    ) {
      return null
    }
    seenLineIds.add(lineId)
    const matches = movements.filter(
      (movement) => String(movement?.documentLineId ?? '').trim() === lineId,
    )
    const movement = matches[0]
    const movementQuantity = Number(movement?.quantity)
    if (
      matches.length !== 1 ||
      movement?.cancelled === true ||
      (expected.movementType && movement?.type !== expected.movementType) ||
      String(movement?.warehouseId ?? '').trim() !==
        String(document?.warehouseId ?? '').trim() ||
      String(movement?.locationId ?? '').trim() !== String(line?.locationId ?? '').trim() ||
      String(movement?.itemId ?? '').trim() !== String(line?.itemId ?? '').trim() ||
      shiftStockTupleKey(movement) !== shiftStockTupleKey(line) ||
      !Number.isFinite(movementQuantity) ||
      movementQuantity <= 0 ||
      Math.abs(movementQuantity - lineQuantity) > 1e-9 ||
      String(movement?.productionOrderId ?? '').trim() !==
        String(document?.productionOrderId ?? '').trim() ||
      String(movement?.productionLineId ?? '').trim() !==
        String(document?.productionLineId ?? '').trim() ||
      String(movement?.shiftReportId ?? '').trim() !==
        String(document?.shiftReportId ?? '').trim()
    ) {
      return null
    }
  }
  return { document, lines, movements }
}

function isExactShiftCorrectionReversal(warehouse, reversalMovement) {
  const sourceMovementId = String(reversalMovement?.reversesMovementId ?? '').trim()
  const sourceMatches = (warehouse?.movements ?? []).filter(
    (movement) => String(movement?.id ?? '').trim() === sourceMovementId,
  )
  if (!sourceMovementId || sourceMatches.length !== 1) return false
  const sourceMovement = sourceMatches[0]
  const sourceDocumentId = String(sourceMovement?.documentId ?? '').trim()
  const sourceDocuments = (warehouse?.documents ?? []).filter(
    (document) => String(document?.id ?? '').trim() === sourceDocumentId,
  )
  if (
    sourceDocuments.length !== 1 ||
    !['shift_consumption', 'waste_to_scrap'].includes(
      String(sourceDocuments[0]?.docRole ?? '').trim(),
    )
  ) {
    return false
  }
  const sourceGraph = resolveExactShiftDocumentGraph(warehouse, sourceDocumentId, {
    docRole: sourceDocuments[0].docRole,
    type: 'issue',
    movementType: 'issue',
    orderId: String(sourceMovement?.productionOrderId ?? '').trim(),
    lineId: String(sourceMovement?.productionLineId ?? '').trim(),
    shiftReportId: String(sourceMovement?.shiftReportId ?? '').trim(),
  })
  if (!sourceGraph || !sourceGraph.movements.includes(sourceMovement)) return false

  const reversalDocumentId = String(reversalMovement?.documentId ?? '').trim()
  const reversalDocuments = (warehouse?.documents ?? []).filter(
    (document) => String(document?.id ?? '').trim() === reversalDocumentId,
  )
  if (reversalDocuments.length !== 1) return false
  const reversalDocument = reversalDocuments[0]
  const reversalLines = Array.isArray(reversalDocument?.lines)
    ? reversalDocument.lines
    : []
  const reversalMovements = (warehouse?.movements ?? []).filter(
    (movement) =>
      String(movement?.documentId ?? '').trim() === reversalDocumentId,
  )
  if (
    reversalDocument?.status !== 'posted' ||
    reversalDocument?.docRole !== 'shift_correction_reversal' ||
    reversalDocument?.type !== sourceGraph.document.type ||
    reversalDocument?.purpose !== sourceGraph.document.purpose ||
    String(reversalDocument?.reversesDocumentId ?? '').trim() !== sourceDocumentId ||
    String(reversalDocument?.warehouseId ?? '').trim() !==
      String(sourceGraph.document?.warehouseId ?? '').trim() ||
    String(reversalDocument?.productionOrderId ?? '').trim() !==
      String(sourceGraph.document?.productionOrderId ?? '').trim() ||
    String(reversalDocument?.productionLineId ?? '').trim() !==
      String(sourceGraph.document?.productionLineId ?? '').trim() ||
    String(reversalDocument?.shiftReportId ?? '').trim() !==
      String(sourceGraph.document?.shiftReportId ?? '').trim() ||
    reversalLines.length !== sourceGraph.lines.length ||
    reversalMovements.length !== sourceGraph.movements.length
  ) {
    return false
  }
  const reversedIds = new Set()
  for (const movement of reversalMovements) {
    const reversedId = String(movement?.reversesMovementId ?? '').trim()
    const originalMatches = sourceGraph.movements.filter(
      (candidate) => String(candidate?.id ?? '').trim() === reversedId,
    )
    const original = originalMatches[0]
    const lineMatches = reversalLines.filter(
      (line) =>
        String(line?.lineId ?? '').trim() ===
        String(movement?.documentLineId ?? '').trim(),
    )
    const line = lineMatches[0]
    const quantity = Number(movement?.quantity)
    if (
      !reversedId ||
      reversedIds.has(reversedId) ||
      originalMatches.length !== 1 ||
      lineMatches.length !== 1 ||
      movement?.cancelled === true ||
      movement?.type !== 'receipt' ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Math.abs(quantity - Number(original?.quantity)) > 1e-9 ||
      Math.abs(quantity - Number(line?.quantity)) > 1e-9 ||
      String(movement?.warehouseId ?? '').trim() !==
        String(original?.warehouseId ?? '').trim() ||
      String(movement?.locationId ?? '').trim() !== String(original?.locationId ?? '').trim() ||
      String(movement?.itemId ?? '').trim() !== String(original?.itemId ?? '').trim() ||
      shiftStockTupleKey(movement) !== shiftStockTupleKey(original) ||
      shiftStockTupleKey(movement) !== shiftStockTupleKey(line) ||
      String(movement?.productionOrderId ?? '').trim() !==
        String(original?.productionOrderId ?? '').trim() ||
      String(movement?.productionLineId ?? '').trim() !==
        String(original?.productionLineId ?? '').trim() ||
      String(movement?.shiftReportId ?? '').trim() !==
        String(original?.shiftReportId ?? '').trim() ||
      (warehouse?.movements ?? []).filter(
        (candidate) =>
          candidate?.cancelled !== true &&
          String(candidate?.reversesMovementId ?? '').trim() === reversedId,
      ).length !== 1
    ) {
      return false
    }
    reversedIds.add(reversedId)
  }
  return reversalMovements.includes(reversalMovement)
}

/**
 * A canonical line shift may consume the frozen raw item only after one or more
 * complete reservation handoffs have posted it to the exact line route.  The
 * handoff projection is an index, not authority by itself: its referenced pair,
 * documents, lines and movements are all revalidated here.
 */
function resolveCanonicalShiftMaterialHandoff(
  production,
  warehouse,
  order,
  binding,
  actualInputs,
) {
  const orderId = String(order?.id ?? '').trim()
  const lineId = String(order?.lineId ?? '').trim()
  const reservationDocumentId = String(order?.reservationDocumentId ?? '').trim()
  const rawMaterialItemId = String(order?.rawMaterialItemId ?? '').trim()
  if (!orderId || !lineId || !reservationDocumentId || !rawMaterialItemId) {
    return fail('shift_material_handoff_required', 409)
  }

  const reservationMatches = (warehouse?.documents ?? []).filter(
    (document) => String(document?.id ?? '').trim() === reservationDocumentId,
  )
  if (reservationMatches.length !== 1) {
    return fail('shift_material_handoff_invalid', 409)
  }
  const reservation = reservationMatches[0]
  if (
    reservation?.type !== 'reservation' ||
    reservation?.docRole !== 'production_reservation' ||
    reservation?.status !== 'posted' ||
    String(reservation?.productionOrderId ?? '').trim() !== orderId ||
    !['production_reservation', 'production_reservation_increase'].includes(
      String(reservation?.purpose ?? reservation?.docRole ?? '').trim(),
    ) ||
    !(reservation?.lines ?? []).length ||
    (reservation.lines ?? []).some(
      (line) => String(line?.itemId ?? '').trim() !== rawMaterialItemId,
    )
  ) {
    return fail('shift_material_handoff_invalid', 409)
  }
  const reservationLines = Array.isArray(reservation?.lines) ? reservation.lines : []
  const reservationMovements = (warehouse?.movements ?? []).filter(
    (movement) =>
      String(movement?.documentId ?? '').trim() === reservationDocumentId,
  )
  if (reservationMovements.length !== reservationLines.length) {
    return fail('shift_material_handoff_invalid', 409)
  }
  const reservationLineIds = new Set()
  for (const line of reservationLines) {
    const lineIdValue = String(line?.lineId ?? '').trim()
    if (!lineIdValue || reservationLineIds.has(lineIdValue)) {
      return fail('shift_material_handoff_invalid', 409)
    }
    reservationLineIds.add(lineIdValue)
    const matches = reservationMovements.filter(
      (movement) => String(movement?.documentLineId ?? '').trim() === lineIdValue,
    )
    const reservationQuantity = Number(line?.quantity)
    const movementQuantity = Number(matches[0]?.quantity)
    if (
      matches.length !== 1 ||
      !Number.isFinite(reservationQuantity) ||
      reservationQuantity <= 0 ||
      !Number.isFinite(movementQuantity) ||
      movementQuantity <= 0 ||
      matches[0]?.cancelled === true ||
      matches[0]?.type !== 'reserve' ||
      String(matches[0]?.warehouseId ?? '').trim() !==
        String(reservation?.warehouseId ?? '').trim() ||
      String(matches[0]?.productionOrderId ?? '').trim() !== orderId ||
      String(matches[0]?.itemId ?? '').trim() !== rawMaterialItemId ||
      String(matches[0]?.locationId ?? '').trim() !==
        String(line?.locationId ?? '').trim() ||
      shiftStockTupleKey(matches[0]) !== shiftStockTupleKey(line) ||
      Math.abs(movementQuantity - reservationQuantity) > 1e-9
    ) {
      return fail('shift_material_handoff_invalid', 409)
    }
  }

  const handoffs = (production?.handoffs ?? []).filter(
    (handoff) =>
      String(handoff?.kind ?? '').trim() !== 'return' &&
      String(handoff?.orderId ?? '').trim() === orderId &&
      String(handoff?.lineId ?? '').trim() === lineId &&
      String(handoff?.reservationDocumentId ?? '').trim() === reservationDocumentId,
  )
  if (handoffs.length === 0) return fail('shift_material_handoff_required', 409)
  if (handoffs.length !== 1) return fail('shift_material_handoff_ambiguous', 409)

  const handoffIds = new Set()
  const transferPairIds = new Set()
  const receiptDocumentIds = new Set()
  const handedOffRawTuples = new Set()
  for (const handoff of handoffs) {
    const handoffId = String(handoff?.id ?? '').trim()
    const transferPairId = String(handoff?.transferPairId ?? '').trim()
    const issueDocumentId = String(handoff?.issueDocumentId ?? '').trim()
    const receiptDocumentId = String(handoff?.receiptDocumentId ?? '').trim()
    if (
      !handoffId ||
      !transferPairId ||
      !issueDocumentId ||
      !receiptDocumentId ||
      issueDocumentId === receiptDocumentId ||
      handoffIds.has(handoffId) ||
      transferPairIds.has(transferPairId)
    ) {
      return fail('shift_material_handoff_invalid', 409)
    }
    handoffIds.add(handoffId)
    transferPairIds.add(transferPairId)
    receiptDocumentIds.add(receiptDocumentId)

    const pairDocuments = (warehouse?.documents ?? []).filter(
      (document) => String(document?.transferPairId ?? '').trim() === transferPairId,
    )
    const issueMatches = pairDocuments.filter(
      (document) => String(document?.id ?? '').trim() === issueDocumentId,
    )
    const receiptMatches = pairDocuments.filter(
      (document) => String(document?.id ?? '').trim() === receiptDocumentId,
    )
    if (pairDocuments.length !== 2 || issueMatches.length !== 1 || receiptMatches.length !== 1) {
      return fail('shift_material_handoff_invalid', 409)
    }
    const issue = issueMatches[0]
    const receipt = receiptMatches[0]
    const documentsValid = [issue, receipt].every(
      (document) =>
        document?.status === 'posted' &&
        String(document?.productionOrderId ?? '').trim() === orderId &&
        String(document?.productionLineId ?? '').trim() === lineId &&
        String(document?.reservationDocumentId ?? '').trim() === reservationDocumentId,
    )
    if (
      !documentsValid ||
      issue?.type !== 'issue' ||
      issue?.purpose !== 'production_issue' ||
      issue?.docRole !== 'transfer_issue' ||
      receipt?.type !== 'receipt' ||
      receipt?.purpose !== 'production_receipt' ||
      receipt?.docRole !== 'transfer_receipt' ||
      String(issue?.warehouseId ?? '').trim() !== String(reservation?.warehouseId ?? '').trim() ||
      String(receipt?.warehouseId ?? '').trim() !==
        String(binding?.productionWarehouseId ?? '').trim()
    ) {
      return fail('shift_material_handoff_invalid', 409)
    }

    const issueLines = Array.isArray(issue?.lines) ? issue.lines : []
    const receiptLines = Array.isArray(receipt?.lines) ? receipt.lines : []
    const reservationQuantity = reservationLines.reduce(
      (sum, line) => sum + Number(line?.quantity),
      0,
    )
    const receiptQuantity = receiptLines.reduce(
      (sum, line) => sum + Number(line?.quantity),
      0,
    )
    const frozenRawQuantity = Number(order?.rawMaterialQty)
    if (
      issueLines.length === 0 ||
      receiptLines.length === 0 ||
      [...issueLines, ...receiptLines].some(
        (line) =>
          String(line?.itemId ?? '').trim() !== rawMaterialItemId ||
          String(line?.productionOrderId ?? '').trim() !== orderId ||
          String(line?.productionLineId ?? '').trim() !== lineId,
      ) ||
      receiptLines.some(
        (line) =>
          String(line?.locationId ?? '').trim() !==
          String(binding?.productionLocationId ?? '').trim(),
      ) ||
      !sameShiftTupleQuantities(
        shiftTupleQuantities(issueLines),
        shiftTupleQuantities(receiptLines),
      ) ||
      !Number.isFinite(reservationQuantity) ||
      !Number.isFinite(receiptQuantity) ||
      !Number.isFinite(frozenRawQuantity) ||
      reservationQuantity <= 0 ||
      receiptQuantity <= 0 ||
      frozenRawQuantity <= 0 ||
      Math.abs(receiptQuantity - reservationQuantity) > 1e-9 ||
      Math.abs(receiptQuantity - frozenRawQuantity) > 1e-9
    ) {
      return fail('shift_material_handoff_invalid', 409)
    }

    if (
      !documentMovementsMatchLines(warehouse, issue, 'issue', {
        orderId,
        lineId,
        reservationDocumentId,
        transferPairId,
        consumesReserve: true,
      }) ||
      !documentMovementsMatchLines(warehouse, receipt, 'receipt', {
        orderId,
        lineId,
        reservationDocumentId,
        transferPairId,
      })
    ) {
      return fail('shift_material_handoff_invalid', 409)
    }

    for (const line of receiptLines) handedOffRawTuples.add(shiftStockTupleKey(line))
  }

  const actualRawInputs = (Array.isArray(actualInputs) ? actualInputs : []).filter(
    (line) => String(line?.itemId ?? '').trim() === rawMaterialItemId,
  )
  if (actualRawInputs.length === 0) return fail('shift_raw_material_input_required', 409)
  if (actualRawInputs.some((line) => !handedOffRawTuples.has(shiftStockTupleKey(line)))) {
    return fail('shift_raw_material_input_not_handed_off', 409)
  }

  // Do not let an orphan receipt with the same lot tuple inflate line stock.
  // Only the validated handoff receipt (plus a storno of a prior exact issue)
  // can contribute positive raw-material balance.
  for (const requested of aggregateShiftActualInputs(actualRawInputs)) {
    let balance = 0
    let invalidReversal = false
    for (const movement of warehouse?.movements ?? []) {
      if (movement?.cancelled === true) continue
      if (shiftStockTupleKey(movement) !== shiftStockTupleKey(requested)) continue
      if (
        String(movement?.warehouseId ?? '').trim() !==
          String(binding?.productionWarehouseId ?? '').trim() ||
        String(movement?.locationId ?? '').trim() !==
          String(binding?.productionLocationId ?? '').trim() ||
        String(movement?.productionOrderId ?? '').trim() !== orderId ||
        String(movement?.productionLineId ?? '').trim() !== lineId
      ) {
        continue
      }
      const rawQuantity = Number(movement?.quantity)
      if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
        invalidReversal = true
        break
      }
      const quantity = rawQuantity
      if (['issue', 'out'].includes(String(movement?.type ?? '').trim())) {
        balance -= quantity
        continue
      }
      if (!['receipt', 'in'].includes(String(movement?.type ?? '').trim())) continue
      const directHandoff = receiptDocumentIds.has(String(movement?.documentId ?? '').trim())
      const reversesMovementId = String(movement?.reversesMovementId ?? '').trim()
      const validReversal =
        Boolean(reversesMovementId) && isExactShiftCorrectionReversal(warehouse, movement)
      if (directHandoff && !reversesMovementId) balance += quantity
      else if (validReversal) balance += quantity
      else if (reversesMovementId) {
        invalidReversal = true
        break
      }
    }
    if (invalidReversal) return fail('shift_material_handoff_invalid', 409)
    if (!Number.isFinite(balance)) {
      return fail('shift_stock_ledger_invalid', 409)
    }
    if (requested.quantity > balance + 1e-9) {
      return fail('insufficient_line_material', 400)
    }
  }

  return ok({
    rawMaterialItemId,
    reservationDocumentId,
    handoffIds: [...handoffIds],
    transferPairIds: [...transferPairIds],
    receiptDocumentIds: [...receiptDocumentIds],
  })
}

function confirmedShiftOutputForOrder(production, orderId, { excludeReportId } = {}) {
  const confirmed = (production?.shiftReports ?? []).filter(
    (report) =>
      report?.status === 'confirmed' &&
      String(report?.orderId ?? report?.productionOrderId ?? '').trim() === orderId,
  )
  const confirmedIds = new Set(confirmed.map((report) => String(report?.id ?? '').trim()))
  if (
    confirmed.some((report) => !String(report?.id ?? '').trim()) ||
    confirmedIds.size !== confirmed.length
  ) {
    return Number.NaN
  }
  const correctionTargets = confirmed
    .map((report) => String(report?.correctsReportId ?? '').trim())
    .filter(Boolean)
  if (
    correctionTargets.some((reportId) => !confirmedIds.has(reportId)) ||
    new Set(correctionTargets).size !== correctionTargets.length
  ) {
    return Number.NaN
  }
  const supersededIds = new Set(
    confirmed
      .map((report) => String(report?.correctsReportId ?? '').trim())
      .filter((reportId) => reportId && confirmedIds.has(reportId)),
  )
  return confirmed.reduce((sum, report) => {
    if (
      String(report?.id ?? '').trim() === String(excludeReportId ?? '').trim() ||
      supersededIds.has(String(report?.id ?? '').trim())
    ) {
      return sum
    }
    const output = Number(report?.outputMp ?? report?.outputM2)
    return Number.isFinite(output) && output > 0 ? sum + output : Number.NaN
  }, 0)
}

function postReservationDoc(warehouse, { warehouseId, orderId, lines, now, actor, date }) {
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const number = nextServerDocumentNumber(warehouse.documents, 'reservation', warehouseId, date)
  const doc = {
    id: documentId,
    type: 'reservation',
    purpose: 'production_reservation',
    docRole: 'production_reservation',
    warehouseId,
    date,
    number,
    lines,
    status: 'posted',
    productionOrderId: orderId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const movements = lines.map((line) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId,
    documentLineId: line.lineId,
    warehouseId,
    locationId: line.locationId,
    itemId: line.itemId,
    quantity: Number(line.quantity),
    batchNo: line.batchNo,
    expiryDate: line.expiryDate,
    batchRunId: line.batchRunId,
    type: 'reserve',
    at: now,
    date,
    actorUid: actor.uid,
    productionOrderId: orderId,
  }))
  return {
    warehouse: {
      ...warehouse,
      documents: [...warehouse.documents, doc],
      movements: [...warehouse.movements, ...movements],
    },
    documentId,
  }
}

function upsertShortage(warehouse, record, now) {
  const list = [...(warehouse.materialShortages ?? [])]
  const key = record.idempotencyKey
  const idx = list.findIndex((r) => r.idempotencyKey === key)
  const row = {
    ...record,
    id: idx >= 0 ? list[idx].id : `sh-${crypto.randomUUID()}`,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
    updatedAt: now,
    status: record.shortageQty <= 0 ? 'resolved' : record.reservedQty > 0 ? 'partial' : 'open',
  }
  if (idx >= 0) list[idx] = row
  else list.push(row)
  return { ...warehouse, materialShortages: list }
}

function applyRecipeDraftSave(production, command, actor, now) {
  const recipeId = String(command.recipeId ?? '').trim()
  const versionId = String(command.versionId ?? '').trim() || `rv-${crypto.randomUUID()}`
  if (!recipeId) return fail('invalid_input', 400)
  const components = Array.isArray(command.components) ? command.components : []
  for (const c of components) {
    if (!String(c.warehouseItemId ?? '').trim()) return fail('invalid_component_item', 400)
    if (!String(c.unitSnapshot ?? '').trim()) return fail('invalid_component_unit', 400)
    if (!Number.isFinite(Number(c.normQty)) || Number(c.normQty) < 0) return fail('invalid_norm', 400)
  }
  const existing = (production.recipeVersions ?? []).find((v) => v.id === versionId)
  if (existing?.status === 'approved') return fail('recipe_immutable', 409)
  const versionNumber =
    Number(command.versionNumber) ||
    existing?.versionNumber ||
    Math.max(0, ...(production.recipeVersions ?? [])
      .filter((v) => v.recipeId === recipeId)
      .map((v) => v.versionNumber)) + 1
  const draft = {
    id: versionId,
    recipeId,
    versionNumber,
    status: 'draft',
    effectiveFrom: command.effectiveFrom ? String(command.effectiveFrom).slice(0, 10) : undefined,
    components: components.map((c) => ({
      lineId: String(c.lineId ?? crypto.randomUUID()),
      warehouseItemId: String(c.warehouseItemId).trim(),
      itemCodeSnapshot: c.itemCodeSnapshot != null ? String(c.itemCodeSnapshot) : undefined,
      itemNameSnapshot: c.itemNameSnapshot != null ? String(c.itemNameSnapshot) : undefined,
      unitSnapshot: String(c.unitSnapshot).trim(),
      normQty: Number(c.normQty),
      tolerancePct: Number(c.tolerancePct) || 0,
      isWater: c.isWater === true,
    })),
    normBase: command.normBase === 'per_batch' || command.normBase === 'per_roll' ? command.normBase : 'per_m2',
    batchSize: command.batchSize != null ? Number(command.batchSize) : undefined,
    contentHash: '',
    note: command.note != null ? String(command.note) : undefined,
    createdBy: existing?.createdBy ?? actor.uid,
    createdByName: existing?.createdByName ?? actor.email ?? actor.uid,
    createdAt: existing?.createdAt ?? now,
  }
  draft.contentHash = hashRecipeContent(draft)
  const list = [...(production.recipeVersions ?? [])]
  const idx = list.findIndex((v) => v.id === versionId)
  if (idx >= 0) list[idx] = draft
  else list.push(draft)
  let next = { ...production, recipeVersions: list }
  next = appendProdAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'recipe_draft_save',
    actorUid: actor.uid,
    detail: `recipe ${recipeId} v${versionNumber}`,
  })
  return ok({ production: next, warehouse: null, result: { versionId, status: 'draft' } })
}

function applyRecipeApprove(production, command, actor, now) {
  const versionId = String(command.versionId ?? '').trim()
  if (!versionId) return fail('invalid_input', 400)
  const list = [...(production.recipeVersions ?? [])]
  const idx = list.findIndex((v) => v.id === versionId)
  if (idx < 0) return fail('not_found', 404)
  const ver = list[idx]
  if (ver.status === 'approved') {
    return ok({ production, warehouse: null, result: { versionId, status: 'approved', idempotent: true } })
  }
  if (ver.status !== 'draft') return fail('invalid_status', 409)
  if (!(ver.components ?? []).length) return fail('empty_components', 400)
  const approved = {
    ...ver,
    status: 'approved',
    contentHash: hashRecipeContent(ver),
    approvedBy: actor.uid,
    approvedByName: actor.email ?? actor.uid,
    approvedAt: now,
    effectiveFrom: ver.effectiveFrom || now.slice(0, 10),
  }
  list[idx] = approved
  let next = { ...production, recipeVersions: list }
  next = appendProdAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'recipe_approve',
    actorUid: actor.uid,
    detail: `approve ${versionId}`,
  })
  return ok({ production: next, warehouse: null, result: { versionId, status: 'approved', contentHash: approved.contentHash } })
}

function applyOrderDraftSave(production, command, actor, now, ctx = {}) {
  const orderId = String(command.orderId ?? '').trim() || `po-${crypto.randomUUID()}`
  const existing = (production.orders ?? []).find((o) => o.id === orderId)
  if (existing && existing.status !== 'draft') return fail('posted_immutable', 409)
  // Trusted BOM *references* only (ids/hash). Never persist client packagingBomSnapshot.
  const packagingBomId =
    command.packagingBomId != null ? String(command.packagingBomId).trim() : existing?.packagingBomId
  const packagingBomVersion =
    command.packagingBomVersion != null
      ? Number(command.packagingBomVersion)
      : existing?.packagingBomVersion
  const packagingBomContentHash =
    command.packagingBomContentHash != null
      ? String(command.packagingBomContentHash).trim()
      : existing?.packagingBomContentHash
  const order = {
    ...(existing ?? {}),
    id: orderId,
    wipContractVersion:
      existing?.wipContractVersion ??
      (ctx.enforceCanonicalLineage === true && !existing ? 1 : undefined),
    orderNumber: String(command.orderNumber ?? existing?.orderNumber ?? orderId),
    finishedProductId: String(command.finishedProductId ?? '').trim(),
    warehouseItemId:
      command.warehouseItemId != null
        ? String(command.warehouseItemId).trim() || undefined
        : existing?.warehouseItemId,
    semiFinishedItemId:
      command.semiFinishedItemId != null
        ? String(command.semiFinishedItemId).trim() || undefined
        : existing?.semiFinishedItemId,
    rawMaterialItemId:
      command.rawMaterialItemId != null
        ? String(command.rawMaterialItemId).trim() || undefined
        : existing?.rawMaterialItemId,
    rawMaterialQty:
      command.rawMaterialQty != null
        ? Number(command.rawMaterialQty)
        : existing?.rawMaterialQty,
    productName: String(command.productName ?? existing?.productName ?? ''),
    formulationRecipeId: String(command.formulationRecipeId ?? '').trim(),
    impregnationOutputItemId:
      command.impregnationOutputItemId != null
        ? String(command.impregnationOutputItemId).trim() || undefined
        : existing?.impregnationOutputItemId,
    totalQtyMp: Number(command.totalQtyMp),
    startDate: String(command.startDate ?? '').slice(0, 10),
    endDate: String(command.endDate ?? '').slice(0, 10),
    lineId: String(command.lineId ?? '').trim(),
    priority: command.priority === 'urgent' ? 'urgent' : 'normal',
    status: 'draft',
    customer: String(command.customer ?? existing?.customer ?? ''),
    category: command.category ?? existing?.category ?? 'grid',
    recommendationId:
      command.recommendationId != null
        ? String(command.recommendationId).trim()
        : existing?.recommendationId,
    planningRunId:
      command.planningRunId != null ? String(command.planningRunId).trim() : existing?.planningRunId,
    planningRunSourceRevision:
      command.planningRunSourceRevision != null
        ? Number(command.planningRunSourceRevision)
        : existing?.planningRunSourceRevision,
    packagingBomId: packagingBomId || undefined,
    packagingBomVersion: Number.isFinite(packagingBomVersion) ? packagingBomVersion : undefined,
    packagingBomContentHash: packagingBomContentHash || undefined,
    salesOrderId:
      command.salesOrderId != null ? String(command.salesOrderId).trim() : existing?.salesOrderId,
    salesLineId:
      command.salesLineId != null ? String(command.salesLineId).trim() : existing?.salesLineId,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
    updatedAt: now,
    history: existing?.history ?? [],
  }
  // Strip any accidental snapshot from prior merge
  delete order.packagingBomSnapshot
  if (!order.finishedProductId || !order.formulationRecipeId || !order.lineId) {
    return fail('invalid_order', 400)
  }
  if (!Number.isFinite(order.totalQtyMp) || order.totalQtyMp <= 0) return fail('invalid_quantity', 400)
  const list = [...(production.orders ?? [])]
  const idx = list.findIndex((o) => o.id === orderId)
  if (idx >= 0) list[idx] = order
  else list.push(order)
  return ok({
    production: { ...production, orders: list },
    warehouse: null,
    result: { orderId, status: 'draft' },
  })
}

function applyOrderConfirm(production, warehouse, command, actor, now, ctx = {}) {
  const orderId = String(command.orderId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  if (!orderId || !rawWarehouseId) return fail('invalid_input', 400)
  const list = [...(production.orders ?? [])]
  const idx = list.findIndex((o) => o.id === orderId)
  if (idx < 0) return fail('not_found', 404)
  const order = list[idx]
  if (order.status === 'active' && order.recipeNormSnapshot) {
    if (orderUsesWipContractV1(order, ctx)) {
      const finishedGoodsReady = validateOrderFinishedGoodsMapping(order, ctx)
      if (!finishedGoodsReady.ok) return finishedGoodsReady
      const wipReady = validateOrderWipMapping(order, warehouse, ctx)
      if (!wipReady.ok) return wipReady
      const impregnationReady = validateOrderImpregnationOutputMapping(
        order,
        warehouse,
      )
      if (!impregnationReady.ok) return impregnationReady
    }
    return ok({
      production,
      warehouse,
      result: {
        orderId,
        status: 'active',
        idempotent: true,
        packagingBomSnapshot: order.packagingBomSnapshot ?? null,
        packagingBomRequired: order.packagingBomRequired,
      },
    })
  }
  if (order.status !== 'draft' && order.status !== 'active') return fail('invalid_status', 409)
  if (isPeriodClosed(warehouse, order.startDate || now.slice(0, 10))) {
    return fail('period_closed', 403)
  }
  if (orderUsesWipContractV1(order, ctx)) {
    const finishedGoodsReady = validateOrderFinishedGoodsMapping(order, ctx)
    if (!finishedGoodsReady.ok) return finishedGoodsReady
    const wipReady = validateOrderWipMapping(order, warehouse, ctx)
    if (!wipReady.ok) return wipReady
    const impregnationReady = validateOrderImpregnationOutputMapping(
      order,
      warehouse,
    )
    if (!impregnationReady.ok) return impregnationReady
  }
  const approved = getApprovedVersion(production, order.formulationRecipeId, now)
  if (!approved) return fail('recipe_not_approved', 409)
  // Ignore client-supplied recipe / packaging snapshots entirely
  const snapshot = buildSnapshot(approved, now)
  let needs
  if (orderUsesWipContractV1(order, ctx)) {
    const rawMaterialItemId = String(order.rawMaterialItemId ?? '').trim()
    const rawMaterialQty = Number(order.rawMaterialQty)
    if (!rawMaterialItemId || !Number.isFinite(rawMaterialQty) || rawMaterialQty <= 0) {
      return fail('raw_material_mapping_required', 409)
    }
    const catalogue = ctx.masterDataActive
      ? ctx.masterData?.items ?? []
      : warehouse.items ?? []
    const rawItem = catalogue.find(
      (row) => String(row?.id ?? '').trim() === rawMaterialItemId,
    )
    if (!rawItem || rawItem.archived === true || rawItem.active === false) {
      return fail('raw_material_item_unavailable', 409)
    }
    const unitSnapshot = String(rawItem.baseUnit ?? rawItem.unit ?? '').trim()
    if (!unitSnapshot) return fail('raw_material_unit_required', 409)
    needs = [
      {
        warehouseItemId: rawMaterialItemId,
        needQty: rawMaterialQty,
        unitSnapshot,
        tolerancePct: 0,
      },
    ]
  } else {
    needs = materialNeedFromSnapshot(snapshot, order.totalQtyMp)
  }
  const date = (order.startDate || now).slice(0, 10)

  let packagingBomSnapshot
  let packagingBomRequired
  const masterDataActive = ctx.masterDataActive === true
  const masterData = ctx.masterData
  if (masterDataActive) {
    const product = (masterData?.finishedProducts ?? []).find(
      (p) => String(p.id) === String(order.finishedProductId),
    )
    if (!product || product.archived === true) return fail('product_not_found', 404)
    const bom = selectApprovedPackagingBom(masterData, product, date)
    const required = productRequiresPackagingBom(product)
    packagingBomRequired = required
    if (!bom && required) return fail('packaging_bom_required', 409)
    if (bom) {
      if (order.packagingBomId || order.packagingBomContentHash) {
        if (
          String(order.packagingBomId || '') !== String(bom.id) ||
          (order.packagingBomVersion != null &&
            Number(order.packagingBomVersion) !== Number(bom.version)) ||
          (order.packagingBomContentHash &&
            String(order.packagingBomContentHash) !== String(bom.contentHash || ''))
        ) {
          return fail('packaging_bom_stale', 409)
        }
      }
      packagingBomSnapshot = buildPackagingBomSnapshot(bom, product, actor, now, date)
    }
  }

  const reserveLines = []
  let wh = warehouse
  for (const need of needs) {
    const available = ordinaryAvailableQty(wh.movements, need.warehouseItemId, rawWarehouseId)
    const reserveQty = Math.min(need.needQty, Math.max(0, available))
    const shortageQty = Math.max(0, need.needQty - reserveQty)
    if (reserveQty > 1e-9) {
      reserveLines.push({
        lineId: crypto.randomUUID(),
        itemId: need.warehouseItemId,
        quantity: reserveQty,
        unitSnapshot: need.unitSnapshot,
      })
    }
    wh = upsertShortage(
      wh,
      {
        idempotencyKey: `shortage::${orderId}::${need.warehouseItemId}::${rawWarehouseId}`,
        orderId,
        itemId: need.warehouseItemId,
        warehouseId: rawWarehouseId,
        needQty: need.needQty,
        reservedQty: reserveQty,
        shortageQty,
        firstShortageDate: shortageQty > 0 ? date : undefined,
        orderPriority: order.priority,
        neededAt: order.startDate,
      },
      now,
    )
  }
  let reservationDocumentId
  if (reserveLines.length) {
    const out = postReservationDoc(wh, {
      warehouseId: rawWarehouseId,
      orderId,
      lines: reserveLines,
      now,
      actor,
      date,
    })
    wh = out.warehouse
    reservationDocumentId = out.documentId
  }
  const confirmed = {
    ...order,
    status: 'active',
    recipeNormSnapshot: snapshot,
    packagingBomRequired,
    packagingBomSnapshot: packagingBomSnapshot ?? undefined,
    packagingBomId: packagingBomSnapshot?.packagingBomId ?? order.packagingBomId,
    packagingBomVersion: packagingBomSnapshot?.version ?? order.packagingBomVersion,
    packagingBomContentHash: packagingBomSnapshot?.contentHash ?? order.packagingBomContentHash,
    confirmedAt: now,
    confirmedBy: actor.uid,
    reservationDocumentId,
    history: [
      ...(order.history ?? []),
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'activated',
        message: `confirmed snapshot ${snapshot.recipeVersionId}`,
      },
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'recipe_norm_snapshot',
        message: snapshot.contentHash,
      },
      ...(packagingBomSnapshot
        ? [
            {
              id: `h-${crypto.randomUUID()}`,
              at: now,
              type: 'packaging_bom_snapshot',
              message: `${packagingBomSnapshot.packagingBomId}@${packagingBomSnapshot.version}:${packagingBomSnapshot.contentHash}`,
            },
          ]
        : []),
    ],
  }
  list[idx] = confirmed
  let prod = { ...production, orders: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'order_confirm',
    actorUid: actor.uid,
    detail: `order ${orderId}`,
  })
  wh = appendWhAudit(wh, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'production_reserve',
    actorUid: actor.uid,
    detail: `order ${orderId} lines=${reserveLines.length}`,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: {
      orderId,
      status: 'active',
      reservationDocumentId,
      snapshotVersionId: snapshot.recipeVersionId,
      reservedLines: reserveLines.length,
      packagingBomId: packagingBomSnapshot?.packagingBomId,
      packagingBomVersion: packagingBomSnapshot?.version,
      packagingBomContentHash: packagingBomSnapshot?.contentHash,
      packagingBomRequired,
    },
  })
}

function currentG3Projection(production, warehouse) {
  return {
    warehouse: {
      documents: warehouse.documents,
      movements: warehouse.movements,
      materialShortages: warehouse.materialShortages,
      auditLog: warehouse.auditLog,
      closedMonths: warehouse.closedMonths,
      productionLineBindings: warehouse.productionLineBindings,
      scrapLocationId: warehouse.scrapLocationId,
    },
    production: {
      recipeVersions: production.recipeVersions,
      orders: production.orders,
      shiftReports: production.shiftReports,
      wipBatches: production.wipBatches,
      wasteRecords: production.wasteRecords,
      handoffs: production.handoffs,
      impregnationQcDecisions: production.impregnationQcDecisions,
      auditLog: production.auditLog,
      packagingReports: production.packagingReports,
      finishedGoodsLots: production.finishedGoodsLots,
      qcDecisions: production.qcDecisions,
    },
  }
}

function resolveOrderConfirmReplay(production, warehouse, command, receipts = []) {
  const orderId = String(command.orderId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const orders = (production.orders ?? []).filter(
    (row) => String(row?.id ?? '').trim() === orderId,
  )
  if (!orderId || !rawWarehouseId || orders.length !== 1) {
    return fail('receipt_replay_state_conflict', 409)
  }
  const order = orders[0]
  const snapshotVersionId = String(order?.recipeNormSnapshot?.recipeVersionId ?? '').trim()
  const reservationDocumentId = String(order?.reservationDocumentId ?? '').trim()
  if (order.status !== 'active' || !snapshotVersionId) {
    return fail('receipt_replay_state_conflict', 409)
  }

  let reservedLines = 0
  if (reservationDocumentId) {
    const documents = (warehouse.documents ?? []).filter(
      (row) => String(row?.id ?? '').trim() === reservationDocumentId,
    )
    if (documents.length !== 1) return fail('receipt_replay_state_conflict', 409)
    const document = documents[0]
    const lines = Array.isArray(document?.lines) ? document.lines : null
    const movements = (warehouse.movements ?? []).filter(
      (row) => String(row?.documentId ?? '').trim() === reservationDocumentId,
    )
    if (
      document.status !== 'posted' ||
      document.type !== 'reservation' ||
      document.docRole !== 'production_reservation' ||
      String(document.productionOrderId ?? '').trim() !== orderId ||
      String(document.warehouseId ?? '').trim() !== rawWarehouseId ||
      !lines ||
      lines.length === 0 ||
      movements.length !== lines.length
    ) {
      return fail('receipt_replay_state_conflict', 409)
    }
    const lineIds = new Set()
    for (const line of lines) {
      const lineId = String(line?.lineId ?? '').trim()
      const itemId = String(line?.itemId ?? '').trim()
      const quantity = Number(line?.quantity)
      const matches = movements.filter(
        (movement) => String(movement?.documentLineId ?? '').trim() === lineId,
      )
      if (
        !lineId ||
        lineIds.has(lineId) ||
        !itemId ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        matches.length !== 1
      ) {
        return fail('receipt_replay_state_conflict', 409)
      }
      lineIds.add(lineId)
      const movement = matches[0]
      if (
        movement?.cancelled === true ||
        movement?.type !== 'reserve' ||
        String(movement?.productionOrderId ?? '').trim() !== orderId ||
        String(movement?.warehouseId ?? '').trim() !== rawWarehouseId ||
        String(movement?.itemId ?? '').trim() !== itemId ||
        String(movement?.locationId ?? '').trim() !== String(line?.locationId ?? '').trim() ||
        String(movement?.batchNo ?? '').trim() !== String(line?.batchNo ?? '').trim() ||
        String(movement?.expiryDate ?? '').trim() !== String(line?.expiryDate ?? '').trim() ||
        String(movement?.batchRunId ?? '').trim() !== String(line?.batchRunId ?? '').trim() ||
        !Number.isFinite(Number(movement?.quantity)) ||
        Math.abs(Number(movement.quantity) - quantity) > 1e-9
      ) {
        return fail('receipt_replay_state_conflict', 409)
      }
    }
    reservedLines = lines.length
  }

  const stableResult = {
    orderId,
    status: 'active',
    reservationDocumentId: reservationDocumentId || undefined,
    snapshotVersionId,
    reservedLines,
    packagingBomId: order?.packagingBomSnapshot?.packagingBomId,
    packagingBomVersion: order?.packagingBomSnapshot?.version,
    packagingBomContentHash: order?.packagingBomSnapshot?.contentHash,
    packagingBomRequired: order?.packagingBomRequired,
  }
  for (const receipt of receipts) {
    const result = receipt?.result
    if (
      !result ||
      String(result.orderId ?? '').trim() !== stableResult.orderId ||
      result.status !== stableResult.status ||
      String(result.reservationDocumentId ?? '').trim() !== reservationDocumentId ||
      String(result.snapshotVersionId ?? '').trim() !== snapshotVersionId ||
      Number(result.reservedLines ?? 0) !== reservedLines ||
      String(result.packagingBomId ?? '').trim() !== String(stableResult.packagingBomId ?? '').trim() ||
      Number(result.packagingBomVersion ?? 0) !== Number(stableResult.packagingBomVersion ?? 0) ||
      String(result.packagingBomContentHash ?? '').trim() !==
        String(stableResult.packagingBomContentHash ?? '').trim() ||
      Boolean(result.packagingBomRequired) !== Boolean(stableResult.packagingBomRequired)
    ) {
      return fail('receipt_replay_state_conflict', 409)
    }
  }
  return ok({ result: stableResult })
}

/**
 * G5.5 / G3 — list confirmed (active) orders missing immutable packagingBomSnapshot.
 * Pure scan; does not mutate.
 */
function scanConfirmedOrdersMissingPackagingBomSnapshot(production, masterData, asOfDate) {
  const asOf = String(asOfDate ?? new Date().toISOString()).slice(0, 10)
  const boms = masterData?.packagingBoms ?? []
  const products = masterData?.finishedProducts ?? []
  const out = []
  for (const order of production?.orders ?? []) {
    if (String(order?.status ?? '') !== 'active') continue
    const existingHash = String(order?.packagingBomSnapshot?.contentHash ?? '').trim()
    if (existingHash) continue
    const finishedProductId = String(order.finishedProductId ?? '').trim()
    const product = products.find((p) => String(p.id) === finishedProductId) ?? null
    const availableBoms = boms
      .filter(
        (b) =>
          String(b.finishedProductId ?? '') === finishedProductId &&
          bomIsApprovedEffective(b, asOf),
      )
      .map((b) => ({
        packagingBomId: String(b.id ?? ''),
        version: Number(b.version) || 1,
        contentHash: String(b.contentHash ?? ''),
        effectiveFrom: b.effectiveFrom != null ? String(b.effectiveFrom).slice(0, 10) : undefined,
        effectiveTo: b.effectiveTo != null ? String(b.effectiveTo).slice(0, 10) : undefined,
      }))
      .filter((b) => b.packagingBomId)
    const ambiguous = availableBoms.length > 1
    let blockReason
    if (!product || product.archived === true) blockReason = 'product_not_found'
    else if (availableBoms.length === 0 && productRequiresPackagingBom(product)) {
      blockReason = 'bom_not_found'
    } else if (ambiguous) blockReason = 'ambiguous_bom'
    out.push({
      orderId: String(order.id),
      finishedProductId,
      confirmedAt: order.confirmedAt ?? null,
      status: order.status,
      availableBoms,
      ambiguous,
      ...(blockReason ? { blockReason } : {}),
    })
  }
  return out
}

/**
 * G5.5 / G3 — backfill packagingBomSnapshot on a confirmed order only.
 * Never mutates quantity, status, reservations, or warehouse movements.
 */
function applyPackagingBomSnapshotMigrate(production, masterData, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const packagingBomId = String(command.packagingBomId ?? '').trim()
  const packagingBomVersion = Number(command.packagingBomVersion)
  const reason = String(command.reason ?? '').trim()
  const dryRun = command.dryRun === true
  const asOf = String(command.asOfDate ?? now).slice(0, 10)

  if (!orderId || !packagingBomId || !Number.isFinite(packagingBomVersion) || !reason) {
    return fail('invalid_input', 400)
  }

  const list = [...(production.orders ?? [])]
  const idx = list.findIndex((o) => o.id === orderId)
  if (idx < 0) return fail('not_found', 404)
  const order = list[idx]
  if (order.status !== 'active') return fail('invalid_status', 409)

  const existingSnap = order.packagingBomSnapshot
  const existingHash = String(existingSnap?.contentHash ?? '').trim()
  if (existingHash) {
    // Idempotent success when same BOM id/version already frozen
    if (
      String(existingSnap.packagingBomId ?? '') === packagingBomId &&
      Number(existingSnap.version) === packagingBomVersion
    ) {
      return ok({
        production,
        warehouse: null,
        result: {
          orderId,
          packagingBomId,
          version: packagingBomVersion,
          contentHash: existingHash,
          dryRun,
          migrated: false,
          idempotent: true,
        },
      })
    }
    return fail('snapshot_already_present', 409)
  }

  const bom = findById(masterData?.packagingBoms, packagingBomId)
  if (!bom) return fail('bom_not_found', 404)
  if (String(bom.finishedProductId ?? '') !== String(order.finishedProductId ?? '')) {
    return fail('bom_not_found', 404)
  }
  if (!bomIsApprovedEffective(bom, asOf)) return fail('bom_not_effective', 409)
  if (Number(bom.version) !== packagingBomVersion) return fail('bom_version_mismatch', 409)
  const bomHash = String(bom.contentHash ?? '').trim()
  if (!bomHash) return fail('bom_content_hash_required', 400)

  const candidates = (masterData?.packagingBoms ?? []).filter(
    (b) =>
      String(b.finishedProductId ?? '') === String(order.finishedProductId ?? '') &&
      bomIsApprovedEffective(b, asOf),
  )
  if (candidates.length > 1) {
    const unique = candidates.filter(
      (b) => String(b.id) === packagingBomId && Number(b.version) === packagingBomVersion,
    )
    if (unique.length !== 1) return fail('ambiguous_bom', 409)
  } else if (candidates.length === 0) {
    return fail('bom_not_found', 404)
  } else if (String(candidates[0].id) !== packagingBomId) {
    return fail('bom_not_found', 404)
  }

  const product =
    (masterData?.finishedProducts ?? []).find(
      (p) => String(p.id) === String(order.finishedProductId),
    ) ?? { id: order.finishedProductId }
  const packagingBomSnapshot = buildPackagingBomSnapshot(bom, product, actor, now, asOf)

  if (dryRun) {
    return ok({
      production,
      warehouse: null,
      result: {
        orderId,
        packagingBomId: packagingBomSnapshot.packagingBomId,
        version: packagingBomSnapshot.version,
        contentHash: packagingBomSnapshot.contentHash,
        dryRun: true,
        migrated: false,
      },
    })
  }

  const migrated = {
    ...order,
    packagingBomSnapshot,
    packagingBomId: packagingBomSnapshot.packagingBomId,
    packagingBomVersion: packagingBomSnapshot.version,
    packagingBomContentHash: packagingBomSnapshot.contentHash,
    history: [
      ...(order.history ?? []),
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'packaging_bom_snapshot_migrate',
        message: `${packagingBomSnapshot.packagingBomId}@${packagingBomSnapshot.version}:${packagingBomSnapshot.contentHash}`,
        reason,
      },
    ],
  }
  list[idx] = migrated
  let prod = { ...production, orders: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'packaging_bom_snapshot_migrate',
    actorUid: actor.uid,
    detail: `${orderId} ${reason}`,
  })
  return ok({
    production: prod,
    warehouse: null,
    result: {
      orderId,
      packagingBomId: packagingBomSnapshot.packagingBomId,
      version: packagingBomSnapshot.version,
      contentHash: packagingBomSnapshot.contentHash,
      dryRun: false,
      migrated: true,
    },
  })
}

function applyOrderCancel(production, warehouse, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const reason = String(command.reason ?? '').trim()
  if (!orderId || !reason) return fail('cancel_reason_required', 400)
  const list = [...(production.orders ?? [])]
  const idx = list.findIndex((o) => o.id === orderId)
  if (idx < 0) return fail('not_found', 404)
  const order = list[idx]
  if (order.status === 'cancelled') {
    return ok({ production, warehouse, result: { orderId, status: 'cancelled', idempotent: true } })
  }
  let wh = warehouse
  // Release remaining reserves for this order (unreserve movements via reservation release doc)
  const reservedByItem = new Map()
  for (const m of wh.movements ?? []) {
    if (m.productionOrderId !== orderId) continue
    if (m.type === 'reserve') {
      reservedByItem.set(m.itemId, (reservedByItem.get(m.itemId) ?? 0) + Math.abs(m.quantity))
    } else if (m.type === 'unreserve' || (m.type === 'issue' && m.consumesReserve)) {
      reservedByItem.set(m.itemId, Math.max(0, (reservedByItem.get(m.itemId) ?? 0) - Math.abs(m.quantity)))
    }
  }
  const releaseLines = [...reservedByItem.entries()]
    .filter(([, q]) => q > 1e-9)
    .map(([itemId, quantity]) => ({
      lineId: crypto.randomUUID(),
      itemId,
      quantity,
    }))
  if (releaseLines.length) {
    const warehouseId = String(command.rawWarehouseId ?? wh.documents.find((d) => d.productionOrderId === orderId)?.warehouseId ?? '').trim()
    if (!warehouseId) return fail('invalid_warehouse', 400)
    if (isPeriodClosed(wh, now.slice(0, 10))) return fail('period_closed', 403)
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const date = now.slice(0, 10)
    const number = nextServerDocumentNumber(wh.documents, 'reservation', warehouseId, date)
    const doc = {
      id: documentId,
      type: 'reservation',
      purpose: 'other',
      docRole: 'reservation_release',
      warehouseId,
      date,
      number,
      lines: releaseLines,
      status: 'posted',
      productionOrderId: orderId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      cancellationReason: reason,
    }
    const movements = releaseLines.map((line) => ({
      id: `mov-${crypto.randomUUID()}`,
      documentId,
      warehouseId,
      itemId: line.itemId,
      quantity: line.quantity,
      type: 'unreserve',
      at: now,
      date,
      actorUid: actor.uid,
      productionOrderId: orderId,
    }))
    wh = {
      ...wh,
      documents: [...wh.documents, doc],
      movements: [...wh.movements, ...movements],
    }
  }
  list[idx] = {
    ...order,
    status: 'cancelled',
    cancelledAt: now,
    cancelledBy: actor.uid,
    cancellationReason: reason,
    history: [
      ...(order.history ?? []),
      { id: `h-${crypto.randomUUID()}`, at: now, type: 'cancelled', message: reason },
    ],
  }
  let prod = { ...production, orders: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'order_cancel',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({ production: prod, warehouse: wh, result: { orderId, status: 'cancelled' } })
}

function remainingReserveMap(movements, orderId, warehouseId) {
  const map = new Map()
  for (const m of movements ?? []) {
    if (m.productionOrderId !== orderId) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    const itemId = m.itemId
    if (m.type === 'reserve') map.set(itemId, (map.get(itemId) ?? 0) + Math.abs(m.quantity))
    else if (m.type === 'unreserve' || (m.type === 'issue' && m.consumesReserve)) {
      map.set(itemId, Math.max(0, (map.get(itemId) ?? 0) - Math.abs(m.quantity)))
    }
  }
  return map
}

function issuedReserveMap(movements, orderId, warehouseId) {
  const map = new Map()
  for (const m of movements ?? []) {
    if (m.productionOrderId !== orderId) continue
    if (warehouseId && m.warehouseId !== warehouseId) continue
    if (m.type === 'issue' && m.consumesReserve) {
      map.set(m.itemId, (map.get(m.itemId) ?? 0) + Math.abs(m.quantity))
    }
  }
  return map
}

function applyOrderChange(production, warehouse, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const newQty = Number(command.totalQtyMp)
  if (!orderId || !rawWarehouseId) return fail('invalid_input', 400)
  if (!Number.isFinite(newQty) || newQty <= 0) return fail('invalid_quantity', 400)
  const list = [...(production.orders ?? [])]
  const idx = list.findIndex((o) => o.id === orderId)
  if (idx < 0) return fail('not_found', 404)
  const order = list[idx]
  if (order.status !== 'active' || !order.recipeNormSnapshot) return fail('order_not_active', 409)
  const canonicalGuard = guardCanonicalOrderChange(order, warehouse, command)
  if (!canonicalGuard.ok) return canonicalGuard
  if (canonicalGuard.canonical) {
    return ok({
      production,
      warehouse,
      result: {
        orderId,
        status: 'active',
        totalQtyMp: order.totalQtyMp,
        increased: 0,
        released: 0,
        idempotent: true,
        canonicalLineagePreserved: true,
      },
    })
  }
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)
  const snapshot = order.recipeNormSnapshot
  const needs = materialNeedFromSnapshot(snapshot, newQty)
  const remaining = remainingReserveMap(warehouse.movements, orderId, rawWarehouseId)
  const issued = issuedReserveMap(warehouse.movements, orderId, rawWarehouseId)
  let wh = warehouse
  const increaseLines = []
  const releaseLines = []
  const date = now.slice(0, 10)
  for (const need of needs) {
    const issuedQty = issued.get(need.warehouseItemId) ?? 0
    const rem = remaining.get(need.warehouseItemId) ?? 0
    const desiredRem = Math.max(0, need.needQty - issuedQty)
    if (desiredRem > rem + 1e-9) {
      const want = desiredRem - rem
      const available = ordinaryAvailableQty(wh.movements, need.warehouseItemId, rawWarehouseId)
      const add = Math.min(want, Math.max(0, available))
      if (add > 1e-9) {
        increaseLines.push({
          lineId: crypto.randomUUID(),
          itemId: need.warehouseItemId,
          quantity: add,
          unitSnapshot: need.unitSnapshot,
        })
      }
      wh = upsertShortage(
        wh,
        {
          idempotencyKey: `shortage::${orderId}::${need.warehouseItemId}::${rawWarehouseId}`,
          orderId,
          itemId: need.warehouseItemId,
          warehouseId: rawWarehouseId,
          needQty: need.needQty,
          reservedQty: rem + add + issuedQty,
          shortageQty: Math.max(0, need.needQty - (rem + add + issuedQty)),
          firstShortageDate: need.needQty - (rem + add + issuedQty) > 1e-9 ? date : undefined,
          orderPriority: order.priority,
          neededAt: order.startDate,
        },
        now,
      )
    } else if (rem > desiredRem + 1e-9) {
      releaseLines.push({
        lineId: crypto.randomUUID(),
        itemId: need.warehouseItemId,
        quantity: rem - desiredRem,
      })
      wh = upsertShortage(
        wh,
        {
          idempotencyKey: `shortage::${orderId}::${need.warehouseItemId}::${rawWarehouseId}`,
          orderId,
          itemId: need.warehouseItemId,
          warehouseId: rawWarehouseId,
          needQty: need.needQty,
          reservedQty: desiredRem + issuedQty,
          shortageQty: Math.max(0, need.needQty - (desiredRem + issuedQty)),
          orderPriority: order.priority,
          neededAt: order.startDate,
        },
        now,
      )
    } else {
      wh = upsertShortage(
        wh,
        {
          idempotencyKey: `shortage::${orderId}::${need.warehouseItemId}::${rawWarehouseId}`,
          orderId,
          itemId: need.warehouseItemId,
          warehouseId: rawWarehouseId,
          needQty: need.needQty,
          reservedQty: rem + issuedQty,
          shortageQty: Math.max(0, need.needQty - (rem + issuedQty)),
          orderPriority: order.priority,
          neededAt: order.startDate,
        },
        now,
      )
    }
  }
  if (increaseLines.length) {
    const out = postReservationDoc(wh, {
      warehouseId: rawWarehouseId,
      orderId,
      lines: increaseLines,
      now,
      actor,
      date,
    })
    wh = out.warehouse
  }
  if (releaseLines.length) {
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const number = nextServerDocumentNumber(wh.documents, 'reservation', rawWarehouseId, date)
    const doc = {
      id: documentId,
      type: 'reservation',
      purpose: 'other',
      docRole: 'reservation_release',
      warehouseId: rawWarehouseId,
      date,
      number,
      lines: releaseLines,
      status: 'posted',
      productionOrderId: orderId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
    }
    const movements = releaseLines.map((line) => ({
      id: `mov-${crypto.randomUUID()}`,
      documentId,
      warehouseId: rawWarehouseId,
      itemId: line.itemId,
      quantity: line.quantity,
      type: 'unreserve',
      at: now,
      date,
      actorUid: actor.uid,
      productionOrderId: orderId,
    }))
    wh = {
      ...wh,
      documents: [...wh.documents, doc],
      movements: [...wh.movements, ...movements],
    }
  }
  const prevQty = order.totalQtyMp
  list[idx] = {
    ...order,
    totalQtyMp: newQty,
    updatedAt: now,
    history: [
      ...(order.history ?? []),
      {
        id: `h-${crypto.randomUUID()}`,
        at: now,
        type: 'changed',
        message: `qty ${prevQty} → ${newQty}`,
      },
    ],
  }
  let prod = { ...production, orders: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'order_change',
    actorUid: actor.uid,
    detail: `order ${orderId} qty ${newQty}`,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: {
      orderId,
      status: 'active',
      totalQtyMp: newQty,
      increased: increaseLines.length,
      released: releaseLines.length,
    },
  })
}

function applyRecipeDraftDelete(production, command, actor, now) {
  const versionId = String(command.versionId ?? '').trim()
  if (!versionId) return fail('invalid_input', 400)
  const ver = (production.recipeVersions ?? []).find((v) => v.id === versionId)
  if (!ver) return fail('not_found', 404)
  if (ver.status === 'approved') return fail('recipe_immutable', 409)
  const list = (production.recipeVersions ?? []).filter((v) => v.id !== versionId)
  let prod = { ...production, recipeVersions: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'recipe_draft_delete',
    actorUid: actor.uid,
    detail: versionId,
  })
  return ok({ production: prod, warehouse: null, result: { versionId, deleted: true } })
}

function applyOrderDraftDelete(production, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  if (!orderId) return fail('invalid_input', 400)
  const order = (production.orders ?? []).find((o) => o.id === orderId)
  if (!order) return fail('not_found', 404)
  if (order.status !== 'draft') return fail('posted_immutable', 409)
  const list = (production.orders ?? []).filter((o) => o.id !== orderId)
  let prod = { ...production, orders: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'order_draft_delete',
    actorUid: actor.uid,
    detail: orderId,
  })
  return ok({ production: prod, warehouse: null, result: { orderId, deleted: true } })
}

function applyShiftDraftSave(production, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  if (!orderId || !lineId) return fail('invalid_input', 400)
  const outputMp = parseShiftOutputMp(command.outputMp, { defaultZero: true })
  if (outputMp == null) return fail('invalid_output', 400)
  const outputRolls = parseShiftOutputRolls(command.outputRolls)
  if (outputRolls == null) return fail('invalid_output_rolls', 400)
  const actualInputs = normalizeShiftDraftStockRows(command.actualInputs, 'actual')
  if (!actualInputs.ok) return fail(actualInputs.error, 400)
  const wasteLines = normalizeShiftDraftStockRows(command.wasteLines, 'waste')
  if (!wasteLines.ok) return fail(wasteLines.error, 400)
  const draftId = String(command.draftId ?? '').trim() || `srd-${crypto.randomUUID()}`
  const existing = (production.shiftReports ?? []).find((r) => r.id === draftId)
  if (existing?.status === 'confirmed') return fail('shift_immutable', 409)
  const draft = {
    ...(existing ?? {}),
    id: draftId,
    status: 'draft',
    orderId,
    lineId,
    shiftDate: String(command.shiftDate ?? now.slice(0, 10)).slice(0, 10),
    shiftSlot: command.shiftSlot ?? 'day',
    outputMp,
    outputRolls,
    actualInputs: actualInputs.rows,
    wasteLines: wasteLines.rows,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
  }
  const list = [...(production.shiftReports ?? [])]
  const idx = list.findIndex((r) => r.id === draftId)
  if (idx >= 0) list[idx] = draft
  else list.push(draft)
  return ok({
    production: { ...production, shiftReports: list },
    warehouse: null,
    result: { draftId, status: 'draft' },
  })
}

function applyShiftDraftDelete(production, command, actor, now) {
  const draftId = String(command.draftId ?? command.reportId ?? '').trim()
  if (!draftId) return fail('invalid_input', 400)
  const report = (production.shiftReports ?? []).find((r) => r.id === draftId)
  if (!report) return fail('not_found', 404)
  if (report.status === 'confirmed') return fail('shift_immutable', 409)
  const list = (production.shiftReports ?? []).filter((r) => r.id !== draftId)
  let prod = { ...production, shiftReports: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'shift_draft_delete',
    actorUid: actor.uid,
    detail: draftId,
  })
  return ok({ production: prod, warehouse: null, result: { draftId, deleted: true } })
}

function reverseDocumentMovements(warehouse, doc, actor, now, reason) {
  const reverseType = (t) => {
    if (t === 'issue') return 'receipt'
    if (t === 'receipt' || t === 'in') return 'issue'
    if (t === 'reserve') return 'unreserve'
    if (t === 'unreserve') return 'reserve'
    return null
  }
  const date = now.slice(0, 10)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const number = nextServerDocumentNumber(warehouse.documents, doc.type, doc.warehouseId, date)
  const reverseLines = (doc.lines ?? []).map((line) => ({
    ...line,
    lineId: crypto.randomUUID(),
  }))
  const reverseLineIdByOriginal = new Map(
    (doc.lines ?? []).map((line, index) => [
      String(line?.lineId ?? '').trim(),
      reverseLines[index]?.lineId,
    ]),
  )
  const revDoc = {
    id: documentId,
    type: doc.type,
    purpose: doc.purpose,
    docRole: 'shift_correction_reversal',
    warehouseId: doc.warehouseId,
    date,
    number: `${number}-REV`,
    lines: reverseLines,
    status: 'posted',
    reversesDocumentId: doc.id,
    shiftReportId: doc.shiftReportId,
    productionOrderId: doc.productionOrderId,
    productionLineId: doc.productionLineId,
    reservationDocumentId: doc.reservationDocumentId,
    batchRunId: doc.batchRunId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    cancellationReason: reason,
  }
  const related = (warehouse.movements ?? []).filter((m) => m.documentId === doc.id)
  const movements = related
    .map((m) => {
      const t = reverseType(m.type)
      if (!t) return null
      return {
        id: `mov-${crypto.randomUUID()}`,
        documentId,
        documentLineId: reverseLineIdByOriginal.get(
          String(m?.documentLineId ?? '').trim(),
        ),
        warehouseId: m.warehouseId,
        locationId: m.locationId,
        itemId: m.itemId,
        quantity: Math.abs(m.quantity),
        type: t,
        at: now,
        date,
        actorUid: actor.uid,
        batchNo: m.batchNo,
        batchRunId: m.batchRunId,
        expiryDate: m.expiryDate,
        productionOrderId: m.productionOrderId,
        productionLineId: m.productionLineId,
        reservationDocumentId: m.reservationDocumentId,
        shiftReportId: m.shiftReportId,
        reversesMovementId: m.id,
        isWip: m.isWip,
        isScrap: m.isScrap,
      }
    })
    .filter(Boolean)
  return {
    warehouse: {
      ...warehouse,
      documents: [...warehouse.documents, revDoc],
      movements: [...warehouse.movements, ...movements],
    },
    reverseDocumentId: documentId,
  }
}

function applyShiftCreateCorrection(production, command, actor, now) {
  const originalReportId = String(command.originalReportId ?? '').trim()
  const reason = String(command.correctionReason ?? command.reason ?? '').trim()
  if (!originalReportId || !reason) return fail('correction_reason_required', 400)
  const original = (production.shiftReports ?? []).find((r) => r.id === originalReportId)
  if (!original || original.status !== 'confirmed') return fail('shift_immutable', 409)
  const outputMp = parseShiftOutputMp(
    command.outputMp === undefined ? original.outputMp : command.outputMp,
    {
      defaultZero: true,
    },
  )
  if (outputMp == null) return fail('invalid_output', 400)
  const outputRolls = parseShiftOutputRolls(
    command.outputRolls === undefined ? original.outputRolls : command.outputRolls,
  )
  if (outputRolls == null) return fail('invalid_output_rolls', 400)
  const actualInputs = normalizeShiftDraftStockRows(
    command.actualInputs === undefined
      ? original.actualInputs ?? []
      : command.actualInputs,
    'actual',
  )
  if (!actualInputs.ok) return fail(actualInputs.error, 400)
  const wasteLines = normalizeShiftDraftStockRows(
    command.wasteLines === undefined
      ? original.wasteInputs ?? original.wasteLines ?? []
      : command.wasteLines,
    'waste',
  )
  if (!wasteLines.ok) return fail(wasteLines.error, 400)
  const draftId = String(command.draftId ?? '').trim() || `corr-${crypto.randomUUID()}`
  const existing = (production.shiftReports ?? []).find((r) => r.id === draftId)
  if (existing?.status === 'confirmed') {
    return ok({
      production,
      warehouse: null,
      result: { draftId, status: 'confirmed', idempotent: true },
    })
  }
  const draft = {
    id: draftId,
    status: 'correction_draft',
    correctsReportId: originalReportId,
    correctionReason: reason,
    orderId: String(command.orderId ?? original.orderId),
    lineId: String(command.lineId ?? original.lineId),
    shiftDate: String(command.shiftDate ?? original.shiftDate).slice(0, 10),
    shiftSlot: command.shiftSlot ?? original.shiftSlot ?? 'day',
    outputMp,
    outputRolls,
    actualInputs: actualInputs.rows,
    wasteLines: wasteLines.rows,
    semiFinishedItemId: command.semiFinishedItemId ?? original.semiFinishedItemId,
    packLocationId: command.packLocationId ?? original.packLocationId,
    createdAt: now,
    createdBy: actor.uid,
  }
  const list = [...(production.shiftReports ?? [])]
  const idx = list.findIndex((r) => r.id === draftId)
  if (idx >= 0) list[idx] = draft
  else list.push(draft)
  let prod = { ...production, shiftReports: list }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'shift_correction_draft',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({ production: prod, warehouse: null, result: { draftId, status: 'correction_draft' } })
}

function applyShiftConfirmCorrection(production, warehouse, command, actor, now, ctx = {}) {
  const reason = String(command.correctionReason ?? command.reason ?? '').trim()
  const originalReportId = String(command.originalReportId ?? '').trim()
  if (!reason || !originalReportId) return fail('correction_reason_required', 400)
  if (isSysadminActor(actor) && !String(command.emergencyReason ?? reason).trim()) {
    return fail('emergency_reason_required', 400)
  }
  const original = (production.shiftReports ?? []).find((r) => r.id === originalReportId)
  if (!original || original.status !== 'confirmed') return fail('shift_immutable', 409)
  const outputRolls = parseShiftOutputRolls(command.outputRolls ?? original.outputRolls)
  if (outputRolls == null) return fail('invalid_output_rolls', 400)
  const corrKey = String(
    command.reportKey ?? `corr::${originalReportId}::${command.idempotencySuffix ?? reason}`,
  )
  const correctionCommandForReplay = {
    originalReportId,
    correctionReason: reason,
    emergencyReason: command.emergencyReason,
    orderId: command.orderId ?? original.orderId,
    lineId: command.lineId ?? original.lineId,
    shiftDate: command.shiftDate ?? original.shiftDate,
    shiftSlot: command.shiftSlot ?? original.shiftSlot,
    outputMp: command.outputMp ?? original.outputMp,
    outputRolls,
    actualInputs: command.actualInputs ?? original.actualInputs,
    wasteLines: command.wasteLines ?? original.wasteInputs ?? original.wasteLines,
    semiFinishedItemId: command.semiFinishedItemId ?? original.semiFinishedItemId,
    packLocationId: command.packLocationId ?? original.packLocationId,
    impregnationQcDecisionId:
      command.impregnationQcDecisionId ?? original.impregnationQcDecisionId,
    batchRunId: command.batchRunId ?? original.batchRunId,
  }
  const correctionFingerprint = shiftCommandFingerprint(correctionCommandForReplay)
  const existingMatches = (production.shiftReports ?? []).filter(
    (r) => r.idempotencyKey === corrKey && r.status === 'confirmed',
  )
  if (existingMatches.length > 1) return fail('shift_idempotency_ambiguous', 409)
  const existing = existingMatches[0]
  if (existing) {
    if (String(existing.commandFingerprint ?? '') !== correctionFingerprint) {
      return fail('shift_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        reportId: existing.id,
        report: existing,
        status: 'confirmed',
        idempotent: true,
      },
    })
  }
  if (isPeriodClosed(warehouse, original.shiftDate || now.slice(0, 10))) {
    return fail('period_closed', 403)
  }

  const originalStrict = Number(original.wipContractVersion) >= 1
  if (originalStrict) {
    const frozenWip = String(original.semiFinishedItemId ?? '').trim()
    const order = (production.orders ?? []).find((row) => row.id === original.orderId)
    const orderWip = String(order?.semiFinishedItemId ?? '').trim()
    const claimedWip = String(command.semiFinishedItemId ?? frozenWip).trim()
    const originalDecisionId = String(original.impregnationQcDecisionId ?? '').trim()
    const claimedDecisionId = String(
      command.impregnationQcDecisionId ?? originalDecisionId,
    ).trim()
    const originalBatchRunId = String(original.batchRunId ?? '').trim()
    const claimedBatchRunId = String(command.batchRunId ?? originalBatchRunId).trim()
    if (
      !frozenWip ||
      !orderWip ||
      claimedWip !== frozenWip ||
      orderWip !== frozenWip ||
      !originalDecisionId ||
      claimedDecisionId !== originalDecisionId ||
      !originalBatchRunId ||
      claimedBatchRunId !== originalBatchRunId
    ) {
      return fail('shift_correction_lineage_mismatch', 409)
    }
    command = {
      ...command,
      semiFinishedItemId: frozenWip,
      impregnationQcDecisionId: originalDecisionId,
      batchRunId: originalBatchRunId,
    }
  }

  // A strict report owns exactly one WIP batch.  Any downstream issue of that
  // batch means packaging has begun; reversing/replacing the shift at that point
  // would strand finished-goods effects, irrespective of the corrected output.
  const originalWipBatchId = String(original?.wipBatchId ?? '').trim()
  const matchingWip = (production.wipBatches ?? []).filter(
    (batch) =>
      String(batch?.shiftReportId ?? '').trim() === originalReportId ||
      (originalWipBatchId && String(batch?.id ?? '').trim() === originalWipBatchId),
  )
  if (originalStrict && (!originalWipBatchId || matchingWip.length !== 1)) {
    return fail('shift_correction_wip_batch_not_unique', 409)
  }
  const wip = matchingWip[0]
  if (originalStrict && wip) {
    if (
      String(wip?.id ?? '').trim() !== originalWipBatchId ||
      String(wip?.shiftReportId ?? '').trim() !== originalReportId ||
      String(wip?.orderId ?? '').trim() !== String(original?.orderId ?? '').trim() ||
      String(wip?.lineId ?? '').trim() !== String(original?.lineId ?? '').trim() ||
      String(wip?.itemId ?? '').trim() !== String(original?.semiFinishedItemId ?? '').trim() ||
      String(wip?.locationId ?? '').trim() !== String(original?.packLocationId ?? '').trim() ||
      wip?.isFinishedGoods === true ||
      !Number.isInteger(Number(wip?.wipContractVersion)) ||
      Number(wip?.wipContractVersion) < 1 ||
      String(wip?.unitSnapshot ?? '').trim() !==
        String(original?.semiFinishedUnitSnapshot ?? '').trim() ||
      String(wip?.impregnationQcDecisionId ?? '').trim() !==
        String(original?.impregnationQcDecisionId ?? '').trim() ||
      String(wip?.batchRunId ?? '').trim() !== String(original?.batchRunId ?? '').trim() ||
      !Number.isFinite(Number(original?.outputMp ?? original?.outputM2)) ||
      !Number.isFinite(Number(wip?.quantityMp)) ||
      Math.abs(Number(wip.quantityMp) - Number(original?.outputMp ?? original?.outputM2)) > 1e-9
    ) {
      return fail('shift_correction_wip_batch_mismatch', 409)
    }
    const wipReceipt = resolveExactShiftDocumentGraph(
      warehouse,
      original?.wipReceiptDocumentId,
      {
        docRole: 'wip_receipt',
        type: 'receipt',
        movementType: 'receipt',
        orderId: String(original?.orderId ?? '').trim(),
        lineId: String(original?.lineId ?? '').trim(),
        shiftReportId: originalReportId,
      },
    )
    if (
      !wipReceipt ||
      wipReceipt.lines.length !== 1 ||
      String(wipReceipt.lines[0]?.itemId ?? '').trim() !== String(wip.itemId).trim() ||
      String(wipReceipt.lines[0]?.locationId ?? '').trim() !== String(wip.locationId).trim() ||
      String(wipReceipt.lines[0]?.batchNo ?? '').trim() !== String(wip.id).trim() ||
      Math.abs(Number(wipReceipt.lines[0]?.quantity) - Number(wip.quantityMp)) > 1e-9
    ) {
      return fail('shift_correction_wip_batch_mismatch', 409)
    }
    const downstreamConsumption = (warehouse.movements ?? []).some((movement) => {
      if (
        String(movement?.sourceWipBatchId ?? '').trim() !== String(wip.id).trim() &&
        String(movement?.batchNo ?? '').trim() !== String(wip.id).trim()
      ) {
        return false
      }
      if (!['issue', 'out'].includes(String(movement?.type ?? '').trim())) return false
      const quantity = Number(movement?.quantity)
      return !Number.isFinite(quantity) || quantity > 1e-9
    })
    if (downstreamConsumption) return fail('wip_already_consumed', 409)
  } else if (wip) {
    // Preserve the historical legacy rule outside the canonical WIP contract.
    const newOut = Number(command.outputMp)
    if (Number.isFinite(newOut) && newOut + 1e-9 < Number(wip.quantityMp)) {
      let remainingWip = 0
      for (const m of warehouse.movements ?? []) {
        if (m.batchNo !== wip.id) continue
        if (m.type === 'receipt' || m.type === 'in') remainingWip += Math.abs(m.quantity)
        if (m.type === 'issue' || m.type === 'out') remainingWip -= Math.abs(m.quantity)
      }
      if (remainingWip + 1e-9 < Number(wip.quantityMp)) {
        return fail('wip_already_consumed', 409)
      }
    }
  }

  if (originalStrict) {
    const ownedDocuments = (warehouse.documents ?? []).filter(
      (document) =>
        document?.status === 'posted' &&
        String(document?.shiftReportId ?? '').trim() === originalReportId &&
        document?.docRole !== 'shift_correction_reversal',
    )
    const expectedIds = new Set(
      [original?.consumptionDocumentId, original?.wipReceiptDocumentId]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    )
    const wastePairId = String(original?.wasteTransferPairId ?? '').trim()
    if (wastePairId) {
      for (const document of ownedDocuments) {
        if (String(document?.transferPairId ?? '').trim() === wastePairId) {
          expectedIds.add(String(document.id).trim())
        }
      }
    }
    if (
      ownedDocuments.length !== expectedIds.size ||
      ownedDocuments.some((document) => !expectedIds.has(String(document?.id ?? '').trim()))
    ) {
      return fail('shift_correction_document_graph_invalid', 409)
    }
    for (const document of ownedDocuments) {
      const role = String(document?.docRole ?? '').trim()
      const expected =
        role === 'shift_consumption'
          ? { type: 'issue', movementType: 'issue' }
          : role === 'wip_receipt'
            ? { type: 'receipt', movementType: 'receipt' }
            : role === 'waste_to_scrap'
              ? { type: 'issue', movementType: 'issue' }
              : role === 'scrap_receipt'
                ? { type: 'receipt', movementType: 'receipt' }
                : null
      if (
        !expected ||
        !resolveExactShiftDocumentGraph(warehouse, document.id, {
          ...expected,
          docRole: role,
          orderId: String(original?.orderId ?? '').trim(),
          lineId: String(original?.lineId ?? '').trim(),
          shiftReportId: originalReportId,
        })
      ) {
        return fail('shift_correction_document_graph_invalid', 409)
      }
    }
  }

  let wh = warehouse
  const reverseIds = []
  for (const doc of warehouse.documents ?? []) {
    if (doc.shiftReportId !== originalReportId || doc.status !== 'posted') continue
    if (doc.docRole === 'shift_correction_reversal') continue
    const rev = reverseDocumentMovements(wh, doc, actor, now, reason)
    wh = rev.warehouse
    reverseIds.push(rev.reverseDocumentId)
  }

  // Soft-mark original; keep immutable body
  const reports = (production.shiftReports ?? []).map((r) =>
    r.id === originalReportId ? { ...r, correctedAt: now, correctedBy: actor.uid, correctionOpen: true } : r,
  )
  let prod = { ...production, shiftReports: reports }
  // Remove linked WIP batch (reversed in warehouse); will recreate on confirm
  prod = {
    ...prod,
    wipBatches: (prod.wipBatches ?? []).filter(
      (batch) =>
        String(batch?.shiftReportId ?? '').trim() !== originalReportId &&
        String(batch?.id ?? '').trim() !== String(original?.wipBatchId ?? '').trim(),
    ),
    // The immutable source report and reversal documents retain the historical
    // waste detail.  The active waste projection must contain only the corrected
    // records, otherwise consumers double-count the superseded shift.
    wasteRecords: (prod.wasteRecords ?? []).filter(
      (record) => String(record?.shiftReportId ?? '').trim() !== originalReportId,
    ),
  }

  const confirmCmd = {
    originalReportId,
    correctionReason: reason,
    emergencyReason: command.emergencyReason,
    orderId: command.orderId ?? original.orderId,
    lineId: command.lineId ?? original.lineId,
    shiftDate: command.shiftDate ?? original.shiftDate,
    shiftSlot: command.shiftSlot ?? original.shiftSlot,
    outputMp: command.outputMp ?? original.outputMp,
    outputRolls,
    actualInputs: command.actualInputs ?? original.actualInputs,
    wasteLines: command.wasteLines ?? original.wasteInputs ?? original.wasteLines,
    semiFinishedItemId: command.semiFinishedItemId ?? original.semiFinishedItemId,
    packLocationId: command.packLocationId ?? original.packLocationId,
    impregnationQcDecisionId:
      command.impregnationQcDecisionId ?? original.impregnationQcDecisionId,
    batchRunId: command.batchRunId ?? original.batchRunId,
    reportKey: corrKey,
  }
  const confirmed = applyShiftConfirm(prod, wh, confirmCmd, actor, now, {
    ...ctx,
    businessKey: corrKey,
    excludeShiftReportId: originalReportId,
    preserveStrictWipSnapshot: originalStrict
      ? {
          semiFinishedItemId: original.semiFinishedItemId,
          semiFinishedUnitSnapshot: original.semiFinishedUnitSnapshot,
        }
      : undefined,
  })
  if (!confirmed.ok) return confirmed
  const reportId = confirmed.result.reportId
  const nextReports = (confirmed.production.shiftReports ?? []).map((r) =>
    r.id === reportId
      ? {
          ...r,
          correctsReportId: originalReportId,
          correctionReason: reason,
        }
      : r,
  )
  const correctedReport = nextReports.find((row) => row.id === reportId)
  let nextProd = { ...confirmed.production, shiftReports: nextReports }
  nextProd = appendProdAudit(nextProd, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'shift_confirm_correction',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({
    production: nextProd,
    warehouse: confirmed.warehouse,
    result: {
      reportId,
      report: correctedReport,
      status: 'confirmed',
      correctsReportId: originalReportId,
      reverseDocumentIds: reverseIds,
      isFinishedGoods: false,
    },
  })
}

function resolveMaterialIssueReservation(warehouse, order, command, ctx = {}) {
  const reservationDocumentId = String(command.reservationDocumentId ?? '').trim()
  const strict = orderUsesWipContractV1(order, ctx)
  if (!reservationDocumentId) {
    return strict
      ? fail('reservation_document_id_required', 409)
      : ok({ reservationDocument: null })
  }

  const matches = (warehouse.documents ?? []).filter(
    (row) => String(row?.id ?? '').trim() === reservationDocumentId,
  )
  if (matches.length === 0) return fail('reservation_document_not_found', 404)
  if (matches.length !== 1) return fail('reservation_document_ambiguous', 409)
  const reservationDocument = matches[0]
  if (
    reservationDocument.status !== 'posted' ||
    (strict &&
      (reservationDocument.type !== 'reservation' ||
        reservationDocument.docRole !== 'production_reservation')) ||
    !['production_reservation', 'production_reservation_increase'].includes(
      String(reservationDocument.purpose ?? ''),
    )
  ) {
    return fail('reservation_document_not_posted', 409)
  }
  if (String(reservationDocument.productionOrderId ?? '').trim() !== String(order.id).trim()) {
    return fail('reservation_document_order_mismatch', 409)
  }
  if (
    String(reservationDocument.warehouseId ?? '').trim() !==
    String(command.rawWarehouseId ?? '').trim()
  ) {
    return fail('reservation_document_warehouse_mismatch', 409)
  }
  const prior = (warehouse.documents ?? []).filter(
    (row) =>
      row.status === 'posted' &&
      String(row.reservationDocumentId ?? '').trim() === reservationDocumentId &&
      ['transfer_issue', 'production_transfer_issue'].includes(String(row.docRole ?? '')),
  )
  if (prior.length) return fail('reservation_document_already_issued', 409)

  const reservationLines = Array.isArray(reservationDocument.lines)
    ? reservationDocument.lines
    : []
  const expected = new Map()
  let invalidReservationLine = reservationLines.length === 0
  const reservationLineIds = new Set()
  for (const line of reservationLines) {
    const documentLineId = String(line?.lineId ?? '').trim()
    const itemId = String(line?.itemId ?? '').trim()
    const quantity = Number(line?.quantity)
    if (
      !documentLineId ||
      reservationLineIds.has(documentLineId) ||
      !itemId ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      invalidReservationLine = true
      continue
    }
    reservationLineIds.add(documentLineId)
    expected.set(itemId, (expected.get(itemId) ?? 0) + quantity)
  }
  const requested = new Map()
  let invalidRequestedLine = !Array.isArray(command.lines) || command.lines.length === 0
  for (const line of Array.isArray(command.lines) ? command.lines : []) {
    const itemId = String(line?.itemId ?? '').trim()
    const quantity = Number(line?.quantity)
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
      invalidRequestedLine = true
      continue
    }
    requested.set(itemId, (requested.get(itemId) ?? 0) + quantity)
  }
  if (strict) {
    const rawMaterialItemId = String(order.rawMaterialItemId ?? '').trim()
    if (
      invalidReservationLine ||
      invalidRequestedLine ||
      !rawMaterialItemId ||
      expected.size !== 1 ||
      requested.size !== 1 ||
      !expected.has(rawMaterialItemId) ||
      !requested.has(rawMaterialItemId)
    ) {
      return fail('reservation_raw_material_mismatch', 409)
    }
  }
  if (
    expected.size !== requested.size ||
    [...expected.keys()].some((itemId) => !requested.has(itemId))
  ) {
    return fail('reservation_document_quantity_mismatch', 409)
  }
  for (const [itemId, quantity] of requested) {
    if (Math.abs((expected.get(itemId) ?? 0) - quantity) > 1e-9) {
      return fail('reservation_document_quantity_mismatch', 409)
    }
  }
  if (strict) {
    const reservationMovements = (warehouse.movements ?? []).filter(
      (movement) =>
        String(movement?.documentId ?? '').trim() === reservationDocumentId,
    )
    if (reservationMovements.length !== reservationLines.length) {
      return fail('reservation_document_movement_mismatch', 409)
    }
    for (const line of reservationLines) {
      const documentLineId = String(line.lineId).trim()
      const lineQuantity = Number(line.quantity)
      const movementMatches = reservationMovements.filter(
        (movement) =>
          String(movement?.documentLineId ?? '').trim() === documentLineId,
      )
      const movement = movementMatches[0]
      const movementQuantity = Number(movement?.quantity)
      if (
        movementMatches.length !== 1 ||
        movement?.cancelled === true ||
        movement?.type !== 'reserve' ||
        String(movement?.itemId ?? '').trim() !== String(line.itemId).trim() ||
        String(movement?.warehouseId ?? '').trim() !==
          String(reservationDocument.warehouseId ?? '').trim() ||
        String(movement?.locationId ?? '').trim() !==
          String(line?.locationId ?? '').trim() ||
        String(movement?.productionOrderId ?? '').trim() !== String(order.id).trim() ||
        shiftStockTupleKey(movement) !== shiftStockTupleKey(line) ||
        !Number.isFinite(lineQuantity) ||
        !Number.isFinite(movementQuantity) ||
        lineQuantity <= 0 ||
        movementQuantity <= 0 ||
        Math.abs(movementQuantity - lineQuantity) > 1e-9
      ) {
        return fail('reservation_document_movement_mismatch', 409)
      }
    }
  } else {
    for (const [itemId, quantity] of requested) {
      const movementQty = (warehouse.movements ?? [])
        .filter(
          (movement) =>
            movement.documentId === reservationDocumentId &&
            movement.type === 'reserve' &&
            movement.itemId === itemId &&
            movement.productionOrderId === order.id &&
            movement.warehouseId === reservationDocument.warehouseId,
        )
        .reduce((sum, movement) => sum + Math.abs(Number(movement.quantity) || 0), 0)
      if (Math.abs(movementQty - quantity) > 1e-9) {
        return fail('reservation_document_movement_mismatch', 409)
      }
    }
  }
  return ok({ reservationDocument })
}

function resolveMaterialHandoffReplay(
  production,
  warehouse,
  command,
  ctx,
  commandType,
  commandFingerprint,
) {
  const idempotencyKey = String(ctx?.idempotencyKey ?? '').trim()
  if (!idempotencyKey) return null
  const matches = (production.handoffs ?? []).filter(
    (handoff) => String(handoff?.idempotencyKey ?? '').trim() === idempotencyKey,
  )
  if (matches.length === 0) {
    return ctx?.replayReceiptPresent
      ? fail('material_handoff_replay_not_found', 409)
      : null
  }
  if (matches.length !== 1) return fail('material_handoff_idempotency_ambiguous', 409)
  const handoff = matches[0]
  if (String(handoff?.commandFingerprint ?? '').trim() !== commandFingerprint) {
    return fail('material_handoff_idempotency_conflict', 409)
  }

  const kind = commandType === 'production.material.issueToLine' ? 'issue' : 'return'
  const result = {
    orderId: String(command.orderId ?? '').trim(),
    lineId: String(command.lineId ?? '').trim(),
    kind,
    rawWarehouseId: String(command.rawWarehouseId ?? '').trim(),
    transferPairId: String(handoff.transferPairId ?? '').trim(),
    reservationDocumentId:
      kind === 'issue' ? String(command.reservationDocumentId ?? '').trim() : undefined,
    reason: String(
      kind === 'issue'
        ? command.overReserveReason ?? command.reason ?? ''
        : command.reason ?? '',
    ).trim(),
    sourceTransferPairIds:
      kind === 'return' ? handoff.sourceTransferPairIds : undefined,
    idempotencyKey,
    commandFingerprint,
    documentIds: [
      String(handoff.issueDocumentId ?? '').trim(),
      String(handoff.receiptDocumentId ?? '').trim(),
    ],
    handoffId: String(handoff.id ?? '').trim(),
    idempotent: true,
  }
  const validated = validateG3MaterialHandoffProjection(
    { ...result, warehouse, production },
    {
      commandType,
      orderId: result.orderId,
      lineId: result.lineId,
      rawWarehouseId: result.rawWarehouseId,
      reservationDocumentId: result.reservationDocumentId,
      reason: result.reason,
      idempotencyKey,
      commandFingerprint,
      submittedLines: command.lines,
    },
  )
  if (!validated.ok) return fail('material_handoff_replay_invalid', 409)
  return ok({ production, warehouse, result })
}

function applyMaterialIssue(production, warehouse, command, actor, now, ctx = {}) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const reason = String(command.overReserveReason ?? command.reason ?? '').trim()
  const linesIn = Array.isArray(command.lines) ? command.lines : []
  if (!orderId || !lineId || !rawWarehouseId || !linesIn.length) return fail('invalid_input', 400)
  const order = (production.orders ?? []).find((o) => o.id === orderId)
  if (!order) return fail('order_not_active', 409)
  if (order.lineId !== lineId) return fail('order_line_mismatch', 400)
  const binding = resolveLineBinding(warehouse, lineId, {
    strict: orderUsesWipContractV1(order, ctx),
  })
  if (!binding.ok) return fail(binding.error, 400)
  const commandType = 'production.material.issueToLine'
  const commandFingerprint = materialHandoffCommandFingerprint(commandType, command)
  const replay = resolveMaterialHandoffReplay(
    production,
    warehouse,
    command,
    ctx,
    commandType,
    commandFingerprint,
  )
  if (replay) return replay
  if (order.status !== 'active') return fail('order_not_active', 409)
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)
  const reservationReady = resolveMaterialIssueReservation(
    warehouse,
    order,
    { ...command, rawWarehouseId },
    ctx,
  )
  if (!reservationReady.ok) return reservationReady
  const reservationDocumentId = reservationReady.reservationDocument?.id

  let wh = warehouse
  const issueLines = []
  for (const line of linesIn) {
    const itemId = String(line.itemId ?? '').trim()
    const qty = Number(line.quantity)
    if (!itemId || !Number.isFinite(qty) || qty <= 0) return fail('invalid_line', 400)
    let reserved = 0
    for (const m of wh.movements ?? []) {
      if (m.productionOrderId !== orderId || m.itemId !== itemId || m.warehouseId !== rawWarehouseId) continue
      if (m.type === 'reserve') reserved += Math.abs(m.quantity)
      if (m.type === 'unreserve' || (m.type === 'issue' && m.consumesReserve)) {
        reserved -= Math.abs(m.quantity)
      }
    }
    reserved = Math.max(0, reserved)
    if (qty > reserved + 1e-9 && !reason) return fail('over_reserve_reason_required', 400)
    const free = ordinaryAvailableQty(wh.movements, itemId, rawWarehouseId)
    if (qty > reserved + free + 1e-9) return fail('insufficient_stock', 400)

    // Own-reserve issue: FEFO over physical lots (reserved qty is spendable for this order only).
    const requestedBatchNo = String(line.batchNo ?? '').trim()
    const requestedExpiryDate = String(line.expiryDate ?? '').trim().slice(0, 10)
    const lots = buildBatchLotsFromMovements(wh.movements, {
      itemId,
      warehouseId: rawWarehouseId,
    })
      .filter(
        (lot) =>
          (!requestedBatchNo || String(lot.batchNo ?? '').trim() === requestedBatchNo) &&
          (!requestedExpiryDate ||
            String(lot.expiryDate ?? '').trim().slice(0, 10) === requestedExpiryDate),
      )
      .map((l) => ({ ...l, available: Math.max(0, l.physical), reserved: 0 }))
    const alloc = allocateBatchesFefoFifo(lots, qty, { today: now.slice(0, 10) })
    if (!alloc.ok) return fail(alloc.error || 'insufficient_stock', 400)
    for (const a of alloc.allocations) {
      issueLines.push({
        itemId,
        quantity: a.quantity,
        batchNo: a.batchNo,
        expiryDate: a.expiryDate,
        locationId: a.locationId,
        consumesReserve: true,
      })
      // Simulate draw so multi-line FEFO sees prior takes
      wh = {
        ...wh,
        movements: [
          ...wh.movements,
          {
            id: `sim-${crypto.randomUUID()}`,
            warehouseId: rawWarehouseId,
            itemId,
            quantity: a.quantity,
            type: 'issue',
            batchNo: a.batchNo,
            expiryDate: a.expiryDate,
            at: now,
            productionOrderId: orderId,
            consumesReserve: true,
          },
        ],
      }
    }
  }
  // Reset simulated movements — rebuild from original warehouse + real docs below
  wh = warehouse

  const date = now.slice(0, 10)
  const pairId = crypto.randomUUID()
  const baseNo = nextServerDocumentNumber(wh.documents, 'issue', rawWarehouseId, date)
  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'production_issue',
    docRole: 'transfer_issue',
    warehouseId: rawWarehouseId,
    date,
    number: `${baseNo}-И`,
    lines: issueLines.map((l) => ({
      lineId: crypto.randomUUID(),
      itemId: l.itemId,
      quantity: l.quantity,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      locationId: l.locationId,
      productionOrderId: orderId,
      productionLineId: lineId,
    })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    productionLineId: lineId,
    reservationDocumentId,
    overReserveReason: reason || undefined,
    commandFingerprint,
    idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}::issue` : undefined,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'production_receipt',
    docRole: 'transfer_receipt',
    warehouseId: binding.productionWarehouseId,
    date,
    number: `${baseNo}-П`,
    lines: issueDoc.lines.map((l) => ({
      ...l,
      lineId: crypto.randomUUID(),
      locationId: binding.productionLocationId,
    })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    productionLineId: lineId,
    reservationDocumentId,
    overReserveReason: reason || undefined,
    commandFingerprint,
    idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}::receipt` : undefined,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const issueMov = issueDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: issueDoc.id,
    documentLineId: l.lineId,
    warehouseId: rawWarehouseId,
    itemId: l.itemId,
    quantity: l.quantity,
    type: 'issue',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    locationId: l.locationId,
    productionOrderId: orderId,
    productionLineId: lineId,
    reservationDocumentId,
    consumesReserve: true,
    transferPairId: pairId,
    commandFingerprint,
  }))
  const receiptMov = receiptDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: receiptDoc.id,
    documentLineId: l.lineId,
    warehouseId: binding.productionWarehouseId,
    locationId: binding.productionLocationId,
    itemId: l.itemId,
    quantity: l.quantity,
    type: 'receipt',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    productionOrderId: orderId,
    productionLineId: lineId,
    reservationDocumentId,
    transferPairId: pairId,
    commandFingerprint,
  }))
  wh = {
    ...wh,
    documents: [...wh.documents, issueDoc, receiptDoc],
    movements: [...wh.movements, ...issueMov, ...receiptMov],
  }
  const handoff = {
    id: `ho-${crypto.randomUUID()}`,
    kind: 'issue',
    orderId,
    lineId,
    rawWarehouseId,
    transferPairId: pairId,
    issueDocumentId: issueDoc.id,
    receiptDocumentId: receiptDoc.id,
    reservationDocumentId,
    idempotencyKey: ctx.idempotencyKey,
    commandFingerprint,
    submittedLines: canonicalG3MaterialHandoffLines(linesIn),
    at: now,
    actorUid: actor.uid,
    overReserveReason: reason || undefined,
  }
  let prod = {
    ...production,
    handoffs: [...(production.handoffs ?? []), handoff],
  }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'material_issue_to_line',
    actorUid: actor.uid,
    detail: `order ${orderId} pair ${pairId}`,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: {
      orderId,
      lineId,
      kind: 'issue',
      rawWarehouseId,
      transferPairId: pairId,
      reservationDocumentId,
      reason,
      idempotencyKey: ctx.idempotencyKey,
      commandFingerprint,
      documentIds: [issueDoc.id, receiptDoc.id],
      handoffId: handoff.id,
    },
  })
}

function applyMaterialReturn(production, warehouse, command, actor, now, ctx = {}) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const reason = String(command.reason ?? '').trim()
  const linesIn = Array.isArray(command.lines) ? command.lines : []
  if (!orderId || !lineId || !rawWarehouseId || !reason || !linesIn.length) {
    return fail('return_reason_required', 400)
  }
  const order = (production.orders ?? []).find((candidate) => candidate.id === orderId)
  if (!order) return fail('order_not_active', 409)
  if (String(order.lineId ?? '').trim() !== lineId) return fail('order_line_mismatch', 400)
  const binding = resolveLineBinding(warehouse, lineId, {
    strict: orderUsesWipContractV1(order, ctx),
  })
  if (!binding.ok) return fail(binding.error, 400)
  const commandType = 'production.material.returnFromLine'
  const commandFingerprint = materialHandoffCommandFingerprint(commandType, command)
  const replay = resolveMaterialHandoffReplay(
    production,
    warehouse,
    command,
    ctx,
    commandType,
    commandFingerprint,
  )
  if (replay) return replay
  if (order.status !== 'active') return fail('order_not_active', 409)
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)

  const strict = orderUsesWipContractV1(order, ctx)
  const returnLinesByLot = new Map()
  for (const line of linesIn) {
    const itemId = String(line.itemId ?? '').trim()
    const qty = Number(line.quantity)
    if (!itemId || !Number.isFinite(qty) || qty <= 0) return fail('invalid_line', 400)
    const batchNo = String(line.batchNo ?? '').trim()
    const expiryDate = String(line.expiryDate ?? '').trim().slice(0, 10)
    const lotKey = [itemId, batchNo, expiryDate].join('::')
    const existing = returnLinesByLot.get(lotKey)
    if (existing) {
      existing.quantity += qty
    } else {
      returnLinesByLot.set(lotKey, {
        itemId,
        quantity: qty,
        batchNo: batchNo || undefined,
        expiryDate: expiryDate || undefined,
      })
    }
  }

  const sourceTransferPairIds = new Set()
  for (const line of returnLinesByLot.values()) {
    // Return authorization is an exact order + line + physical tuple + lot balance.
    // Aggregating duplicate submitted rows first prevents each row from independently
    // passing against the same remaining quantity.
    let bal = 0
    const lineSourceTransferPairIds = new Set()
    for (const m of warehouse.movements ?? []) {
      if (m.itemId !== line.itemId) continue
      if (m.warehouseId !== binding.productionWarehouseId) continue
      if ((m.locationId ?? '') !== binding.productionLocationId) continue
      if (m.productionOrderId !== orderId) continue
      if (strict && String(m.productionLineId ?? '').trim() !== lineId) continue
      if (String(m.batchNo ?? '').trim() !== String(line.batchNo ?? '')) continue
      if (String(m.expiryDate ?? '').trim().slice(0, 10) !== String(line.expiryDate ?? '')) continue
      if (m.type === 'receipt' || m.type === 'in') bal += Math.abs(m.quantity)
      if (m.type === 'issue' || m.type === 'out') bal -= Math.abs(m.quantity)

      if (strict && (m.type === 'receipt' || m.type === 'in')) {
        const receiptDoc = (warehouse.documents ?? []).find(
          (document) => document.id === m.documentId,
        )
        const transferPairId = String(receiptDoc?.transferPairId ?? '').trim()
        if (
          receiptDoc?.status !== 'posted' ||
          receiptDoc?.docRole !== 'transfer_receipt' ||
          receiptDoc?.purpose !== 'production_receipt' ||
          receiptDoc?.productionOrderId !== orderId ||
          receiptDoc?.productionLineId !== lineId ||
          !transferPairId
        ) {
          continue
        }
        const sourceIssue = (warehouse.documents ?? []).find(
          (document) =>
            document.status === 'posted' &&
            document.transferPairId === transferPairId &&
            document.docRole === 'transfer_issue' &&
            document.purpose === 'production_issue' &&
            document.productionOrderId === orderId &&
            document.productionLineId === lineId,
        )
        if (sourceIssue?.warehouseId === rawWarehouseId) {
          sourceTransferPairIds.add(transferPairId)
          lineSourceTransferPairIds.add(transferPairId)
        }
      }
    }
    if (line.quantity > bal + 1e-9) return fail('return_exceeds_remaining', 400)
    if (strict && lineSourceTransferPairIds.size === 0) {
      return fail('return_source_handoff_not_found', 409)
    }
  }

  if (strict) {
    for (const sourceTransferPairId of sourceTransferPairIds) {
      const sourceHandoffs = (production.handoffs ?? []).filter(
        (handoff) =>
          String(handoff?.transferPairId ?? '').trim() === sourceTransferPairId &&
          String(handoff?.kind ?? '').trim() === 'issue' &&
          String(handoff?.orderId ?? '').trim() === orderId &&
          String(handoff?.lineId ?? '').trim() === lineId &&
          String(handoff?.rawWarehouseId ?? '').trim() === rawWarehouseId,
      )
      const sourceHandoff = sourceHandoffs[0]
      const sourceFingerprint = String(sourceHandoff?.commandFingerprint ?? '').trim()
      const sourceIdempotencyKey = String(sourceHandoff?.idempotencyKey ?? '').trim()
      const sourceReservationDocumentId = String(
        sourceHandoff?.reservationDocumentId ?? '',
      ).trim()
      const sourceDocumentIds = [
        String(sourceHandoff?.issueDocumentId ?? '').trim(),
        String(sourceHandoff?.receiptDocumentId ?? '').trim(),
      ]
      const sourceReason = String(sourceHandoff?.overReserveReason ?? '').trim()
      const sourceValidation =
        sourceHandoffs.length === 1
          ? validateG3MaterialHandoffProjection(
              {
                orderId,
                lineId,
                kind: 'issue',
                rawWarehouseId,
                transferPairId: sourceTransferPairId,
                reservationDocumentId: sourceReservationDocumentId,
                reason: sourceReason,
                idempotencyKey: sourceIdempotencyKey,
                commandFingerprint: sourceFingerprint,
                documentIds: sourceDocumentIds,
                warehouse,
                production,
              },
              {
                commandType: 'production.material.issueToLine',
                orderId,
                lineId,
                rawWarehouseId,
                reservationDocumentId: sourceReservationDocumentId,
                reason: sourceReason,
                idempotencyKey: sourceIdempotencyKey,
                commandFingerprint: sourceFingerprint,
                submittedLines: sourceHandoff?.submittedLines,
              },
            )
          : { ok: false }
      if (!sourceValidation.ok) return fail('return_source_handoff_invalid', 409)
    }
  }

  const returnLines = [...returnLinesByLot.values()]

  const date = now.slice(0, 10)
  const pairId = crypto.randomUUID()
  const baseNo = nextServerDocumentNumber(warehouse.documents, 'issue', binding.productionWarehouseId, date)
  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'production_material_return',
    docRole: 'transfer_issue',
    warehouseId: binding.productionWarehouseId,
    date,
    number: `${baseNo}-И`,
    lines: returnLines.map((l) => ({
      lineId: crypto.randomUUID(),
      itemId: String(l.itemId).trim(),
      quantity: Number(l.quantity),
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      locationId: binding.productionLocationId,
      productionOrderId: orderId,
      productionLineId: lineId,
    })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    productionLineId: lineId,
    commandFingerprint,
    idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}::issue` : undefined,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    returnReason: reason,
    sourceTransferPairIds: [...sourceTransferPairIds],
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'production_material_return',
    docRole: 'transfer_receipt',
    warehouseId: rawWarehouseId,
    date,
    number: `${baseNo}-П`,
    lines: issueDoc.lines.map((l) => ({ ...l, lineId: crypto.randomUUID(), locationId: undefined })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    productionLineId: lineId,
    commandFingerprint,
    returnReason: reason,
    sourceTransferPairIds: [...sourceTransferPairIds],
    idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}::receipt` : undefined,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const issueMov = issueDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: issueDoc.id,
    documentLineId: l.lineId,
    warehouseId: binding.productionWarehouseId,
    locationId: binding.productionLocationId,
    itemId: l.itemId,
    quantity: l.quantity,
    type: 'issue',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    productionOrderId: orderId,
    productionLineId: lineId,
    transferPairId: pairId,
    commandFingerprint,
  }))
  const receiptMov = receiptDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: receiptDoc.id,
    documentLineId: l.lineId,
    warehouseId: rawWarehouseId,
    itemId: l.itemId,
    quantity: l.quantity,
    type: 'receipt',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    productionOrderId: orderId,
    productionLineId: lineId,
    transferPairId: pairId,
    commandFingerprint,
  }))
  const wh = {
    ...warehouse,
    documents: [...warehouse.documents, issueDoc, receiptDoc],
    movements: [...warehouse.movements, ...issueMov, ...receiptMov],
  }
  const handoff = {
    id: `ho-${crypto.randomUUID()}`,
    kind: 'return',
    orderId,
    lineId,
    rawWarehouseId,
    transferPairId: pairId,
    issueDocumentId: issueDoc.id,
    receiptDocumentId: receiptDoc.id,
    idempotencyKey: ctx.idempotencyKey,
    commandFingerprint,
    submittedLines: canonicalG3MaterialHandoffLines(linesIn),
    at: now,
    actorUid: actor.uid,
    reason,
    sourceTransferPairIds: [...sourceTransferPairIds],
  }
  let prod = {
    ...production,
    handoffs: [...(production.handoffs ?? []), handoff],
  }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'material_return_from_line',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: {
      orderId,
      lineId,
      kind: 'return',
      rawWarehouseId,
      transferPairId: pairId,
      sourceTransferPairIds: [...sourceTransferPairIds],
      reason,
      idempotencyKey: ctx.idempotencyKey,
      commandFingerprint,
      documentIds: [issueDoc.id, receiptDoc.id],
      handoffId: handoff.id,
    },
  })
}

function nextAuthoritativeShiftReportNumber(reports, shiftDate) {
  const prefix = `СО-${String(shiftDate ?? '').replace(/-/g, '')}-`
  let max = 0
  for (const report of Array.isArray(reports) ? reports : []) {
    const number = String(report?.number ?? '')
    if (!number.startsWith(prefix)) continue
    const sequence = Number(number.slice(prefix.length))
    if (Number.isInteger(sequence) && sequence > max) max = sequence
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function parseShiftOutputMp(value, options = {}) {
  if (value === undefined && options.defaultZero === true) return 0
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return null
  }
  const outputMp = Number(value)
  return Number.isFinite(outputMp) && outputMp >= 0 ? outputMp : null
}

function parseShiftOutputRolls(value) {
  if (value === undefined) return 0
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return null
  }
  const outputRolls = Number(value)
  return Number.isFinite(outputRolls) && Number.isInteger(outputRolls) && outputRolls >= 0
    ? outputRolls
    : null
}

function normalizeShiftDraftStockRows(value, kind) {
  const input = value === undefined ? [] : value
  if (!Array.isArray(input)) {
    return {
      ok: false,
      error: kind === 'actual' ? 'invalid_actual_input' : 'invalid_waste_line',
    }
  }

  const rows = []
  const seenTuples = new Set()
  for (const valueRow of input) {
    if (!valueRow || typeof valueRow !== 'object' || Array.isArray(valueRow)) {
      return {
        ok: false,
        error: kind === 'actual' ? 'invalid_actual_input' : 'invalid_waste_line',
      }
    }
    const itemId = String(valueRow.itemId ?? '').trim()
    const quantity = parseShiftOutputMp(valueRow.quantity)
    if (!itemId || quantity == null) {
      return {
        ok: false,
        error: kind === 'actual' ? 'invalid_actual_input' : 'invalid_waste_line',
      }
    }
    const reason = String(valueRow.reason ?? valueRow.reasonCode ?? '').trim()
    if (kind === 'waste' && quantity > 0 && !reason) {
      return { ok: false, error: 'waste_reason_required' }
    }
    const row = {
      itemId,
      quantity,
      batchNo: String(valueRow.batchNo ?? '').trim() || undefined,
      expiryDate: String(valueRow.expiryDate ?? '').trim() || undefined,
      batchRunId: String(valueRow.batchRunId ?? '').trim() || undefined,
      ...(kind === 'actual'
        ? {
            deviationReason:
              String(valueRow.deviationReason ?? '').trim() || undefined,
            unit: String(valueRow.unit ?? '').trim() || undefined,
          }
        : {
            reason: reason || undefined,
            reasonCode: String(valueRow.reasonCode ?? '').trim() || undefined,
            comment: String(valueRow.comment ?? '').trim() || undefined,
            unit: String(valueRow.unit ?? valueRow.unitSnapshot ?? '').trim() || undefined,
          }),
    }
    const tupleKey = shiftStockTupleKey(row)
    if (seenTuples.has(tupleKey)) {
      return {
        ok: false,
        error:
          kind === 'actual'
            ? 'duplicate_actual_input'
            : 'duplicate_waste_line',
      }
    }
    seenTuples.add(tupleKey)
    rows.push(row)
  }
  return { ok: true, rows }
}

function applyShiftConfirm(production, warehouse, command, actor, now, ctx = {}) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const shiftDate = String(command.shiftDate ?? now.slice(0, 10)).slice(0, 10)
  const outputRolls = parseShiftOutputRolls(command.outputRolls)
  if (outputRolls == null) return fail('invalid_output_rolls', 400)
  const normalizedCommand = {
    ...command,
    orderId,
    lineId,
    shiftDate,
    shiftSlot: command.shiftSlot ?? 'day',
    outputRolls,
  }
  const idem = String(ctx.businessKey ?? canonicalShiftBusinessKey(normalizedCommand))
  const commandFingerprint = shiftCommandFingerprint(normalizedCommand)
  const existingMatches = (production.shiftReports ?? []).filter(
    (report) => report?.idempotencyKey === idem && report?.status === 'confirmed',
  )
  if (existingMatches.length > 1) return fail('shift_idempotency_ambiguous', 409)
  const existing = existingMatches[0]
  if (existing) {
    if (String(existing.commandFingerprint ?? '') !== commandFingerprint) {
      return fail('shift_idempotency_conflict', 409)
    }
    return ok({
      production,
      warehouse,
      result: {
        reportId: existing.id,
        report: existing,
        status: 'confirmed',
        idempotent: true,
      },
    })
  }
  const order = (production.orders ?? []).find((o) => o.id === orderId)
  if (order?.status !== 'active' || !order.recipeNormSnapshot) return fail('order_not_active', 409)
  if (order.lineId !== lineId) return fail('order_line_mismatch', 400)
  const wipReady = resolveShiftWip(order, warehouse, command, ctx)
  if (!wipReady.ok) return wipReady
  const qcReady = resolveApprovedImpregnationQc(production, warehouse, command, order, ctx)
  if (!qcReady.ok) return qcReady
  if (isPeriodClosed(warehouse, shiftDate)) return fail('period_closed', 403)
  const strictLineage = orderUsesWipContractV1(order, ctx)
  const binding = resolveLineBinding(warehouse, lineId, { strict: strictLineage })
  if (!binding.ok) return fail(binding.error, 400)

  const rawActuals = Array.isArray(command.actualInputs) ? command.actualInputs : []
  const wasteInput = Array.isArray(command.wasteLines) ? command.wasteLines : []
  const wasteReady = strictLineage
    ? resolveScrapReadiness({
        scrapLocationId: warehouse.scrapLocationId,
        locations: warehouse.locations,
        accountingByWarehouse: warehouse.accountingByWarehouse,
        productionWarehouseId: binding.productionWarehouseId,
        productionLocationId: binding.productionLocationId,
        wasteLines: wasteInput,
      })
    : { ok: true, wasteLines: wasteInput, scrapLocationId: warehouse.scrapLocationId }
  if (!wasteReady.ok) return fail(wasteReady.error, 400)
  const waste = wasteReady.wasteLines
  const outputMp = parseShiftOutputMp(command.outputMp)
  if (outputMp == null || (strictLineage && outputMp <= 0)) {
    return fail('invalid_output', 400)
  }

  const orderTotalQtyMp = Number(order.totalQtyMp)
  const priorConfirmedOutput = confirmedShiftOutputForOrder(production, orderId, {
    excludeReportId: ctx.excludeShiftReportId,
  })
  if (
    strictLineage &&
    (!Number.isFinite(orderTotalQtyMp) ||
      orderTotalQtyMp <= 0 ||
      !Number.isFinite(priorConfirmedOutput))
  ) {
    return fail('shift_output_ledger_invalid', 409)
  }
  if (
    Number.isFinite(orderTotalQtyMp) &&
    orderTotalQtyMp > 0 &&
    priorConfirmedOutput + outputMp > orderTotalQtyMp + 1e-9
  ) {
    return fail('shift_output_exceeds_order_quantity', 409)
  }

  const actuals = rawActuals.map((actual) => ({
    ...actual,
    itemId: String(actual?.itemId ?? '').trim(),
    quantity: Number(actual?.quantity),
    batchNo: String(actual?.batchNo ?? '').trim() || undefined,
    batchRunId: String(actual?.batchRunId ?? '').trim() || undefined,
    expiryDate: String(actual?.expiryDate ?? '').trim() || undefined,
  }))
  if (
    actuals.some(
      (actual) =>
        !actual.itemId || !Number.isFinite(actual.quantity) || actual.quantity <= 0,
    )
  ) {
    return fail('invalid_actual_input', 400)
  }

  const handoffReady = strictLineage
    ? resolveCanonicalShiftMaterialHandoff(
        production,
        warehouse,
        order,
        binding,
        actuals,
      )
    : ok({
        rawMaterialItemId: undefined,
        reservationDocumentId: undefined,
        handoffIds: [],
        transferPairIds: [],
      })
  if (!handoffReady.ok) return handoffReady

  const normalizedWaste = []
  if (strictLineage) {
    for (const row of waste) {
      const itemId = String(row?.itemId ?? '').trim()
      const quantity = Number(row?.quantity)
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
        return fail('invalid_waste_line', 400)
      }
      if (!String(row?.reason ?? row?.reasonCode ?? '').trim()) {
        return fail('waste_reason_required', 400)
      }
      const requestedBatchNo = String(row?.batchNo ?? '').trim()
      const requestedExpiryDate = String(row?.expiryDate ?? '').trim()
      const requestedBatchRunId = String(row?.batchRunId ?? '').trim()
      const candidates = actuals.filter(
        (actual) =>
          actual.itemId === itemId &&
          (!requestedBatchNo || String(actual.batchNo ?? '').trim() === requestedBatchNo) &&
          (!requestedExpiryDate ||
            String(actual.expiryDate ?? '').trim() === requestedExpiryDate) &&
          (!requestedBatchRunId ||
            String(actual.batchRunId ?? '').trim() === requestedBatchRunId),
      )
      if (candidates.length !== 1) return fail('waste_actual_input_ambiguous', 409)
      normalizedWaste.push({
        ...row,
        itemId,
        quantity,
        unit: row?.unit ?? row?.unitSnapshot,
        batchNo: candidates[0].batchNo,
        expiryDate: candidates[0].expiryDate,
        batchRunId: candidates[0].batchRunId,
      })
    }
  } else {
    normalizedWaste.push(
      ...waste.map((row) => ({
        ...row,
        unit: row?.unit ?? row?.unitSnapshot,
      })),
    )
  }

  const wasteByStockKey = new Map()
  for (const row of normalizedWaste) {
    const key = shiftStockTupleKey(row)
    wasteByStockKey.set(key, (wasteByStockKey.get(key) ?? 0) + row.quantity)
  }
  const processActuals = strictLineage
    ? actuals.map((actual) => {
        const wasteQty = wasteByStockKey.get(shiftStockTupleKey(actual)) ?? 0
        if (wasteQty > actual.quantity + 1e-9) return null
        return { ...actual, quantity: Math.max(0, actual.quantity - wasteQty) }
      })
    : actuals
  if (processActuals.some((actual) => actual == null)) {
    return fail('waste_exceeds_actual_input', 400)
  }
  const positiveProcessActuals = processActuals.filter(
    (actual) => actual && actual.quantity > 1e-9,
  )

  const snapshot = order.recipeNormSnapshot
  const norms = materialNeedFromSnapshot(snapshot, outputMp)
  for (const actual of actuals) {
    const itemId = String(actual.itemId ?? '').trim()
    const qty = Number(actual.quantity)
    const norm = norms.find((n) => n.warehouseItemId === itemId)
    if (norm) {
      const tol = (norm.tolerancePct / 100) * norm.needQty
      const deviation = Math.abs(qty - norm.needQty)
      if (deviation > tol + 1e-9 && !String(actual.deviationReason ?? '').trim()) {
        return fail('deviation_reason_required', 400)
      }
    }
  }

  // A split form may contain several rows for the same physical lot.  Check
  // their combined demand once against the exact item/batch/expiry/run tuple;
  // checking each row independently lets duplicate rows overspend one lot.
  for (const requested of aggregateShiftActualInputs(actuals)) {
    const balance = shiftLineStockBalance(warehouse.movements, requested, {
      productionOrderId: orderId,
      productionLineId: lineId,
      productionWarehouseId: binding.productionWarehouseId,
      productionLocationId: binding.productionLocationId,
      requireProductionLineId: strictLineage,
      exactLineage: strictLineage,
    })
    if (requested.quantity > balance + 1e-9) {
      return fail('insufficient_line_material', 400)
    }
  }

  const reportId = `sr-${crypto.randomUUID()}`
  const reportNumber = nextAuthoritativeShiftReportNumber(
    production.shiftReports,
    shiftDate,
  )
  const date = shiftDate
  let wh = warehouse
  let consumptionDocumentId
  let wipReceiptDocumentId
  let wasteTransferPairId

  // Consume only process-used material. Positive waste is transferred once below.
  if (positiveProcessActuals.length) {
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const number = nextServerDocumentNumber(wh.documents, 'issue', binding.productionWarehouseId, date)
    const doc = {
      id: documentId,
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'shift_consumption',
      warehouseId: binding.productionWarehouseId,
      date,
      number,
      lines: positiveProcessActuals.map((a) => ({
        lineId: crypto.randomUUID(),
        itemId: String(a.itemId).trim(),
        quantity: Number(a.quantity),
        batchNo: a.batchNo,
        batchRunId: a.batchRunId,
        expiryDate: a.expiryDate,
        locationId: binding.productionLocationId,
      })),
      status: 'posted',
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
    }
    const movements = doc.lines.map((l) => ({
      id: `mov-${crypto.randomUUID()}`,
      documentId,
      documentLineId: l.lineId,
      warehouseId: binding.productionWarehouseId,
      locationId: binding.productionLocationId,
      itemId: l.itemId,
      quantity: l.quantity,
      type: 'issue',
      at: now,
      date,
      actorUid: actor.uid,
      batchNo: l.batchNo,
      batchRunId: l.batchRunId,
      expiryDate: l.expiryDate,
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
    }))
    wh = { ...wh, documents: [...wh.documents, doc], movements: [...wh.movements, ...movements] }
    consumptionDocumentId = documentId
  }

  // WIP receipt to the one configured packaging route (semi-finished — not FG).
  const configuredPackBinding = resolveLineBinding(warehouse, 'pack', {
    strict: strictLineage,
  })
  const packBinding = configuredPackBinding.ok
    ? configuredPackBinding
    : strictLineage
      ? configuredPackBinding
      : binding
  if (!packBinding.ok) return fail('pack_location_not_configured', 400)
  const claimedPackLocationId = String(command.packLocationId ?? '').trim()
  if (
    strictLineage &&
    claimedPackLocationId &&
    claimedPackLocationId !== packBinding.productionLocationId
  ) {
    return fail('pack_location_mismatch', 409)
  }
  const packLocationId = strictLineage
    ? packBinding.productionLocationId
    : claimedPackLocationId || binding.productionLocationId
  const semiFinishedItemId = wipReady.semiFinishedItemId
  const wipBatchId = `wip-${crypto.randomUUID()}`
  {
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const number = nextServerDocumentNumber(
      wh.documents,
      'receipt',
      packBinding.productionWarehouseId,
      date,
    )
    const doc = {
      id: documentId,
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'wip_receipt',
      warehouseId: packBinding.productionWarehouseId,
      date,
      number,
      lines: [
        {
          lineId: crypto.randomUUID(),
          itemId: semiFinishedItemId,
          quantity: outputMp,
          unitSnapshot: wipReady.semiFinishedUnitSnapshot,
          locationId: packLocationId,
          batchNo: wipBatchId,
        },
      ],
      status: 'posted',
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      isWip: true,
    }
    const movements = [
      {
        id: `mov-${crypto.randomUUID()}`,
        documentId,
        documentLineId: doc.lines[0].lineId,
        warehouseId: packBinding.productionWarehouseId,
        locationId: packLocationId,
        itemId: semiFinishedItemId,
        quantity: outputMp,
        unitSnapshot: wipReady.semiFinishedUnitSnapshot,
        type: 'receipt',
        at: now,
        date,
        actorUid: actor.uid,
        batchNo: wipBatchId,
        productionOrderId: orderId,
        productionLineId: lineId,
        shiftReportId: reportId,
        isWip: true,
      },
    ]
    wh = { ...wh, documents: [...wh.documents, doc], movements: [...wh.movements, ...movements] }
    wipReceiptDocumentId = documentId
  }

  // Waste → scrap location
  const scrapLocationId = String(wasteReady.scrapLocationId ?? '').trim()
  if (normalizedWaste.length) {
    if (!scrapLocationId) return fail('scrap_location_not_configured', 400)
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const transferPairId = `wh-pair-${crypto.randomUUID()}`
    const number = nextServerDocumentNumber(wh.documents, 'issue', binding.productionWarehouseId, date)
    // transfer: issue from line + receipt to scrap as pair simplified to issue+receipt
    const issueDoc = {
      id: documentId,
      type: 'issue',
      purpose: 'writeoff',
      docRole: 'waste_to_scrap',
      warehouseId: binding.productionWarehouseId,
      date,
      number,
      lines: normalizedWaste.map((w) => ({
        lineId: crypto.randomUUID(),
        itemId: String(w.itemId).trim(),
        quantity: Number(w.quantity),
        ...shiftStockLineage(w),
        locationId: binding.productionLocationId,
      })),
      status: 'posted',
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      transferPairId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
    }
    const scrapReceiptId = `wh-doc-${crypto.randomUUID()}`
    const scrapDoc = {
      id: scrapReceiptId,
      type: 'receipt',
      purpose: 'writeoff',
      docRole: 'scrap_receipt',
      warehouseId: binding.productionWarehouseId,
      date,
      number: `${number}-SCR`,
      lines: issueDoc.lines.map((l) => ({
        ...l,
        lineId: crypto.randomUUID(),
        locationId: scrapLocationId,
      })),
      status: 'posted',
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      isScrap: true,
      transferPairId,
    }
    const movs = [
      ...issueDoc.lines.map((l) => ({
        id: `mov-${crypto.randomUUID()}`,
        documentId,
        documentLineId: l.lineId,
        warehouseId: binding.productionWarehouseId,
        locationId: binding.productionLocationId,
        itemId: l.itemId,
        quantity: l.quantity,
        type: 'issue',
        at: now,
        date,
        actorUid: actor.uid,
        ...shiftStockLineage(l),
        productionOrderId: orderId,
        productionLineId: lineId,
        shiftReportId: reportId,
        transferPairId,
      })),
      ...scrapDoc.lines.map((l) => ({
        id: `mov-${crypto.randomUUID()}`,
        documentId: scrapReceiptId,
        documentLineId: l.lineId,
        warehouseId: binding.productionWarehouseId,
        locationId: scrapLocationId,
        itemId: l.itemId,
        quantity: l.quantity,
        type: 'receipt',
        at: now,
        date,
        actorUid: actor.uid,
        ...shiftStockLineage(l),
        productionOrderId: orderId,
        productionLineId: lineId,
        shiftReportId: reportId,
        transferPairId,
        isScrap: true,
      })),
    ]
    wh = {
      ...wh,
      documents: [...wh.documents, issueDoc, scrapDoc],
      movements: [...wh.movements, ...movs],
    }
    wasteTransferPairId = transferPairId
  }

  const catalogue = ctx.masterDataActive
    ? ctx.masterData?.items ?? []
    : warehouse.items ?? []
  const totalActualByItem = new Map()
  for (const actual of actuals) {
    totalActualByItem.set(
      actual.itemId,
      (totalActualByItem.get(actual.itemId) ?? 0) + actual.quantity,
    )
  }
  const remainingWasteByTuple = new Map(wasteByStockKey)
  const materialLines = actuals.map((actual) => {
    const item = catalogue.find((candidate) => candidate?.id === actual.itemId)
    const norm = norms.find((candidate) => candidate.warehouseItemId === actual.itemId)
    const itemActualTotal = totalActualByItem.get(actual.itemId) ?? actual.quantity
    const normQty = norm
      ? norm.needQty * (actual.quantity / itemActualTotal)
      : actual.quantity
    const tupleKey = shiftStockTupleKey(actual)
    const remainingWaste = remainingWasteByTuple.get(tupleKey) ?? 0
    const wasteQty = Math.min(actual.quantity, remainingWaste)
    remainingWasteByTuple.set(tupleKey, Math.max(0, remainingWaste - wasteQty))
    const deviationQty = actual.quantity - normQty
    const deviationPct = Math.abs(normQty) <= 1e-9
      ? actual.quantity === 0 ? 0 : 100
      : (deviationQty / Math.abs(normQty)) * 100
    return {
      lineId: crypto.randomUUID(),
      itemId: actual.itemId,
      itemCodeSnapshot: item?.internalCode,
      itemNameSnapshot: item?.name,
      unitSnapshot: String(
        item?.baseUnit ?? item?.unit ?? norm?.unitSnapshot ?? actual?.unit ?? '',
      ).trim(),
      normQty,
      actualInputQty: actual.quantity,
      wasteQty,
      processConsumedQty: actual.quantity - wasteQty,
      deviationQty,
      deviationPct,
      tolerancePct: norm?.tolerancePct ?? 0,
      normSource: norm ? 'recipe' : 'fact_only',
      deviationReason: String(actual.deviationReason ?? '').trim() || undefined,
      ...shiftStockLineage(actual),
    }
  })
  const canonicalWasteLines = normalizedWaste.map((row) => {
    const item = catalogue.find(
      (candidate) => String(candidate?.id ?? '').trim() === String(row.itemId).trim(),
    )
    return {
      lineId: crypto.randomUUID(),
      itemId: String(row.itemId).trim(),
      ...shiftStockLineage(row),
      quantity: Number(row.quantity),
      unitSnapshot: String(item?.baseUnit ?? item?.unit ?? row.unit ?? '').trim(),
      reasonCode: String(row.reasonCode ?? '').trim() || 'process_waste',
      comment: String(row.reason ?? row.comment ?? '').trim() || undefined,
    }
  })

  const report = {
    id: reportId,
    number: reportNumber,
    idempotencyKey: idem,
    commandFingerprint,
    status: 'confirmed',
    orderId,
    productionOrderId: orderId,
    lineId,
    shiftDate,
    shiftSlot: command.shiftSlot ?? 'day',
    shift: command.shiftSlot ?? 'day',
    outputMp,
    outputM2: outputMp,
    outputRolls,
    rollCount: outputRolls,
    actualInputs: actuals,
    materialLines,
    wasteInputs: normalizedWaste,
    wasteLines: canonicalWasteLines,
    wipBatchId,
    semiFinishedItemId,
    semiFinishedUnitSnapshot: wipReady.semiFinishedUnitSnapshot,
    wipContractVersion: wipReady.strict ? 1 : undefined,
    impregnationQcDecisionId: qcReady.decision?.id,
    batchRunId: qcReady.decision?.batchRunId,
    rawMaterialItemId: handoffReady.rawMaterialItemId,
    reservationDocumentId: handoffReady.reservationDocumentId,
    materialHandoffIds: handoffReady.handoffIds,
    materialHandoffTransferPairIds: handoffReady.transferPairIds,
    packLocationId,
    productionWarehouseId: binding.productionWarehouseId,
    productionLocationId: binding.productionLocationId,
    packagingWarehouseId: packBinding.productionWarehouseId,
    packagingLocationId: packLocationId,
    scrapLocationId: normalizedWaste.length ? scrapLocationId : undefined,
    recipeNormSnapshot: snapshot,
    recipeVersionId: snapshot.recipeVersionId,
    contentHash: snapshot.contentHash,
    confirmedAt: now,
    confirmedBy: actor.uid,
    confirmedByName: actor.email ?? actor.uid,
    responsibleUserId: actor.uid,
    responsibleNameSnapshot: actor.email ?? actor.uid,
    createdAt: now,
    updatedAt: now,
    consumptionDocumentId,
    wipReceiptDocumentId,
    wasteTransferPairId,
  }
  const wip = {
    id: wipBatchId,
    orderId,
    shiftReportId: reportId,
    lineId,
    itemId: semiFinishedItemId,
    quantityMp: outputMp,
    rolls: outputRolls,
    locationId: packLocationId,
    isFinishedGoods: false,
    wipContractVersion: wipReady.strict ? 1 : undefined,
    unitSnapshot: wipReady.semiFinishedUnitSnapshot,
    impregnationQcDecisionId: qcReady.decision?.id,
    batchRunId: qcReady.decision?.batchRunId,
    createdAt: now,
  }
  const wasteRecords = normalizedWaste.map((w) => ({
    id: `waste-${crypto.randomUUID()}`,
    orderId,
    shiftReportId: reportId,
    itemId: String(w.itemId).trim(),
    quantity: Number(w.quantity),
    unit: w.unit,
    reason: String(w.reason ?? ''),
    ...shiftStockLineage(w),
    productionLineId: lineId,
    sourceLocationId: binding.productionLocationId,
    destinationLocationId: scrapLocationId || undefined,
    at: now,
  }))
  let prod = {
    ...production,
    shiftReports: [...(production.shiftReports ?? []), report],
    wipBatches: [...(production.wipBatches ?? []), wip],
    wasteRecords: [...(production.wasteRecords ?? []), ...wasteRecords],
  }
  prod = appendProdAudit(prod, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'shift_confirm',
    actorUid: actor.uid,
    detail: `report ${reportId}`,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: {
      reportId,
      report,
      status: 'confirmed',
      wipBatchId,
      isFinishedGoods: false,
    },
  })
}

function applyReallocate(production, warehouse, command, actor, now) {
  const reason = String(command.reason ?? '').trim()
  const sourceOrderId = String(command.sourceOrderId ?? '').trim()
  const targetOrderId = String(command.targetOrderId ?? '').trim()
  const itemId = String(command.itemId ?? '').trim()
  const warehouseId = String(command.warehouseId ?? '').trim()
  const qty = Number(command.quantity)
  if (!reason || !sourceOrderId || !targetOrderId || !itemId || !warehouseId) {
    return fail('reallocate_reason_required', 400)
  }
  if (!Number.isFinite(qty) || qty <= 0) return fail('invalid_quantity', 400)
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)
  // Manual priority override already requires reason (provided).
  let reserved = 0
  for (const m of warehouse.movements ?? []) {
    if (m.productionOrderId !== sourceOrderId || m.itemId !== itemId || m.warehouseId !== warehouseId) continue
    if (m.type === 'reserve') reserved += Math.abs(m.quantity)
    if (m.type === 'unreserve' || (m.type === 'issue' && m.consumesReserve)) {
      reserved -= Math.abs(m.quantity)
    }
  }
  if (qty > reserved + 1e-9) return fail('insufficient_source_reserve', 400)
  const date = now.slice(0, 10)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const number = nextServerDocumentNumber(warehouse.documents, 'reservation', warehouseId, date)
  const doc = {
    id: documentId,
    type: 'reservation',
    purpose: 'other',
    docRole: 'reservation_reallocate',
    warehouseId,
    date,
    number,
    lines: [
      { lineId: crypto.randomUUID(), itemId, quantity: qty, fromOrderId: sourceOrderId, toOrderId: targetOrderId },
    ],
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    cancellationReason: reason,
  }
  const movements = [
    {
      id: `mov-${crypto.randomUUID()}`,
      documentId,
      warehouseId,
      itemId,
      quantity: qty,
      type: 'unreserve',
      at: now,
      date,
      actorUid: actor.uid,
      productionOrderId: sourceOrderId,
    },
    {
      id: `mov-${crypto.randomUUID()}`,
      documentId,
      warehouseId,
      itemId,
      quantity: qty,
      type: 'reserve',
      at: now,
      date,
      actorUid: actor.uid,
      productionOrderId: targetOrderId,
    },
  ]
  const wh = {
    ...warehouse,
    documents: [...warehouse.documents, doc],
    movements: [...warehouse.movements, ...movements],
  }
  let prod = appendProdAudit(production, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'reservation_reallocate',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: { documentId, sourceOrderId, targetOrderId, quantity: qty },
  })
}

function authoritativeLineBindingFingerprint(command) {
  const digest = createHash('sha256')
    .update(canonicalProductionLineBindingPayload(command), 'utf8')
    .digest('hex')
  return `line-binding:v2:${digest}`
}

function applyLineBindingConfigure(production, warehouse, command, actor, now, ctx = {}) {
  if (ctx.allowStagingConfiguration !== true) {
    return fail(LINE_BINDING_CONFIG_STAGING_ONLY, 403)
  }
  const bindingFingerprint = authoritativeLineBindingFingerprint(command)
  const replayFingerprints = Array.isArray(ctx.replayFingerprints)
    ? ctx.replayFingerprints.map((value) => String(value ?? '').trim())
    : []
  if (
    replayFingerprints.some(
      (persistedFingerprint) =>
        !persistedFingerprint || persistedFingerprint !== bindingFingerprint,
    )
  ) {
    return fail('production_line_binding_config_idempotency_conflict', 409)
  }

  const configured = applyProductionLineBindingConfig(warehouse, command, actor, now, {
    fingerprint: authoritativeLineBindingFingerprint,
  })
  if (!configured.ok) return fail(configured.error, configured.status)
  if (replayFingerprints.length > 0 && configured.idempotent !== true) {
    return fail('production_line_binding_config_replay_superseded', 409)
  }
  if (configured.idempotent) {
    return ok({
      production,
      warehouse,
      result: {
        lineId: String(configured.binding.lineId ?? configured.binding.id).trim(),
        bindingId: configured.bindingId,
        productionWarehouseId: String(configured.binding.productionWarehouseId).trim(),
        productionLocationId: String(configured.binding.productionLocationId).trim(),
        note: String(configured.binding.note ?? '').trim(),
        bindingFingerprint: configured.bindingFingerprint,
        previousBindingFingerprint: configured.previousBindingFingerprint,
        idempotent: true,
      },
    })
  }

  const nextWarehouse = appendWhAudit(configured.warehouse, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'production_line_binding_configure',
    actorUid: actor.uid,
    detail: JSON.stringify({
      lineId: configured.binding.lineId,
      productionWarehouseId: configured.binding.productionWarehouseId,
      productionLocationId: configured.binding.productionLocationId,
      bindingFingerprint: configured.bindingFingerprint,
    }),
  })
  return ok({
    production,
    warehouse: nextWarehouse,
    result: {
      lineId: String(configured.binding.lineId ?? configured.binding.id).trim(),
      bindingId: configured.bindingId,
      productionWarehouseId: String(configured.binding.productionWarehouseId).trim(),
      productionLocationId: String(configured.binding.productionLocationId).trim(),
      note: String(configured.binding.note ?? '').trim(),
      bindingFingerprint: configured.bindingFingerprint,
      previousBindingFingerprint: configured.previousBindingFingerprint,
      idempotent: false,
    },
  })
}

const CAP_BY_COMMAND = Object.freeze({
  'production.domain.activate': G3_CAPS.ORDER_CONFIRM, // bootstrap gate; also sysadmin
  'production.recipe.draft.save': G3_CAPS.RECIPE_DRAFT_EDIT,
  'production.recipe.draft.delete': G3_CAPS.RECIPE_DRAFT_EDIT,
  'production.recipe.version.approve': G3_CAPS.RECIPE_APPROVE,
  'production.order.draft.save': G3_CAPS.ORDER_EDIT,
  'production.order.draft.delete': G3_CAPS.ORDER_EDIT,
  'production.order.confirm': G3_CAPS.ORDER_CONFIRM,
  'production.order.change': G3_CAPS.ORDER_CONFIRM,
  'production.order.cancel': G3_CAPS.ORDER_CANCEL,
  'production.order.packagingBomSnapshot.preview': G3_CAPS.ORDER_PACKAGING_BOM_SNAPSHOT_MIGRATE,
  'production.order.packagingBomSnapshot.apply': G3_CAPS.ORDER_PACKAGING_BOM_SNAPSHOT_MIGRATE,
  'production.reservation.reallocate': G3_CAPS.RESERVATION_REALLOCATE,
  'production.material.issueToLine': G3_CAPS.MATERIAL_ISSUE,
  'production.material.returnFromLine': G3_CAPS.MATERIAL_RETURN,
  'production.impregnationQc.decide': G3_CAPS.IMPREGNATION_QC_DECIDE,
  'production.lineBinding.configure': G3_CAPS.LINE_BINDING_CONFIGURE,
  'production.shift.draft.save': G3_CAPS.SHIFT_EDIT,
  'production.shift.draft.delete': G3_CAPS.SHIFT_EDIT,
  'production.shift.confirm': G3_CAPS.SHIFT_CONFIRM,
  'production.shift.createCorrection': G3_CAPS.SHIFT_CORRECT,
  'production.shift.confirmCorrection': G3_CAPS.SHIFT_CORRECT,
  'production.request.post': G3_CAPS.REQUEST_POST,
  'production.read': G3_CAPS.READ,
})

/**
 * Unified G3 command gateway — one idempotencyKey, one CAS, warehouse+production together.
 */
export async function executeG3Command(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = String(input.storeId ?? '').trim()
  let idempotencyKey = String(input.idempotencyKey ?? '').trim()
  const commandType = String(input.commandType ?? '').trim()
  const rawCommand = stripClientTrusted(input.command)
  if (commandType === 'production.request.post') {
    idempotencyKey = normalizeRequestPostIdempotencyKey(rawCommand?.requestId, idempotencyKey)
  }
  const strictLegacyRequestPostReplay =
    commandType === 'production.request.post' && isStagingIsolatedRuntime()
  const strictCanonicalOrderChangeCheck =
    commandType === 'production.order.change' && isStagingIsolatedRuntime()
  const strictOrderConfirmReplayValidation =
    commandType === 'production.order.confirm'
  // Shift receipts are transport receipts, not business-payload validation.
  // Always re-enter the authoritative reducer so the persisted command
  // fingerprint can distinguish an exact timeout replay from a key collision.
  const strictShiftReplayValidation =
    commandType === 'production.shift.confirm' ||
    commandType === 'production.shift.confirmCorrection'
  const strictImpregnationQcReplayValidation =
    commandType === 'production.impregnationQc.decide'
  const strictLineBindingReplayValidation =
    commandType === 'production.lineBinding.configure'
  const strictMaterialHandoffReplayValidation =
    commandType === 'production.material.issueToLine' ||
    commandType === 'production.material.returnFromLine'
  const requiresAuthoritativeReplayValidation =
    strictLegacyRequestPostReplay ||
    strictCanonicalOrderChangeCheck ||
    strictOrderConfirmReplayValidation ||
    strictShiftReplayValidation ||
    strictImpregnationQcReplayValidation ||
    strictLineBindingReplayValidation ||
    strictMaterialHandoffReplayValidation
  if (!storeId || !idempotencyKey || !commandType) return fail('invalid_input', 400)
  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }

  const needed = CAP_BY_COMMAND[commandType]
  if (!needed) return fail('unknown_command', 400)
  let receiptCommandFingerprint
  try {
    receiptCommandFingerprint = g3CommandReceiptFingerprint(commandType, rawCommand)
  } catch {
    return fail('invalid_input', 400)
  }
  const receiptBinding = buildG3ReceiptBinding(
    storeId,
    actor.uid,
    commandType,
    receiptCommandFingerprint,
  )
  const requireLineScope =
    commandType === 'production.shift.confirm' ||
    commandType === 'production.shift.draft.save' ||
    commandType === 'production.shift.createCorrection' ||
    commandType === 'production.shift.confirmCorrection' ||
    commandType === 'production.material.issueToLine' ||
    commandType === 'production.material.returnFromLine' ||
    commandType === 'production.impregnationQc.decide' ||
    commandType === 'production.lineBinding.configure' ||
    commandType === 'production.request.post'
  const perm = await requireG3Capability(actor.uid, storeId, needed, {
    lineId: rawCommand.lineId ?? rawCommand.productionLineId,
    requireLineScope:
      requireLineScope &&
      !strictLegacyRequestPostReplay &&
      Boolean(rawCommand.lineId ?? rawCommand.productionLineId),
  })
  if (!perm.ok) return perm
  if (
    commandType === 'production.lineBinding.configure' &&
    !isStagingIsolatedRuntime()
  ) {
    return fail(LINE_BINDING_CONFIG_STAGING_ONLY, 403)
  }

  const dc = getG1DataConnect()
  const receipt = await loadReceipt(dc, idempotencyKey)
  if (receipt?.corrupt) return fail('receipt_corrupt', 500)

  const critical = strictLegacyRequestPostReplay
    ? await loadExistingCriticalForLegacyReplay(dc, storeId)
    : commandType === 'production.domain.activate'
      ? await loadOrInitCritical(dc, storeId, actor.uid)
      : await loadExistingCriticalForCommand(dc, storeId)
  if (!critical.ok) return critical

  const embedded = embeddedReceipt(critical.payload, idempotencyKey)
  const receiptCandidates = [receipt, embedded].filter((row) => row?.result)
  const allowLegacyUnboundReceipt =
    requiresAuthoritativeReplayValidation && !strictOrderConfirmReplayValidation
  const receiptConflictError = strictMaterialHandoffReplayValidation
    ? 'material_handoff_idempotency_conflict'
    : strictShiftReplayValidation
      ? 'shift_idempotency_conflict'
      : strictImpregnationQcReplayValidation
        ? 'impregnation_qc_idempotency_conflict'
        : strictLineBindingReplayValidation
          ? 'production_line_binding_config_idempotency_conflict'
          : 'idempotency_conflict'
  for (const candidate of receiptCandidates) {
    const bindingCheck = validateG3ReceiptBinding(candidate, receiptBinding, {
      allowLegacyUnbound: allowLegacyUnboundReceipt,
      conflictError: receiptConflictError,
    })
    if (!bindingCheck.ok) return bindingCheck
  }
  if (
    receiptCandidates.length > 0 &&
    !requiresAuthoritativeReplayValidation &&
    commandType !== 'production.domain.activate'
  ) {
    return fail('receipt_replay_requires_current_state', 409)
  }

  let warehouse = structuredClone(critical.payload.domains.warehouse)
  let production = structuredClone(critical.payload.domains.production ?? emptyProductionStore())
  const warehouseBeforeHash = stableDomainHash(warehouse)
  const now = new Date().toISOString()
  const productionActive = isProductionDomainActive(critical.payload, critical.revision)

  if (requireLineScope) {
    let lineId = String(rawCommand.lineId ?? rawCommand.productionLineId ?? '').trim()
    if (strictLegacyRequestPostReplay) {
      const requestId = String(rawCommand.requestId ?? '').trim()
      const reportId = `sr-reqpost-${requestId}`
      const authoritativeLineIds = new Set()
      for (const row of production.shiftReports ?? []) {
        if (
          String(row?.productionRequestId ?? '').trim() === requestId ||
          String(row?.id ?? '').trim() === reportId
        ) {
          const value = String(row?.lineId ?? '').trim()
          if (value) authoritativeLineIds.add(value)
        }
      }
      for (const row of production.wipBatches ?? []) {
        if (
          String(row?.productionRequestId ?? '').trim() === requestId ||
          String(row?.shiftReportId ?? '').trim() === reportId
        ) {
          const value = String(row?.lineId ?? '').trim()
          if (value) authoritativeLineIds.add(value)
        }
      }
      for (const row of warehouse.documents ?? []) {
        if (
          String(row?.productionRequestId ?? '').trim() === requestId ||
          String(row?.shiftReportId ?? '').trim() === reportId
        ) {
          const value = String(row?.productionLineId ?? '').trim()
          if (value) authoritativeLineIds.add(value)
        }
      }
      if ([...authoritativeLineIds].some((value) => !hasLineScope(perm.capabilities, value))) {
        return fail('forbidden_line_scope', 403)
      }
      if (authoritativeLineIds.size === 1) {
        lineId = [...authoritativeLineIds][0]
      }
    }
    if (!lineId && rawCommand.originalReportId) {
      const orig = (production.shiftReports ?? []).find(
        (r) => r.id === String(rawCommand.originalReportId).trim(),
      )
      lineId = String(orig?.lineId ?? '').trim()
      if (lineId) rawCommand.lineId = lineId
    }
    if (!hasLineScope(perm.capabilities, lineId)) {
      return fail('forbidden_line_scope', 403)
    }
  }

  // Domain activation: mutating production commands require explicit production.active
  // (except activate + read). Login/pull never activates.
  if (
    commandType !== 'production.domain.activate' &&
    commandType !== 'production.read' &&
    commandType !== 'production.order.packagingBomSnapshot.preview' &&
    !productionActive
  ) {
    return fail('production_domain_inactive', 409)
  }

  // PHASE R1 — frozen production blocks writes; read/preview still allowed
  if (
    commandType !== 'production.read' &&
    commandType !== 'production.order.packagingBomSnapshot.preview' &&
    isDomainFrozen(critical.payload, 'production', critical.revision)
  ) {
    return fail('domain_frozen', 409)
  }

  // Preserve the legacy receipt fast path for untagged historical orders.
  // Tagged WIP-v1 orders must be checked against their current frozen lineage,
  // so neither an external nor embedded receipt may bypass applyOrderChange.
  if (strictCanonicalOrderChangeCheck) {
    const targetOrder = (production.orders ?? []).find(
      (row) => String(row?.id ?? '').trim() === String(rawCommand.orderId ?? '').trim(),
    )
    if (
      targetOrder &&
      !(Number(targetOrder.wipContractVersion) >= 1) &&
      receiptCandidates.length > 0
    ) {
      return fail('receipt_replay_requires_current_state', 409)
    }
  }

  if (commandType === 'production.domain.activate') {
    if (!isSysadminActor(actor) && !hasCapability(perm.capabilities, G3_CAPS.ORDER_CONFIRM)) {
      return fail('forbidden', 403)
    }
    const reason = String(rawCommand.reason ?? '').trim()
    if (isSysadminActor(actor) && !reason) return fail('emergency_reason_required', 400)
    if (productionActive) {
      const activeResult = bindG3ReceiptResult({
        criticalRevision: critical.revision,
        productionActive: true,
        warehouseActive: critical.payload.domainMeta?.warehouse?.active === true,
        idempotent: true,
        production,
        warehouse: {
          documents: warehouse.documents,
          movements: warehouse.movements,
        },
        ...(embedded?.result && !receipt?.result
          ? { recoveredFromEmbeddedReceipt: true }
          : {}),
      }, receiptBinding)
      if (!receipt?.result) {
        await saveReceipt(
          dc,
          idempotencyKey,
          storeId,
          commandType,
          actor.uid,
          activeResult,
          critical.revision,
        )
      }
      return ok(activeResult)
    }
    // Optional seed from command (explicit bootstrap only — not from client legacy dump blindly)
    if (Array.isArray(rawCommand.seedOrders)) production.orders = rawCommand.seedOrders
    if (Array.isArray(rawCommand.seedRecipeVersions)) {
      production.recipeVersions = rawCommand.seedRecipeVersions
    }
    production = appendProdAudit(production, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'production_domain_activate',
      actorUid: actor.uid,
      detail: reason || 'activate',
    })
    const resultPreview = bindG3ReceiptResult({
      productionActive: true,
      reason: reason || undefined,
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
        impregnationQcDecisions: production.impregnationQcDecisions,
        auditLog: production.auditLog,
      },
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        materialShortages: warehouse.materialShortages,
        auditLog: warehouse.auditLog,
        closedMonths: warehouse.closedMonths,
        productionLineBindings: warehouse.productionLineBindings,
        scrapLocationId: warehouse.scrapLocationId,
      },
    }, receiptBinding)
    const committed = await casCommitDomains(dc, storeId, critical, warehouse, production, actor.uid, {
      idempotencyKey,
      commandType,
      result: resultPreview,
      receiptBinding,
      activateProduction: true,
    })
    if (!committed.ok) return committed
    const result = { ...resultPreview, criticalRevision: committed.criticalRevision }
    await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
    return ok(result)
  }

  let applied
  if (commandType === 'production.recipe.draft.save') {
    applied = applyRecipeDraftSave(production, rawCommand, actor, now)
  } else if (commandType === 'production.recipe.draft.delete') {
    applied = applyRecipeDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'production.recipe.version.approve') {
    applied = applyRecipeApprove(production, rawCommand, actor, now)
  } else if (commandType === 'production.order.draft.save') {
    applied = applyOrderDraftSave(production, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
    })
  } else if (commandType === 'production.order.draft.delete') {
    applied = applyOrderDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'production.order.confirm') {
    applied = applyOrderConfirm(production, warehouse, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      masterDataActive: isMasterDataDomainActive(critical.payload),
      masterData: critical.payload.domains.masterData,
    })
  } else if (commandType === 'production.order.change') {
    applied = applyOrderChange(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.order.cancel') {
    applied = applyOrderCancel(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.reservation.reallocate') {
    applied = applyReallocate(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.material.issueToLine') {
    applied = applyMaterialIssue(production, warehouse, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      idempotencyKey,
      replayReceiptPresent: Boolean(receipt?.result || embedded?.result),
    })
  } else if (commandType === 'production.material.returnFromLine') {
    applied = applyMaterialReturn(production, warehouse, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      idempotencyKey,
      replayReceiptPresent: Boolean(receipt?.result || embedded?.result),
    })
  } else if (commandType === 'production.impregnationQc.decide') {
    applied = applyImpregnationQcDecision(production, warehouse, rawCommand, actor, now, {
      allowEduManualVisual: isStagingIsolatedRuntime(),
    })
  } else if (commandType === 'production.lineBinding.configure') {
    applied = applyLineBindingConfigure(production, warehouse, rawCommand, actor, now, {
      allowStagingConfiguration: isStagingIsolatedRuntime(),
      replayFingerprints: [
        ...(receipt?.result ? [receipt.result.bindingFingerprint ?? ''] : []),
        ...(embedded?.result ? [embedded.result.bindingFingerprint ?? ''] : []),
      ],
    })
  } else if (commandType === 'production.shift.draft.save') {
    applied = applyShiftDraftSave(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.draft.delete') {
    applied = applyShiftDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.confirm') {
    applied = applyShiftConfirm(production, warehouse, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      masterDataActive: isMasterDataDomainActive(critical.payload),
      masterData: critical.payload.domains.masterData,
    })
  } else if (commandType === 'production.shift.createCorrection') {
    applied = applyShiftCreateCorrection(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.confirmCorrection') {
    applied = applyShiftConfirmCorrection(production, warehouse, rawCommand, actor, now, {
      enforceCanonicalLineage: isStagingIsolatedRuntime(),
      masterDataActive: isMasterDataDomainActive(critical.payload),
      masterData: critical.payload.domains.masterData,
    })
  } else if (commandType === 'production.request.post') {
    applied = strictLegacyRequestPostReplay
      ? resolveCompletedLegacyRequestPostReplay(production, warehouse, rawCommand)
      : applyProductionRequestPost(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.order.packagingBomSnapshot.preview') {
    const asOf = String(rawCommand.asOfDate ?? now).slice(0, 10)
    let orders = scanConfirmedOrdersMissingPackagingBomSnapshot(
      production,
      critical.payload.domains.masterData,
      asOf,
    )
    const filterOrderId = String(rawCommand.orderId ?? '').trim()
    if (filterOrderId) orders = orders.filter((o) => o.orderId === filterOrderId)
    return ok({
      criticalRevision: critical.revision,
      orders,
      count: orders.length,
      asOfDate: asOf,
    })
  } else if (commandType === 'production.order.packagingBomSnapshot.apply') {
    applied = applyPackagingBomSnapshotMigrate(
      production,
      critical.payload.domains.masterData,
      rawCommand,
      actor,
      now,
    )
    if (applied.ok && rawCommand.dryRun === true) {
      return ok({
        ...applied.result,
        criticalRevision: critical.revision,
      })
    }
  } else if (commandType === 'production.read') {
    return ok({
      criticalRevision: critical.revision,
      warehouse,
      production,
      productionActive,
      warehouseActive: critical.payload.domainMeta?.warehouse?.active === true,
      domainMeta: critical.payload.domainMeta,
      source: productionActive ? 'fst_critical_store' : 'legacy_or_inactive',
    })
  } else {
    return fail('unknown_command', 400)
  }

  if (!applied.ok) return applied
  production = applied.production ?? production
  warehouse = applied.warehouse ?? warehouse

  // A confirmed-order receipt is only a transport hint. Revalidate the exact
  // current order + reservation graph, then return the latest authoritative
  // projection without another CAS. This keeps timeout replay fresh after
  // downstream writes while key/type/payload collisions fail closed above.
  if (
    commandType === 'production.order.confirm' &&
    applied.result?.idempotent === true
  ) {
    const replay = resolveOrderConfirmReplay(
      production,
      warehouse,
      rawCommand,
      receiptCandidates,
    )
    if (!replay.ok) return replay
    const replayResult = bindG3ReceiptResult({
      ...replay.result,
      ...currentG3Projection(production, warehouse),
      criticalRevision: critical.revision,
      touchesWarehouse: false,
      idempotent: true,
      ...(embedded?.result && !receipt?.result
        ? { recoveredFromEmbeddedReceipt: true }
        : {}),
    }, receiptBinding)
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

  // A WIP-v1 order.change no-op was proven against the current authoritative
  // raw/WIP snapshot. Return the current projection without CAS, audit, or receipt.
  if (
    commandType === 'production.order.change' &&
    applied.result?.idempotent === true &&
    applied.result?.canonicalLineagePreserved === true
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
      },
      production: {
        orders: production.orders,
      },
    })
  }

  // A QC transport receipt is not proof that the submitted business payload
  // still matches the authoritative decision. Re-enter the pure reducer, then
  // return an exact replay without CAS when its persisted fingerprint matches.
  if (
    commandType === 'production.impregnationQc.decide' &&
    applied.result?.idempotent === true
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      touchesWarehouse: false,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        materialShortages: warehouse.materialShortages,
        auditLog: warehouse.auditLog,
        closedMonths: warehouse.closedMonths,
        productionLineBindings: warehouse.productionLineBindings,
        scrapLocationId: warehouse.scrapLocationId,
      },
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
        impregnationQcDecisions: production.impregnationQcDecisions,
        auditLog: production.auditLog,
        packagingReports: production.packagingReports,
        finishedGoodsLots: production.finishedGoodsLots,
        qcDecisions: production.qcDecisions,
      },
    })
  }

  // Re-entered line-binding retries are acknowledged from current authoritative
  // state only after the command fingerprint and exact binding both match.
  if (
    commandType === 'production.lineBinding.configure' &&
    applied.result?.idempotent === true
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      idempotent: true,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        materialShortages: warehouse.materialShortages,
        auditLog: warehouse.auditLog,
        closedMonths: warehouse.closedMonths,
        productionLineBindings: warehouse.productionLineBindings,
        scrapLocationId: warehouse.scrapLocationId,
      },
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
        impregnationQcDecisions: production.impregnationQcDecisions,
        auditLog: production.auditLog,
        packagingReports: production.packagingReports,
        finishedGoodsLots: production.finishedGoodsLots,
        qcDecisions: production.qcDecisions,
      },
    })
  }

  // Material handoff retries are revalidated against the persisted command
  // fingerprint and exact document/line/movement graph. They never post a
  // second pair or advance the critical revision.
  if (
    strictMaterialHandoffReplayValidation &&
    applied.result?.idempotent === true
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      idempotent: true,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        materialShortages: warehouse.materialShortages,
        auditLog: warehouse.auditLog,
        closedMonths: warehouse.closedMonths,
        productionLineBindings: warehouse.productionLineBindings,
        scrapLocationId: warehouse.scrapLocationId,
      },
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
        impregnationQcDecisions: production.impregnationQcDecisions,
        auditLog: production.auditLog,
        packagingReports: production.packagingReports,
        finishedGoodsLots: production.finishedGoodsLots,
        qcDecisions: production.qcDecisions,
      },
    })
  }

  // A verified historical request.post replay is read-only and never realigns.
  if (
    commandType === 'production.request.post' &&
    applied.result?.idempotent === true &&
    !applied.result?.realignedPackLocation
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      idempotent: true,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
      },
      production: {
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        finishedGoodsLots: production.finishedGoodsLots,
      },
    })
  }

  // A shift replay has already been matched to the persisted full command
  // fingerprint.  It is a read-only acknowledgement: do not increment the
  // critical revision or recreate documents merely to refresh a transport
  // receipt.
  if (
    strictShiftReplayValidation &&
    applied.result?.idempotent === true
  ) {
    return ok({
      ...applied.result,
      criticalRevision: critical.revision,
      idempotent: true,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        materialShortages: warehouse.materialShortages,
        auditLog: warehouse.auditLog,
        closedMonths: warehouse.closedMonths,
        productionLineBindings: warehouse.productionLineBindings,
        scrapLocationId: warehouse.scrapLocationId,
      },
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
        impregnationQcDecisions: production.impregnationQcDecisions,
        auditLog: production.auditLog,
        packagingReports: production.packagingReports,
        finishedGoodsLots: production.finishedGoodsLots,
        qcDecisions: production.qcDecisions,
      },
    })
  }

  const touchesWarehouse = warehouseBeforeHash !== stableDomainHash(warehouse)
  if (
    commandType === 'production.impregnationQc.decide' &&
    touchesWarehouse
  ) {
    return fail('impregnation_qc_warehouse_mutation_forbidden', 409)
  }
  const resultPreview = bindG3ReceiptResult({
    ...applied.result,
    touchesWarehouse,
    warehouse: {
      documents: warehouse.documents,
      movements: warehouse.movements,
      materialShortages: warehouse.materialShortages,
      auditLog: warehouse.auditLog,
      closedMonths: warehouse.closedMonths,
      productionLineBindings: warehouse.productionLineBindings,
      scrapLocationId: warehouse.scrapLocationId,
    },
    production: {
      recipeVersions: production.recipeVersions,
      orders: production.orders,
      shiftReports: production.shiftReports,
      wipBatches: production.wipBatches,
      wasteRecords: production.wasteRecords,
      handoffs: production.handoffs,
      impregnationQcDecisions: production.impregnationQcDecisions,
      auditLog: production.auditLog,
      packagingReports: production.packagingReports,
      finishedGoodsLots: production.finishedGoodsLots,
      qcDecisions: production.qcDecisions,
    },
  }, receiptBinding)

  const committed = await casCommitDomains(dc, storeId, critical, warehouse, production, actor.uid, {
    idempotencyKey,
    commandType,
    result: resultPreview,
    receiptBinding,
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

export async function getAuthoritativeCriticalDomains(storeId) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: String(storeId).trim() })
  const row = data?.fstCriticalStore
  if (!row) return ok({ revision: 0, warehouse: null, production: null, source: 'missing' })
  const parsed = parseCriticalPayload(row.payloadJson)
  if (!parsed.ok) return fail(parsed.error, 500)
  const revision = Number(row.revision) || 0
  return ok({
    revision,
    warehouse: parsed.payload.domains.warehouse,
    production: parsed.payload.domains.production ?? emptyProductionStore(),
    masterData: parsed.payload.domains.masterData,
    sales: parsed.payload.domains.sales,
    planning: parsed.payload.domains.planning,
    procurement: parsed.payload.domains.procurement,
    domainMeta: parsed.payload.domainMeta,
    source: revision > 0 ? 'fst_critical_store' : 'legacy_empty',
  })
}

export {
  applyLineBindingConfigure,
  materialHandoffCommandFingerprint,
  applyShiftConfirm,
  applyShiftConfirmCorrection,
  applyShiftCreateCorrection,
  applyShiftDraftSave,
  resolveCanonicalShiftMaterialHandoff,
  resolveApprovedImpregnationQc,
  casCommitDomains,
  hashRecipeContent,
  defaultProductionCapabilities,
  G3_CAPS,
  scanConfirmedOrdersMissingPackagingBomSnapshot,
  applyPackagingBomSnapshotMigrate,
}
