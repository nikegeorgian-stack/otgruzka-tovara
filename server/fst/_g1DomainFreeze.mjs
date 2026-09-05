/**
 * PHASE R1 — freeze/resume for critical domains (warehouse, production, packagingQc,
 * masterData, salesPlanning, procurement, capacityPlanning).
 *
 * Typed commands only; CAS preserves sibling domain operatingMode; forged payload rejected.
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
  CRITICAL_DOMAIN_FREEZE_CAP,
  DOMAIN_FREEZE_KEYS,
  applyDomainFreeze,
  applyDomainResume,
  emptyCapacityStore,
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

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function str(v) {
  return String(v ?? '').trim()
}

function isAdminEmail(actor) {
  const email = String(actor?.email ?? '')
    .trim()
    .toLowerCase()
  return Boolean(actor?.claims?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

/**
 * commandType → { key, action: 'freeze'|'resume' }
 */
export const DOMAIN_FREEZE_COMMANDS = Object.freeze({
  'warehouse.domain.freeze': { key: 'warehouse', action: 'freeze' },
  'warehouse.domain.resume': { key: 'warehouse', action: 'resume' },
  'production.domain.freeze': { key: 'production', action: 'freeze' },
  'production.domain.resume': { key: 'production', action: 'resume' },
  'packaging.domain.freeze': { key: 'packagingQc', action: 'freeze' },
  'packaging.domain.resume': { key: 'packagingQc', action: 'resume' },
  'masterdata.domain.freeze': { key: 'masterData', action: 'freeze' },
  'masterdata.domain.resume': { key: 'masterData', action: 'resume' },
  'sales.domain.freeze': { key: 'salesPlanning', action: 'freeze' },
  'sales.domain.resume': { key: 'salesPlanning', action: 'resume' },
  'procurement.domain.freeze': { key: 'procurement', action: 'freeze' },
  'procurement.domain.resume': { key: 'procurement', action: 'resume' },
  'capacity.domain.freeze': { key: 'capacityPlanning', action: 'freeze' },
  'capacity.domain.resume': { key: 'capacityPlanning', action: 'resume' },
})

/**
 * Pure local apply (no I/O) for unit tests.
 */
export function applyDomainFreezeCommandLocal(
  payload,
  commandType,
  command = {},
  actor = {},
  now = new Date().toISOString(),
) {
  const entry = DOMAIN_FREEZE_COMMANDS[commandType]
  if (!entry || !DOMAIN_FREEZE_KEYS.includes(entry.key)) {
    return fail('unknown_command', 400)
  }
  const reason = str(command.reason)
  if (!reason) return fail('reason_required', 400)

  const applied =
    entry.action === 'freeze'
      ? applyDomainFreeze(payload, entry.key, { actorUid: actor.uid, reason, now })
      : applyDomainResume(payload, entry.key, { actorUid: actor.uid, reason, now })

  if (!applied.ok) return applied

  return ok({
    payload: applied.payload,
    domainKey: applied.domainKey,
    operatingMode: applied.operatingMode,
    frozen: applied.frozen === true,
    resumed: applied.resumed === true,
    idempotent: applied.idempotent === true,
    reason,
    result: {
      domainKey: applied.domainKey,
      operatingMode: applied.operatingMode,
      frozen: applied.frozen === true,
      resumed: applied.resumed === true,
      idempotent: applied.idempotent === true,
      reason,
    },
  })
}

async function loadCritical(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  if (!row) {
    return { revision: 0, payload: emptyCriticalPayload(), exists: false }
  }
  const parsed = parseCriticalPayload(row.payloadJson, { revision: row.revision })
  if (!parsed.ok) throw new Error(parsed.error || 'invalid_critical_payload')
  return { revision: Number(row.revision) || 0, payload: parsed.payload, exists: true }
}

async function resolveFreezeAccess(dc, actor, storeId) {
  if (isAdminEmail(actor)) {
    return { ok: true, via: 'sysadmin' }
  }
  const { data } = await getFstPrincipalAccessByUidStore(dc, {
    firebaseUid: actor.uid,
    storeId,
  })
  const row = data?.fstPrincipalAccesses?.[0] ?? null
  if (!row || row.active !== true) {
    return fail('principal_access_missing', 403)
  }
  const caps = parseCapabilities(row.capabilitiesJson)
  if (caps[CRITICAL_DOMAIN_FREEZE_CAP] !== true) {
    return fail('capability_denied', 403, { capability: CRITICAL_DOMAIN_FREEZE_CAP })
  }
  return { ok: true, via: 'principal', accessId: principalAccessId(storeId, actor.uid), row }
}

