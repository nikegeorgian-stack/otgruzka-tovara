/**
 * G4.1 — memory signed upload session (Storage emulator signed URLs unsupported
 * without a service account). Complements scripts/g41-live-emulator-smoke.mjs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('g41 signed session (memory adapter)', () => {
  beforeEach(() => {
    process.env.QC_STORAGE_ADAPTER = 'memory'
    process.env.QC_LOCAL_EMULATOR = '1'
    process.env.GCLOUD_PROJECT = 'demo-otgruzka'
    process.env.GOOGLE_CLOUD_PROJECT = 'demo-otgruzka'
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  })

  afterEach(() => {
    delete process.env.QC_STORAGE_ADAPTER
    delete process.env.QC_LOCAL_EMULATOR
  })

  it('creates path-bound memory signed session and redeems exact bytes', async () => {
    const mod = await import('../api/fst/_qcStorage.mjs')
    const storagePath = mod.buildQcStoragePath('fibercell-main', 'g41-lot', 'g41-att')
    const session = await mod.createSignedUploadSession({
      storagePath,
      contentType: 'application/pdf',
      sizeBytes: 256,
      checksum: 'g41-chk',
    })
    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.uploadUrl.startsWith('memory://qc-upload/')).toBe(true)
    expect(session.storagePath).toBe(storagePath)
    expect(session.contentType).toBe('application/pdf')

    const bound = mod.assertSignedSessionPathBound(session, storagePath, 'application/pdf')
    expect(bound.ok).toBe(true)

    const wrongSize = mod.redeemMemorySignedUpload({
      uploadUrl: session.uploadUrl,
      bytes: Buffer.alloc(100),
      contentType: 'application/pdf',
      checksum: 'g41-chk',
    })
    expect(wrongSize.ok).toBe(false)

    const session2 = await mod.createSignedUploadSession({
      storagePath,
      contentType: 'application/pdf',
      sizeBytes: 256,
      checksum: 'g41-chk',
    })
    expect(session2.ok).toBe(true)
    if (!session2.ok) return

    const redeem = mod.redeemMemorySignedUpload({
      uploadUrl: session2.uploadUrl,
      bytes: Buffer.alloc(256, 7),
      contentType: 'application/pdf',
      checksum: 'g41-chk',
    })
    expect(redeem.ok).toBe(true)
    if (!redeem.ok) return
    expect(redeem.storagePath).toBe(storagePath)
    expect(redeem.generation).toBeTruthy()

    const verified = await mod.verifyStorageObject({
      storagePath,
      expectedContentType: 'application/pdf',
      expectedSizeBytes: 256,
      expectedChecksum: 'g41-chk',
    })
    expect(verified.ok).toBe(true)
  })
})
