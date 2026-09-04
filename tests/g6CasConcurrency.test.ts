/**
 * PHASE G6 — CAS concurrency: two capacity commands observe same expectedRevision;
 * one wins, loser gets 409; retry/idempotency; sibling domains preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  markWarehouseDomainActive,
  markSalesPlanningActive,
  markProcurementDomainActive,
  markMasterDataDomainActive,
  serializeCriticalPayload,
  fingerprintCriticalPayload,
} from '../api/fst/_g1CriticalHelpers.mjs'
import { G6_CAPS, defaultG6Capabilities } from '../api/fst/_g6Capabilities.mjs'

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

vi.mock('../api/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../api/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_CAPS = defaultG6Capabilities(
  Object.fromEntries(Object.values(G6_CAPS).map((k) => [k, true])),
)

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()

  calls.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const id = `${vars.storeId}::${vars.firebaseUid}`
      const row = dcState.principals.get(id)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  calls.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: dcState.critical },
  }))
  calls.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: dcState.receipts.get(vars.id) ?? null },
  }))
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!dcState.critical) throw new Error('missing')
    if (dcState.critical.revision !== vars.expectedRevision) throw new Error('revision_conflict')
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

function grant(caps: Record<string, unknown>, uid = 'u1') {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'planner',
    capabilitiesJson: JSON.stringify(caps),
    active: true,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(): any {
  return JSON.parse(String(dcState.critical!.payloadJson))
}

async function g6() {
  return import('../api/fst/_g6CapacityService.mjs')
}

function installCasBarrier(n = 2) {
  const realCas = calls.updateCas.getMockImplementation()!
  type Entry = {
    args: unknown[]
    resolve: (v: unknown) => void
    reject: (e: unknown) => void
  }
  const pending: Entry[] = []
  const observedRevisions: number[] = []

  calls.updateCas.mockImplementation((...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      const vars = args[1] as Record<string, unknown>
      observedRevisions.push(Number(vars.expectedRevision))
      pending.push({ args, resolve, reject })
      if (pending.length < n) return
      const firstRev = observedRevisions[0]
      for (const r of observedRevisions) {
        expect(r).toBe(firstRev)
      }
      void (async () => {
        const [winner, ...losers] = pending
        try {
          winner.resolve(await realCas(...winner.args))
        } catch (e) {
          winner.reject(e)
        }
        for (const loser of losers) {
          try {
            loser.resolve(await realCas(...loser.args))
          } catch (e) {
            loser.reject(e)
          }
        }
      })()
    })
  })

  return { observedRevisions, restore: () => calls.updateCas.mockImplementation(realCas) }
}

async function bootstrapCapacity() {
  grant({ ...ALL_CAPS, productionLineIds: ['*', '1', '2', 'pack'] })
  const svc = await g6()
  expect(
    (
      await svc.executeG6Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'g6-cas-act',
        commandType: 'capacity.domain.activate',
        command: { reason: 'cas' },
      })
    ).ok,
  ).toBe(true)

  let p = payload()
  p = markWarehouseDomainActive(p, 'u1')
  p = markMasterDataDomainActive(p, 'u1')
  p = markSalesPlanningActive(p, 'u1')
  p = markProcurementDomainActive(p, 'u1')
  p.domains.warehouse.movements = [
    { id: 'm-keep', type: 'receipt', warehouseId: 'wh-main', itemId: 'mat-keep', quantity: 42, at: '2026-09-04' },
  ]
  p.domains.sales.orders = [{ id: 'so-keep', status: 'confirmed' }]
  p.domains.planning.planningRuns = [{ id: 'pr-keep' }]
  p.domains.procurement.purchaseOrders = [{ id: 'po-keep' }]
  const json = serializeCriticalPayload(p)
  dcState.critical!.payloadJson = json
  dcState.critical!.fingerprint = fingerprintCriticalPayload(json)
  return svc
}

describe('G6 CAS concurrency', () => {
  it('two concurrent norm drafts: one wins, one 409; retry idempotent; siblings preserved', async () => {
    const svc = await bootstrapCapacity()
    const startRev = Number(dcState.critical!.revision)
    const whBefore = structuredClone(payload().domains.warehouse)
    const salesBefore = structuredClone(payload().domains.sales)
    const planBefore = structuredClone(payload().domains.planning)
    const procBefore = structuredClone(payload().domains.procurement)

    const barrier = installCasBarrier(2)
    const [a, b] = await Promise.all([
      svc.executeG6Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'cas-norm-a',
        commandType: 'capacity.norm.draft.save',
        command: {
          normId: 'cn-a',
          finishedProductId: 'fp-a',
          lineId: '1',
          stage: 'production',
          capacityM2PerShift: 10,
          effectiveFrom: '2026-01-01',
        },
      }),
      svc.executeG6Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'cas-norm-b',
        commandType: 'capacity.norm.draft.save',
        command: {
          normId: 'cn-b',
          finishedProductId: 'fp-b',
          lineId: '2',
          stage: 'production',
          capacityM2PerShift: 20,
          effectiveFrom: '2026-01-01',
        },
      }),
    ])
    barrier.restore()

    expect(barrier.observedRevisions).toHaveLength(2)
    expect(barrier.observedRevisions[0]).toBe(startRev)
    expect(barrier.observedRevisions[1]).toBe(startRev)

    const oks = [a, b].filter((r) => r.ok)
    const fails = [a, b].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(fails).toHaveLength(1)
    expect(fails[0].status).toBe(409)
    expect(fails[0].error).toBe('revision_conflict')

    const p = payload()
    expect(p.domains.warehouse.movements).toEqual(whBefore.movements)
    expect(p.domains.sales.orders).toEqual(salesBefore.orders)
    expect(p.domains.planning.planningRuns).toEqual(planBefore.planningRuns)
    expect(p.domains.procurement.purchaseOrders).toEqual(procBefore.purchaseOrders)

    const winnerKey = a.ok ? 'cas-norm-a' : 'cas-norm-b'
    const winnerNormId = a.ok ? 'cn-a' : 'cn-b'
    const receipts = p.commandReceipts ?? {}
    expect(receipts[winnerKey]).toBeTruthy()

    const retry = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: winnerKey,
      commandType: 'capacity.norm.draft.save',
      command: {
        normId: winnerNormId,
        finishedProductId: a.ok ? 'fp-a' : 'fp-b',
        lineId: a.ok ? '1' : '2',
        stage: 'production',
        capacityM2PerShift: 99,
        effectiveFrom: '2026-01-01',
      },
    })
    expect(retry.ok).toBe(true)
    expect(retry.idempotent === true || retry.recoveredFromEmbeddedReceipt === true).toBe(true)
    const norms = payload().domains.capacity.norms ?? []
    expect(norms.filter((n: { normId: string }) => n.normId === winnerNormId)).toHaveLength(1)

    // Loser retry with fresh key succeeds
    const loserNormId = a.ok ? 'cn-b' : 'cn-a'
    const loserRetry = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: `${a.ok ? 'cas-norm-b' : 'cas-norm-a'}-retry`,
      commandType: 'capacity.norm.draft.save',
      command: {
        normId: loserNormId,
        finishedProductId: a.ok ? 'fp-b' : 'fp-a',
        lineId: a.ok ? '2' : '1',
        stage: 'production',
        capacityM2PerShift: 20,
        effectiveFrom: '2026-01-01',
      },
    })
    expect(loserRetry.ok, String(loserRetry.error)).toBe(true)
    expect(payload().domains.capacity.norms.map((n: { normId: string }) => n.normId).sort()).toEqual([
      'cn-a',
      'cn-b',
    ])
  })
})
