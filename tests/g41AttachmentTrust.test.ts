/**
 * PHASE G4.1 — QC attachment trust boundary.
 *
 * `QcAttachmentRecord` is only trustworthy because every field is re-derived from
 * the Storage object metadata: canonical path, MIME, size, checksum and object
 * generation. The uploader's word is never taken for any of them, and once
 * packagingQc is active the upload right comes from FstPrincipalAccess only.
 *
 * `_qcStorage.mjs` runs for real here (memory adapter) so the size / MIME /
 * checksum / generation checks are the production ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORE = 'fibercell-main'
const OTHER_STORE = 'other-store'
const LOT = 'lot-1'
const UID = 'user-1'

// ---------------------------------------------------------------------------
// In-memory G1 (critical store + principals)
// ---------------------------------------------------------------------------

const g1State = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as null | Record<string, unknown>,
}

const g1 = {
  getPrincipal: vi.fn(async () => ({ data: { fstPrincipalAccesses: [] as unknown[] } })),
  getCritical: vi.fn(async () => ({ data: { fstCriticalStore: null as unknown } })),
  upsertPrincipal: vi.fn(async () => undefined),
}

vi.mock('../api/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ g1Mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => g1.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => g1.getCritical(...args),
  getFstCommandReceipt: vi.fn(async () => ({ data: { fstCommandReceipt: null } })),
  upsertFstCriticalStore: vi.fn(async () => undefined),
  updateFstCriticalStoreCas: vi.fn(async () => undefined),
  insertFstCommandReceipt: vi.fn(async () => undefined),
  upsertFstPrincipalAccess: (...args: unknown[]) => g1.upsertPrincipal(...args),
}))

vi.mock('../api/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

// ---------------------------------------------------------------------------
// In-memory QC read model
// ---------------------------------------------------------------------------

type AttachmentRow = Record<string, unknown> & { id: string; revision: number }

const qcState = {
  permissions: new Map<string, Record<string, unknown>>(),
  attachments: new Map<string, AttachmentRow>(),
  byIdempotency: new Map<string, string>(),
}

const qc = {
  insertAttachment: vi.fn(async (row: AttachmentRow) => {
    qcState.attachments.set(row.id, { ...row })
    const key = String(row.idempotencyKey ?? '')
    if (key) qcState.byIdempotency.set(key, row.id)
  }),
  updateAttachment: vi.fn(async (vars: Record<string, unknown>) => {
    const current = qcState.attachments.get(String(vars.id))
    if (!current) throw new Error('not_found')
    if (Number(current.revision ?? 0) !== Number(vars.expectedRevision)) {
      throw new Error('revision_conflict')
    }
    qcState.attachments.set(String(vars.id), {
      ...current,
      status: String(vars.status),
      objectGeneration: vars.objectGeneration ?? null,
      verifiedAt: vars.verifiedAt,
      revision: Number(vars.revision),
    })
  }),
}

vi.mock('../api/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({ qcMocked: true })),
  getQcPermissionByUidStore: async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => ({
    data: {
      qcPermissions: [qcState.permissions.get(`${vars.storeId}::${vars.firebaseUid}`)].filter(Boolean),
    },
  }),
  upsertQcPermission: async () => undefined,
  getQcAttachmentRecord: async (_dc: unknown, vars: { id: string }) => ({
    data: { qcAttachmentRecord: qcState.attachments.get(vars.id) ?? null },
  }),
  getQcAttachmentByIdempotency: async (_dc: unknown, vars: { idempotencyKey: string }) => {
    const id = qcState.byIdempotency.get(String(vars.idempotencyKey))
    const row = id ? qcState.attachments.get(id) : null
    return { data: { qcAttachmentRecords: row ? [row] : [] } }
  },
  insertQcAttachmentRecord: async (_dc: unknown, row: AttachmentRow) => qc.insertAttachment(row),
  updateQcAttachmentRecord: async (_dc: unknown, vars: Record<string, unknown>) =>
    qc.updateAttachment(vars),
  getQcFinishedGoodsLot: async () => ({ data: { qcFinishedGoodsLot: null } }),
  upsertQcFinishedGoodsLot: async () => undefined,
  insertQcLotDecision: async () => undefined,
  getQcLotDecisionByIdempotency: async () => ({ data: { qcLotDecisions: [] } }),
  getLatestQcLotDecision: async () => ({ data: { qcLotDecisions: [] } }),
  listVerifiedLotAttachments: async () => ({ data: { qcAttachmentRecords: [] } }),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const actor = { uid: UID, email: 'qc@example.com', claims: {} }

beforeEach(() => {
  for (const fn of Object.values(g1)) fn.mockClear()
  for (const fn of Object.values(qc)) fn.mockClear()
  g1State.principals.clear()
  g1State.critical = null
  qcState.permissions.clear()
  qcState.attachments.clear()
  qcState.byIdempotency.clear()
  process.env.QC_STORAGE_ADAPTER = 'memory'
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  g1.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const row = g1State.principals.get(`${vars.storeId}::${vars.firebaseUid}`)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  g1.getCritical.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCriticalStore: vars.id === STORE ? g1State.critical : null },
  }))
})

afterEach(() => {
  delete process.env.QC_STORAGE_ADAPTER
  vi.resetModules()
})

function setPrincipal(caps: Record<string, unknown>, { active = true } = {}) {
  const id = `${STORE}::${UID}`
  g1State.principals.set(id, {
    id,
    firebaseUid: UID,
    storeId: STORE,
    roleId: 'qc',
    capabilitiesJson: JSON.stringify(caps),
    active,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

function setQcPermission(flags: Record<string, boolean>) {
  const id = `${STORE}::${UID}`
  qcState.permissions.set(id, {
    id,
    firebaseUid: UID,
    storeId: STORE,
    active: true,
    canView: true,
    canUpload: false,
    canRelease: false,
    canRegrade: false,
    canReject: false,
    canPostShipment: false,
    revision: 1,
    ...flags,
  })
}

async function seedCritical({ packagingQc }: { packagingQc: boolean }) {
  const h = await import('../api/fst/_g1CriticalHelpers.mjs')
  let p = h.emptyCriticalPayload()
  p = h.markWarehouseDomainActive(p, 'sys')
  p = h.markProductionDomainActive(p, 'sys')
  if (packagingQc) p = h.markPackagingQcFeatureActive(p, 'sys')
  const json = h.serializeCriticalPayload(p)
  g1State.critical = {
    id: STORE,
    payloadJson: json,
    fingerprint: h.fingerprintCriticalPayload(json),
    revision: 4,
    updatedByUid: 'sys',
  }
}

type Loaded = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: any
}

/** Imports service + the real storage module so they share one memory adapter. */
async function load(): Promise<Loaded> {
  const storage = await import('../api/fst/_qcStorage.mjs')
  const service = await import('../api/fst/_qcService.mjs')
  return { service, storage }
}

