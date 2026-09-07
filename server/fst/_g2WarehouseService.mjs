/**
 * PHASE G2 — authoritative warehouse document lifecycle (typed commands).
 * Single CAS per business command; client movements/status/actor/number are not trusted.
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
  upsertFstPrincipalAccess,
} from './_g1DataConnect.mjs'
import {
  G2_ALLOWED_DOC_TYPES,
  G2_ALLOWED_PURPOSES,
  G2_MAX_BODY_BYTES,
  computeServerBalance,
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  isPeriodClosed,
  isPackagingQcFeatureActive,
  isProductionDomainActive,
  isWarehouseDomainActive,
  isMasterDataDomainActive,
  isSalesPlanningActive,
  isProcurementDomainActive,
  isDomainFrozen,
  markWarehouseDomainActive,
  monthKeyFromDate,
  nextReversalNumber,
  nextServerDocumentNumber,
  parseCapabilities,
  parseCriticalPayload,
  principalAccessId,
  sanitizeDocumentLines,
  serializeCriticalPayload,
  stableDomainHash,
} from './_g1CriticalHelpers.mjs'
import {
  G2_CAPS,
  defaultWarehouseCapabilities,
  hasCapability,
  normalizeCapabilities,
} from './_g2Capabilities.mjs'
import {
  allocateIssueLineBatches,
  buildBatchLotsFromMovements,
  ordinaryAvailableQty,
} from './_g2BatchAllocation.mjs'

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

export async function requirePrincipalCapability(uid, storeId, capability, actor = null) {
  const dc = getG1DataConnect()
  let row = await loadPrincipal(dc, storeId, uid)
  if ((!row || row.active !== true) && actor && isSysadminActor(actor)) {
    // R2.9: sysadmin without FstPrincipalAccess row — auto-provision full warehouse caps
    // (app role ADM ≠ G2 principal; without this WH/ADM posts return raw "forbidden").
    const provisioned = await grantPrincipalAccess({
      actor,
      storeId,
      firebaseUid: uid,
      roleId: 'sysadmin',
      active: true,
      capabilities: {
        canViewWarehouse: true,
        canDraftEdit: true,
        canPostWarehouseDocument: true,
        canCancelWarehouseDocument: true,
        [G2_CAPS.TRANSFER_POST]: true,
        [G2_CAPS.INVENTORY_POST]: true,
        [G2_CAPS.OPENING_ACTIVATE]: true,
        [G2_CAPS.PERIOD_CLOSE]: true,
        [G2_CAPS.PERIOD_REOPEN]: true,
      },
    })
    if (!provisioned.ok) return fail('warehouse.g2.errForbidden', 403)
    row = await loadPrincipal(dc, storeId, uid)
  }
  if (!row || row.active !== true) return fail('warehouse.g2.errForbidden', 403)
  const caps = normalizeCapabilities(parseCapabilities(row.capabilitiesJson))
  if (!hasCapability(caps, capability)) return fail('warehouse.g2.errMissingCapability', 403)
  return ok({ principal: row, capabilities: caps })
}

export async function grantPrincipalAccess(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  if (!isSysadminActor(actor)) return fail('forbidden', 403)
  const storeId = String(input.storeId ?? '').trim()
  const firebaseUid = String(input.firebaseUid ?? '').trim()
  const roleId = String(input.roleId ?? '').trim() || 'warehouse'
  if (!storeId || !firebaseUid) return fail('invalid_input', 400)

  const dc = getG1DataConnect()
  const current = await loadPrincipal(dc, storeId, firebaseUid)
  const caps = defaultWarehouseCapabilities(input.capabilities ?? {})
  const row = {
    id: principalAccessId(storeId, firebaseUid),
    firebaseUid,
    storeId,
    roleId,
    capabilitiesJson: JSON.stringify(caps),
    active: input.active !== false,
    revision: (current?.revision ?? 0) + 1,
    createdByUid: current?.createdByUid ?? actor.uid,
    updatedByUid: actor.uid,
    revokedAt: null,
    revokedByUid: null,
    revokeReason: null,
  }
  await upsertFstPrincipalAccess(dc, row)
  return ok({ principal: { ...row, capabilities: caps } })
}

export async function revokePrincipalAccess(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  if (!isSysadminActor(actor)) return fail('forbidden', 403)
  if (!String(input.reason ?? '').trim()) return fail('invalid_input', 400)
  const storeId = String(input.storeId ?? '').trim()
  const firebaseUid = String(input.firebaseUid ?? '').trim()
  if (!storeId || !firebaseUid) return fail('invalid_input', 400)

  const dc = getG1DataConnect()
  const current = await loadPrincipal(dc, storeId, firebaseUid)
  const caps = defaultWarehouseCapabilities({})
  for (const k of Object.keys(caps)) caps[k] = false
  const row = {
    id: principalAccessId(storeId, firebaseUid),
    firebaseUid,
    storeId,
    roleId: current?.roleId ?? 'warehouse',
    capabilitiesJson: JSON.stringify(caps),
    active: false,
    revision: (current?.revision ?? 0) + 1,
    createdByUid: current?.createdByUid ?? actor.uid,
    updatedByUid: actor.uid,
    revokedAt: new Date().toISOString(),
    revokedByUid: actor.uid,
    revokeReason: String(input.reason).trim(),
  }
  await upsertFstPrincipalAccess(dc, row)
  return ok({ principal: row })
}

async function loadOrInitCritical(dc, storeId, actorUid) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore ?? null
  if (row) {
    const revision = Number(row.revision) || 0
    const parsed = parseCriticalPayload(row.payloadJson, { revision })
    if (!parsed.ok) return fail(parsed.error, 500)
    return ok({
      revision,
      payload: parsed.payload,
      fingerprint: row.fingerprint,
    })
  }
  const payload = emptyCriticalPayload()
  const payloadJson = serializeCriticalPayload(payload)
  await upsertFstCriticalStore(dc, {
    id: storeId,
    revision: 0,
    payloadJson,
    fingerprint: fingerprintCriticalPayload(payloadJson),
    updatedByUid: actorUid,
  })
  return ok({ revision: 0, payload, fingerprint: fingerprintCriticalPayload(payloadJson) })
}

export async function getAuthoritativeCriticalStore(storeId) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore ?? null
  if (!row) {
    const empty = emptyCriticalPayload()
    return ok({
      id: storeId,
      revision: 0,
      payload: empty,
      warehouse: empty.domains.warehouse,
      production: empty.domains.production,
      masterData: empty.domains.masterData,
      sales: empty.domains.sales,
      planning: empty.domains.planning,
      procurement: empty.domains.procurement,
      domainMeta: empty.domainMeta,
      warehouseActive: false,
      productionActive: false,
      packagingQcActive: false,
      masterDataActive: false,
      salesPlanningActive: false,
      procurementActive: false,
      authoritative: true,
    })
  }
  const revision = Number(row.revision) || 0
  const parsed = parseCriticalPayload(row.payloadJson, { revision })
  if (!parsed.ok) return fail(parsed.error, 500)
  return ok({
    id: storeId,
    revision,
    payload: parsed.payload,
    warehouse: parsed.payload.domains.warehouse,
    production: parsed.payload.domains.production ?? emptyCriticalPayload().domains.production,
    masterData: parsed.payload.domains.masterData ?? emptyCriticalPayload().domains.masterData,
    sales: parsed.payload.domains.sales ?? emptyCriticalPayload().domains.sales,
    planning: parsed.payload.domains.planning ?? emptyCriticalPayload().domains.planning,
    procurement: parsed.payload.domains.procurement ?? emptyCriticalPayload().domains.procurement,
    domainMeta: parsed.payload.domainMeta,
    warehouseActive: isWarehouseDomainActive(parsed.payload, revision),
    productionActive: isProductionDomainActive(parsed.payload, revision),
    packagingQcActive: isPackagingQcFeatureActive(parsed.payload),
    masterDataActive: isMasterDataDomainActive(parsed.payload),
    salesPlanningActive: isSalesPlanningActive(parsed.payload),
    procurementActive: isProcurementDomainActive(parsed.payload),
    fingerprint: row.fingerprint,
    updatedByUid: row.updatedByUid,
    authoritative: true,
  })
}

async function loadReceipt(dc, idempotencyKey, storeId) {
  const existingReceipt = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const receipt = existingReceipt.data?.fstCommandReceipt ?? null
  if (!receipt) return null
  if (receipt.storeId !== storeId) return { conflict: true }
  try {
    return { result: JSON.parse(receipt.resultJson) }
  } catch {
    return { corrupt: true }
  }
}

function embeddedReceipt(payload, idempotencyKey) {
  const row = payload?.commandReceipts?.[idempotencyKey]
  if (!row?.result) return null
  return { result: row.result, criticalRevision: row.criticalRevisionAfter, embedded: true }
}

/**
 * G2 CAS preserves sibling domains (production) and stamps warehouse activation.
 * Idempotency result is embedded in the same CAS payload (external receipt is best-effort).
 */
