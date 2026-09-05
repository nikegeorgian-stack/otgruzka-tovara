/**
 * PHASE G4.1 — one authoritative ACL for packaging / QC.
 *
 * FstPrincipalAccess is canonical. Once
 * `domainMeta.production.features.packagingQc.active` is true the legacy
 * P1C.3 QcPermission table is a deprecated projection and must not grant
 * anything. AppStore `roleId` is never consulted at any point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const STORE = 'fibercell-main'
const UID = 'user-1'

// ---------------------------------------------------------------------------
// In-memory G1 Data Connect (critical store + principals + receipts)
// ---------------------------------------------------------------------------

const g1State = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as null | Record<string, unknown>,
  receipts: new Map<string, Record<string, unknown>>(),
}

const g1 = {
  getPrincipal: vi.fn(async () => ({ data: { fstPrincipalAccesses: [] as unknown[] } })),
  getCritical: vi.fn(async () => ({ data: { fstCriticalStore: null as unknown } })),
  getReceipt: vi.fn(async () => ({ data: { fstCommandReceipt: null as unknown } })),
  upsertCritical: vi.fn(async () => undefined),
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
  upsertPrincipal: vi.fn(async () => undefined),
}

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ g1Mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => g1.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => g1.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => g1.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => g1.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => g1.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => g1.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => g1.upsertPrincipal(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

// ---------------------------------------------------------------------------
// In-memory QC read model (legacy P1C.3 projections)
// ---------------------------------------------------------------------------

const qcState = {
  permissions: new Map<string, Record<string, unknown>>(),
  lots: new Map<string, Record<string, unknown>>(),
  decisions: [] as Record<string, unknown>[],
  attachments: [] as Record<string, unknown>[],
}

const qc = {
  getPermission: vi.fn(async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => ({
    data: {
      qcPermissions: [qcState.permissions.get(`${vars.storeId}::${vars.firebaseUid}`)].filter(
        Boolean,
      ),
    },
  })),
  upsertPermission: vi.fn(async (_dc: unknown, row: Record<string, unknown>) => {
    qcState.permissions.set(String(row.id), row)
  }),
  getLot: vi.fn(async (_dc: unknown, vars: { id: string }) => ({
    data: { qcFinishedGoodsLot: qcState.lots.get(vars.id) ?? null },
  })),
  upsertLot: vi.fn(async (_dc: unknown, row: Record<string, unknown>) => {
    qcState.lots.set(String(row.id), row)
  }),
  insertDecision: vi.fn(async (_dc: unknown, row: Record<string, unknown>) => {
    qcState.decisions.push(row)
  }),
}

vi.mock('../server/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({ qcMocked: true })),
  getQcPermissionByUidStore: (...args: unknown[]) => qc.getPermission(...args),
  upsertQcPermission: (...args: unknown[]) => qc.upsertPermission(...args),
  getQcFinishedGoodsLot: (...args: unknown[]) => qc.getLot(...args),
  upsertQcFinishedGoodsLot: (...args: unknown[]) => qc.upsertLot(...args),
  insertQcLotDecision: (...args: unknown[]) => qc.insertDecision(...args),
  getQcLotDecisionByIdempotency: async () => ({ data: { qcLotDecisions: [] } }),
  getLatestQcLotDecision: async () => ({ data: { qcLotDecisions: [] } }),
  getQcAttachmentByIdempotency: async () => ({ data: { qcAttachmentRecords: [] } }),
  getQcAttachmentRecord: async () => ({ data: { qcAttachmentRecord: null } }),
  listVerifiedLotAttachments: async () => ({ data: { qcAttachmentRecords: qcState.attachments } }),
  insertQcAttachmentRecord: async () => undefined,
  updateQcAttachmentRecord: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const actor = { uid: UID, email: 'qc@example.com', claims: {} }
const sysadminActor = { uid: UID, email: 'admin@fibercell.net', claims: {} }

const FG_ITEM = 'fg-item'
const FINISHED_PRODUCT = 'fp-1'

beforeEach(() => {
  for (const fn of Object.values(g1)) fn.mockClear()
  for (const fn of Object.values(qc)) fn.mockClear()
  g1State.principals.clear()
  g1State.critical = null
  g1State.receipts.clear()
  qcState.permissions.clear()
  qcState.lots.clear()
  qcState.decisions.length = 0
  qcState.attachments.length = 0
  process.env.QC_STORAGE_ADAPTER = 'memory'

  g1.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const row = g1State.principals.get(`${vars.storeId}::${vars.firebaseUid}`)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  g1.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: g1State.critical },
  }))
  g1.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: g1State.receipts.get(vars.id) ?? null },
  }))
  g1.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    g1State.critical = { ...row }
  })
  g1.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!g1State.critical) throw new Error('missing')
    if (g1State.critical.revision !== vars.expectedRevision) throw new Error('revision_conflict')
    g1State.critical = {
      ...g1State.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
      updatedByUid: vars.updatedByUid,
    }
  })
  g1.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (g1State.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    g1State.receipts.set(String(row.id), row)
  })
  g1.upsertPrincipal.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    g1State.principals.set(String(row.id), { ...row })
  })
})

afterEach(() => {
  delete process.env.QC_STORAGE_ADAPTER
  vi.resetModules()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(): any {
  return JSON.parse(String(g1State.critical!.payloadJson))
}

function setPrincipal(
  caps: Record<string, unknown>,
  { active = true, roleId = 'qc', uid = UID }: { active?: boolean; roleId?: string; uid?: string } = {},
) {
  const id = `${STORE}::${uid}`
  g1State.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId,
    capabilitiesJson: JSON.stringify(caps),
    active,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

function setQcPermission(flags: Record<string, boolean>, { active = true, uid = UID } = {}) {
  const id = `${STORE}::${uid}`
  qcState.permissions.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    active,
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

/**
 * Seeds FstCriticalStore directly (no G3/G4 bootstrap) so the ACL branch under
 * test is the only thing that varies.
 */
