/**
 * PHASE G2 — warehouse lifecycle authoritative gateway tests.
 * Mocked Admin Data Connect only (no production credentials).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const dcState = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as null | Record<string, unknown>,
  receipts: new Map<string, Record<string, unknown>>(),
}

const calls = {
  getPrincipal: vi.fn(async () => ({ data: { fstPrincipalAccesses: [] as unknown[] } })),
  getCritical: vi.fn(async () => ({ data: { fstCriticalStore: null as unknown } })),
  getReceipt: vi.fn(async () => ({ data: { fstCommandReceipt: null as unknown } })),
  upsertPrincipal: vi.fn(async () => undefined),
  upsertCritical: vi.fn(async () => undefined),
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()

  calls.getPrincipal.mockImplementation(async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
    const id = `${vars.storeId}::${vars.firebaseUid}`
    const row = dcState.principals.get(id)
    return { data: { fstPrincipalAccesses: row ? [row] : [] } }
  })
  calls.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: dcState.critical },
  }))
  calls.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: dcState.receipts.get(vars.id) ?? null },
  }))
  calls.upsertPrincipal.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.principals.set(String(row.id), row)
  })
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!dcState.critical) throw new Error('missing')
    if (dcState.critical.revision !== vars.expectedRevision) {
      throw new Error('revision_conflict')
    }
    dcState.critical = {
      ...dcState.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
      updatedByUid: vars.updatedByUid,
    }
  })
  calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (dcState.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    dcState.receipts.set(String(row.id), row)
  })
})

afterEach(() => {
  vi.resetModules()
})

function grant(uid: string, storeId: string, caps: Record<string, boolean>, active = true) {
  const id = `${storeId}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId,
    roleId: 'warehouse',
    capabilitiesJson: JSON.stringify(caps),
    active,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

const actor = { uid: 'u1', email: 'u1@x', claims: {} }

/** R29H/R29J: unknown catalogue items require complete identity snapshots (fail-closed). */
function snap(
  itemId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
  name = `Item ${itemId}`,
) {
  return {
    itemId,
    quantity,
    itemNameSnapshot: name,
    unitSnapshot: 'кг',
    itemCodeSnapshot: `FC-${itemId}`,
    ...extra,
  }
}

describe('G2 ACL', () => {
  it('user without permission → 403', async () => {
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-deny',
      commandType: 'warehouse.draft.save',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        lines: [snap('i1', 1)],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('foreign storeId → 403', async () => {
    grant('u1', 'store-a', { 'warehouse.draft.edit': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'store-b',
      idempotencyKey: 'k-foreign',
      commandType: 'warehouse.draft.save',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        lines: [snap('i1', 1)],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })
})

describe('G2 draft lifecycle', () => {
  it('draft does not change stock; postExisting then immutable', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.draft.edit': true,
      'warehouse.document.post': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const draft = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-draft-1',
      commandType: 'warehouse.draft.save',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 5)],
      },
    })
    expect(draft.ok).toBe(true)
    expect(draft.warehouse.movements).toHaveLength(0)
    expect(draft.warehouse.documents[0].status).toBe('draft')

    const posted = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-post-1',
      commandType: 'warehouse.document.postExisting',
      command: { documentId: draft.documentId },
    })
    expect(posted.ok).toBe(true)
    expect(posted.warehouse.movements.length).toBeGreaterThan(0)

    const editPosted = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-edit-posted',
      commandType: 'warehouse.draft.save',
      command: {
        documentId: draft.documentId,
        type: 'receipt',
        warehouseId: 'w1',
        lines: [snap('i1', 99)],
      },
    })
    expect(editPosted.ok).toBe(false)
    expect(editPosted.error).toBe('posted_immutable')
  })

  it('double post is idempotent via receipt', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const a = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-dup-post',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 2)],
      },
    })
    expect(a.ok).toBe(true)
    const b = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-dup-post',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 2)],
      },
    })
    expect(b.ok).toBe(true)
    expect(b.idempotent).toBe(true)
    expect(calls.updateCas).toHaveBeenCalledTimes(1)
  })
})