async function casCommitFreeze(dc, storeId, critical, nextPayload, actorUid, {
  idempotencyKey,
  commandType,
  result,
}) {
  const prev = critical.payload.domains ?? {}
  let payload = {
    ...nextPayload,
    schemaVersion: Math.max(Number(nextPayload.schemaVersion) || 0, Number(critical.payload.schemaVersion) || 0),
    domains: {
      ...prev,
      warehouse: nextPayload.domains?.warehouse ?? prev.warehouse,
      production: nextPayload.domains?.production ?? prev.production,
      masterData: nextPayload.domains?.masterData ?? prev.masterData,
      sales: nextPayload.domains?.sales ?? prev.sales,
      planning: nextPayload.domains?.planning ?? prev.planning,
      procurement: nextPayload.domains?.procurement ?? prev.procurement,
      capacity: nextPayload.domains?.capacity ?? prev.capacity ?? emptyCapacityStore(),
    },
    // domainMeta comes from apply — only target slice changed
    domainMeta: nextPayload.domainMeta,
  }

  const nextRevision = critical.revision + 1
  if (idempotencyKey && result) {
    payload = {
      ...payload,
      commandReceipts: {
        ...(payload.commandReceipts ?? {}),
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

  const nextJson = serializeCriticalPayload(payload)
  try {
    if (!critical.exists && critical.revision === 0) {
      await upsertFstCriticalStore(dc, {
        id: storeId,
        revision: nextRevision,
        payloadJson: nextJson,
        fingerprint: fingerprintCriticalPayload(nextJson),
        updatedByUid: actorUid,
      })
    } else {
      await updateFstCriticalStoreCas(dc, {
        id: storeId,
        expectedRevision: critical.revision,
        revision: nextRevision,
        payloadJson: nextJson,
        fingerprint: fingerprintCriticalPayload(nextJson),
        updatedByUid: actorUid,
      })
    }
  } catch (err) {
    const msg = String(err?.message ?? err ?? '')
    if (msg.includes('revision_conflict') || msg.includes('FAILED_PRECONDITION')) {
      return fail('revision_conflict', 409)
    }
    throw err
  }

  return ok({ criticalRevision: nextRevision, payload })
}

/**
 * Server execute: auth, reason, CAS, embedded + table receipts.
 */
export async function executeDomainFreezeCommand(input) {
  const {
    actor,
    storeId: rawStoreId,
    idempotencyKey: rawKey,
    commandType,
    command = {},
    payloadJson,
    warehousePatch,
    fullStore,
    roleId,
  } = input ?? {}

  if (!actor?.uid) return fail('unauthorized', 401)
  if (payloadJson != null || warehousePatch != null || fullStore != null) {
    return fail('forged_client_payload_rejected', 400)
  }
  if (roleId != null) {
    return fail('client_role_not_proof', 403)
  }

  const storeId = str(rawStoreId) || 'default'
  const idempotencyKey = str(rawKey)
  if (!commandType || !DOMAIN_FREEZE_COMMANDS[commandType]) {
    return fail('unknown_command', 400)
  }
  if (!idempotencyKey) return fail('idempotency_key_required', 400)

  const reason = str(command?.reason)
  if (!reason) return fail('reason_required', 400)

  const dc = getG1DataConnect()

  const { data: receiptData } = await getFstCommandReceipt(dc, { id: idempotencyKey })
  const existingReceipt = receiptData?.fstCommandReceipt
  if (existingReceipt?.resultJson && existingReceipt.storeId === storeId) {
    try {
      const prev = JSON.parse(existingReceipt.resultJson)
      return ok({ ...prev, idempotent: true })
    } catch {
      /* continue */
    }
  }

  const critical0 = await loadCritical(dc, storeId)
  const embedded = critical0.payload.commandReceipts?.[idempotencyKey]
  if (embedded?.result) {
    return ok({ ...embedded.result, idempotent: true, recoveredFromEmbeddedReceipt: true })
  }

  const access = await resolveFreezeAccess(dc, actor, storeId)
  if (!access.ok) return access

  // Sysadmin emergency always OK with non-empty reason (already validated).
  // Principal path already checked critical.domain.freeze.

  const now = new Date().toISOString()
  const applied = applyDomainFreezeCommandLocal(
    critical0.payload,
    commandType,
    { reason },
    actor,
    now,
  )
  if (!applied.ok) return applied

  // Idempotent no-op: still return success without CAS when nothing changed
  if (applied.idempotent === true) {
    const response = {
      ...applied.result,
      criticalRevision: critical0.revision,
      domainMeta: critical0.payload.domainMeta,
      idempotent: true,
    }
    return ok(response)
  }

  const committed = await casCommitFreeze(dc, storeId, critical0, applied.payload, actor.uid, {
    idempotencyKey,
    commandType,
    result: applied.result,
  })
  if (!committed.ok) return committed

  const response = {
    ...applied.result,
    criticalRevision: committed.criticalRevision,
    domainMeta: committed.payload.domainMeta,
    operatingMode: applied.operatingMode,
    domainKey: applied.domainKey,
  }

  try {
    await insertFstCommandReceipt(dc, {
      id: idempotencyKey,
      storeId,
      commandType,
      actorUid: actor.uid,
      resultJson: JSON.stringify(response),
      criticalRevisionAfter: committed.criticalRevision,
    })
  } catch {
    // embedded receipt already CAS'd
  }

  return ok(response)
}

export { CRITICAL_DOMAIN_FREEZE_CAP, DOMAIN_FREEZE_KEYS, isAdminEmail }