async function seedCritical({
  packagingQc,
  lots = [],
  qcDecisions = [],
}: {
  packagingQc: boolean
  lots?: Record<string, unknown>[]
  qcDecisions?: Record<string, unknown>[]
}) {
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = h.emptyCriticalPayload()
  p = h.markWarehouseDomainActive(p, 'sys')
  p = h.markProductionDomainActive(p, 'sys')
  if (packagingQc) p = h.markPackagingQcFeatureActive(p, 'sys')
  p.domains.production.finishedGoodsLots = lots
  p.domains.production.qcDecisions = qcDecisions
  const json = h.serializeCriticalPayload(p)
  g1State.critical = {
    id: STORE,
    payloadJson: json,
    fingerprint: h.fingerprintCriticalPayload(json),
    revision: 7,
    updatedByUid: 'sys',
  }
}

function pendingLot(id = 'fgl-1') {
  return {
    id,
    lotNumber: 'LOT-20260904-001',
    packagingReportId: 'pkr-1',
    productionOrderId: 'ord-1',
    lineId: 'pack',
    finishedProductId: FINISHED_PRODUCT,
    warehouseItemId: FG_ITEM,
    warehouseId: 'pack-wh',
    locationId: 'fg-loc',
    qcStatus: 'pending',
    quantityProduced: 100,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    lotRevision: 1,
    currentDecisionId: null,
  }
}

// ---------------------------------------------------------------------------
// requireActivePermission — packagingQc active
// ---------------------------------------------------------------------------

