/**
 * R2.9L-FINAL — web QC attach must go through initiate→PUT→finalize, not fail-closed stub.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { md5Base64, uploadQcAttachmentViaServer } from '@/lib/production/qcServerUpload'
import { createFailClosedQcAttachmentAdapter } from '@/lib/production/qcAttachments'

vi.mock('@/lib/production/qcServerClient', () => ({
  qcUploadInitiate: vi.fn(),
  qcUploadFinalize: vi.fn(),
}))

import { qcUploadFinalize, qcUploadInitiate } from '@/lib/production/qcServerClient'

const initiate = vi.mocked(qcUploadInitiate)
const finalize = vi.mocked(qcUploadFinalize)

describe('R2.9L QC web upload path', () => {
  beforeEach(() => {
    initiate.mockReset()
    finalize.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
  })

  it('md5Base64 matches Node crypto for PDF bytes', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 edu test')
    const expected = createHash('md5').update(bytes).digest('base64')
    expect(md5Base64(bytes)).toBe(expected)
  })

  it('fail-closed adapter never marks mandatory QC file as stored', async () => {
    const adapter = createFailClosedQcAttachmentAdapter()
    const row = await adapter.upload({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'EDU_PASSPORT.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })
    expect(row.uploadStatus).toBe('failed')
    expect(row.checksum).toContain('server_upload_required')
  })

  it('uploadQcAttachmentViaServer rejects empty bytes (no stub metadata path)', async () => {
    const result = await uploadQcAttachmentViaServer({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'EDU_PASSPORT.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('production.qc.errAttachmentEmpty')
    expect(initiate).not.toHaveBeenCalled()
  })

  it('uploadQcAttachmentViaServer runs initiate → signed PUT → finalize and returns stored', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF\n')
    const checksum = createHash('md5').update(bytes).digest('base64')
    initiate.mockResolvedValue({
      ok: true,
      data: {
        attachment: {
          id: 'att-1',
          storagePath: 'fstFiles/fibercell-main/qc-lots/lot-1/att-1/blob',
          status: 'initiated',
          checksum,
          sizeBytes: bytes.byteLength,
        },
        upload: {
          method: 'PUT',
          uploadUrl: 'https://storage.example/signed',
          storagePath: 'fstFiles/fibercell-main/qc-lots/lot-1/att-1/blob',
          contentType: 'application/pdf',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          headers: { 'Content-Type': 'application/pdf', 'x-goog-if-generation-match': '0' },
        },
      },
    })
    finalize.mockResolvedValue({
      ok: true,
      data: {
        attachment: {
          id: 'att-1',
          storagePath: 'fstFiles/fibercell-main/qc-lots/lot-1/att-1/blob',
          status: 'verified',
          checksum,
          sizeBytes: bytes.byteLength,
        },
      },
    })

    const result = await uploadQcAttachmentViaServer({
      lotId: 'lot-1',
      documentKind: 'passport',
      originalFilename: 'EDU_PASSPORT_TEST.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      bytes,
      storeDocId: 'fibercell-main',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attachment.uploadStatus).toBe('stored')
    expect(result.attachment.id).toBe('att-1')
    expect(result.attachment.checksum).toBe(checksum)
    expect(initiate).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'https://storage.example/signed',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
