/**
 * PHASE G1 — authoritative warehouse document post (typed command, not JSON patch).
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
  computeServerBalance,
  emptyCriticalPayload,
  fingerprintCriticalPayload,
  parseCapabilities,
  parseCriticalPayload,
  principalAccessId,
  serializeCriticalPayload,
} from './_g1CriticalHelpers.mjs'

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400) {
  return { ok: false, error, status }
}

function isSysadminActor(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '').trim().toLowerCase()
  return Boolean(actor?.claims?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

async function loadPrincipal(dc, storeId, uid) {
  const { data } = await getFstPrincipalAccessByUidStore(dc, { firebaseUid: uid, storeId })
  return data?.fstPrincipalAccesses?.[0] ?? null
}

export async function requirePrincipalCapability(uid, storeId, capability) {
  const dc = getG1DataConnect()
  const row = await loadPrincipal(dc, storeId, uid)
  if (!row || row.active !== true) return fail('forbidden', 403)
  const caps = parseCapabilities(row.capabilitiesJson)
  if (caps[capability] !== true) return fail('forbidden', 403)
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
  const caps = {
    canViewWarehouse: input.capabilities?.canViewWarehouse !== false,
    canPostWarehouseDocument: input.capabilities?.canPostWarehouseDocument === true,
    canCancelWarehouseDocument: input.capabilities?.canCancelWarehouseDocument === true,
  }
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
  const row = {
    id: principalAccessId(storeId, firebaseUid),
    firebaseUid,
    storeId,
    roleId: current?.roleId ?? 'warehouse',
    capabilitiesJson: JSON.stringify({
      canViewWarehouse: false,
      canPostWarehouseDocument: false,
      canCancelWarehouseDocument: false,
    }),
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
    const parsed = parseCriticalPayload(row.payloadJson)
    if (!parsed.ok) return fail(parsed.error, 500)
    return ok({
      revision: row.revision,
      payload: parsed.payload,
      fingerprint: row.fingerprint,
    })
  }
  const payload = emptyCriticalPayload()
  const payloadJson = serializeCriticalPayload(payload)
  await upsertFstCriticalStore(dc, {
    id: storeId,
    revision: 1,
    payloadJson,
    fingerprint: fingerprintCriticalPayload(payloadJson),
    updatedByUid: actorUid,
  })
  return ok({ revision: 1, payload, fingerprint: fingerprintCriticalPayload(payloadJson) })
}

export async function getAuthoritativeCriticalStore(storeId) {
  const dc = getG1DataConnect()
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore ?? null
  if (!row) {
    return ok({
      id: storeId,
      revision: 0,
      payload: emptyCriticalPayload(),
      warehouse: emptyCriticalPayload().domains.warehouse,
      authoritative: true,
    })
  }
  const parsed = parseCriticalPayload(row.payloadJson)
  if (!parsed.ok) return fail(parsed.error, 500)
  return ok({
    id: storeId,
    revision: row.revision,
    payload: parsed.payload,
    warehouse: parsed.payload.domains.warehouse,
    fingerprint: row.fingerprint,
    updatedByUid: row.updatedByUid,
    authoritative: true,
  })
}

/**
 * Typed command: post warehouse document.
 * Server recomputes balances; ignores client-supplied balances/status/movements.
 */