describe('G4.1 requireActivePermission with packagingQc active', () => {
  it('revoked/inactive principal is not rescued by a QcPermission canRelease=true row', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.release': true }, { active: false })
    setQcPermission({ canRelease: true })

    const service = await import('../server/fst/_qcService.mjs')
    const denied = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('forbidden')
    expect(denied.status).toBe(403)
    // The deprecated projection is not even queried once the feature is active.
    expect(qc.getPermission).not.toHaveBeenCalled()
  })

  it('no principal row at all + QcPermission canRelease=true → denied', async () => {
    await seedCritical({ packagingQc: true })
    setQcPermission({ canRelease: true, canPostShipment: true, canUpload: true })

    const service = await import('../server/fst/_qcService.mjs')
    for (const flag of ['canRelease', 'canPostShipment', 'canUpload'] as const) {
      const denied = await service.requireActivePermission(UID, STORE, flag)
      expect(denied.ok).toBe(false)
      expect(denied.status).toBe(403)
    }
    expect(qc.getPermission).not.toHaveBeenCalled()
  })

  it('principal qc.release=true is enough even with QcPermission canRelease=false', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.release': true })
    setQcPermission({ canRelease: false })

    const service = await import('../server/fst/_qcService.mjs')
    const allowed = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(allowed.ok).toBe(true)
    expect(allowed.source).toBe('fst_principal_access')
    expect(allowed.packagingQcActive).toBe(true)
    expect(allowed.permission?.canRelease).toBe(true)

    // Capabilities are per-flag: qc.regrade was never granted.
    const otherFlag = await service.requireActivePermission(UID, STORE, 'canRegrade')
    expect(otherFlag.ok).toBe(false)
    expect(otherFlag.status).toBe(403)
  })

  it('an unmapped flag can never be satisfied', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.release': true, canSomethingElse: true })

    const service = await import('../server/fst/_qcService.mjs')
    const denied = await service.requireActivePermission(UID, STORE, 'canSomethingElse')
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// requireActivePermission — legacy mode
// ---------------------------------------------------------------------------

describe('G4.1 requireActivePermission with packagingQc inactive', () => {
  it('legacy QcPermission still grants while the feature is off', async () => {
    await seedCritical({ packagingQc: false })
    setQcPermission({ canRelease: true })

    const service = await import('../server/fst/_qcService.mjs')
    const allowed = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(allowed.ok).toBe(true)
    expect(allowed.source).toBe('qc_permission_legacy')
    expect(allowed.packagingQcActive).toBe(false)
    expect(qc.getPermission).toHaveBeenCalled()
  })

  it('a principal capability also grants while the feature is off', async () => {
    await seedCritical({ packagingQc: false })
    setPrincipal({ 'shipment.post': true })

    const service = await import('../server/fst/_qcService.mjs')
    const allowed = await service.requireActivePermission(UID, STORE, 'canPostShipment')
    expect(allowed.ok).toBe(true)
    expect(allowed.source).toBe('fst_principal_access')
    expect(allowed.packagingQcActive).toBe(false)
  })

  it('missing critical store fails soft into legacy mode', async () => {
    g1State.critical = null
    setQcPermission({ canRelease: true })

    const service = await import('../server/fst/_qcService.mjs')
    expect(await service.isPackagingQcActiveForStore(STORE)).toBe(false)
    const allowed = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(allowed.ok).toBe(true)
    expect(allowed.source).toBe('qc_permission_legacy')
  })
})

// ---------------------------------------------------------------------------
// Legacy P1C.3 mutations are closed once G4 owns the truth
// ---------------------------------------------------------------------------

describe('G4.1 legacy QC endpoints redirect to the G4 gateway', () => {
  it('releaseLot returns use_g4_gateway even with a full QcPermission row', async () => {
    await seedCritical({ packagingQc: true, lots: [pendingLot()] })
    setQcPermission({ canRelease: true, canRegrade: true, canReject: true, canPostShipment: true })
    qcState.lots.set('fgl-1', {
      id: 'fgl-1',
      storeId: STORE,
      status: 'pending',
      revision: 1,
      quantityProduced: 100,
      quantityShipped: 0,
    })

    const service = await import('../server/fst/_qcService.mjs')
    const released = await service.releaseLot({ actor, storeId: STORE, lotId: 'fgl-1' })
    expect(released.ok).toBe(false)
    expect(released.error).toBe('use_g4_gateway')
    expect(released.status).toBe(409)
    expect(qc.insertDecision).not.toHaveBeenCalled()
    expect(qc.upsertLot).not.toHaveBeenCalled()
  })

  it('every mutating P1C.3 entry point is gated', async () => {
    await seedCritical({ packagingQc: true, lots: [pendingLot()] })
    setQcPermission({ canRelease: true, canRegrade: true, canReject: true, canPostShipment: true })
    setPrincipal({
      'qc.release': true,
      'qc.regrade': true,
      'qc.reject': true,
      'shipment.post': true,
    })

    const service = await import('../server/fst/_qcService.mjs')
    const base = { actor, storeId: STORE, lotId: 'fgl-1', reason: 'x', quantity: 1 }
    const calls: Array<[string, Promise<{ ok: boolean; error?: string; status?: number }>]> = [
      ['releaseLot', service.releaseLot(base)],
      ['regradeLot', service.regradeLot(base)],
      ['rejectLot', service.rejectLot(base)],
      ['authorizeShipment', service.authorizeShipment(base)],
      ['cancelShipment', service.cancelShipment(base)],
      [
        'upsertLotProjection',
        service.upsertLotProjection({ ...base, id: 'fgl-1', status: 'released' }),
      ],
    ]
    for (const [name, promise] of calls) {
      const result = await promise
      expect(result.ok, name).toBe(false)
      expect(result.error, name).toBe('use_g4_gateway')
      expect(result.status, name).toBe(409)
    }
  })
})

// ---------------------------------------------------------------------------
// G4 gateway: sysadmin email is not a capability
// ---------------------------------------------------------------------------

describe('G4.1 G4 gateway capability check', () => {
  it('a sysadmin email without qc.release cannot release through executeG4Command', async () => {
    await seedCritical({ packagingQc: true, lots: [pendingLot()] })
    setPrincipal({ 'packaging.read': true, 'qc.review': true, productionLineIds: ['*'] })

    const g4 = await import('../server/fst/_g4PackagingService.mjs')
    const denied = await g4.executeG4Command({
      actor: sysadminActor,
      storeId: STORE,
      idempotencyKey: 'g41-release-no-cap',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: 'fgl-1', reason: 'lab ok' },
    })
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
    expect(payload().domains.production.finishedGoodsLots[0].qcStatus).toBe('pending')
    expect(qcState.decisions.length).toBe(0)

    // The same actor still passes a capability it actually holds.
    const read = await g4.executeG4Command({
      actor: sysadminActor,
      storeId: STORE,
      idempotencyKey: 'g41-read',
      commandType: 'packaging.read',
      command: {},
    })
    expect(read.ok).toBe(true)
    expect(read.packagingQcActive).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Grant / revoke keep FstPrincipalAccess canonical
// ---------------------------------------------------------------------------

describe('G4.1 grant / revoke write the canonical principal', () => {
  it('grantPermission maps QC flags onto G4 capabilities', async () => {
    await seedCritical({ packagingQc: true })
    const service = await import('../server/fst/_qcService.mjs')
    const granted = await service.grantPermission({
      actor: { uid: 'sys-1', claims: { fstSysadmin: true } },
      firebaseUid: UID,
      storeId: STORE,
      flags: { canView: true, canUpload: true, canRelease: true },
    })
    expect(granted.ok).toBe(true)
    expect(granted.aclSource).toBe('fst_principal_access')

    const principal = g1State.principals.get(`${STORE}::${UID}`)!
    const caps = JSON.parse(String(principal.capabilitiesJson))
    expect(caps['qc.release']).toBe(true)
    expect(caps['qc.attachment.upload']).toBe(true)
    expect(caps['packaging.read']).toBe(true)
    // Flags absent from the grant are never silently switched on.
    expect(caps['qc.regrade']).not.toBe(true)
    expect(caps['shipment.post']).not.toBe(true)

    const allowed = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(allowed.ok).toBe(true)
    expect(allowed.source).toBe('fst_principal_access')
  })

  it('revokePermission wins over a stale QcPermission projection', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.release': true, 'shipment.post': true })
    setQcPermission({ canRelease: true, canPostShipment: true })

    const service = await import('../server/fst/_qcService.mjs')
    expect((await service.requireActivePermission(UID, STORE, 'canRelease')).ok).toBe(true)

    const revoked = await service.revokePermission({
      actor: { uid: 'sys-1', claims: { fstSysadmin: true } },
      firebaseUid: UID,
      storeId: STORE,
      reason: 'left the QC team',
    })
    expect(revoked.ok).toBe(true)

    const caps = JSON.parse(String(g1State.principals.get(`${STORE}::${UID}`)!.capabilitiesJson))
    expect(caps['qc.release']).toBe(false)
    expect(caps['shipment.post']).toBe(false)

    // Simulate the deprecated projection drifting back to "allowed".
    setQcPermission({ canRelease: true, canPostShipment: true })
    for (const flag of ['canRelease', 'canPostShipment'] as const) {
      const denied = await service.requireActivePermission(UID, STORE, flag)
      expect(denied.ok, flag).toBe(false)
      expect(denied.status, flag).toBe(403)
    }
  })
})

// ---------------------------------------------------------------------------
// AppStore roleId is never part of the decision
// ---------------------------------------------------------------------------

describe('G4.1 AppStore role is not an ACL source', () => {
  it('a privileged-looking roleId with empty capabilities is denied', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({}, { roleId: 'sysadmin' })
    setQcPermission({ canRelease: true })

    const service = await import('../server/fst/_qcService.mjs')
    const denied = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
  })

  it('an unprivileged-looking roleId with the capability is allowed', async () => {
    await seedCritical({ packagingQc: true })
    setPrincipal({ 'qc.release': true }, { roleId: 'guest' })

    const service = await import('../server/fst/_qcService.mjs')
    const allowed = await service.requireActivePermission(UID, STORE, 'canRelease')
    expect(allowed.ok).toBe(true)
    expect(allowed.principal?.roleId).toBe('guest')
  })

  it('the ACL source slice never reads roleId / roleViews / webViews', async () => {
    const src = await fs.readFile(path.resolve('server/fst/_qcService.mjs'), 'utf8')
    const aclStart = src.indexOf('export async function requireActivePermission')
    const aclEnd = src.indexOf('export async function rejectIfPackagingQcAuthoritative')
    expect(aclStart).toBeGreaterThan(0)
    expect(aclEnd).toBeGreaterThan(aclStart)

    const capsStart = src.indexOf('async function loadPrincipalCaps')
    const capsEnd = src.indexOf('function syntheticPermissionFromFlag')
    expect(capsStart).toBeGreaterThan(0)
    expect(capsEnd).toBeGreaterThan(capsStart)

    const slice = src.slice(capsStart, capsEnd) + src.slice(aclStart, aclEnd)
    expect(slice).not.toMatch(/roleId/)
    expect(slice).not.toMatch(/roleViews/)
    expect(slice).not.toMatch(/webViews/)
    expect(slice).not.toMatch(/access\./)
    expect(slice).toMatch(/loadPrincipalCaps/)
    expect(slice).toMatch(/isPackagingQcActiveForStore/)
  })
})