describe('G2 transfer / storno / period', () => {
  it('transfer insufficient stock leaves no partial write', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.transfer.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-xfer-fail',
      commandType: 'warehouse.transfer.post',
      command: {
        warehouseId: 'w1',
        targetWarehouseId: 'w2',
        date: '2026-09-04',
        lines: [snap('i1', 10)],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('insufficient_stock')
    expect(calls.updateCas).not.toHaveBeenCalled()
  })

  it('transfer success is atomic for both legs', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.document.post': true,
      'warehouse.transfer.post': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-stock',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 10)],
      },
    })
    const xfer = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-xfer-ok',
      commandType: 'warehouse.transfer.post',
      command: {
        warehouseId: 'w1',
        targetWarehouseId: 'w2',
        date: '2026-09-04',
        lines: [snap('i1', 4)],
      },
    })
    expect(xfer.ok).toBe(true)
    expect(xfer.documentIds).toHaveLength(2)
    const docs = xfer.warehouse.documents.filter((d: { transferPairId?: string }) => d.transferPairId)
    expect(docs).toHaveLength(2)
  })

  it('storno creates reversal and does not delete movements; repeat idempotent', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.document.post': true,
      'warehouse.document.cancel': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const posted = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-recv',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 3)],
      },
    })
    const movBefore = posted.warehouse.movements.length
    const cancel = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-cancel',
      commandType: 'warehouse.document.cancel',
      command: { documentId: posted.documentId, reason: 'test cancel reason' },
    })
    expect(cancel.ok).toBe(true)
    expect(cancel.reversalIds.length).toBe(1)
    expect(cancel.warehouse.movements.length).toBeGreaterThan(movBefore)
    const orig = cancel.warehouse.documents.find((d: { id: string }) => d.id === posted.documentId)
    expect(orig.status).toBe('cancelled')

    const again = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-cancel',
      commandType: 'warehouse.document.cancel',
      command: { documentId: posted.documentId, reason: 'test cancel reason' },
    })
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)
  })

  it('closed period blocks write; reopen without reason forbidden', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.period.close': true,
      'warehouse.period.reopen': true,
      'warehouse.document.post': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const closed = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-close',
      commandType: 'warehouse.period.close',
      command: { month: '2026-09' },
    })
    expect(closed.ok).toBe(true)

    const blocked = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-post-closed',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-10',
        lines: [snap('i1', 1)],
      },
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toBe('period_closed')

    const reopenBad = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-reopen-bad',
      commandType: 'warehouse.period.reopen',
      command: { month: '2026-09' },
    })
    expect(reopenBad.ok).toBe(false)
    expect(reopenBad.error).toBe('reopen_reason_required')
  })
})

describe('G2 opening / inventory / excel / CAS', () => {
  it('opening inventory activates only target warehouse', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.opening.activate': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-open',
      commandType: 'warehouse.opening.post',
      command: {
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 100)],
      },
    })
    expect(r.ok).toBe(true)
    expect(r.activatedWarehouseId).toBe('w1')
    const acc = r.warehouse.accountingByWarehouse
    expect(acc.some((a: { warehouseId: string; status: string }) => a.warehouseId === 'w1' && a.status === 'active')).toBe(true)
    expect(acc.every((a: { warehouseId: string }) => a.warehouseId === 'w1')).toBe(true)
  })

  it('inventory adjustment changes stock only after post', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.document.post': true,
      'warehouse.inventory.post': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-base',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 10)],
      },
    })
    const inv = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-inv',
      commandType: 'warehouse.inventory.post',
      command: {
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [{ ...snap('i1', 7), counted: 7, countedQty: 7 }],
      },
    })
    expect(inv.ok).toBe(true)
    expect(inv.applied).toBe(1)
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const bal = h.computeServerBalance(inv.warehouse.movements, 'w1', 'i1')
    expect(bal).toBe(7)
  })

  it('excel import creates drafts only', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.draft.edit': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-excel',
      commandType: 'warehouse.excel.importDrafts',
      command: {
        warehouseId: 'w1',
        date: '2026-09-04',
        receipts: [{ lines: [snap('i1', 2)] }],
      },
    })
    expect(r.ok).toBe(true)
    expect(r.count).toBe(1)
    expect(r.warehouse.documents.every((d: { status: string }) => d.status === 'draft')).toBe(true)
    expect(r.warehouse.movements).toHaveLength(0)
  })

  it('CAS conflict does not leave partial state', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    calls.updateCas.mockImplementationOnce(async () => {
      throw new Error('revision_conflict')
    })
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-cas',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 1)],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('revision_conflict')
    expect(dcState.receipts.size).toBe(0)
  })

  it('forged actor/status/movements are ignored', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-forge',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('i1', 1)],
        status: 'cancelled',
        postedBy: 'hacker',
        movements: [{ type: 'receipt', quantity: 999 }],
        number: 'CLIENT-NO',
      },
    })
    expect(r.ok).toBe(true)
    const doc = r.warehouse.documents.find((d: { id: string }) => d.id === r.documentId)
    expect(doc.status).toBe('posted')
    expect(doc.postedBy).toBe('u1')
    expect(doc.number).not.toBe('CLIENT-NO')
  })
})