async function casCommit(dc, storeId, critical, nextWarehouse, actorUid, { idempotencyKey, commandType, result } = {}) {
  let nextPayload = {
    ...critical.payload,
    schemaVersion: Math.max(Number(critical.payload.schemaVersion) || 0, 3),
    domains: {
      ...critical.payload.domains,
      warehouse: nextWarehouse,
      // Explicitly keep production reference (deep-equal sibling)
      production: critical.payload.domains.production ?? emptyCriticalPayload().domains.production,
    },
  }
  nextPayload = markWarehouseDomainActive(nextPayload, actorUid)
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
          result,
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
    production: nextPayload.domains.production,
    payload: nextPayload,
    productionHash: stableDomainHash(nextPayload.domains.production),
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
    console.warn('g2 receipt insert failed', err)
  }
}

function appendAudit(warehouse, entry) {
  return {
    ...warehouse,
    auditLog: [...(warehouse.auditLog ?? []), entry],
  }
}

function ensureItemCatalog(warehouse, lines) {
  const items = [...(warehouse.items ?? [])]
  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim()
    if (!itemId) continue
    const existing = items.find((i) => i.id === itemId)
    if (existing) {
      // Existing catalogue card is identity source — receipt snapshot must not mutate it.
      continue
    }
    const name = String(line.itemNameSnapshot ?? '').trim()
    const unit = String(line.unitSnapshot ?? line.inputUnit ?? '').trim()
    // Fail closed: incomplete snapshot must not invent name=itemId stubs (R2.9H).
    if (!name || name === itemId || !unit) {
      return {
        ok: false,
        error: 'unknown_item_incomplete_snapshot',
        itemId,
      }
    }
    items.push({
      id: itemId,
      name,
      internalCode: String(line.itemCodeSnapshot ?? '').trim(),
      unit,
      sku: line.skuSnapshot != null ? String(line.skuSnapshot) : undefined,
      categoryId: line.categoryIdSnapshot != null ? String(line.categoryIdSnapshot) : undefined,
      barcode: line.barcodeSnapshot != null ? String(line.barcodeSnapshot) : undefined,
      active: line.activeSnapshot === false ? false : true,
    })
  }
  return { ok: true, warehouse: { ...warehouse, items } }
}

/** Apply ensureItemCatalog or return a G2 fail payload. */
function withEnsuredItemCatalog(warehouse, lines) {
  const ensured = ensureItemCatalog(warehouse, lines)
  if (!ensured.ok) return fail(ensured.error, 400, { itemId: ensured.itemId })
  return { ok: true, warehouse: ensured.warehouse }
}

function accountingStatus(warehouse, warehouseId) {
  const row = (warehouse.accountingByWarehouse ?? []).find((r) => r.warehouseId === warehouseId)
  return row?.status ?? 'uninitialized'
}

function setAccountingActive(warehouse, warehouseId, actor, documentId) {
  const now = new Date().toISOString()
  const rows = [...(warehouse.accountingByWarehouse ?? [])]
  const idx = rows.findIndex((r) => r.warehouseId === warehouseId)
  const next = {
    id: warehouseId,
    warehouseId,
    status: 'active',
    openingInventoryDocumentId: documentId,
    activatedAt: now,
    activatedBy: actor.uid,
    activatedByName: actor.email ?? actor.uid,
    revision: (idx >= 0 ? (rows[idx].revision ?? 0) : 0) + 1,
  }
  if (idx >= 0) rows[idx] = next
  else rows.push(next)
  return { ...warehouse, accountingByWarehouse: rows }
}

function itemRequiresKnownLot(warehouse, itemId, warehouseId) {
  const lots = buildBatchLotsFromMovements(warehouse.movements, { itemId, warehouseId })
  return lots.some((l) => l.batchNo && l.physical > 1e-9)
}

/**
 * Build authoritative movements. Issue/transfer-out: server FEFO/FIFO allocation
 * (client allocation arrays / computed lots are ignored). Receipt: batch metadata
 * from document lines is inventory fact. Reversal docs should use buildReversalMovements.
 */
