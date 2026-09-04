/**
 * PHASE G3 — authoritative production lifecycle (recipes, orders, reserve, handoff, shift).
 * Atomicity: mutate domains.warehouse + domains.production, then ONE UpdateFstCriticalStoreCas.
 * Client snapshots / movements / roles from FstStore.payloadJson are not trusted.
 */
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
  bomIsApprovedEffective,
  buildPackagingBomSnapshot,
  findById,
  productRequiresPackagingBom,
  selectApprovedPackagingBom,
} from './_g5PackagingBomHelpers.mjs'

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

async function loadReceipt(dc, idempotencyKey, storeId) {
  const { data } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const row = data?.fstCommandReceipt
  if (!row) return null
  if (row.storeId !== storeId) return { conflict: true }
  try {
    return { result: JSON.parse(row.resultJson), criticalRevision: row.criticalRevisionAfter }
  } catch {
    return { corrupt: true }
  }
}

function embeddedReceipt(payload, idempotencyKey) {
  const row = payload?.commandReceipts?.[idempotencyKey]
  if (!row?.result) return null
  return {
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
  { idempotencyKey, commandType, result, activateProduction = false, activatePackagingQc = false } = {},
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
          commandType,
          actorUid,
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

function resolveLineBinding(warehouse, lineId) {
  const b = (warehouse.productionLineBindings ?? []).find(
    (x) => x.lineId === lineId || x.id === lineId,
  )
  if (!b?.productionWarehouseId || !b?.productionLocationId) {
    return { ok: false, error: 'line_location_not_configured' }
  }
  return {
    ok: true,
    productionWarehouseId: b.productionWarehouseId,
    productionLocationId: b.productionLocationId,
  }
}

function postReservationDoc(warehouse, { warehouseId, orderId, lines, now, actor, date }) {
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const number = nextServerDocumentNumber(warehouse.documents, 'reservation', warehouseId, date)
  const doc = {
    id: documentId,
    type: 'reservation',
    purpose: 'production_issue',
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
    itemId: line.itemId,
    quantity: Number(line.quantity),
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

function applyOrderDraftSave(production, command, actor, now) {
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
    orderNumber: String(command.orderNumber ?? existing?.orderNumber ?? orderId),
    finishedProductId: String(command.finishedProductId ?? '').trim(),
    productName: String(command.productName ?? existing?.productName ?? ''),
    formulationRecipeId: String(command.formulationRecipeId ?? '').trim(),
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
    return ok({
      production,
      warehouse,
      result: {
        orderId,
        status: 'active',
        idempotent: true,
        packagingBomSnapshot: order.packagingBomSnapshot ?? null,
      },
    })
  }
  if (order.status !== 'draft' && order.status !== 'active') return fail('invalid_status', 409)
  if (isPeriodClosed(warehouse, order.startDate || now.slice(0, 10))) {
    return fail('period_closed', 403)
  }
  const approved = getApprovedVersion(production, order.formulationRecipeId, now)
  if (!approved) return fail('recipe_not_approved', 409)
  // Ignore client-supplied recipe / packaging snapshots entirely
  const snapshot = buildSnapshot(approved, now)
  const needs = materialNeedFromSnapshot(snapshot, order.totalQtyMp)
  const date = (order.startDate || now).slice(0, 10)

  let packagingBomSnapshot
  const masterDataActive = ctx.masterDataActive === true
  const masterData = ctx.masterData
  if (masterDataActive) {
    const product = (masterData?.finishedProducts ?? []).find(
      (p) => String(p.id) === String(order.finishedProductId),
    )
    if (!product || product.archived === true) return fail('product_not_found', 404)
    const bom = selectApprovedPackagingBom(masterData, product, date)
    const required = productRequiresPackagingBom(product)
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
    },
  })
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
  const draftId = String(command.draftId ?? '').trim() || `srd-${crypto.randomUUID()}`
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  if (!orderId || !lineId) return fail('invalid_input', 400)
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
    outputMp: Number(command.outputMp) || 0,
    outputRolls: Number(command.outputRolls) || 0,
    actualInputs: Array.isArray(command.actualInputs) ? command.actualInputs : [],
    wasteLines: Array.isArray(command.wasteLines) ? command.wasteLines : [],
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
  const revDoc = {
    id: documentId,
    type: doc.type,
    purpose: doc.purpose,
    docRole: 'shift_correction_reversal',
    warehouseId: doc.warehouseId,
    date,
    number: `${number}-REV`,
    lines: (doc.lines ?? []).map((l) => ({ ...l, lineId: crypto.randomUUID() })),
    status: 'posted',
    reversesDocumentId: doc.id,
    shiftReportId: doc.shiftReportId,
    productionOrderId: doc.productionOrderId,
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
        warehouseId: m.warehouseId,
        locationId: m.locationId,
        itemId: m.itemId,
        quantity: Math.abs(m.quantity),
        type: t,
        at: now,
        date,
        actorUid: actor.uid,
        batchNo: m.batchNo,
        expiryDate: m.expiryDate,
        productionOrderId: m.productionOrderId,
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
    outputMp: Number(command.outputMp ?? original.outputMp) || 0,
    outputRolls: Number(command.outputRolls ?? original.outputRolls) || 0,
    actualInputs: Array.isArray(command.actualInputs) ? command.actualInputs : original.actualInputs,
    wasteLines: Array.isArray(command.wasteLines) ? command.wasteLines : original.wasteLines,
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

function applyShiftConfirmCorrection(production, warehouse, command, actor, now) {
  const reason = String(command.correctionReason ?? command.reason ?? '').trim()
  const originalReportId = String(command.originalReportId ?? '').trim()
  if (!reason || !originalReportId) return fail('correction_reason_required', 400)
  if (isSysadminActor(actor) && !String(command.emergencyReason ?? reason).trim()) {
    return fail('emergency_reason_required', 400)
  }
  const original = (production.shiftReports ?? []).find((r) => r.id === originalReportId)
  if (!original || original.status !== 'confirmed') return fail('shift_immutable', 409)
  const corrKey = String(
    command.reportKey ?? `corr::${originalReportId}::${command.idempotencySuffix ?? reason}`,
  )
  const existing = (production.shiftReports ?? []).find(
    (r) => r.idempotencyKey === corrKey && r.status === 'confirmed',
  )
  if (existing) {
    return ok({
      production,
      warehouse,
      result: { reportId: existing.id, status: 'confirmed', idempotent: true },
    })
  }
  if (isPeriodClosed(warehouse, original.shiftDate || now.slice(0, 10))) {
    return fail('period_closed', 403)
  }

  // Block correction if WIP already consumed below proposed output
  const wip = (production.wipBatches ?? []).find((b) => b.shiftReportId === originalReportId)
  if (wip) {
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
    wipBatches: (prod.wipBatches ?? []).filter((b) => b.shiftReportId !== originalReportId),
  }

  const confirmCmd = {
    orderId: command.orderId ?? original.orderId,
    lineId: command.lineId ?? original.lineId,
    shiftDate: command.shiftDate ?? original.shiftDate,
    shiftSlot: command.shiftSlot ?? original.shiftSlot,
    outputMp: command.outputMp ?? original.outputMp,
    outputRolls: command.outputRolls ?? original.outputRolls,
    actualInputs: command.actualInputs ?? original.actualInputs,
    wasteLines: command.wasteLines ?? original.wasteLines,
    semiFinishedItemId: command.semiFinishedItemId ?? original.semiFinishedItemId,
    packLocationId: command.packLocationId ?? original.packLocationId,
    reportKey: corrKey,
  }
  const confirmed = applyShiftConfirm(prod, wh, confirmCmd, actor, now)
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
      status: 'confirmed',
      correctsReportId: originalReportId,
      reverseDocumentIds: reverseIds,
      isFinishedGoods: false,
    },
  })
}

