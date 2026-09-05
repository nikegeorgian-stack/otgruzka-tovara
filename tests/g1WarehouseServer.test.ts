/**
 * PHASE G1 — server-authoritative warehouse vertical slice tests.
 * Uses mocked Admin Data Connect (no production credentials).
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

describe('G1 critical helpers', () => {
  it('rejects non-allowlisted domains in critical payload', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const bad = h.parseCriticalPayload(
      JSON.stringify({
        schemaVersion: 1,
        domains: { warehouse: h.emptyWarehouseStore(), employees: {} },
      }),
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('domain_not_allowed')
    const good = h.parseCriticalPayload(
      JSON.stringify({
        schemaVersion: 4,
        domains: {
          warehouse: h.emptyWarehouseStore(),
          production: h.emptyProductionStore(),
          masterData: h.emptyMasterDataStore(),
          sales: h.emptySalesStore(),
          planning: h.emptyPlanningStore(),
          procurement: h.emptyProcurementStore(),
        },
      }),
    )
    expect(good.ok).toBe(true)
    expect(h.G1_ALLOWED_DOMAINS).toEqual([
      'warehouse',
      'production',
      'masterData',
      'sales',
      'planning',
      'procurement',
      'capacity',
    ])
  })

  it('server recomputes balance from movements (ignores client balances)', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const bal = h.computeServerBalance(
      [
        { warehouseId: 'w1', itemId: 'i1', type: 'in', quantity: 10 },
        { warehouseId: 'w1', itemId: 'i1', type: 'out', quantity: 3 },
        { warehouseId: 'w1', itemId: 'i1', type: 'out', quantity: 2, cancelled: true },
      ],
      'w1',
      'i1',
    )
    expect(bal).toBe(7)
  })
})

describe('G1 principal access bootstrap', () => {
  it('sysadmin bootstrap requires trusted claim/email', async () => {
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const denied = await svc.grantPrincipalAccess({
      actor: { uid: 'u1', email: 'user@example.com', claims: {} },
      firebaseUid: 'u2',
      storeId: 'fibercell-main',
      capabilities: { canPostWarehouseDocument: true },
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('forbidden')

    const okGrant = await svc.grantPrincipalAccess({
      actor: { uid: 'admin', email: 'admin@fibercell.net', claims: { fstSysadmin: true } },
      firebaseUid: 'u2',
      storeId: 'fibercell-main',
      capabilities: { canPostWarehouseDocument: true, canViewWarehouse: true },
    })
    expect(okGrant.ok).toBe(true)
    expect(calls.upsertPrincipal).toHaveBeenCalled()
  })

  it('disabled permission is forbidden', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true }, false)
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const r = await svc.requirePrincipalCapability('u1', 'fibercell-main', 'canPostWarehouseDocument')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('forbidden')
  })
})

describe('G1 warehouse post command', () => {
  it('rejects arbitrary payloadJson / warehousePatch / fullStore', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true, canViewWarehouse: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1', email: 'u1@x' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k1',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
      payloadJson: '{"hack":true}',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('arbitrary_patch_forbidden')
  })

  it('forged roleId/capability in FstStore is irrelevant — principal table gates post', async () => {
    // No principal row even if "forged" client role would claim warehouse admin.
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'forger', email: 'forger@x' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-forge',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 5 }] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('forbidden')
  })

  it('foreign storeId is forbidden', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'other-store',
      idempotencyKey: 'k-other',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('forbidden')
  })

  it('posts receipt atomically: document + movements + audit via CAS', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1', email: 'u1@x' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-post-1',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        lines: [{ itemId: 'i1', quantity: 10, itemNameSnapshot: 'Item' }],
      },
    })
    expect(r.ok).toBe(true)
    expect(calls.updateCas).toHaveBeenCalledTimes(1)
    expect(calls.insertReceipt).toHaveBeenCalledTimes(1)
    expect(r.warehouse.documents).toHaveLength(1)
    expect(r.warehouse.movements).toHaveLength(1)
    expect(r.warehouse.auditLog).toHaveLength(1)
    expect(r.criticalRevision).toBe(1) // init 0 then post → 1
  })

  it('rejects issue that would go negative (server-side stock)', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-in',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 2 }] },
    })
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-out',
      command: { type: 'issue', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 5 }] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('insufficient_stock')
  })

  it('revision conflict applies nothing (CAS)', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    // Seed critical
    await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-seed',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
    })
    const before = structuredClone(dcState.critical)
    calls.updateCas.mockImplementationOnce(async () => {
      throw new Error('revision_conflict')
    })
    const r = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-conflict',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('revision_conflict')
    expect(dcState.critical?.payloadJson).toBe(before?.payloadJson)
    expect(dcState.receipts.has('k-conflict')).toBe(false)
  })

  it('replay with same idempotencyKey does not create second document', async () => {
    grant('u1', 'fibercell-main', { canPostWarehouseDocument: true })
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const a = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-idem',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 3 }] },
    })
    const b = await svc.postWarehouseDocumentCommand({
      actor: { uid: 'u1' },
      storeId: 'fibercell-main',
      idempotencyKey: 'k-idem',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 3 }] },
    })
    expect(a.ok && b.ok).toBe(true)
    expect(b.idempotent).toBe(true)
    expect(a.documentId).toBe(b.documentId)
    const payload = JSON.parse(String(dcState.critical?.payloadJson))
    expect(payload.domains.warehouse.documents).toHaveLength(1)
  })
})

describe('G1 forged UpdateFstStore does not affect authoritative warehouse', () => {
  it('resolveAuthoritativeWarehouse prefers critical store when revision>0', async () => {
    const svc = await import('../server/fst/_g1WarehouseService.mjs')
    const forged = {
      documents: [{ id: 'fake', status: 'posted' }],
      movements: [{ id: 'fake-m', quantity: 999 }],
      items: [],
    }
    const authoritative = {
      documents: [{ id: 'real', status: 'posted' }],
      movements: [{ id: 'real-m', quantity: 1 }],
      items: [],
    }
    const out = svc.resolveAuthoritativeWarehouse(forged, authoritative, 3)
    expect(out.source).toBe('fst_critical_store')
    expect(out.warehouse).toBe(authoritative)
    expect(out.warehouse.movements[0].quantity).toBe(1)
  })

  it('client overlay helper mirrors the same rule', async () => {
    const client = await import('../src/lib/warehouse/g1ServerClient.ts')
    const out = client.resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: {
        items: [],
        locations: [],
        documents: [{ id: 'forged' } as never],
        movements: [],
        auditLog: [],
      } as never,
      criticalWarehouse: {
        items: [],
        locations: [],
        documents: [{ id: 'auth' } as never],
        movements: [{ id: 'm1' } as never],
        auditLog: [],
      } as never,
      criticalRevision: 2,
    })
    expect(out.source).toBe(client.G1_CRITICAL_SOURCE)
    expect(out.warehouse.documents[0].id).toBe('auth')
  })
})

describe('G1 security static gates', () => {
  it('client connector mutations do not expose FstCriticalStore ops', async () => {
    const gql = await fs.readFile(
      path.resolve('fst-web/dataconnect/fst-connector/mutations.gql'),
      'utf8',
    )
    expect(gql).toMatch(/UpdateFstStore/)
    expect(gql).not.toMatch(/FstCriticalStore/)
    expect(gql).not.toMatch(/FstPrincipalAccess/)
    expect(gql).not.toMatch(/FstCommandReceipt/)
  })

  it('admin G1 mutations are NO_ACCESS', async () => {
    const gql = await fs.readFile(
      path.resolve('fst-web/dataconnect/fst-admin-connector/mutations.gql'),
      'utf8',
    )
    expect(gql).toMatch(/mutation UpsertFstCriticalStore[\s\S]*@auth\(level: NO_ACCESS\)/)
    expect(gql).toMatch(/mutation UpsertFstPrincipalAccess[\s\S]*@auth\(level: NO_ACCESS\)/)
    expect(gql).toMatch(/mutation UpdateFstCriticalStoreCas[\s\S]*@auth\(level: NO_ACCESS\)/)
  })

  it('client bundle sources do not import firebase-admin', async () => {
    const src = await fs.readFile(path.resolve('src/lib/warehouse/g1ServerClient.ts'), 'utf8')
    expect(src).not.toMatch(/firebase-admin/)
    expect(src).not.toMatch(/dataconnect-admin-generated/)
  })
})