function buildMovementsForDoc(doc, warehouse, now, actorUid, { allowNegative = false } = {}) {
  const typeMap = {
    receipt: 'receipt',
    issue: 'issue',
    inventory: 'inventory',
  }
  const movType = typeMap[doc.type] ?? 'adjustment'
  const out = []

  if (doc.type === 'issue') {
    // Allocate sequentially so multi-line docs see prior lines' draws.
    let workingMovements = [...(warehouse?.movements ?? [])]
    for (const line of doc.lines ?? []) {
      const requireKnownLot = itemRequiresKnownLot({ movements: workingMovements }, line.itemId, doc.warehouseId)
      const alloc = allocateIssueLineBatches({
        movements: workingMovements,
        itemId: line.itemId,
        warehouseId: doc.warehouseId,
        locationId: line.locationId,
        quantity: Number(line.quantity),
        manualBatchNo: line.batchNo,
        manualExpiryDate: line.expiryDate,
        manualOverrideReason: line.batchOverrideReason,
        requireKnownLot,
        allowExpired: false,
        today: String(doc.date ?? now).slice(0, 10),
      })
      if (!alloc.ok) {
        if (allowNegative && alloc.error !== 'warehouse.batch.errOverrideReasonRequired') {
          out.push({
            id: `mov-${crypto.randomUUID()}`,
            documentId: doc.id,
            documentLineId: line.lineId,
            warehouseId: doc.warehouseId,
            itemId: line.itemId,
            quantity: Number(line.quantity),
            type: 'issue',
            at: now,
            date: doc.date,
            actorUid,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            batchId: line.batchId,
            locationId: line.locationId,
            emergencyNegative: true,
          })
          continue
        }
        return { ok: false, error: alloc.error, shortages: [{ itemId: line.itemId, shortfall: alloc.shortfall }] }
      }
      for (const a of alloc.allocations) {
        const mov = {
          id: `mov-${crypto.randomUUID()}`,
          documentId: doc.id,
          documentLineId: line.lineId,
          warehouseId: doc.warehouseId,
          itemId: line.itemId,
          quantity: a.quantity,
          type: 'issue',
          at: now,
          date: doc.date,
          actorUid,
          batchNo: a.batchNo,
          expiryDate: a.expiryDate,
          batchId: line.batchId,
          locationId: a.locationId ?? line.locationId,
        }
        out.push(mov)
        workingMovements = [...workingMovements, mov]
      }
    }
    return { ok: true, movements: out }
  }

  for (const line of doc.lines ?? []) {
    out.push({
      id: `mov-${crypto.randomUUID()}`,
      documentId: doc.id,
      documentLineId: line.lineId,
      warehouseId: doc.warehouseId,
      itemId: line.itemId,
      quantity: Number(line.quantity),
      type: movType,
      at: now,
      date: doc.date,
      actorUid,
      batchId: line.batchId,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      locationId: line.locationId,
    })
  }
  return { ok: true, movements: out }
}

function checkIssueStock(warehouse, warehouseId, lines, { allowNegative = false } = {}) {
  if (allowNegative) return { ok: true }
  // Dry-run FEFO allocation; reserved qty is not ordinary-available.
  let working = [...(warehouse.movements ?? [])]
  for (const line of lines) {
    const available = ordinaryAvailableQty(working, line.itemId, warehouseId)
    if (line.quantity > available + 1e-9) {
      return {
        ok: false,
        error: 'insufficient_stock',
        shortages: [{ itemId: line.itemId, available, requested: line.quantity }],
      }
    }
    const requireKnownLot = itemRequiresKnownLot({ movements: working }, line.itemId, warehouseId)
    const alloc = allocateIssueLineBatches({
      movements: working,
      itemId: line.itemId,
      warehouseId,
      locationId: line.locationId,
      quantity: Number(line.quantity),
      manualBatchNo: line.batchNo,
      manualExpiryDate: line.expiryDate,
      manualOverrideReason: line.batchOverrideReason,
      requireKnownLot,
      allowExpired: false,
      today: new Date().toISOString().slice(0, 10),
    })
    if (!alloc.ok) {
      return {
        ok: false,
        error: alloc.error === 'warehouse.batch.errInsufficient' ? 'insufficient_stock' : alloc.error,
        shortages: [{ itemId: line.itemId, available, requested: line.quantity, shortfall: alloc.shortfall }],
      }
    }
    for (const a of alloc.allocations) {
      working.push({
        id: `sim-${crypto.randomUUID()}`,
        warehouseId,
        itemId: line.itemId,
        quantity: a.quantity,
        type: 'issue',
        batchNo: a.batchNo,
        expiryDate: a.expiryDate,
        locationId: a.locationId ?? line.locationId,
        at: new Date().toISOString(),
      })
    }
  }
  return { ok: true }
}

/** Reverse original movements into the correct lots (not re-FEFO). */
function buildReversalMovements(warehouse, doc, reversalDoc, now, actorUid) {
  const originals = (warehouse.movements ?? []).filter(
    (m) => m.documentId === doc.id && !m.cancelled,
  )
  if (originals.length === 0) return { ok: false, error: 'missing_source_movements' }
  const flip = (t) => {
    if (t === 'receipt' || t === 'in') return 'issue'
    if (t === 'issue' || t === 'out') return 'receipt'
    if (t === 'inventory' || t === 'adjustment' || t === 'adjust') return 'inventory'
    return t
  }
  return {
    ok: true,
    movements: originals.map((m) => {
      const nextType = flip(m.type)
      const qty =
        nextType === 'inventory' ? -Number(m.quantity) : Math.abs(Number(m.quantity) || 0)
      return {
        id: `mov-${crypto.randomUUID()}`,
        documentId: reversalDoc.id,
        documentLineId: m.documentLineId,
        warehouseId: m.warehouseId,
        itemId: m.itemId,
        quantity: qty,
        type: nextType,
        at: now,
        date: reversalDoc.date,
        actorUid,
        batchNo: m.batchNo,
        expiryDate: m.expiryDate,
        batchId: m.batchId,
        locationId: m.locationId,
        comment: `storno ${doc.number}`,
      }
    }),
  }
}

function stripClientTrustedFields(command) {
  // Ignore client-supplied authoritative fields even if present.
  const {
    status: _s,
    postedAt: _pa,
    postedBy: _pb,
    postedByName: _pbn,
    movements: _m,
    revision: _r,
    cancelledAt: _ca,
    cancelledBy: _cb,
    actorUid: _au,
    actorEmail: _ae,
    criticalRevision: _cr,
    ...rest
  } = command && typeof command === 'object' ? command : {}
  return rest
}