describe('G2 security guards', () => {
  it('forged UpdateFstStore overlay prefers critical when revision>0', async () => {
    const client = await import('../src/lib/warehouse/g1ServerClient.ts')
    const out = client.resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: {
        documents: [{ id: 'forged' }],
        movements: [{ id: 'm-forged', quantity: 999 }],
        items: [],
        locations: [],
        categories: [],
        auditLog: [],
        invoiceRegistry: [],
      } as never,
      criticalWarehouse: {
        documents: [{ id: 'real' }],
        movements: [{ id: 'm-real', quantity: 1 }],
        items: [],
        locations: [],
        categories: [],
        auditLog: [],
        closedMonths: ['2026-08'],
        invoiceRegistry: [],
      } as never,
      criticalRevision: 3,
    })
    expect(out.source).toBe('fst_critical_store')
    expect(out.warehouse.documents[0].id).toBe('real')
    expect(out.warehouse.closedMonths).toEqual(['2026-08'])
  }, 20_000)

  it('verifyIdToken uses checkRevoked=true', async () => {
    const src = await fs.readFile(path.resolve('server/fst/_adminAuth.mjs'), 'utf8')
    expect(src).toMatch(/verifyIdToken\(token,\s*true\)/)
  })

  it('Admin SDK absent from src and frontend bundle patterns', async () => {
    const root = path.resolve(process.cwd(), 'src')
    const stack = [root]
    const hits: string[] = []
    const banned = ['firebase-admin/', 'dataconnect-admin-generated', 'BEGIN PRIVATE KEY']
    while (stack.length) {
      const cur = stack.pop()!
      const entries = await fs.readdir(cur, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(cur, e.name)
        if (e.isDirectory()) {
          if (e.name === 'i18n') continue
          stack.push(full)
          continue
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) continue
        const text = await fs.readFile(full, 'utf8')
        for (const b of banned) {
          if (text.includes(b)) hits.push(`${full}:${b}`)
        }
      }
    }
    expect(hits).toEqual([])
  }, 30_000)
})

