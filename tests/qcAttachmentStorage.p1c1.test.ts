import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  if ('window' in globalThis) {
    delete (globalThis as { window?: unknown }).window
  }
})

describe('qc attachment storage', () => {
  it('sanitizes qc attachment paths and stores metadata in memory', async () => {
    const mod = await import('@/lib/production/qcAttachments')
    expect(mod.qcAttachmentStoragePath('fibercell-main', 'lot 1/../', 'att#1')).toBe(
      'fstFiles/fibercell-main/qc-lots/lot1/att1/blob',
    )
    const adapter = mod.createMemoryQcAttachmentAdapter()
    const attachment = await adapter.upload({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'паспорт .pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      storeDocId: 'fibercell-main',
      attachmentId: 'att#1',
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(attachment.uploadStatus).toBe('stored')
    expect(attachment.storagePath).toBe('fstFiles/fibercell-main/qc-lots/lot-1/att1/blob')
    expect(attachment.displayName).toContain('pdf')
  })

  it('returns the memory adapter when firebase is not configured', async () => {
    vi.doMock('@/lib/cloud/firebase', () => ({
      getFirebaseApp: vi.fn(() => ({})),
      getFirebaseAuth: vi.fn(() => ({ currentUser: null })),
      isFirebaseConfigured: vi.fn(() => false),
    }))
    vi.doMock('firebase/storage', () => ({
      deleteObject: vi.fn(async () => undefined),
      getDownloadURL: vi.fn(async () => 'https://example.test/blob'),
      getStorage: vi.fn(() => ({})),
      ref: vi.fn((_, path) => ({ path })),
      uploadBytes: vi.fn(async () => undefined),
    }))
    ;(globalThis as { window?: unknown }).window = {}
    const mod = await import('@/lib/production/qcAttachments')
    const adapter = mod.resolveQcAttachmentAdapter()
    const attachment = await adapter.upload({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      storeDocId: 'fibercell-main',
      bytes: new Uint8Array([4, 5, 6]),
    })
    expect(attachment.uploadStatus).toBe('stored')
    expect('bytes' in attachment).toBe(false)
    expect('base64' in attachment).toBe(false)
  })

  it('selects firebase adapter in browser when configured', async () => {
    const uploadBytes = vi.fn(async () => undefined)
    vi.doMock('@/lib/cloud/firebase', () => ({
      getFirebaseApp: vi.fn(() => ({})),
      getFirebaseAuth: vi.fn(() => ({ currentUser: { uid: 'user-1' } })),
      isFirebaseConfigured: vi.fn(() => true),
    }))
    vi.doMock('firebase/storage', () => ({
      deleteObject: vi.fn(async () => undefined),
      getDownloadURL: vi.fn(async () => 'https://example.test/blob'),
      getStorage: vi.fn(() => ({})),
      ref: vi.fn((_, path) => ({ path })),
      uploadBytes,
    }))
    ;(globalThis as { window?: unknown }).window = {}
    const mod = await import('@/lib/production/qcAttachments')
    const adapter = mod.resolveQcAttachmentAdapter()
    await adapter.upload({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      storeDocId: 'fibercell-main',
      bytes: new Uint8Array([4, 5, 6]),
    })
    expect(uploadBytes).toHaveBeenCalled()
  })
})