function assertPurposeAndType(type, purpose) {
  if (!G2_ALLOWED_DOC_TYPES.includes(type)) return fail('unsupported_document_type', 400)
  if (purpose && !G2_ALLOWED_PURPOSES.includes(purpose)) return fail('unsupported_purpose', 400)
  return ok()
}

/** G1 compatibility: post receipt/issue as typed command. */
export async function postWarehouseDocumentCommand(input) {
  return executeG2Command({
    ...input,
    commandType: 'warehouse.document.post',
    command: {
      type: input.command?.type,
      warehouseId: input.command?.warehouseId,
      date: input.command?.date,
      number: input.command?.number,
      lines: input.command?.lines,
      purpose: input.command?.purpose,
      docRole: input.command?.docRole,
      documentId: input.command?.documentId,
      allowNegativeEmergency: input.command?.allowNegativeEmergency,
      emergencyReason: input.command?.emergencyReason,
    },
  })
}

export function resolveAuthoritativeWarehouse(legacyWarehouse, criticalWarehouse, criticalRevision) {
  if (criticalRevision > 0 && criticalWarehouse) {
    return {
      warehouse: criticalWarehouse,
      source: 'fst_critical_store',
      criticalRevision,
    }
  }
  return {
    warehouse: legacyWarehouse ?? emptyCriticalPayload().domains.warehouse,
    source: 'legacy_fst_store_not_authoritative',
    criticalRevision: 0,
  }
}

/**
 * Unified G2 command gateway.
 * commandType:
 *  warehouse.draft.save | warehouse.draft.delete | warehouse.document.post
 *  warehouse.document.postExisting | warehouse.transfer.post
 *  warehouse.inventory.post | warehouse.opening.post
 *  warehouse.dailyIssue.post | warehouse.excel.importDrafts
 *  warehouse.document.cancel | warehouse.period.close | warehouse.period.reopen
 */