export async function postWarehouseDocumentCommand(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const storeId = String(input.storeId ?? '').trim()
  const idempotencyKey = String(input.idempotencyKey ?? '').trim()
  const command = input.command
  if (!storeId || !idempotencyKey || !command || typeof command !== 'object') {
    return fail('invalid_input', 400)
  }

  // Reject arbitrary payload replacement attempts.
  if (input.payloadJson != null || input.warehousePatch != null || input.fullStore != null) {
    return fail('arbitrary_patch_forbidden', 400)
  }

  const perm = await requirePrincipalCapability(actor.uid, storeId, 'canPostWarehouseDocument')
  if (!perm.ok) return perm

  const dc = getG1DataConnect()
  const existingReceipt = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const receipt = existingReceipt.data?.fstCommandReceipt ?? null
  if (receipt) {
    if (receipt.storeId !== storeId) return fail('not_found', 404)
    try {
      return ok({ ...JSON.parse(receipt.resultJson), idempotent: true })
    } catch {
      return fail('receipt_corrupt', 500)
    }
  }

  const critical = await loadOrInitCritical(dc, storeId, actor.uid)
  if (!critical.ok) return critical

  const type = String(command.type ?? '').trim()
  if (type !== 'receipt' && type !== 'issue') {
    return fail('unsupported_document_type', 400)
  }
  const warehouseId = String(command.warehouseId ?? '').trim()
  const lines = Array.isArray(command.lines) ? command.lines : []
  if (!warehouseId || lines.length === 0) return fail('invalid_input', 400)

  const warehouse = structuredClone(critical.payload.domains.warehouse)
  // Ensure items referenced exist in critical catalog (minimal bootstrap from command snapshots).
  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim()
    if (!itemId) return fail('invalid_line', 400)
    if (!warehouse.items.some((i) => i.id === itemId)) {
      warehouse.items.push({
        id: itemId,
        name: String(line.itemNameSnapshot ?? itemId),
        internalCode: String(line.itemCodeSnapshot ?? ''),
        unit: String(line.unitSnapshot ?? line.inputUnit ?? 'pcs'),
      })
    }
  }

  // Server stock validation for issues (never trust client remaining qty).
  if (type === 'issue') {
    for (const line of lines) {
      const itemId = String(line.itemId)
      const qty = Number(line.quantity)
      if (!Number.isFinite(qty) || qty <= 0) return fail('invalid_quantity', 400)
      const available = computeServerBalance(warehouse.movements, warehouseId, itemId)
      if (qty > available + 1e-9) {
        return fail('insufficient_stock', 400)
      }
    }
  }

  const docId = String(command.documentId ?? '').trim() || `wh-doc-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const doc = {
    id: docId,
    type,
    status: 'posted',
    warehouseId,
    date: String(command.date ?? now.slice(0, 10)),
    number: String(command.number ?? docId),
    lines: lines.map((line) => ({
      lineId: String(line.lineId ?? crypto.randomUUID()),
      itemId: String(line.itemId),
      quantity: Number(line.quantity),
      inputUnit: line.inputUnit,
      itemCodeSnapshot: line.itemCodeSnapshot,
      itemNameSnapshot: line.itemNameSnapshot,
      unitSnapshot: line.unitSnapshot,
    })),
    purpose: command.purpose,
    docRole: command.docRole,
    idempotencyKey,
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
  }

  // Idempotency by document key inside warehouse as second line of defense.
  const prior = warehouse.documents.find((d) => d.idempotencyKey === idempotencyKey)
  if (prior) {
    const result = {
      documentId: prior.id,
      criticalRevision: critical.revision,
      warehouseRevisionHint: critical.revision,
      warehouse: {
        documents: warehouse.documents,
        movements: warehouse.movements,
        items: warehouse.items,
        auditLog: warehouse.auditLog,
      },
    }
    try {
      await insertFstCommandReceipt(dc, {
        id: idempotencyKey,
        storeId,
        commandType: 'warehouse.postDocument',
        actorUid: actor.uid,
        resultJson: JSON.stringify(result),
        criticalRevisionAfter: critical.revision,
      })
    } catch {
      // receipt may already exist
    }
    return ok({ ...result, idempotent: true })
  }

  const movements = doc.lines.map((line) => ({
    id: `mov-${crypto.randomUUID()}`,
    documentId: doc.id,
    documentLineId: line.lineId,
    warehouseId,
    itemId: line.itemId,
    quantity: line.quantity,
    type: type === 'receipt' ? 'in' : 'out',
    at: now,
    actorUid: actor.uid,
  }))

  const audit = {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'document_post',
    documentId: doc.id,
    actorUid: actor.uid,
    detail: `${type} ${doc.number}`,
  }

  warehouse.documents = [...warehouse.documents, doc]
  warehouse.movements = [...warehouse.movements, ...movements]
  warehouse.auditLog = [...(warehouse.auditLog ?? []), audit]

  const nextPayload = {
    ...critical.payload,
    domains: { ...critical.payload.domains, warehouse },
  }
  const nextJson = serializeCriticalPayload(nextPayload)
  const nextRevision = critical.revision + 1

  try {
    await updateFstCriticalStoreCas(dc, {
      id: storeId,
      expectedRevision: critical.revision,
      revision: nextRevision,
      payloadJson: nextJson,
      fingerprint: fingerprintCriticalPayload(nextJson),
      updatedByUid: actor.uid,
    })
  } catch (err) {
    const msg = String(err?.message ?? err ?? '')
    if (msg.includes('revision_conflict') || msg.includes('FAILED_PRECONDITION')) {
      return fail('revision_conflict', 409)
    }
    throw err
  }

  const result = {
    documentId: doc.id,
    movementsCount: movements.length,
    auditId: audit.id,
    criticalRevision: nextRevision,
    warehouse: {
      documents: warehouse.documents,
      movements: warehouse.movements,
      items: warehouse.items,
      auditLog: warehouse.auditLog,
    },
  }

  try {
    await insertFstCommandReceipt(dc, {
      id: idempotencyKey,
      storeId,
      commandType: 'warehouse.postDocument',
      actorUid: actor.uid,
      resultJson: JSON.stringify(result),
      criticalRevisionAfter: nextRevision,
    })
  } catch (err) {
    // CAS already applied; receipt is best-effort for fast replay.
    // Document-level idempotencyKey still prevents double apply on retry.
    console.warn('g1 receipt insert failed', err)
  }

  return ok(result)
}

/** Prove forged legacy FstStore warehouse is not authoritative when critical exists. */
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