describe('G2.1 FEFO issue + reserve + period UI gate', () => {
  it('issue uses FEFO and does not spend foreign reserve', async () => {
    grant('u1', 'fibercell-main', {
      'warehouse.document.post': true,
    })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const r1 = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-fefo-r1',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-01',
        lines: [
          snap('steel', 10, { batchNo: 'EXP-LATE', expiryDate: '2027-01-01' }, 'Steel'),
          snap('steel', 6, { batchNo: 'EXP-SOON', expiryDate: '2026-10-01' }, 'Steel'),
        ],
      },
    })
    expect(r1.ok).toBe(true)

    // Inject a reserve movement via CAS payload (simulate prior reserve).
    const payload = JSON.parse(String(dcState.critical!.payloadJson))
    payload.domains.warehouse.movements.push({
      id: 'res-1',
      warehouseId: 'w1',
      itemId: 'steel',
      type: 'reserve',
      quantity: 4,
      batchNo: 'EXP-SOON',
      expiryDate: '2026-10-01',
      at: '2026-09-02T00:00:00.000Z',
    })
    dcState.critical!.payloadJson = JSON.stringify(payload)

    const issue = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-fefo-iss',
      commandType: 'warehouse.document.post',
      command: {
        type: 'issue',
        warehouseId: 'w1',
        date: '2026-09-03',
        lines: [snap('steel', 5)],
      },
    })
    expect(issue.ok).toBe(true)
    const issueMovs = issue.warehouse.movements.filter(
      (m: { type: string; documentId: string }) =>
        m.type === 'issue' && m.documentId === issue.documentId,
    )
    expect(issueMovs[0].batchNo).toBe('EXP-SOON')
    expect(issueMovs[0].quantity).toBe(2) // 6-4 reserved
    expect(issueMovs[1].batchNo).toBe('EXP-LATE')
    expect(issueMovs[1].quantity).toBe(3)

    const over = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-fefo-over',
      commandType: 'warehouse.document.post',
      command: {
        type: 'issue',
        warehouseId: 'w1',
        date: '2026-09-03',
        lines: [snap('steel', 99)],
      },
    })
    expect(over.ok).toBe(false)
    expect(over.error).toMatch(/insufficient|batch/i)
  })

  it('manual batch override without reason fails; client number ignored', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-num-r',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-01',
        number: 'CLIENT-FORGED-99',
        lines: [snap('bolt', 3, { batchNo: 'BX', expiryDate: '2027-01-01' }, 'Bolt')],
      },
    })
    const posted = JSON.parse(String(dcState.critical!.payloadJson))
    const doc = posted.domains.warehouse.documents.find(
      (d: { type: string }) => d.type === 'receipt',
    )
    expect(doc.number).not.toBe('CLIENT-FORGED-99')
    expect(String(doc.number)).toMatch(/^ПР-/)

    const bad = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-num-iss',
      commandType: 'warehouse.document.post',
      command: {
        type: 'issue',
        warehouseId: 'w1',
        date: '2026-09-02',
        lines: [snap('bolt', 1, { batchNo: 'BX', batchOverrideReason: '' }, 'Bolt')],
      },
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('warehouse.batch.errOverrideReasonRequired')
  })

  it('emergency negative is sysadmin-only with reason; Settings period UI not desktop-only', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    const denied = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-em-deny',
      commandType: 'warehouse.document.post',
      command: {
        type: 'issue',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [snap('ghost', 1)],
        allowNegativeEmergency: true,
        emergencyReason: 'need stock now!!',
      },
    })
    expect(denied.ok).toBe(false)

    const settingsSrc = await fs.readFile(path.resolve('src/pages/SettingsPage.tsx'), 'utf8')
    expect(settingsSrc).not.toMatch(/!isWeb && currentUser && canManageAccess\(currentUser\) && \(\s*\n\s*<section[\s\S]*warehousePeriods/)
    expect(settingsSrc).toMatch(/showWarehousePeriods/)
    expect(settingsSrc).toMatch(/handleReopenWarehousePeriod/)
    expect(settingsSrc).toMatch(/warehousePeriodReopenReasonRequired/)
  })

  it('failed CAS does not insert command receipt', async () => {
    grant('u1', 'fibercell-main', { 'warehouse.document.post': true })
    const svc = await import('../server/fst/_g2WarehouseService.mjs')
    await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-cas-ok',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-01',
        lines: [snap('i-cas', 1)],
      },
    })
    const beforeReceipts = dcState.receipts.size
    calls.updateCas.mockImplementationOnce(async () => {
      throw new Error('revision_conflict')
    })
    const conflict = await svc.executeG2Command({
      actor,
      storeId: 'fibercell-main',
      idempotencyKey: 'k-cas-stale',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-01',
        lines: [snap('i-cas', 1)],
      },
    })
    expect(conflict.ok).toBe(false)
    expect(conflict.status).toBe(409)
    expect(dcState.receipts.size).toBe(beforeReceipts)
    expect(dcState.receipts.has('k-cas-stale')).toBe(false)
  })
})