export async function executeG2Command(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = String(input.storeId ?? '').trim()
  const idempotencyKey = String(input.idempotencyKey ?? '').trim()
  const commandType = String(input.commandType ?? '').trim()
  const rawCommand = stripClientTrustedFields(input.command)
  if (!storeId || !idempotencyKey || !commandType) return fail('invalid_input', 400)

  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }

  // Approximate body size guard (serialized command).
  try {
    const approx = JSON.stringify(rawCommand).length
    if (approx > G2_MAX_BODY_BYTES) return fail('body_too_large', 413)
  } catch {
    return fail('invalid_input', 400)
  }

  const capabilityByCommand = {
    'warehouse.draft.save': G2_CAPS.DRAFT_EDIT,
    'warehouse.draft.delete': G2_CAPS.DRAFT_EDIT,
    'warehouse.document.post': G2_CAPS.DOCUMENT_POST,
    'warehouse.document.postExisting': G2_CAPS.DOCUMENT_POST,
    'warehouse.transfer.post': G2_CAPS.TRANSFER_POST,
    'warehouse.inventory.post': G2_CAPS.INVENTORY_POST,
    'warehouse.opening.post': G2_CAPS.OPENING_ACTIVATE,
    'warehouse.dailyIssue.post': G2_CAPS.DOCUMENT_POST,
    'warehouse.excel.importDrafts': G2_CAPS.DRAFT_EDIT,
    'warehouse.document.cancel': G2_CAPS.DOCUMENT_CANCEL,
    'warehouse.period.close': G2_CAPS.PERIOD_CLOSE,
    'warehouse.period.reopen': G2_CAPS.PERIOD_REOPEN,
  }
  const needed = capabilityByCommand[commandType]
  if (!needed) return fail('unknown_command', 400)

  const perm = await requirePrincipalCapability(actor.uid, storeId, needed, actor)
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
    // CAS already committed earlier; external receipt missing — recover + best-effort reinsert
    await saveReceipt(
      dc,
      idempotencyKey,
      storeId,
      commandType,
      actor.uid,
      embedded.result,
      embedded.criticalRevision ?? critical.revision,
    )
    return ok({ ...embedded.result, idempotent: true, recoveredFromEmbeddedReceipt: true })
  }

  // PHASE R1 — frozen warehouse: overlay still readable via get; all writes denied
  if (isDomainFrozen(critical.payload, 'warehouse', critical.revision)) {
    return fail('domain_frozen', 409)
  }

  let warehouse = structuredClone(critical.payload.domains.warehouse)
  const productionBeforeHash = stableDomainHash(critical.payload.domains.production)
  const now = new Date().toISOString()

  let resultPayload

  if (commandType === 'warehouse.draft.save') {
    resultPayload = applyDraftSave(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.draft.delete') {
    resultPayload = applyDraftDelete(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.document.post' || commandType === 'warehouse.document.postExisting') {
    // PHASE G5.1 — purchase receipts must use G5 gateway once procurement is active.
    let purposeForGate = String(rawCommand.purpose ?? '').trim()
    if (commandType === 'warehouse.document.postExisting') {
      const draftId = String(rawCommand.documentId ?? '').trim()
      const draft = warehouse.documents?.find((d) => d.id === draftId)
      if (draft?.purpose) purposeForGate = String(draft.purpose)
    }
    if (isProcurementDomainActive(critical.payload) && purposeForGate === 'purchase') {
      return fail('use_g5_gateway', 409)
    }
    resultPayload = applyDocumentPost(warehouse, rawCommand, actor, now, {
      existingDraft: commandType === 'warehouse.document.postExisting',
    })
  } else if (commandType === 'warehouse.transfer.post') {
    resultPayload = applyTransferPost(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.inventory.post') {
    resultPayload = applyInventoryPost(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.opening.post') {
    resultPayload = applyOpeningPost(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.dailyIssue.post') {
    resultPayload = applyDailyIssuePost(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.excel.importDrafts') {
    resultPayload = applyExcelImportDrafts(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.document.cancel') {
    resultPayload = applyCancel(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.period.close') {
    resultPayload = applyPeriodClose(warehouse, rawCommand, actor, now)
  } else if (commandType === 'warehouse.period.reopen') {
    resultPayload = applyPeriodReopen(warehouse, rawCommand, actor, now)
  } else {
    return fail('unknown_command', 400)
  }

  if (!resultPayload.ok) return resultPayload
  warehouse = resultPayload.warehouse

  const resultPreview = {
    ...resultPayload.result,
    warehouse: {
      documents: warehouse.documents,
      movements: warehouse.movements,
      items: warehouse.items,
      locations: warehouse.locations,
      categories: warehouse.categories,
      auditLog: warehouse.auditLog,
      closedMonths: warehouse.closedMonths,
      periodHistory: warehouse.periodHistory,
      accountingByWarehouse: warehouse.accountingByWarehouse,
      dailyIssueSessions: warehouse.dailyIssueSessions,
    },
  }

  const committed = await casCommit(dc, storeId, critical, warehouse, actor.uid, {
    idempotencyKey,
    commandType,
    result: resultPreview,
  })
  if (!committed.ok) return committed

  if (stableDomainHash(committed.production) !== productionBeforeHash) {
    return fail('cross_domain_corruption', 500)
  }

  const result = {
    ...resultPreview,
    criticalRevision: committed.criticalRevision,
  }
  await saveReceipt(dc, idempotencyKey, storeId, commandType, actor.uid, result, committed.criticalRevision)
  return ok(result)
}

function applyDraftSave(warehouse, command, actor, now) {
  const type = String(command.type ?? '').trim()
  const purpose = command.purpose ? String(command.purpose) : 'other'
  const typeOk = assertPurposeAndType(type, purpose)
  if (!typeOk.ok) return typeOk
  const warehouseId = String(command.warehouseId ?? '').trim()
  if (!warehouseId) return fail('invalid_input', 400)
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const linesIn = sanitizeDocumentLines(command.lines ?? [])
  if (!linesIn.ok) return fail(linesIn.error, 400)

  const documentId = String(command.documentId ?? '').trim() || crypto.randomUUID()
  const existing = warehouse.documents.find((d) => d.id === documentId)
  if (existing && existing.status !== 'draft') return fail('posted_immutable', 409)

  const __catalog = withEnsuredItemCatalog(warehouse, linesIn.lines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

    const number =
    existing?.number ||
    nextServerDocumentNumber(warehouse.documents, type, warehouseId, date)

  const doc = {
    ...(existing ?? {}),
    id: documentId,
    type,
    purpose,
    warehouseId,
    date,
    number,
    lines: linesIn.lines,
    status: 'draft',
    comment: command.comment != null ? String(command.comment) : existing?.comment,
    docRole: command.docRole != null ? String(command.docRole) : existing?.docRole,
    targetWarehouseId:
      command.targetWarehouseId != null ? String(command.targetWarehouseId) : existing?.targetWarehouseId,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.uid,
    createdByName: existing?.createdByName ?? actor.email ?? actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.email ?? actor.uid,
    revision: (existing?.revision ?? 0) + 1,
    idempotencyKey: command.clientDraftKey ? String(command.clientDraftKey) : existing?.idempotencyKey,
  }

  const documents = existing
    ? warehouse.documents.map((d) => (d.id === documentId ? doc : d))
    : [...warehouse.documents, doc]

  let next = { ...warehouse, documents }
  if (!existing) {
    next = appendAudit(next, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'document_draft',
      documentId,
      actorUid: actor.uid,
      detail: `draft ${type} ${number}`,
    })
  }
  return ok({
    warehouse: next,
    result: { documentId, number, status: 'draft' },
  })
}

function applyDraftDelete(warehouse, command, actor, now) {
  const documentId = String(command.documentId ?? '').trim()
  if (!documentId) return fail('invalid_input', 400)
  const doc = warehouse.documents.find((d) => d.id === documentId)
  if (!doc) return fail('not_found', 404)
  if (doc.status !== 'draft') return fail('not_draft', 409)
  if (isPeriodClosed(warehouse, doc.date)) return fail('period_closed', 403)

  let next = {
    ...warehouse,
    documents: warehouse.documents.filter((d) => d.id !== documentId),
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_draft',
    documentId,
    actorUid: actor.uid,
    detail: `deleted draft ${doc.number}`,
  })
  return ok({ warehouse: next, result: { documentId, deleted: true } })
}

function applyDocumentPost(warehouse, command, actor, now, { existingDraft }) {
  let doc
  let warehouseId
  let type
  let lines
  let date
  let purpose
  let documentId

  if (existingDraft) {
    documentId = String(command.documentId ?? '').trim()
    if (!documentId) return fail('invalid_input', 400)
    const existing = warehouse.documents.find((d) => d.id === documentId)
    if (!existing) return fail('not_found', 404)
    if (existing.status === 'cancelled') return fail('already_cancelled', 409)
    if (existing.status !== 'draft') return fail('posted_immutable', 409)
    doc = existing
    warehouseId = existing.warehouseId
    type = existing.type
    purpose = existing.purpose ?? 'other'
    date = existing.date
    const linesIn = sanitizeDocumentLines(existing.lines)
    if (!linesIn.ok) return fail(linesIn.error, 400)
    lines = linesIn.lines
  } else {
    type = String(command.type ?? '').trim()
    purpose = command.purpose ? String(command.purpose) : 'other'
    const typeOk = assertPurposeAndType(type, purpose)
    if (!typeOk.ok) return typeOk
    if (type !== 'receipt' && type !== 'issue') return fail('unsupported_document_type', 400)
    warehouseId = String(command.warehouseId ?? '').trim()
    if (!warehouseId) return fail('invalid_input', 400)
    date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
    const linesIn = sanitizeDocumentLines(command.lines ?? [])
    if (!linesIn.ok) return fail(linesIn.error, 400)
    lines = linesIn.lines
    documentId = String(command.documentId ?? '').trim() || `wh-doc-${crypto.randomUUID()}`
  }

  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  // Opening inventory must use dedicated command.
  if (purpose === 'opening_inventory') return fail('use_opening_command', 400)

  // PHASE G5.1 — after procurement domain activation, purchase receipts go through G5 only.
  // (Checked by callers that pass critical payload; see applyDocumentPostWithCriticalGate.)

  const __catalog = withEnsuredItemCatalog(warehouse, lines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

  
  const allowNegative =
    command.allowNegativeEmergency === true &&
    isSysadminActor(actor) &&
    String(command.emergencyReason ?? '').trim().length >= 8

  if (type === 'issue') {
    const stock = checkIssueStock(warehouse, warehouseId, lines, { allowNegative })
    if (!stock.ok) return fail(stock.error, 400, { shortages: stock.shortages })
  }

  const number =
    (existingDraft ? doc.number : null) ||
    nextServerDocumentNumber(warehouse.documents, type, warehouseId, date)

  const full = {
    ...(existingDraft ? doc : {}),
    id: documentId,
    type,
    purpose,
    warehouseId,
    date,
    number,
    lines,
    status: 'posted',
    docRole: command.docRole != null ? String(command.docRole) : doc?.docRole,
    comment: command.comment != null ? String(command.comment) : doc?.comment,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: existingDraft ? doc.createdAt : now,
    createdBy: existingDraft ? doc.createdBy : actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }

  const built = buildMovementsForDoc(full, warehouse, now, actor.uid, { allowNegative })
  if (!built.ok) return fail(built.error, 400, { shortages: built.shortages })
  const movements = built.movements
  const documents = existingDraft
    ? warehouse.documents.map((d) => (d.id === documentId ? full : d))
    : [...warehouse.documents, full]

  let next = {
    ...warehouse,
    documents,
    movements: [...warehouse.movements, ...movements],
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId,
    actorUid: actor.uid,
    detail: `post ${type} ${number}`,
  })
  if (allowNegative) {
    next = appendAudit(next, {
      id: `aud-${crypto.randomUUID()}`,
      at: now,
      action: 'emergency_negative_stock',
      documentId,
      actorUid: actor.uid,
      detail: String(command.emergencyReason).trim(),
    })
  }

  return ok({
    warehouse: next,
    result: { documentId, number, movementsCount: movements.length, status: 'posted' },
  })
}

function applyTransferPost(warehouse, command, actor, now) {
  const fromId = String(command.warehouseId ?? '').trim()
  const toId = String(command.targetWarehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!fromId || !toId || fromId === toId) return fail('invalid_transfer', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)
  const linesIn = sanitizeDocumentLines(command.lines ?? [])
  if (!linesIn.ok) return fail(linesIn.error, 400)

  const __catalog = withEnsuredItemCatalog(warehouse, linesIn.lines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

    const stock = checkIssueStock(warehouse, fromId, linesIn.lines)
  if (!stock.ok) return fail(stock.error, 400, { shortages: stock.shortages })

  const pairId = crypto.randomUUID()
  const baseNo = nextServerDocumentNumber(warehouse.documents, 'issue', fromId, date)
  const issueNo = `${baseNo}-И`
  const receiptNo = `${baseNo}-П`

  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'transfer',
    docRole: 'transfer_issue',
    warehouseId: fromId,
    date,
    number: issueNo,
    lines: linesIn.lines,
    status: 'posted',
    transferPairId: pairId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'transfer',
    docRole: 'transfer_receipt',
    warehouseId: toId,
    date,
    number: receiptNo,
    lines: linesIn.lines.map((l) => ({ ...l, lineId: crypto.randomUUID() })),
    status: 'posted',
    transferPairId: pairId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }

  const issueBuilt = buildMovementsForDoc(issueDoc, warehouse, now, actor.uid)
  if (!issueBuilt.ok) return fail(issueBuilt.error, 400, { shortages: issueBuilt.shortages })
  // Destination receipt mirrors issue lot splits (same batch/expiry/qty), not client allocation.
  const receiptMov = issueBuilt.movements.map((m) => ({
    ...m,
    id: `mov-${crypto.randomUUID()}`,
    documentId: receiptDoc.id,
    warehouseId: toId,
    type: 'receipt',
    documentLineId: crypto.randomUUID(),
  }))
  // Stamp issue batch metadata onto receipt doc lines for audit readability.
  receiptDoc.lines = issueBuilt.movements.map((m) => ({
    lineId: crypto.randomUUID(),
    itemId: m.itemId,
    quantity: m.quantity,
    batchNo: m.batchNo,
    expiryDate: m.expiryDate,
    locationId: m.locationId,
  }))

  let next = {
    ...warehouse,
    documents: [...warehouse.documents, issueDoc, receiptDoc],
    movements: [...warehouse.movements, ...issueBuilt.movements, ...receiptMov],
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId: issueDoc.id,
    actorUid: actor.uid,
    detail: `transfer ${fromId}→${toId} pair=${pairId}`,
  })

  return ok({
    warehouse: next,
    result: {
      documentId: issueDoc.id,
      transferPairId: pairId,
      documentIds: [issueDoc.id, receiptDoc.id],
      status: 'posted',
    },
  })
}

function applyInventoryPost(warehouse, command, actor, now) {
  const warehouseId = String(command.warehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)
  if (!Array.isArray(command.lines) || command.lines.length === 0) return fail('empty_lines', 400)
  if (command.lines.length > 500) return fail('too_many_lines', 400)

  const deltaLines = []
  for (const line of command.lines) {
    const itemId = String(line.itemId ?? '').trim()
    const counted = Number(line.counted ?? line.quantity)
    if (!itemId || !Number.isFinite(counted)) return fail('invalid_line', 400)
    const book = computeServerBalance(warehouse.movements, warehouseId, itemId)
    const delta = counted - book
    if (Math.abs(delta) < 1e-9) continue
    deltaLines.push({
      lineId: crypto.randomUUID(),
      itemId,
      quantity: delta,
      counted,
      book,
      itemNameSnapshot: line.itemNameSnapshot,
      itemCodeSnapshot: line.itemCodeSnapshot,
      unitSnapshot: line.unitSnapshot,
    })
  }
  if (deltaLines.length === 0) {
    return ok({
      warehouse,
      result: { documentId: null, applied: 0, unchanged: command.lines.length, status: 'noop' },
    })
  }

  const __catalog = withEnsuredItemCatalog(warehouse, deltaLines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

    const number = nextServerDocumentNumber(warehouse.documents, 'inventory', warehouseId, date)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const doc = {
    id: documentId,
    type: 'inventory',
    purpose: 'other',
    warehouseId,
    date,
    number,
    lines: deltaLines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const built = buildMovementsForDoc(doc, warehouse, now, actor.uid)
  if (!built.ok) return fail(built.error, 400, { shortages: built.shortages })
  const movements = built.movements
  let next = {
    ...warehouse,
    documents: [...warehouse.documents, doc],
    movements: [...warehouse.movements, ...movements],
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId,
    actorUid: actor.uid,
    detail: `inventory ${number} lines=${deltaLines.length}`,
  })
  return ok({
    warehouse: next,
    result: { documentId, number, applied: deltaLines.length, status: 'posted' },
  })
}

function applyOpeningPost(warehouse, command, actor, now) {
  const warehouseId = String(command.warehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)
  const linesIn = sanitizeDocumentLines(command.lines ?? [])
  if (!linesIn.ok) return fail(linesIn.error, 400)

  // Only activate this warehouse; leave others untouched.
  if (accountingStatus(warehouse, warehouseId) === 'active') {
    const existing = (warehouse.documents ?? []).find(
      (d) =>
        d.purpose === 'opening_inventory' &&
        d.warehouseId === warehouseId &&
        d.status === 'posted',
    )
    if (existing) {
      return ok({
        warehouse,
        result: {
          documentId: existing.id,
          status: 'posted',
          idempotentHint: true,
          accountingStatus: 'active',
        },
      })
    }
  }

  const __catalog = withEnsuredItemCatalog(warehouse, linesIn.lines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

    const number = nextServerDocumentNumber(warehouse.documents, 'receipt', warehouseId, date)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const doc = {
    id: documentId,
    type: 'receipt',
    purpose: 'opening_inventory',
    docRole: 'opening_inventory',
    warehouseId,
    date,
    number,
    lines: linesIn.lines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const built = buildMovementsForDoc(doc, warehouse, now, actor.uid)
  if (!built.ok) return fail(built.error, 400, { shortages: built.shortages })
  const movements = built.movements
  let next = {
    ...warehouse,
    documents: [...warehouse.documents, doc],
    movements: [...warehouse.movements, ...movements],
  }
  next = setAccountingActive(next, warehouseId, actor, documentId)
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId,
    actorUid: actor.uid,
    detail: `opening inventory activate ${warehouseId}`,
  })
  return ok({
    warehouse: next,
    result: {
      documentId,
      number,
      status: 'posted',
      accountingStatus: 'active',
      activatedWarehouseId: warehouseId,
    },
  })
}

function applyDailyIssuePost(warehouse, command, actor, now) {
  // Daily issue → single posted issue document (session closed server-side).
  const warehouseId = String(command.warehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)
  const linesIn = sanitizeDocumentLines(command.lines ?? [])
  if (!linesIn.ok) return fail(linesIn.error, 400)

  const __catalog = withEnsuredItemCatalog(warehouse, linesIn.lines)

  if (!__catalog.ok) return __catalog

  warehouse = __catalog.warehouse

    const stock = checkIssueStock(warehouse, warehouseId, linesIn.lines)
  if (!stock.ok) return fail(stock.error, 400, { shortages: stock.shortages })

  const number = nextServerDocumentNumber(warehouse.documents, 'issue', warehouseId, date)
  const documentId = `wh-doc-${crypto.randomUUID()}`
  const sessionId = String(command.sessionId ?? '').trim() || crypto.randomUUID()
  const doc = {
    id: documentId,
    type: 'issue',
    purpose: 'other',
    docRole: 'daily_issue',
    warehouseId,
    date,
    number,
    lines: linesIn.lines,
    status: 'posted',
    dailyIssueSessionId: sessionId,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }
  const built = buildMovementsForDoc(doc, warehouse, now, actor.uid)
  if (!built.ok) return fail(built.error, 400, { shortages: built.shortages })
  const movements = built.movements
  const sessions = [...(warehouse.dailyIssueSessions ?? [])]
  const sIdx = sessions.findIndex((s) => s.id === sessionId)
  const sessionRow = {
    id: sessionId,
    warehouseId,
    date,
    status: 'posted',
    postedDocumentId: documentId,
    postedAt: now,
  }
  if (sIdx >= 0) sessions[sIdx] = { ...sessions[sIdx], ...sessionRow }
  else sessions.push(sessionRow)

  let next = {
    ...warehouse,
    documents: [...warehouse.documents, doc],
    movements: [...warehouse.movements, ...movements],
    dailyIssueSessions: sessions,
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId,
    actorUid: actor.uid,
    detail: `daily issue ${number}`,
  })
  return ok({
    warehouse: next,
    result: { documentId, number, sessionId, status: 'posted' },
  })
}

function applyExcelImportDrafts(warehouse, command, actor, now) {
  const warehouseId = String(command.warehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)
  const receipts = Array.isArray(command.receipts) ? command.receipts : null
  if (!receipts || receipts.length === 0) return fail('empty_import', 400)
  if (receipts.length > 50) return fail('too_many_receipts', 400)

  const documentIds = []
  let next = warehouse
  for (const receipt of receipts) {
    const linesIn = sanitizeDocumentLines(receipt.lines ?? [])
    if (!linesIn.ok) return fail(linesIn.error, 400)
    const __catalog = withEnsuredItemCatalog(next, linesIn.lines)
    if (!__catalog.ok) return __catalog
    next = __catalog.warehouse
        const number = nextServerDocumentNumber(next.documents, 'receipt', warehouseId, date)
    const documentId = `wh-doc-${crypto.randomUUID()}`
    const doc = {
      id: documentId,
      type: 'receipt',
      purpose: 'purchase',
      warehouseId,
      date,
      number,
      lines: linesIn.lines,
      status: 'draft',
      comment: receipt.comment != null ? String(receipt.comment) : 'excel_import',
      createdAt: now,
      createdBy: actor.uid,
      createdByName: actor.email ?? actor.uid,
      updatedAt: now,
      revision: 1,
    }
    next = {
      ...next,
      documents: [...next.documents, doc],
    }
    documentIds.push(documentId)
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_draft',
    actorUid: actor.uid,
    detail: `excel import drafts=${documentIds.length}`,
  })
  return ok({
    warehouse: next,
    result: { documentIds, status: 'draft', count: documentIds.length },
  })
}

function cancelOne(warehouse, doc, actor, now, reason) {
  if (doc.status === 'cancelled') {
    return {
      ok: true,
      warehouse,
      reversalId: doc.reversalDocumentId ?? null,
      idempotent: true,
    }
  }
  if (doc.status !== 'posted') return { ok: false, error: 'cannot_cancel', status: 409 }

  if (doc.type === 'inventory') {
    const originalMovements = warehouse.movements.filter(
      (m) => m.documentId === doc.id && m.type === 'inventory',
    )
    const reversalId = `wh-doc-${crypto.randomUUID()}`
    const reversalNumber = nextReversalNumber(doc.number)
    const reversalMovements = originalMovements.map((m) => ({
      ...m,
      id: `mov-${crypto.randomUUID()}`,
      quantity: -Number(m.quantity),
      documentId: reversalId,
      documentNo: reversalNumber,
      at: now,
      actorUid: actor.uid,
      comment: `storno ${doc.number}: ${reason}`,
    }))
    const reversalDoc = {
      id: reversalId,
      type: 'inventory',
      purpose: 'other',
      docRole: 'reversal',
      warehouseId: doc.warehouseId,
      date: now.slice(0, 10),
      number: reversalNumber,
      lines: doc.lines,
      status: 'posted',
      reversesDocumentId: doc.id,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      cancellationReason: reason,
    }
    let next = {
      ...warehouse,
      documents: [
        ...warehouse.documents.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                status: 'cancelled',
                cancelledAt: now,
                cancelledBy: actor.uid,
                cancelledByName: actor.email ?? actor.uid,
                cancellationReason: reason,
                reversalDocumentId: reversalId,
              }
            : d,
        ),
        reversalDoc,
      ],
      movements: [...warehouse.movements, ...reversalMovements],
    }
    return { ok: true, warehouse: next, reversalId }
  }

  const reversalType = doc.type === 'receipt' ? 'issue' : 'receipt'
  // Cancelling a receipt issues the same lots — verify lot availability (not re-FEFO).
  if (reversalType === 'issue') {
    const originals = (warehouse.movements ?? []).filter(
      (m) => m.documentId === doc.id && !m.cancelled && (m.type === 'receipt' || m.type === 'in'),
    )
    for (const m of originals) {
      const lots = buildBatchLotsFromMovements(warehouse.movements, {
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        locationId: m.locationId,
      })
      const lot = lots.find(
        (l) =>
          (l.batchNo || '') === (m.batchNo || '') &&
          (l.expiryDate || '') === (m.expiryDate || ''),
      )
      const avail = lot?.available ?? 0
      if (avail + 1e-9 < Math.abs(Number(m.quantity) || 0)) {
        return {
          ok: false,
          error: 'insufficient_stock',
          status: 400,
          shortages: [{ itemId: m.itemId, available: avail, requested: Math.abs(m.quantity) }],
        }
      }
    }
  }

  const reversalId = `wh-doc-${crypto.randomUUID()}`
  const reversalNumber = nextReversalNumber(doc.number)
  const reversalDoc = {
    id: reversalId,
    type: reversalType,
    purpose: 'other',
    docRole: 'reversal',
    warehouseId: doc.warehouseId,
    date: now.slice(0, 10),
    number: reversalNumber,
    lines: (doc.lines ?? []).map((l) => ({ ...l, lineId: l.lineId ?? crypto.randomUUID() })),
    status: 'posted',
    reversesDocumentId: doc.id,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    cancellationReason: reason,
  }
  const rev = buildReversalMovements(warehouse, doc, reversalDoc, now, actor.uid)
  if (!rev.ok) return { ok: false, error: rev.error, status: 409 }
  let next = {
    ...warehouse,
    documents: [
      ...warehouse.documents.map((d) =>
        d.id === doc.id
          ? {
              ...d,
              status: 'cancelled',
              cancelledAt: now,
              cancelledBy: actor.uid,
              cancelledByName: actor.email ?? actor.uid,
              cancellationReason: reason,
              reversalDocumentId: reversalId,
            }
          : d,
      ),
      reversalDoc,
    ],
    movements: [...warehouse.movements, ...rev.movements],
  }
  return { ok: true, warehouse: next, reversalId }
}

function applyCancel(warehouse, command, actor, now) {
  const documentId = String(command.documentId ?? '').trim()
  const reason = String(command.reason ?? '').trim()
  if (!documentId) return fail('invalid_input', 400)
  if (!reason) return fail('cancel_reason_required', 400)

  const doc = warehouse.documents.find((d) => d.id === documentId)
  if (!doc) return fail('not_found', 404)
  if (isPeriodClosed(warehouse, doc.date)) return fail('period_closed', 403)

  if (doc.status === 'cancelled') {
    return ok({
      warehouse,
      result: {
        documentId,
        reversalIds: doc.reversalDocumentId ? [doc.reversalDocumentId] : [],
        status: 'cancelled',
      },
    })
  }

  const targets = doc.transferPairId
    ? warehouse.documents.filter(
        (d) => d.transferPairId === doc.transferPairId && d.status !== 'cancelled',
      )
    : [doc]

  // Atomic pair: apply on a clone; discard on any failure.
  let next = structuredClone(warehouse)
  const reversalIds = []
  for (const target of targets) {
    const out = cancelOne(next, target, actor, now, reason)
    if (!out.ok) return fail(out.error, out.status ?? 400, { shortages: out.shortages })
    next = out.warehouse
    if (out.reversalId) reversalIds.push(out.reversalId)
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_cancel',
    documentId,
    actorUid: actor.uid,
    detail: `cancel ${doc.number}: ${reason}`,
  })
  return ok({
    warehouse: next,
    result: { documentId, reversalIds, status: 'cancelled' },
  })
}

function applyPeriodClose(warehouse, command, actor, now) {
  const month = String(command.month ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('invalid_month', 400)
  const closed = new Set(warehouse.closedMonths ?? [])
  if (closed.has(month)) {
    return ok({
      warehouse,
      result: { month, status: 'closed' },
    })
  }
  closed.add(month)
  const history = [
    ...(warehouse.periodHistory ?? []),
    {
      id: `ph-${crypto.randomUUID()}`,
      month,
      action: 'close',
      at: now,
      actorUid: actor.uid,
      actorEmail: actor.email ?? actor.uid,
    },
  ]
  return ok({
    warehouse: {
      ...warehouse,
      closedMonths: [...closed].sort(),
      periodHistory: history,
    },
    result: { month, status: 'closed' },
  })
}

function applyPeriodReopen(warehouse, command, actor, now) {
  const month = String(command.month ?? '').trim()
  const reason = String(command.reason ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('invalid_month', 400)
  if (!reason) return fail('reopen_reason_required', 400)
  const closed = new Set(warehouse.closedMonths ?? [])
  if (!closed.has(month)) {
    return ok({
      warehouse,
      result: { month, status: 'open' },
    })
  }
  closed.delete(month)
  const history = [
    ...(warehouse.periodHistory ?? []),
    {
      id: `ph-${crypto.randomUUID()}`,
      month,
      action: 'reopen',
      at: now,
      actorUid: actor.uid,
      actorEmail: actor.email ?? actor.uid,
      reason,
    },
  ]
  return ok({
    warehouse: {
      ...warehouse,
      closedMonths: [...closed].sort(),
      periodHistory: history,
    },
    result: { month, status: 'reopened', reason },
  })
}

// Re-export month helper for tests
export { monthKeyFromDate, isPeriodClosed }
