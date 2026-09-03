import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const calls = {
  getPermission: vi.fn(async () => ({ data: { qcPermissions: [] } })),
  getLot: vi.fn(async () => ({ data: { qcFinishedGoodsLot: null } })),
  getDecisionByIdempotency: vi.fn(async () => ({ data: { qcLotDecisions: [] } })),
  getLatestDecision: vi.fn(async () => ({ data: { qcLotDecisions: [] } })),
  getAttachmentByIdempotency: vi.fn(async () => ({ data: { qcAttachmentRecords: [] } })),
  getAttachment: vi.fn(async () => ({ data: { qcAttachmentRecord: null } })),
  listVerifiedAttachments: vi.fn(async () => ({ data: { qcAttachmentRecords: [] } })),
  upsertPermission: vi.fn(async () => undefined),
  upsertLot: vi.fn(async () => undefined),
  insertDecision: vi.fn(async () => undefined),
  insertAttachment: vi.fn(async () => undefined),
  updateAttachment: vi.fn(async () => undefined),
}

vi.mock('../api/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({ mocked: true })),
  getQcPermissionByUidStore: (...args: unknown[]) => calls.getPermission(...args),
  getQcFinishedGoodsLot: (...args: unknown[]) => calls.getLot(...args),
  getQcLotDecisionByIdempotency: (...args: unknown[]) => calls.getDecisionByIdempotency(...args),
  getLatestQcLotDecision: (...args: unknown[]) => calls.getLatestDecision(...args),
  getQcAttachmentByIdempotency: (...args: unknown[]) => calls.getAttachmentByIdempotency(...args),
  getQcAttachmentRecord: (...args: unknown[]) => calls.getAttachment(...args),
  listVerifiedLotAttachments: (...args: unknown[]) => calls.listVerifiedAttachments(...args),
  upsertQcPermission: (...args: unknown[]) => calls.upsertPermission(...args),
  upsertQcFinishedGoodsLot: (...args: unknown[]) => calls.upsertLot(...args),
  insertQcLotDecision: (...args: unknown[]) => calls.insertDecision(...args),
  insertQcAttachmentRecord: (...args: unknown[]) => calls.insertAttachment(...args),
  updateQcAttachmentRecord: (...args: unknown[]) => calls.updateAttachment(...args),
}))

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  calls.getPermission.mockResolvedValue({ data: { qcPermissions: [] } })
  calls.getLot.mockResolvedValue({ data: { qcFinishedGoodsLot: null } })
  calls.getDecisionByIdempotency.mockResolvedValue({ data: { qcLotDecisions: [] } })
  calls.getLatestDecision.mockResolvedValue({ data: { qcLotDecisions: [] } })
  calls.getAttachmentByIdempotency.mockResolvedValue({ data: { qcAttachmentRecords: [] } })
  calls.getAttachment.mockResolvedValue({ data: { qcAttachmentRecord: null } })
  calls.listVerifiedAttachments.mockResolvedValue({ data: { qcAttachmentRecords: [] } })
  process.env.QC_STORAGE_ADAPTER = 'memory'
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
})

afterEach(() => {
  delete process.env.QC_STORAGE_ADAPTER
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  delete process.env.QC_LOCAL_EMULATOR
})

function activePermission(flags: Record<string, boolean>) {
  return {
    data: {
      qcPermissions: [
        {
          id: 'fibercell-main::user-1',
          firebaseUid: 'user-1',
          storeId: 'fibercell-main',
          active: true,
          canView: true,
          canUpload: false,
          canRelease: false,
          canRegrade: false,
          canReject: false,
          canPostShipment: false,
          revision: 1,
          ...flags,
        },
      ],
    },
  }
}

describe('qc signed upload / vercel gate', () => {
  it(
    'documents Vercel 4.5MiB limit and refuses binary proxy semantics',
    async () => {
      const mod = await import('../api/fst/_qcStorage.mjs')
      expect(mod.VERCEL_FUNCTION_BODY_LIMIT_BYTES).toBe(4.5 * 1024 * 1024)
      expect(mod.QC_ATTACHMENT_MAX_BYTES).toBeGreaterThan(mod.VERCEL_FUNCTION_BODY_LIMIT_BYTES)

      const putSrc = await fs.readFile(path.resolve('api/fst/qc-upload-put.mjs'), 'utf8')
      expect(putSrc).toMatch(/binary_proxy_forbidden/)
      expect(putSrc).toMatch(/createSignedUploadSession/)
      expect(putSrc).not.toMatch(/Buffer\.from\(base64/)
    },
    15000,
  )

  it('signed session is bound to exact storage path and content type', async () => {
    const mod = await import('../api/fst/_qcStorage.mjs')
    const storagePath = mod.buildQcStoragePath('fibercell-main', 'lot-1', 'att-1')
    const session = await mod.createSignedUploadSession({
      storagePath,
      contentType: 'application/pdf',
      sizeBytes: 2048,
      checksum: 'abc',
    })
    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.storagePath).toBe(storagePath)
    expect(session.contentType).toBe('application/pdf')
    expect(session.uploadUrl.startsWith('memory://qc-upload/')).toBe(true)

    const bound = mod.assertSignedSessionPathBound(session, storagePath, 'application/pdf')
    expect(bound.ok).toBe(true)

    const wrong = mod.assertSignedSessionPathBound(session, storagePath + '/x', 'application/pdf')
    expect(wrong.ok).toBe(false)

    const redeemBadPath = mod.redeemMemorySignedUpload({
      uploadUrl: session.uploadUrl,
      bytes: Buffer.alloc(100),
      contentType: 'application/pdf',
      checksum: 'abc',
    })
    expect(redeemBadPath.ok).toBe(false)

    const redeemOk = mod.redeemMemorySignedUpload({
      uploadUrl: session.uploadUrl,
      bytes: Buffer.alloc(2048),
      contentType: 'application/pdf',
      checksum: 'abc',
    })
    expect(redeemOk.ok).toBe(true)
  })
})