function applyMaterialIssue(production, warehouse, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const reason = String(command.overReserveReason ?? command.reason ?? '').trim()
  const linesIn = Array.isArray(command.lines) ? command.lines : []
  if (!orderId || !lineId || !rawWarehouseId || !linesIn.length) return fail('invalid_input', 400)
  const order = (production.orders ?? []).find((o) => o.id === orderId)
  if (!order || order.status !== 'active') return fail('order_not_active', 409)
  if (order.lineId !== lineId) return fail('order_line_mismatch', 400)
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)
  const binding = resolveLineBinding(warehouse, lineId)
  if (!binding.ok) return fail(binding.error, 400)

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
    const lots = buildBatchLotsFromMovements(wh.movements, { itemId, warehouseId: rawWarehouseId }).map(
      (l) => ({ ...l, available: Math.max(0, l.physical), reserved: 0 }),
    )
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
    })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    productionLineId: lineId,
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
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const issueMov = issueLines.map((l, i) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: issueDoc.id,
    warehouseId: rawWarehouseId,
    itemId: l.itemId,
    quantity: l.quantity,
    type: 'issue',
    at: now,
    date,
    actorUid: actor.uid,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
    productionOrderId: orderId,
    consumesReserve: true,
  }))
  const receiptMov = issueLines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: receiptDoc.id,
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
  }))
  wh = {
    ...wh,
    documents: [...wh.documents, issueDoc, receiptDoc],
    movements: [...wh.movements, ...issueMov, ...receiptMov],
  }
  const handoff = {
    id: `ho-${crypto.randomUUID()}`,
    orderId,
    lineId,
    transferPairId: pairId,
    issueDocumentId: issueDoc.id,
    receiptDocumentId: receiptDoc.id,
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
    result: { orderId, transferPairId: pairId, documentIds: [issueDoc.id, receiptDoc.id] },
  })
}

