import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'

export type QcServerError =
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'invalid_input'
  | 'server'

export type QcServerResult<T> = { ok: true; data: T } | { ok: false; error: QcServerError; message: string }

async function bearerToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

function fail(error: QcServerError, message: string): QcServerResult<never> {
  return { ok: false, error, message }
}

async function qcFetch<T>(path: string, body: Record<string, unknown>): Promise<QcServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return fail('not_configured', 'QC-сервер не настроен в этом окружении')
  }
  const token = await bearerToken()
  if (!token) {
    return fail('unauthorized', 'Нужно войти в Firebase для QC-операции')
  }

  try {
    const res = await fetch(fstApiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const contentType = res.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json')
      ? ((await res.json().catch(() => null)) as { error?: string; message?: string } | null)
      : null

    if (res.ok && payload && payload.error === undefined) {
      return { ok: true, data: payload as T }
    }

    if (res.status === 401) return fail('unauthorized', 'QC-сервер отклонил токен')
    if (res.status === 403) return fail('forbidden', 'Нет прав для QC-операции')
    if (!payload) return fail('network', 'QC-сервер недоступен или вернул не-JSON ответ')
    return fail('server', payload.message || payload.error || 'QC-сервер вернул ошибку')
  } catch {
    return fail('network', 'QC-сервер недоступен')
  }
}

export async function qcSelfPermission(storeId: string): Promise<QcServerResult<{ permission: unknown | null }>> {
  return qcFetch('/api/fst/qc-permissions-self', { storeId })
}

export async function qcGrantPermission(input: {
  firebaseUid: string
  storeId: string
  flags?: Record<string, boolean>
}): Promise<QcServerResult<{ permission: unknown }>> {
  return qcFetch('/api/fst/qc-permissions-admin', {
    action: 'grant',
    firebaseUid: input.firebaseUid,
    storeId: input.storeId,
    flags: input.flags ?? {},
  })
}

export async function qcRevokePermission(input: {
  firebaseUid: string
  storeId: string
  reason: string
}): Promise<QcServerResult<{ permission: unknown }>> {
  return qcFetch('/api/fst/qc-permissions-admin', {
    action: 'revoke',
    firebaseUid: input.firebaseUid,
    storeId: input.storeId,
    reason: input.reason,
  })
}

export async function qcUploadInitiate(input: {
  storeId: string
  lotId: string
  documentKind: string
  contentType: string
  sizeBytes: number
  checksum: string
  attachmentId?: string
  storagePath?: string
  idempotencyKey?: string
}): Promise<QcServerResult<{ attachment: unknown; upload?: QcUploadSession | null }>> {
  return qcFetch('/api/fst/qc-upload-initiate', input)
}

export type QcUploadSession = {
  method: string
  uploadUrl: string
  storagePath: string
  contentType: string
  expiresAt: string
  headers?: Record<string, string>
  maxBytes?: number
}

/** Obtain short-lived Storage write session (no binary through Vercel). */
export async function qcUploadSession(input: {
  storeId: string
  attachmentId: string
}): Promise<QcServerResult<{ upload?: QcUploadSession; alreadyVerified?: boolean }>> {
  return qcFetch('/api/fst/qc-upload-put', input)
}

export async function qcUploadFinalize(input: {
  storeId: string
  lotId?: string
  attachmentId?: string
  idempotencyKey?: string
}): Promise<QcServerResult<{ attachment: unknown }>> {
  return qcFetch('/api/fst/qc-upload-finalize', input)
}

export async function qcReleaseLot(input: {
  storeId: string
  lotId: string
  idempotencyKey?: string
}): Promise<QcServerResult<{ lot: unknown; decision?: { id?: string; revision?: number; decidedByUid?: string; decidedAt?: string } }>> {
  return qcFetch('/api/fst/qc-release', input)
}

export async function qcRegradeLot(input: {
  storeId: string
  lotId: string
  reason: string
  targetFinishedProductId?: string
  idempotencyKey?: string
}): Promise<QcServerResult<{ lot: unknown }>> {
  return qcFetch('/api/fst/qc-regrade', input)
}

export async function qcRejectLot(input: {
  storeId: string
  lotId: string
  reason: string
  idempotencyKey?: string
}): Promise<QcServerResult<{ lot: unknown }>> {
  return qcFetch('/api/fst/qc-reject', input)
}

export async function qcShipment(input: {
  storeId: string
  lotId: string
  quantity: number
  idempotencyKey?: string
}): Promise<QcServerResult<{ lot: unknown }>> {
  return qcFetch('/api/fst/qc-shipment', input)
}

export async function qcShipmentCancel(input: {
  storeId: string
  lotId: string
  quantity: number
  idempotencyKey?: string
}): Promise<QcServerResult<{ lot: unknown }>> {
  return qcFetch('/api/fst/qc-shipment-cancel', input)
}

export async function qcUpsertLotProjection(input: {
  id: string
  storeId: string
  finishedProductId: string
  warehouseItemId: string
  batchNo: string
  quantityProduced: number
  quantityShipped?: number
  packagingReportId: string
  status?: string
}): Promise<QcServerResult<{ lot: unknown }>> {
  return qcFetch('/api/fst/qc-lot-upsert', {
    ...input,
    storeId: input.storeId || FST_SHARED_STORE_DOC_ID,
  })
}