describe('qc service layer', () => {
  it('grants permissions without auto-enabling release', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    const result = await service.grantPermission({
      actor: { uid: 'sys-1', claims: { fstSysadmin: true } },
      firebaseUid: 'user-1',
      storeId: 'fibercell-main',
      flags: { canView: true, canUpload: true },
    })
    expect(result.ok).toBe(true)
    const vars = calls.upsertPermission.mock.calls[0][1]
    expect(vars.canRelease).toBe(false)
  })

  it('denies ordinary user grant and requires reason on revoke', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    const denied = await service.grantPermission({
      actor: { uid: 'user-2', claims: { fstSysadmin: false }, email: 'otc@example.com' },
      firebaseUid: 'user-1',
      storeId: 'fibercell-main',
      flags: { canRelease: true },
    })
    expect(denied.ok).toBe(false)
    const revokeNoReason = await service.revokePermission({
      actor: { uid: 'sys-1', claims: { fstSysadmin: true } },
      firebaseUid: 'user-1',
      storeId: 'fibercell-main',
      reason: '',
    })
    expect(revokeNoReason.ok).toBe(false)
  })

  it('initiate issues signed session; cross-store finalize denied', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    calls.getPermission.mockResolvedValue(activePermission({ canUpload: true }))
    const init = await service.initiateAttachment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      documentKind: 'passport',
      contentType: 'application/pdf',
      sizeBytes: 100,
      checksum: 'x',
      attachmentId: 'att-1',
    })
    expect(init.ok).toBe(true)
    if (init.ok) {
      expect(init.upload?.storagePath).toBe(init.attachment.storagePath)
      expect(init.upload?.uploadUrl).toMatch(/^memory:\/\//)
    }

    calls.getAttachment.mockResolvedValue({
      data: {
        qcAttachmentRecord: {
          id: 'att-1',
          storeId: 'other-store',
          lotId: 'lot-1',
          status: 'initiated',
          revision: 1,
          storagePath: 'fstFiles/other-store/qc-lots/lot-1/att-1/blob',
          contentType: 'application/pdf',
          sizeBytes: 10,
          checksum: 'x',
        },
      },
    })
    const denied = await service.finalizeAttachment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      attachmentId: 'att-1',
    })
    expect(denied.ok).toBe(false)
  })

  it('finalize rejects lot/path mismatch and missing object', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    calls.getPermission.mockResolvedValue(activePermission({ canUpload: true }))
    calls.getAttachment.mockResolvedValue({
      data: {
        qcAttachmentRecord: {
          id: 'att-1',
          storeId: 'fibercell-main',
          lotId: 'lot-1',
          status: 'initiated',
          revision: 1,
          storagePath: 'fstFiles/fibercell-main/qc-lots/lot-1/att-1/blob',
          contentType: 'application/pdf',
          sizeBytes: 10,
          checksum: 'x',
        },
      },
    })
    const lotMismatch = await service.finalizeAttachment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'other-lot',
      attachmentId: 'att-1',
    })
    expect(lotMismatch.ok).toBe(false)

    const missingObj = await service.finalizeAttachment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      attachmentId: 'att-1',
    })
    expect(missingObj.ok).toBe(false)
  })

  it('release requires verified passport+protocol; forged qcStatus ignored', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    calls.getPermission.mockResolvedValue(activePermission({ canRelease: false }))
    calls.getLot.mockResolvedValue({
      data: {
        qcFinishedGoodsLot: {
          id: 'lot-1',
          storeId: 'fibercell-main',
          status: 'released',
          revision: 1,
          quantityProduced: 10,
          quantityShipped: 0,
        },
      },
    })
    const denied = await service.releaseLot({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      qcStatus: 'released',
    })
    expect(denied.ok).toBe(false)

    calls.getPermission.mockResolvedValue(activePermission({ canRelease: true }))
    calls.listVerifiedAttachments.mockResolvedValue({ data: { qcAttachmentRecords: [] } })
    const missingAtt = await service.releaseLot({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
    })
    expect(missingAtt.ok).toBe(false)
  })

  it('shipment requires server decision; forged lot.status ignored; revoke denies', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    calls.getPermission.mockResolvedValue(activePermission({ canPostShipment: true }))
    calls.getLot.mockResolvedValue({
      data: {
        qcFinishedGoodsLot: {
          id: 'lot-1',
          storeId: 'fibercell-main',
          finishedProductId: 'fp-1',
          warehouseItemId: 'wi-1',
          status: 'released',
          quantityProduced: 10,
          quantityShipped: 0,
          revision: 3,
        },
      },
    })
    calls.getLatestDecision.mockResolvedValue({ data: { qcLotDecisions: [] } })
    const denied = await service.authorizeShipment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      quantity: 2,
    })
    expect(denied.ok).toBe(false)

    calls.getLatestDecision.mockResolvedValue({
      data: {
        qcLotDecisions: [{ id: 'dec-1', storeId: 'fibercell-main', lotId: 'lot-1', status: 'released', revision: 1 }],
      },
    })
    const allowed = await service.authorizeShipment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      quantity: 2,
      finishedProductId: 'fp-1',
      warehouseItemId: 'wi-1',
    })
    expect(allowed.ok).toBe(true)

    calls.getPermission.mockResolvedValue({
      data: {
        qcPermissions: [
          {
            id: 'fibercell-main::user-1',
            firebaseUid: 'user-1',
            storeId: 'fibercell-main',
            active: false,
            canPostShipment: true,
            revision: 2,
          },
        ],
      },
    })
    const revoked = await service.authorizeShipment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      quantity: 1,
    })
    expect(revoked.ok).toBe(false)
  })

  it('idempotent finalize when already verified', async () => {
    const service = await import('../api/fst/_qcService.mjs')
    calls.getPermission.mockResolvedValue(activePermission({ canUpload: true }))
    const verified = {
      id: 'att-1',
      storeId: 'fibercell-main',
      lotId: 'lot-1',
      status: 'verified',
      revision: 2,
      storagePath: 'fstFiles/fibercell-main/qc-lots/lot-1/att-1/blob',
      contentType: 'application/pdf',
      sizeBytes: 10,
      checksum: 'x',
    }
    calls.getAttachment.mockResolvedValue({ data: { qcAttachmentRecord: verified } })
    const again = await service.finalizeAttachment({
      actor: { uid: 'user-1' },
      storeId: 'fibercell-main',
      attachmentId: 'att-1',
    })
    expect(again.ok).toBe(true)
    expect(calls.updateAttachment).not.toHaveBeenCalled()
  })
})