const PASSPORT = {
  storeId: STORE,
  lotId: LOT,
  documentKind: 'passport' as const,
  contentType: 'application/pdf',
  sizeBytes: 2048,
  checksum: 'sum-passport',
}

// ---------------------------------------------------------------------------
// initiateAttachment
// ---------------------------------------------------------------------------

describe('G4.1 initiateAttachment input gates', () => {
  it('refuses a size above the 10MiB attachment cap', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage } = await load()
    expect(storage.QC_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024)

    const tooBig = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      attachmentId: 'att-big',
      sizeBytes: storage.QC_ATTACHMENT_MAX_BYTES + 1,
    })
    expect(tooBig.ok).toBe(false)
    expect(tooBig.error).toBe('invalid_size')

    for (const sizeBytes of [0, -1, 'many', null]) {
      const bad = await service.initiateAttachment({
        actor,
        ...PASSPORT,
        attachmentId: 'att-bad-size',
        sizeBytes,
      })
      expect(bad.ok, String(sizeBytes)).toBe(false)
      expect(bad.error, String(sizeBytes)).toBe('invalid_size')
    }
    expect(qc.insertAttachment).not.toHaveBeenCalled()
  })

  it('refuses a MIME type that is not allowed for the document kind', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service } = await load()

    for (const contentType of ['image/png', 'application/zip', 'text/html', '']) {
      const bad = await service.initiateAttachment({
        actor,
        ...PASSPORT,
        attachmentId: 'att-mime',
        contentType,
      })
      expect(bad.ok, contentType || '<empty>').toBe(false)
      expect(bad.error, contentType || '<empty>').toBe('invalid_mime')
    }

    // Mandatory kinds are PDF-only; `other` also accepts images.
    const image = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      documentKind: 'other',
      attachmentId: 'att-other',
      contentType: 'image/png',
    })
    expect(image.ok).toBe(true)
  })

  it('binds the signed session to the canonical store/lot/attachment path', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage } = await load()

    const init = await service.initiateAttachment({ actor, ...PASSPORT, attachmentId: 'att-1' })
    expect(init.ok).toBe(true)
    const expectedPath = storage.buildQcStoragePath(STORE, LOT, 'att-1')
    expect(init.attachment.storagePath).toBe(expectedPath)
    expect(init.upload.storagePath).toBe(expectedPath)
    const session = { ok: true, ...init.upload }
    expect(storage.assertSignedSessionPathBound(session, expectedPath, 'application/pdf').ok).toBe(true)
    expect(
      storage.assertSignedSessionPathBound(session, `${expectedPath}/x`, 'application/pdf').ok,
    ).toBe(false)
    expect(
      storage.assertSignedSessionPathBound(session, expectedPath, 'image/png').error,
    ).toBe('content_type_mismatch')
  })
})

