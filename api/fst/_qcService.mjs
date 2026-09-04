import {
  getLatestQcLotDecision,
  getQcAttachmentByIdempotency,
  getQcAttachmentRecord,
  getQcDataConnect,
  getQcFinishedGoodsLot,
  getQcLotDecisionByIdempotency,
  getQcPermissionByUidStore,
  insertQcAttachmentRecord,
  insertQcLotDecision,
  listVerifiedLotAttachments,
  upsertQcFinishedGoodsLot,
  upsertQcPermission,
} from './_qcDataConnect.mjs'
import { FST_ADMIN_EMAILS } from './_adminAuth.mjs'
import { buildQcStoragePath, QC_ATTACHMENT_MAX_BYTES, assertMime, verifyStorageObject, createSignedUploadSession } from './_qcStorage.mjs'
import {
  getFstCriticalStore,
  getFstPrincipalAccessByUidStore,
  getG1DataConnect,
  upsertFstPrincipalAccess,
} from './_g1DataConnect.mjs'
import {
  isPackagingQcFeatureActive,
  parseCapabilities,
  parseCriticalPayload,
  principalAccessId,
} from './_g1CriticalHelpers.mjs'
import { QC_PERMISSION_TO_G4 } from './_g4Capabilities.mjs'

export function permissionId(storeId, uid) {
  return `${String(storeId ?? '').trim()}::${String(uid ?? '').trim()}`
}

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400) {
  return { ok: false, error, status }
}