describe('admin connector isolation', () => {
  it('keeps QC admin ops out of client connector and NO_ACCESS on admin', async () => {
    const dir = path.resolve(process.cwd(), 'fst-web/dataconnect/fst-connector')
    const files = await fs.readdir(dir)
    let blob = ''
    for (const name of files) {
      if (!name.endsWith('.gql') && !name.endsWith('.yaml')) continue
      blob += await fs.readFile(path.join(dir, name), 'utf8')
    }
    expect(blob).not.toMatch(/UpsertQcPermission|InsertQcLotDecision|QcPermission/)

    const mutations = await fs.readFile(
      path.resolve(process.cwd(), 'fst-web/dataconnect/fst-admin-connector/mutations.gql'),
      'utf8',
    )
    expect(mutations).toMatch(/@auth\(level: NO_ACCESS\)/)
    expect(mutations).not.toMatch(/@auth\(level: USER\)/)
  })
})

describe('source scan guard', () => {
  it('keeps admin sdk and server env names out of src', async () => {
    const root = path.resolve(process.cwd(), 'src')
    const stack = [root]
    const hits: string[] = []
    const banned = [
      '@fst/dataconnect-admin-generated',
      'dataconnect-admin-generated',
      'BEGIN PRIVATE KEY',
      'firebase-admin/',
    ]
    const skipDirs = new Set(['i18n'])
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue
          stack.push(full)
          continue
        }
        if (!/\.(ts|tsx|js|jsx|mjs|mts)$/.test(entry.name)) continue
        const text = await fs.readFile(full, 'utf8')
        for (const b of banned) {
          if (text.includes(b)) hits.push(`${full}:${b}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('storage rules deny client qc-lots writes', async () => {
    const rules = await fs.readFile(path.resolve(process.cwd(), 'fst-web/storage.rules'), 'utf8')
    expect(rules).toMatch(/qc-lots/)
    expect(rules).toMatch(/allow create, update, delete: if false/)
    expect(rules).toMatch(/fstPhotos/)
  })
})