function applyMaterialReturn(production, warehouse, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const rawWarehouseId = String(command.rawWarehouseId ?? '').trim()
  const reason = String(command.reason ?? '').trim()
  const linesIn = Array.isArray(command.lines) ? command.lines : []
  if (!orderId || !lineId || !rawWarehouseId || !reason || !linesIn.length) {
    return fail('return_reason_required', 400)
  }
  if (isPeriodClosed(warehouse, now.slice(0, 10))) return fail('period_closed', 403)
  const binding = resolveLineBinding(warehouse, lineId)
  if (!binding.ok) return fail(binding.error, 400)

  for (const line of linesIn) {
    const itemId = String(line.itemId ?? '').trim()
    const qty = Number(line.quantity)
    const atLine = ordinaryAvailableQty(
      warehouse.movements.filter(
        (m) =>
          m.warehouseId === binding.productionWarehouseId &&
          (m.locationId ?? '') === binding.productionLocationId &&
          m.productionOrderId === orderId,
      ),
      itemId,
      binding.productionWarehouseId,
    )
    // Recompute from filtered movements manually
    let bal = 0
    for (const m of warehouse.movements ?? []) {
      if (m.itemId !== itemId) continue
      if (m.warehouseId !== binding.productionWarehouseId) continue
      if ((m.locationId ?? '') !== binding.productionLocationId) continue
      if (m.productionOrderId !== orderId) continue
      if (m.type === 'receipt' || m.type === 'in') bal += Math.abs(m.quantity)
      if (m.type === 'issue' || m.type === 'out') bal -= Math.abs(m.quantity)
    }
    if (qty > bal + 1e-9) return fail('return_exceeds_remaining', 400)
  }

  const date = now.slice(0, 10)
  const pairId = crypto.randomUUID()
  const baseNo = nextServerDocumentNumber(warehouse.documents, 'issue', binding.productionWarehouseId, date)
  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'return',
    docRole: 'transfer_issue',
    warehouseId: binding.productionWarehouseId,
    date,
    number: `${baseNo}-И`,
    lines: linesIn.map((l) => ({
      lineId: crypto.randomUUID(),
      itemId: String(l.itemId).trim(),
      quantity: Number(l.quantity),
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      locationId: binding.productionLocationId,
    })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    cancellationReason: reason,
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'return',
    docRole: 'transfer_receipt',
    warehouseId: rawWarehouseId,
    date,
    number: `${baseNo}-П`,
    lines: issueDoc.lines.map((l) => ({ ...l, lineId: crypto.randomUUID(), locationId: undefined })),
    status: 'posted',
    transferPairId: pairId,
    productionOrderId: orderId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const issueMov = issueDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: issueDoc.id,
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
  }))
  const receiptMov = issueDoc.lines.map((l) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: receiptDoc.id,
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
  }))
  const wh = {
    ...warehouse,
    documents: [...warehouse.documents, issueDoc, receiptDoc],
    movements: [...warehouse.movements, ...issueMov, ...receiptMov],
  }
  let prod = appendProdAudit(production, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'material_return_from_line',
    actorUid: actor.uid,
    detail: reason,
  })
  return ok({
    production: prod,
    warehouse: wh,
    result: { orderId, transferPairId: pairId, documentIds: [issueDoc.id, receiptDoc.id] },
  })
}