// ---------------------------------------------------------------------------
// finalizeAttachment
// ---------------------------------------------------------------------------

describe('G4.1 finalizeAttachment verifies the Storage object', () => {
  async function initiated(overrides: Record<string, unknown> = {}) {
    const { service, storage } = await load()
    const init = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      attachmentId: 'att-1',
      idempotencyKey: 'qc-att-1',
      ...overrides,
    })
    expect(init.ok).toBe(true)
    return { service, storage, record: init.attachment }
  }

  it('denies finalize when no object was ever uploaded', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service } = await initiated()

    const denied = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('not_found')
    expect(qcState.attachments.get('att-1')!.status).toBe('initiated')
  })

  it('denies a cross-store, cross-lot or cross-path finalize', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage, record } = await initiated()
    storage.memoryPutObject(record.storagePath, {
      generation: '11',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
    })

    // Permissions are per-store, so a foreign storeId never even reaches the record.
    const wrongStore = await service.finalizeAttachment({
      actor,
      storeId: OTHER_STORE,
      attachmentId: 'att-1',
    })
    expect(wrongStore.ok).toBe(false)
    expect(wrongStore.status).toBe(403)

    // A record owned by another store is invisible to this store's finalize.
    qcState.attachments.set('att-foreign', {
      id: 'att-foreign',
      storeId: OTHER_STORE,
      lotId: LOT,
      documentKind: 'passport',
      storagePath: storage.buildQcStoragePath(OTHER_STORE, LOT, 'att-foreign'),
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
      status: 'initiated',
      revision: 1,
    })
    const foreignRecord = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      attachmentId: 'att-foreign',
    })
    expect(foreignRecord.ok).toBe(false)
    expect(foreignRecord.error).toBe('not_found')

    const wrongLot = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: 'lot-other',
      attachmentId: 'att-1',
    })
    expect(wrongLot.ok).toBe(false)
    expect(wrongLot.error).toBe('lot_mismatch')

    const wrongPath = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      storagePath: storage.buildQcStoragePath(STORE, LOT, 'att-elsewhere'),
    })
    expect(wrongPath.ok).toBe(false)
    expect(wrongPath.error).toBe('path_mismatch')

    expect(qc.updateAttachment).not.toHaveBeenCalled()
    expect(qcState.attachments.get('att-1')!.status).toBe('initiated')
  })

  it('denies a checksum or size that disagrees with the stored object', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage, record } = await initiated()

    storage.memoryPutObject(record.storagePath, {
      generation: '11',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: 'tampered-bytes',
    })
    const checksumMismatch = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
    })
    expect(checksumMismatch.ok).toBe(false)
    expect(checksumMismatch.error).toBe('checksum_mismatch')

    storage.memoryPutObject(record.storagePath, {
      generation: '12',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes + 1,
      checksum: PASSPORT.checksum,
    })
    const sizeMismatch = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
    })
    expect(sizeMismatch.ok).toBe(false)
    expect(sizeMismatch.error).toBe('size_mismatch')

    storage.memoryPutObject(record.storagePath, {
      generation: '13',
      contentType: 'application/zip',
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
    })
    const typeMismatch = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
    })
    expect(typeMismatch.ok).toBe(false)
    expect(typeMismatch.error).toBe('content_type_mismatch')

    expect(qcState.attachments.get('att-1')!.status).toBe('initiated')
  })

  it('denies a generation different from the one the client claims it uploaded', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage, record } = await initiated()
    storage.memoryPutObject(record.storagePath, {
      generation: '11',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
    })

    const mismatch = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      expectedGeneration: '99',
    })
    expect(mismatch.ok).toBe(false)
    expect(mismatch.error).toBe('generation_mismatch')
    expect(qcState.attachments.get('att-1')!.status).toBe('initiated')

    const matching = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      expectedGeneration: '11',
    })
    expect(matching.ok).toBe(true)
    expect(matching.attachment.status).toBe('verified')
    expect(matching.attachment.objectGeneration).toBe('11')
  })

  it('repeating finalize for the same generation is idempotent', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage, record } = await initiated()
    storage.memoryPutObject(record.storagePath, {
      generation: '11',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
    })

    const first = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      expectedGeneration: '11',
    })
    expect(first.ok).toBe(true)
    expect(qc.updateAttachment).toHaveBeenCalledTimes(1)
    const revisionAfterFirst = qcState.attachments.get('att-1')!.revision

    const second = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      expectedGeneration: '11',
    })
    expect(second.ok).toBe(true)
    expect(second.attachment.status).toBe('verified')
    expect(qc.updateAttachment).toHaveBeenCalledTimes(1)
    expect(qcState.attachments.get('att-1')!.revision).toBe(revisionAfterFirst)

    // Re-initiating with the same key returns the verified row without a new session.
    const reinit = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      attachmentId: 'att-1',
      idempotencyKey: 'qc-att-1',
    })
    expect(reinit.ok).toBe(true)
    expect(reinit.attachment.status).toBe('verified')
    expect(reinit.upload).toBeUndefined()
    expect(qc.insertAttachment).toHaveBeenCalledTimes(1)
  })

  it('accepts a redeemed signed session end to end', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canUpload: true })
    const { service, storage } = await load()

    const init = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      checksum: 'sum-e2e',
      attachmentId: 'att-e2e',
    })
    expect(init.ok).toBe(true)

    const redeemed = storage.redeemMemorySignedUpload({
      uploadUrl: init.upload.uploadUrl,
      bytes: Buffer.alloc(PASSPORT.sizeBytes),
      contentType: 'application/pdf',
      checksum: 'sum-e2e',
    })
    expect(redeemed.ok).toBe(true)

    const finalized = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-e2e',
      expectedGeneration: redeemed.generation,
    })
    expect(finalized.ok).toBe(true)
    expect(finalized.attachment.status).toBe('verified')
    expect(finalized.attachment.objectGeneration).toBe(String(redeemed.generation))
  })
})