function asNonEmptyString(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function asPositiveInteger(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.trunc(num)
}

function asSafeFlags(flags) {
  return {
    canView: flags?.canView !== false,
    canUpload: flags?.canUpload === true,
    canRelease: flags?.canRelease === true,
    canRegrade: flags?.canRegrade === true,
    canReject: flags?.canReject === true,
    canPostShipment: flags?.canPostShipment === true,
  }
}

function isSysadminActor(actor) {
  const email = String(actor?.email ?? actor?.claims?.email ?? '').trim().toLowerCase()
  return Boolean(actor?.claims?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

async function loadPermission(dc, storeId, uid) {
  const { data } = await getQcPermissionByUidStore(dc, { firebaseUid: uid, storeId })
  const row = data?.qcPermissions?.[0] ?? null
  return row
}

/**
 * PHASE G4.1 — packagingQc feature from FstCriticalStore.
 * Fail-soft false when critical unavailable (legacy P1C.3 unit tests).
 */
export async function isPackagingQcActiveForStore(storeId) {
  const id = String(storeId ?? '').trim()
  if (!id) return false
  try {
    const g1 = getG1DataConnect()
    const { data } = await getFstCriticalStore(g1, { id })
    const row = data?.fstCriticalStore
    if (!row) return false
    const revision = Number(row.revision) || 0
    const parsed = parseCriticalPayload(row.payloadJson, { revision })
    if (!parsed.ok) return false
    return isPackagingQcFeatureActive(parsed.payload)
  } catch {
    return false
  }
}

async function loadPrincipalCaps(storeId, uid) {
  const g1 = getG1DataConnect()
  const { data } = await getFstPrincipalAccessByUidStore(g1, {
    firebaseUid: uid,
    storeId,
  })
  const row = data?.fstPrincipalAccesses?.[0] ?? null
  if (!row || row.active !== true) return { row: null, caps: {} }
  return { row, caps: parseCapabilities(row.capabilitiesJson) }
}

function syntheticPermissionFromFlag(storeId, uid, flag, base) {
  return {
    id: permissionId(storeId, uid),
    firebaseUid: uid,
    storeId,
    active: true,
    canView: flag === 'canView' ? true : Boolean(base?.canView),
    canUpload: flag === 'canUpload',
    canRelease: flag === 'canRelease',
    canRegrade: flag === 'canRegrade',
    canReject: flag === 'canReject',
    canPostShipment: flag === 'canPostShipment',
    [flag]: true,
  }
}

async function loadLot(dc, lotId) {
  const { data } = await getQcFinishedGoodsLot(dc, { id: lotId })
  return data?.qcFinishedGoodsLot ?? null
}

async function loadDecisionByIdempotency(dc, idempotencyKey) {
  const { data } = await getQcLotDecisionByIdempotency(dc, { idempotencyKey })
  return data?.qcLotDecisions?.[0] ?? null
}

async function loadAttachmentByIdempotency(dc, idempotencyKey) {
  const { data } = await getQcAttachmentByIdempotency(dc, { idempotencyKey })
  return data?.qcAttachmentRecords?.[0] ?? null
}

function buildPermissionRow(current, input, actor) {
  const flags = asSafeFlags(input.flags)
  return {
    id: permissionId(input.storeId, input.firebaseUid),
    firebaseUid: input.firebaseUid,
    storeId: input.storeId,
    active: input.active !== false,
    canView: flags.canView,
    canUpload: flags.canUpload,
    canRelease: flags.canRelease,
    canRegrade: flags.canRegrade,
    canReject: flags.canReject,
    canPostShipment: flags.canPostShipment,
    revision: (current?.revision ?? 0) + 1,
    createdByUid: current?.createdByUid ?? actor.uid,
    updatedByUid: actor.uid,
    revokedAt: input.revokedAt ?? current?.revokedAt ?? null,
    revokedByUid: input.revokedByUid ?? current?.revokedByUid ?? null,
    revokeReason: input.revokeReason ?? current?.revokeReason ?? null,
  }
}

function buildLotUpsertRow(current, patch, actor) {
  const base = current ?? {
    id: patch.id,
    storeId: patch.storeId,
    finishedProductId: patch.finishedProductId,
    warehouseItemId: patch.warehouseItemId,
    batchNo: patch.batchNo,
    quantityProduced: patch.quantityProduced,
    quantityShipped: patch.quantityShipped ?? 0,
    packagingReportId: patch.packagingReportId,
    status: patch.status ?? 'pending',
    revision: 0,
    updatedAt: new Date().toISOString(),
  }
  return {
    id: base.id,
    storeId: base.storeId,
    finishedProductId: patch.finishedProductId ?? base.finishedProductId,
    warehouseItemId: patch.warehouseItemId ?? base.warehouseItemId,
    batchNo: patch.batchNo ?? base.batchNo,
    quantityProduced: patch.quantityProduced ?? base.quantityProduced,
    quantityShipped: patch.quantityShipped ?? base.quantityShipped ?? 0,
    packagingReportId: patch.packagingReportId ?? base.packagingReportId,
    status: patch.status ?? base.status ?? 'pending',
    revision: (base.revision ?? 0) + 1,
    updatedByUid: actor.uid,
  }
}

function buildDecisionRow(currentDecision, input, actor, status) {
  const id = currentDecision?.id ?? input.decisionId ?? (input.idempotencyKey ? `qc-decision::${input.idempotencyKey}` : `qc-decision::${crypto.randomUUID()}`)
  return {
    id,
    storeId: input.storeId,
    lotId: input.lotId,
    lotRevision: input.lotRevision ?? input.lotRevisionAtDecision ?? 0,
    decisionVersion: (currentDecision?.decisionVersion ?? 0) + 1,
    status,
    passportAttachmentId: input.passportAttachmentId ?? null,
    protocolAttachmentId: input.protocolAttachmentId ?? null,
    targetFinishedProductId: input.targetFinishedProductId ?? null,
    reason: input.reason ?? null,
    decidedByUid: actor.uid,
    decidedAt: new Date().toISOString(),
    revision: (currentDecision?.revision ?? 0) + 1,
    idempotencyKey: input.idempotencyKey,
  }
}

/**
 * PHASE G4.1 ACL:
 * - packagingQc.active === true → ONLY FstPrincipalAccess (QcPermission ignored).
 * - packagingQc inactive → legacy QcPermission OR principal (P1C.3 compatibility).
 * AppStore roleId is never consulted.
 */
export async function requireActivePermission(uid, storeId, flag) {
  const g4Cap = QC_PERMISSION_TO_G4[flag]
  const packagingQcActive = await isPackagingQcActiveForStore(storeId)

  if (packagingQcActive) {
    if (!g4Cap) return fail('forbidden', 403)
    try {
      const { row, caps } = await loadPrincipalCaps(storeId, uid)
      if (row && caps[g4Cap] === true) {
        return ok({
          permission: syntheticPermissionFromFlag(storeId, uid, flag, null),
          source: 'fst_principal_access',
          packagingQcActive: true,
          principal: row,
        })
      }
    } catch {
      return fail('forbidden', 403)
    }
    return fail('forbidden', 403)
  }

  const dc = getQcDataConnect()
  const permission = await loadPermission(dc, storeId, uid)
  if (permission && permission.active === true && permission[flag] === true) {
    return ok({ permission, source: 'qc_permission_legacy', packagingQcActive: false })
  }

  if (g4Cap) {
    try {
      const { row, caps } = await loadPrincipalCaps(storeId, uid)
      if (row && caps[g4Cap] === true) {
        return ok({
          permission: syntheticPermissionFromFlag(storeId, uid, flag, permission),
          source: 'fst_principal_access',
          packagingQcActive: false,
          principal: row,
        })
      }
    } catch {
      // Principal unavailable — fall through.
    }
  }

  return fail('forbidden', 403)
}

/** Mutating P1C.3 QC/shipment APIs must not bypass G4 after feature activation. */
export async function rejectIfPackagingQcAuthoritative(storeId) {
  if (await isPackagingQcActiveForStore(storeId)) {
    return fail('use_g4_gateway', 409)
  }
  return ok()
}

function flagsToG4Caps(flags) {
  const caps = {}
  const safe = asSafeFlags(flags)
  for (const [flag, g4] of Object.entries(QC_PERMISSION_TO_G4)) {
    if (safe[flag] === true) caps[g4] = true
  }
  return caps
}

/**
 * Admin grant: FstPrincipalAccess is canonical; QcPermission is deprecated projection only.
 */
export async function grantPermission(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  if (!isSysadminActor(actor)) return fail('forbidden', 403)
  const storeId = String(input.storeId ?? '').trim()
  const firebaseUid = String(input.firebaseUid ?? '').trim()
  if (!storeId || !firebaseUid) return fail('invalid_input', 400)

  const dc = getQcDataConnect()
  const current = await loadPermission(dc, storeId, firebaseUid)
  const row = buildPermissionRow(current, { ...input, storeId, firebaseUid }, actor)
  await upsertQcPermission(dc, row)

  try {
    const g1 = getG1DataConnect()
    const { data } = await getFstPrincipalAccessByUidStore(g1, { firebaseUid, storeId })
    const existing = data?.fstPrincipalAccesses?.[0] ?? null
    const prevCaps = existing ? parseCapabilities(existing.capabilitiesJson) : {}
    const nextCaps = { ...prevCaps, ...flagsToG4Caps(input.flags) }
    for (const [flag, g4] of Object.entries(QC_PERMISSION_TO_G4)) {
      if (row[flag] === true) nextCaps[g4] = true
      else if (
        input.flags &&
        Object.prototype.hasOwnProperty.call(input.flags, flag) &&
        input.flags[flag] !== true
      ) {
        nextCaps[g4] = false
      }
    }
    await upsertFstPrincipalAccess(g1, {
      id: principalAccessId(storeId, firebaseUid),
      firebaseUid,
      storeId,
      roleId: existing?.roleId ?? 'qc',
      capabilitiesJson: JSON.stringify(nextCaps),
      active: true,
      revision: (existing?.revision ?? 0) + 1,
      createdByUid: existing?.createdByUid ?? actor.uid,
      updatedByUid: actor.uid,
      revokedAt: null,
      revokedByUid: null,
      revokeReason: null,
    })
  } catch (err) {
    console.warn('grantPermission principal upsert failed', err)
  }

  return ok({
    permission: {
      id: row.id,
      firebaseUid: row.firebaseUid,
      storeId: row.storeId,
      active: row.active,
      canView: row.canView,
      canUpload: row.canUpload,
      canRelease: row.canRelease,
      canRegrade: row.canRegrade,
      canReject: row.canReject,
      canPostShipment: row.canPostShipment,
      revision: row.revision,
      updatedByUid: row.updatedByUid,
      revokedAt: row.revokedAt,
      revokedByUid: row.revokedByUid,
      revokeReason: row.revokeReason,
    },
    aclSource: 'fst_principal_access',
  })
}

/**
 * Admin revoke: clear mapped QC/shipment G4 caps on principal + deprecate QcPermission.
 */
export async function revokePermission(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  if (!isSysadminActor(actor)) return fail('forbidden', 403)
  if (!asNonEmptyString(input.reason)) return fail('invalid_input', 400)
  const storeId = String(input.storeId ?? '').trim()
  const firebaseUid = String(input.firebaseUid ?? '').trim()
  if (!storeId || !firebaseUid) return fail('invalid_input', 400)

  const dc = getQcDataConnect()
  const current = await loadPermission(dc, storeId, firebaseUid)
  const row = buildPermissionRow(
    current,
    {
      ...input,
      storeId,
      firebaseUid,
      active: false,
      revokedAt: new Date().toISOString(),
      revokedByUid: actor.uid,
      revokeReason: input.reason,
      flags: {
        canView: false,
        canUpload: false,
        canRelease: false,
        canRegrade: false,
        canReject: false,
        canPostShipment: false,
      },
    },
    actor,
  )
  await upsertQcPermission(dc, row)

  try {
    const g1 = getG1DataConnect()
    const { data } = await getFstPrincipalAccessByUidStore(g1, { firebaseUid, storeId })
    const existing = data?.fstPrincipalAccesses?.[0] ?? null
    const prevCaps = existing ? parseCapabilities(existing.capabilitiesJson) : {}
    const nextCaps = { ...prevCaps }
    for (const g4 of Object.values(QC_PERMISSION_TO_G4)) {
      nextCaps[g4] = false
    }
    await upsertFstPrincipalAccess(g1, {
      id: principalAccessId(storeId, firebaseUid),
      firebaseUid,
      storeId,
      roleId: existing?.roleId ?? 'qc',
      capabilitiesJson: JSON.stringify(nextCaps),
      active: existing?.active === true,
      revision: (existing?.revision ?? 0) + 1,
      createdByUid: existing?.createdByUid ?? actor.uid,
      updatedByUid: actor.uid,
      revokedAt: existing?.revokedAt ?? null,
      revokedByUid: existing?.revokedByUid ?? null,
      revokeReason: existing?.revokeReason ?? null,
    })
  } catch (err) {
    console.warn('revokePermission principal upsert failed', err)
  }

  return ok({
    permission: {
      id: row.id,
      firebaseUid: row.firebaseUid,
      storeId: row.storeId,
      active: row.active,
      canView: row.canView,
      canUpload: row.canUpload,
      canRelease: row.canRelease,
      canRegrade: row.canRegrade,
      canReject: row.canReject,
      canPostShipment: row.canPostShipment,
      revision: row.revision,
      updatedByUid: row.updatedByUid,
      revokedAt: row.revokedAt,
      revokedByUid: row.revokedByUid,
      revokeReason: row.revokeReason,
    },
    aclSource: 'fst_principal_access',
  })
}

export async function initiateAttachment(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const permission = await requireActivePermission(actor.uid, input.storeId, 'canUpload')
  if (!permission.ok) return permission

  const sizeBytes = asPositiveInteger(input.sizeBytes)
  if (!sizeBytes || sizeBytes > QC_ATTACHMENT_MAX_BYTES) return fail('invalid_size', 400)
  const mimeGate = assertMime(input.documentKind, input.contentType)
  if (!mimeGate.ok) return fail('invalid_mime', 400)

  const dc = getQcDataConnect()
  const existing = input.idempotencyKey ? await loadAttachmentByIdempotency(dc, input.idempotencyKey) : null
  if (existing && existing.storeId !== input.storeId) return fail('not_found', 404)
  if (existing) {
    if (existing.status === 'verified') return ok({ attachment: existing })
    const session = await createSignedUploadSession({
      storagePath: existing.storagePath,
      contentType: existing.contentType,
      sizeBytes: existing.sizeBytes,
      checksum: existing.checksum,
    })
    if (!session.ok) return fail(session.error, 400)
    return ok({
      attachment: existing,
      upload: {
        method: session.method,
        uploadUrl: session.uploadUrl,
        storagePath: session.storagePath,
        contentType: session.contentType,
        expiresAt: session.expiresAt,
        headers: session.headers,
        maxBytes: existing.sizeBytes,
      },
    })
  }

  const attachmentId = asNonEmptyString(input.attachmentId) ?? `att-${crypto.randomUUID()}`
  const storagePath = asNonEmptyString(input.storagePath) ?? buildQcStoragePath(input.storeId, input.lotId, attachmentId)
  const row = {
    id: attachmentId,
    storeId: input.storeId,
    lotId: input.lotId,
    documentKind: input.documentKind,
    storagePath,
    contentType: String(input.contentType).trim().toLowerCase(),
    sizeBytes,
    checksum: String(input.checksum ?? ''),
    objectGeneration: null,
    status: 'initiated',
    uploadedByUid: actor.uid,
    revision: 1,
    idempotencyKey: input.idempotencyKey ?? `qc-attachment::${attachmentId}`,
  }
  await insertQcAttachmentRecord(dc, row)
  const session = await createSignedUploadSession({
    storagePath: row.storagePath,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
  })
  if (!session.ok) return fail(session.error, 400)
  return ok({
    attachment: row,
    upload: {
      method: session.method,
      uploadUrl: session.uploadUrl,
      storagePath: session.storagePath,
      contentType: session.contentType,
      expiresAt: session.expiresAt,
      headers: session.headers,
      maxBytes: row.sizeBytes,
    },
  })
}

export async function finalizeAttachment(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const permission = await requireActivePermission(actor.uid, input.storeId, 'canUpload')
  if (!permission.ok) return permission

  const dc = getQcDataConnect()
  const record = input.idempotencyKey
    ? await loadAttachmentByIdempotency(dc, input.idempotencyKey)
    : input.attachmentId
      ? (await getQcAttachmentRecord(dc, { id: input.attachmentId })).data?.qcAttachmentRecord ?? null
      : null

  if (!record) return fail('not_found', 404)
  if (record.storeId !== input.storeId) return fail('not_found', 404)
  if (input.lotId && record.lotId !== input.lotId) return fail('lot_mismatch', 400)
  if (input.storagePath && record.storagePath !== input.storagePath) return fail('path_mismatch', 400)
  if (record.status === 'verified') return ok({ attachment: record })

  const verification = await verifyStorageObject({
    storagePath: record.storagePath,
    expectedContentType: record.contentType,
    expectedSizeBytes: record.sizeBytes,
    expectedChecksum: record.checksum,
  })
  if (!verification.ok) return fail(verification.error, 400)
  if (input.expectedGeneration && verification.generation && String(input.expectedGeneration) !== String(verification.generation)) {
    return fail('generation_mismatch', 400)
  }

  const nextRevision = (record.revision ?? 0) + 1
  await updateAttachmentRecord(dc, record, verification.generation, nextRevision)
  return ok({
    attachment: {
      ...record,
      status: 'verified',
      objectGeneration: verification.generation ?? record.objectGeneration ?? null,
      verifiedAt: new Date().toISOString(),
      revision: nextRevision,
    },
  })
}

async function updateAttachmentRecord(dc, record, objectGeneration, nextRevision) {
  const { updateQcAttachmentRecord } = await import('./_qcDataConnect.mjs')
  await updateQcAttachmentRecord(dc, {
    id: record.id,
    expectedRevision: record.revision ?? 0,
    revision: nextRevision,
    status: 'verified',
    objectGeneration: objectGeneration ?? null,
    checksum: record.checksum,
    sizeBytes: record.sizeBytes,
    contentType: record.contentType,
    verifiedAt: new Date().toISOString(),
  })
}

export async function upsertLotProjection(input) {
  const actor = input.actor
  if (!actor?.uid) return fail('unauthorized', 401)
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const dc = getQcDataConnect()
  const current = await loadLot(dc, input.id)
  if (current && current.storeId !== input.storeId) return fail('not_found', 404)
  const row = buildLotUpsertRow(current, input, actor)
  await upsertQcFinishedGoodsLot(dc, row)
  return ok({ lot: row })
}

export async function releaseLot(input) {
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const permission = await requireActivePermission(input.actor.uid, input.storeId, 'canRelease')
  if (!permission.ok) return permission
  const dc = getQcDataConnect()
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  if (currentLot.storeId !== input.storeId) return fail('not_found', 404)
  const verified = await listVerifiedAttachments(dc, input.storeId, input.lotId)
  if (!verified.passport || !verified.protocol) return fail('attachments_required', 400)
  const passportStorage = await verifyStorageObject({
    storagePath: verified.passport.storagePath,
    expectedContentType: verified.passport.contentType,
    expectedSizeBytes: verified.passport.sizeBytes,
    expectedChecksum: verified.passport.checksum,
  })
  if (!passportStorage.ok) return fail(passportStorage.error, 400)
  if (
    verified.passport.objectGeneration &&
    passportStorage.generation &&
    String(verified.passport.objectGeneration) !== String(passportStorage.generation)
  ) {
    return fail('generation_mismatch', 400)
  }
  const protocolStorage = await verifyStorageObject({
    storagePath: verified.protocol.storagePath,
    expectedContentType: verified.protocol.contentType,
    expectedSizeBytes: verified.protocol.sizeBytes,
    expectedChecksum: verified.protocol.checksum,
  })
  if (!protocolStorage.ok) return fail(protocolStorage.error, 400)
  if (
    verified.protocol.objectGeneration &&
    protocolStorage.generation &&
    String(verified.protocol.objectGeneration) !== String(protocolStorage.generation)
  ) {
    return fail('generation_mismatch', 400)
  }
  const latestDecision = await loadLatestDecision(dc, input.storeId, input.lotId)
  if (latestDecision?.status === 'released') return ok({ lot: currentLot, decision: latestDecision })
  if (latestDecision?.status && !['pending', 'in_review'].includes(latestDecision.status)) {
    return fail('immutable', 400)
  }
  if (currentLot.status && !['pending', 'in_review', 'active'].includes(currentLot.status)) {
    return fail('immutable', 400)
  }
  if (input.idempotencyKey) {
    const existingDecision = await loadDecisionByIdempotency(dc, input.idempotencyKey)
    if (existingDecision && existingDecision.storeId !== input.storeId) return fail('not_found', 404)
    if (existingDecision) return ok({ lot: currentLot, decision: existingDecision })
  }
  const decision = buildDecisionRow(
    null,
    {
      ...input,
      lotRevision: currentLot.revision ?? 0,
      passportAttachmentId: verified.passport.id,
      protocolAttachmentId: verified.protocol.id,
    },
    input.actor,
    'released',
  )
  const nextLot = buildLotUpsertRow(currentLot, { status: 'released' }, input.actor)
  await insertQcLotDecision(dc, decision)
  await upsertQcFinishedGoodsLot(dc, nextLot)
  return ok({ lot: nextLot, decision })
}

export async function regradeLot(input) {
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const permission = await requireActivePermission(input.actor.uid, input.storeId, 'canRegrade')
  if (!permission.ok) return permission
  if (!asNonEmptyString(input.reason)) return fail('invalid_input', 400)
  const dc = getQcDataConnect()
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  if (currentLot.storeId !== input.storeId) return fail('not_found', 404)
  if (input.idempotencyKey) {
    const existingDecision = await loadDecisionByIdempotency(dc, input.idempotencyKey)
    if (existingDecision && existingDecision.storeId !== input.storeId) return fail('not_found', 404)
    if (existingDecision) return ok({ lot: currentLot, decision: existingDecision })
  }
  const decision = buildDecisionRow(
    null,
    {
      ...input,
      lotRevision: currentLot.revision ?? 0,
    },
    input.actor,
    'regrade_pending',
  )
  const nextLot = buildLotUpsertRow(currentLot, { status: 'regrade_pending' }, input.actor)
  await insertQcLotDecision(dc, decision)
  await upsertQcFinishedGoodsLot(dc, nextLot)
  return ok({ lot: nextLot, decision })
}

export async function rejectLot(input) {
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const permission = await requireActivePermission(input.actor.uid, input.storeId, 'canReject')
  if (!permission.ok) return permission
  if (!asNonEmptyString(input.reason)) return fail('invalid_input', 400)
  const dc = getQcDataConnect()
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  if (currentLot.storeId !== input.storeId) return fail('not_found', 404)
  if (input.idempotencyKey) {
    const existingDecision = await loadDecisionByIdempotency(dc, input.idempotencyKey)
    if (existingDecision && existingDecision.storeId !== input.storeId) return fail('not_found', 404)
    if (existingDecision) return ok({ lot: currentLot, decision: existingDecision })
  }
  const decision = buildDecisionRow(
    null,
    {
      ...input,
      lotRevision: currentLot.revision ?? 0,
    },
    input.actor,
    'rejected',
  )
  const nextLot = buildLotUpsertRow(currentLot, { status: 'rejected' }, input.actor)
  await insertQcLotDecision(dc, decision)
  await upsertQcFinishedGoodsLot(dc, nextLot)
  return ok({ lot: nextLot, decision })
}

async function listVerifiedAttachments(dc, storeId, lotId) {
  const { data } = await listVerifiedLotAttachments(dc, { storeId, lotId })
  const rows = data?.qcAttachmentRecords ?? []
  return {
    passport: rows.find((row) => row.documentKind === 'passport') ?? null,
    protocol: rows.find((row) => row.documentKind === 'protocol') ?? null,
  }
}

async function loadLatestDecision(dc, storeId, lotId) {
  const { data } = await getLatestQcLotDecision(dc, { storeId, lotId })
  return data?.qcLotDecisions?.[0] ?? null
}

export async function authorizeShipment(input) {
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const permission = await requireActivePermission(input.actor.uid, input.storeId, 'canPostShipment')
  if (!permission.ok) return permission
  const dc = getQcDataConnect()
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  if (currentLot.storeId !== input.storeId) return fail('not_found', 404)
  // Authoritative release = QcLotDecision from server SQL (ignore forged payload qcStatus).
  const latestDecision = await loadLatestDecision(dc, input.storeId, input.lotId)
  if (!latestDecision || latestDecision.status !== 'released') {
    return fail('not_released', 400)
  }
  if (input.finishedProductId && currentLot.finishedProductId !== input.finishedProductId) {
    return fail('lot_item_mismatch', 400)
  }
  if (input.warehouseItemId && currentLot.warehouseItemId !== input.warehouseItemId) {
    return fail('lot_item_mismatch', 400)
  }
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return fail('invalid_quantity', 400)
  const remaining = Math.max(
    0,
    (currentLot.quantityProduced ?? 0) - Math.max(0, currentLot.quantityShipped ?? 0),
  )
  if (qty > remaining) return fail('quantity_exceeds_remaining', 400)
  return ok({ lot: currentLot, decision: latestDecision, quantity: qty })
}

export async function applyShipment(input) {
  const dc = getQcDataConnect()
  const qty = Number(input.quantity)
  if (input.idempotencyKey) {
    const existingDecision = await loadDecisionByIdempotency(dc, input.idempotencyKey)
    if (existingDecision && existingDecision.storeId !== input.storeId) return fail('not_found', 404)
    if (existingDecision) {
      const currentLot = await loadLot(dc, input.lotId)
      if (!currentLot) return fail('not_found', 404)
      return ok({ lot: currentLot, decision: existingDecision, quantity: qty })
    }
  }
  const authorization = await authorizeShipment(input)
  if (!authorization.ok) return authorization
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  const decision = buildDecisionRow(
    null,
    {
      ...input,
      lotRevision: currentLot.revision ?? 0,
      reason: input.reason ?? null,
    },
    input.actor,
    'shipment_applied',
  )
  const nextQuantityShipped = Math.min(
    currentLot.quantityProduced ?? 0,
    (currentLot.quantityShipped ?? 0) + qty,
  )
  const nextLot = buildLotUpsertRow(currentLot, { quantityShipped: nextQuantityShipped }, input.actor)
  await insertQcLotDecision(dc, decision)
  await upsertQcFinishedGoodsLot(dc, nextLot)
  return ok({ lot: nextLot, decision, quantity: qty })
}

export async function cancelShipment(input) {
  const gate = await rejectIfPackagingQcAuthoritative(input.storeId)
  if (!gate.ok) return gate
  const permission = await requireActivePermission(input.actor.uid, input.storeId, 'canPostShipment')
  if (!permission.ok) return permission
  const dc = getQcDataConnect()
  const currentLot = await loadLot(dc, input.lotId)
  if (!currentLot) return fail('not_found', 404)
  if (currentLot.storeId !== input.storeId) return fail('not_found', 404)
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return fail('invalid_quantity', 400)
  const shipped = Math.max(0, currentLot.quantityShipped ?? 0)
  if (qty > shipped) return fail('quantity_exceeds_shipped', 400)
  if (input.idempotencyKey) {
    const existingDecision = await loadDecisionByIdempotency(dc, input.idempotencyKey)
    if (existingDecision && existingDecision.storeId !== input.storeId) return fail('not_found', 404)
    if (existingDecision) return ok({ lot: currentLot, decision: existingDecision })
  }
  const decision = buildDecisionRow(
    null,
    {
      ...input,
      lotRevision: currentLot.revision ?? 0,
      reason: input.reason ?? null,
    },
    input.actor,
    'shipment_cancelled',
  )
  const nextLot = buildLotUpsertRow(currentLot, { quantityShipped: shipped - qty }, input.actor)
  await insertQcLotDecision(dc, decision)
  await upsertQcFinishedGoodsLot(dc, nextLot)
  return ok({ lot: nextLot, decision, quantity: qty })
}