function applyShiftConfirm(production, warehouse, command, actor, now) {
  const orderId = String(command.orderId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const shiftDate = String(command.shiftDate ?? now.slice(0, 10)).slice(0, 10)
  const idem = String(command.reportKey ?? `${orderId}::${lineId}::${shiftDate}::${command.shiftSlot ?? 'day'}`)
  const existing = (production.shiftReports ?? []).find((r) => r.idempotencyKey === idem && r.status === 'confirmed')
  if (existing) {
    return ok({
      production,
      warehouse,
      result: { reportId: existing.id, status: 'confirmed', idempotent: true },
    })
  }
  const order = (production.orders ?? []).find((o) => o.id === orderId)
  if (!order?.recipeNormSnapshot) return fail('order_not_active', 409)
  if (order.lineId !== lineId) return fail('order_line_mismatch', 400)
  if (isPeriodClosed(warehouse, shiftDate)) return fail('period_closed', 403)
  const binding = resolveLineBinding(warehouse, lineId)
  if (!binding.ok) return fail(binding.error, 400)

  const actuals = Array.isArray(command.actualInputs) ? command.actualInputs : []
  const waste = Array.isArray(command.wasteLines) ? command.wasteLines : []
  const outputMp = Number(command.outputMp)
  const outputRolls = Number(command.outputRolls) || 0
  if (!Number.isFinite(outputMp) || outputMp < 0) return fail('invalid_output', 400)

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
    // Line stock check
    let bal = 0
    for (const m of warehouse.movements ?? []) {
      if (m.itemId !== itemId) continue
      if (m.warehouseId !== binding.productionWarehouseId) continue
      if ((m.locationId ?? '') !== binding.productionLocationId) continue
      if (m.productionOrderId !== orderId) continue
      if (m.type === 'receipt' || m.type === 'in') bal += Math.abs(m.quantity)
      if (m.type === 'issue' || m.type === 'out') bal -= Math.abs(m.quantity)
    }
    if (qty > bal + 1e-9) return fail('insufficient_line_material', 400)
  }

  const reportId = `sr-${crypto.randomUUID()}`
  const date = shiftDate
  let wh = warehouse

  // Consume materials at production location
  if (actuals.length) {
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
      lines: actuals.map((a) => ({
        lineId: crypto.randomUUID(),
        itemId: String(a.itemId).trim(),
        quantity: Number(a.quantity),
        batchNo: a.batchNo,
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
      shiftReportId: reportId,
    }))
    wh = { ...wh, documents: [...wh.documents, doc], movements: [...wh.movements, ...movements] }
  }

  // WIP receipt to pack location (semi-finished — not FG)
  const packLocationId = String(command.packLocationId ?? binding.productionLocationId).trim()
  const semiFinishedItemId = String(command.semiFinishedItemId ?? order.finishedProductId).trim()
  const wipBatchId = `wip-${crypto.randomUUID()}`
  {
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const number = nextServerDocumentNumber(wh.documents, 'receipt', binding.productionWarehouseId, date)
    const doc = {
      id: documentId,
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'wip_receipt',
      warehouseId: binding.productionWarehouseId,
      date,
      number,
      lines: [
        {
          lineId: crypto.randomUUID(),
          itemId: semiFinishedItemId,
          quantity: outputMp,
          locationId: packLocationId,
          batchNo: wipBatchId,
        },
      ],
      status: 'posted',
      productionOrderId: orderId,
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
        warehouseId: binding.productionWarehouseId,
        locationId: packLocationId,
        itemId: semiFinishedItemId,
        quantity: outputMp,
        type: 'receipt',
        at: now,
        date,
        actorUid: actor.uid,
        batchNo: wipBatchId,
        productionOrderId: orderId,
        shiftReportId: reportId,
        isWip: true,
      },
    ]
    wh = { ...wh, documents: [...wh.documents, doc], movements: [...wh.movements, ...movements] }
  }

  // Waste → scrap location
  const scrapLocationId = String(wh.scrapLocationId ?? '').trim()
  if (waste.length) {
    if (!scrapLocationId) return fail('scrap_location_not_configured', 400)
    const documentId = `wh-doc-${crypto.randomUUID()}`
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
      lines: waste.map((w) => ({
        lineId: crypto.randomUUID(),
        itemId: String(w.itemId).trim(),
        quantity: Number(w.quantity),
        locationId: binding.productionLocationId,
      })),
      status: 'posted',
      productionOrderId: orderId,
      shiftReportId: reportId,
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
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      isScrap: true,
    }
    const movs = [
      ...issueDoc.lines.map((l) => ({
        id: `mov-${crypto.randomUUID()}`,
        documentId,
        warehouseId: binding.productionWarehouseId,
        locationId: binding.productionLocationId,
        itemId: l.itemId,
        quantity: l.quantity,
        type: 'issue',
        at: now,
        date,
        actorUid: actor.uid,
        productionOrderId: orderId,
        shiftReportId: reportId,
      })),
      ...scrapDoc.lines.map((l) => ({
        id: `mov-${crypto.randomUUID()}`,
        documentId: scrapReceiptId,
        warehouseId: binding.productionWarehouseId,
        locationId: scrapLocationId,
        itemId: l.itemId,
        quantity: l.quantity,
        type: 'receipt',
        at: now,
        date,
        actorUid: actor.uid,
        productionOrderId: orderId,
        shiftReportId: reportId,
        isScrap: true,
      })),
    ]
    wh = {
      ...wh,
      documents: [...wh.documents, issueDoc, scrapDoc],
      movements: [...wh.movements, ...movs],
    }
  }

  const report = {
    id: reportId,
    idempotencyKey: idem,
    status: 'confirmed',
    orderId,
    lineId,
    shiftDate,
    shiftSlot: command.shiftSlot ?? 'day',
    outputMp,
    outputRolls,
    actualInputs: actuals,
    wasteLines: waste,
    wipBatchId,
    semiFinishedItemId,
    packLocationId,
    recipeVersionId: snapshot.recipeVersionId,
    contentHash: snapshot.contentHash,
    confirmedAt: now,
    confirmedBy: actor.uid,
    confirmedByName: actor.email ?? actor.uid,
    createdAt: now,
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
    createdAt: now,
  }
  const wasteRecords = waste.map((w) => ({
    id: `waste-${crypto.randomUUID()}`,
    orderId,
    shiftReportId: reportId,
    itemId: String(w.itemId).trim(),
    quantity: Number(w.quantity),
    unit: w.unit,
    reason: String(w.reason ?? ''),
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
    result: { reportId, status: 'confirmed', wipBatchId, isFinishedGoods: false },
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
  'production.shift.draft.save': G3_CAPS.SHIFT_EDIT,
  'production.shift.draft.delete': G3_CAPS.SHIFT_EDIT,
  'production.shift.confirm': G3_CAPS.SHIFT_CONFIRM,
  'production.shift.createCorrection': G3_CAPS.SHIFT_CORRECT,
  'production.shift.confirmCorrection': G3_CAPS.SHIFT_CORRECT,
  'production.read': G3_CAPS.READ,
})

/**
 * Unified G3 command gateway — one idempotencyKey, one CAS, warehouse+production together.
 */
export async function executeG3Command(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = String(input.storeId ?? '').trim()
  const idempotencyKey = String(input.idempotencyKey ?? '').trim()
  const commandType = String(input.commandType ?? '').trim()
  const rawCommand = stripClientTrusted(input.command)
  if (!storeId || !idempotencyKey || !commandType) return fail('invalid_input', 400)
  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }

  const needed = CAP_BY_COMMAND[commandType]
  if (!needed) return fail('unknown_command', 400)
  const requireLineScope =
    commandType === 'production.shift.confirm' ||
    commandType === 'production.shift.draft.save' ||
    commandType === 'production.shift.createCorrection' ||
    commandType === 'production.shift.confirmCorrection' ||
    commandType === 'production.material.issueToLine' ||
    commandType === 'production.material.returnFromLine'
  const perm = await requireG3Capability(actor.uid, storeId, needed, {
    lineId: rawCommand.lineId,
    requireLineScope: requireLineScope && Boolean(rawCommand.lineId),
  })
  if (!perm.ok) return perm

  const dc = getG1DataConnect()
  const receipt = await loadReceipt(dc, idempotencyKey, storeId)
  if (receipt?.conflict) return fail('not_found', 404)
  if (receipt?.corrupt) return fail('receipt_corrupt', 500)
  if (receipt?.result) return ok({ ...receipt.result, idempotent: true })

  const critical = await loadOrInitCritical(dc, storeId, actor.uid)
  if (!critical.ok) return critical

  const embedded = embeddedReceipt(critical.payload, idempotencyKey)
  if (embedded?.result) {
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

  let warehouse = structuredClone(critical.payload.domains.warehouse)
  let production = structuredClone(critical.payload.domains.production ?? emptyProductionStore())
  const warehouseBeforeHash = stableDomainHash(warehouse)
  const now = new Date().toISOString()
  const productionActive = isProductionDomainActive(critical.payload, critical.revision)

  if (requireLineScope) {
    let lineId = String(rawCommand.lineId ?? '').trim()
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

  if (commandType === 'production.domain.activate') {
    if (!isSysadminActor(actor) && !hasCapability(perm.capabilities, G3_CAPS.ORDER_CONFIRM)) {
      return fail('forbidden', 403)
    }
    const reason = String(rawCommand.reason ?? '').trim()
    if (isSysadminActor(actor) && !reason) return fail('emergency_reason_required', 400)
    if (productionActive) {
      return ok({
        criticalRevision: critical.revision,
        productionActive: true,
        warehouseActive: critical.payload.domainMeta?.warehouse?.active === true,
        idempotent: true,
        production,
        warehouse: {
          documents: warehouse.documents,
          movements: warehouse.movements,
        },
      })
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
    const resultPreview = {
      productionActive: true,
      reason: reason || undefined,
      production: {
        recipeVersions: production.recipeVersions,
        orders: production.orders,
        shiftReports: production.shiftReports,
        wipBatches: production.wipBatches,
        wasteRecords: production.wasteRecords,
        handoffs: production.handoffs,
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
    }
    const committed = await casCommitDomains(dc, storeId, critical, warehouse, production, actor.uid, {
      idempotencyKey,
      commandType,
      result: resultPreview,
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
    applied = applyOrderDraftSave(production, rawCommand, actor, now)
  } else if (commandType === 'production.order.draft.delete') {
    applied = applyOrderDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'production.order.confirm') {
    applied = applyOrderConfirm(production, warehouse, rawCommand, actor, now, {
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
    applied = applyMaterialIssue(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.material.returnFromLine') {
    applied = applyMaterialReturn(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.shift.draft.save') {
    applied = applyShiftDraftSave(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.draft.delete') {
    applied = applyShiftDraftDelete(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.confirm') {
    applied = applyShiftConfirm(production, warehouse, rawCommand, actor, now)
  } else if (commandType === 'production.shift.createCorrection') {
    applied = applyShiftCreateCorrection(production, rawCommand, actor, now)
  } else if (commandType === 'production.shift.confirmCorrection') {
    applied = applyShiftConfirmCorrection(production, warehouse, rawCommand, actor, now)
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

  const touchesWarehouse = warehouseBeforeHash !== stableDomainHash(warehouse)
  const resultPreview = {
    ...applied.result,
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
      auditLog: production.auditLog,
    },
  }

  const committed = await casCommitDomains(dc, storeId, critical, warehouse, production, actor.uid, {
    idempotencyKey,
    commandType,
    result: resultPreview,
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
  casCommitDomains,
  hashRecipeContent,
  defaultProductionCapabilities,
  G3_CAPS,
  scanConfirmedOrdersMissingPackagingBomSnapshot,
  applyPackagingBomSnapshotMigrate,
}