// ---------------------------------------------------------------------------
// Upload right
// ---------------------------------------------------------------------------

describe('G4.1 upload right follows the single ACL', () => {
  it('a QcPermission-only uploader is denied once packagingQc is active', async () => {
    await seedCritical({ packagingQc: true })
    setQcPermission({ canUpload: true })
    const { service } = await load()

    const initDenied = await service.initiateAttachment({
      actor,
      ...PASSPORT,
      attachmentId: 'att-1',
    })
    expect(initDenied.ok).toBe(false)
    expect(initDenied.error).toBe('forbidden')
    expect(initDenied.status).toBe(403)

    const finalizeDenied = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
    })
    expect(finalizeDenied.ok).toBe(false)
    expect(finalizeDenied.status).toBe(403)
    expect(qc.insertAttachment).not.toHaveBeenCalled()
  })

  it('a principal with qc.attachment.upload is allowed while packagingQc is active', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.attachment.upload': true })
    const { service, storage } = await load()

    const init = await service.initiateAttachment({ actor, ...PASSPORT, attachmentId: 'att-1' })
    expect(init.ok).toBe(true)
    storage.memoryPutObject(init.attachment.storagePath, {
      generation: '21',
      contentType: PASSPORT.contentType,
      sizeBytes: PASSPORT.sizeBytes,
      checksum: PASSPORT.checksum,
    })

    const finalized = await service.finalizeAttachment({
      actor,
      storeId: STORE,
      lotId: LOT,
      attachmentId: 'att-1',
      expectedGeneration: '21',
    })
    expect(finalized.ok).toBe(true)
    expect(finalized.attachment.status).toBe('verified')
  })

  it('an inactive principal cannot upload even with the capability', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.attachment.upload': true }, { active: false })
    setQcPermission({ canUpload: true })
    const { service } = await load()

    const denied = await service.initiateAttachment({ actor, ...PASSPORT, attachmentId: 'att-1' })
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
  })

  it('an anonymous actor is rejected before any storage work', async () => {
    await seedCritical({ packagingQc: true })
    const { service } = await load()

    const init = await service.initiateAttachment({ actor: {}, ...PASSPORT, attachmentId: 'att-1' })
    expect(init.ok).toBe(false)
    expect(init.error).toBe('unauthorized')
    expect(init.status).toBe(401)

    const finalize = await service.finalizeAttachment({
      actor: {},
      storeId: STORE,
      attachmentId: 'att-1',
    })
    expect(finalize.ok).toBe(false)
    expect(finalize.error).toBe('unauthorized')
  })
})
