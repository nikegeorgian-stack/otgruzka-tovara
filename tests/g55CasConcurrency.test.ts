/**
 * PHASE G5.5 — deterministic CAS concurrency: two commands observe same expectedRevision,
 * only one wins; loser gets 409 revision_conflict; retry/idempotency behave correctly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'
import { G3_CAPS } from '../server/fst/_g3Capabilities.mjs'

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
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

vi.mock('../server/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({})),
  insertQcLotDecision: vi.fn(async () => undefined),
  listVerifiedLotAttachments: vi.fn(async () => []),
  upsertQcFinishedGoodsLot: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_qcStorage.mjs', () => ({
  buildQcStoragePath: vi.fn(() => 'path'),
  verifyStorageObject: vi.fn(async () => ({ ok: true })),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

const WH = 'wh-main'
const ITEM_A = 'item-a'
const ITEM_B = 'item-b'
const DATE = '2026-09-04'

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

async function g5() {
  return import('../server/fst/_g5SalesProcurementService.mjs')
}
async function g3() {
  return import('../server/fst/_g3ProductionService.mjs')
}

/**
 * Barrier: collect N concurrent CAS entries that share the same expectedRevision,
 * then let the first apply and the rest hit real CAS (revision_conflict).
 */
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
      // All N have entered CAS with their expectedRevision before any write.
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

async function bootstrapG5MasterData() {
  grant({
    ...ALL_CAPS,
    'production.read': true,
    'production.recipe.draft.edit': true,
    'production.recipe.approve': true,
    'production.order.edit': true,
    'production.order.confirm': true,
    productionLineIds: ['*', '1'],
  })
  const svc = await g5()
  expect(
    (await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'md-act',
      commandType: 'masterdata.domain.activate',
      command: { reason: 'g55-cas' },
    })).ok,
  ).toBe(true)
  expect(
    (await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sp-act',
      commandType: 'sales.domain.activate',
      command: { reason: 'g55-cas' },
    })).ok,
  ).toBe(true)

  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p.domains.warehouse.movements = [
    {
      id: 'm-keep',
      type: 'receipt',
      warehouseId: WH,
      itemId: 'mat-keep',
      quantity: 42,
      at: DATE,
    },
  ]
  p.domains.warehouse.documents = [{ id: 'doc-keep', type: 'receipt' }]
  p.domains.production.orders = [{ id: 'po-keep', status: 'draft', finishedProductId: 'fp-keep' }]
  p.domains.production.recipeVersions = []
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)
  return svc
}

describe('G5.5 CAS concurrency', () => {
  it('two concurrent masterdata.item.upsert: one wins, one 409; receipt only for winner; retry idempotent', async () => {
    const svc = await bootstrapG5MasterData()
    const startRev = Number(dcState.critical!.revision)
    const whBefore = structuredClone(payload().domains.warehouse)
    const prodBefore = structuredClone(payload().domains.production)

    const barrier = installCasBarrier(2)
    const [a, b] = await Promise.all([
      svc.executeG5Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'cas-item-a',
        commandType: 'masterdata.item.upsert',
        command: {
          id: ITEM_A,
          code: 'A',
          name: 'Item A',
          baseUnit: 'pcs',
          moq: 1,
          active: true,
        },
      }),
      svc.executeG5Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'cas-item-b',
        commandType: 'masterdata.item.upsert',
        command: {
          id: ITEM_B,
          code: 'B',
          name: 'Item B',
          baseUnit: 'pcs',
          moq: 1,
          active: true,
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
    const receipts = p.commandReceipts ?? {}
    const winnerKey = a.ok ? 'cas-item-a' : 'cas-item-b'
    const loserKey = a.ok ? 'cas-item-b' : 'cas-item-a'
    expect(receipts[winnerKey]).toBeTruthy()
    expect(receipts[loserKey]).toBeFalsy()

    // Sibling domains preserved after winner CAS
    expect(p.domains.warehouse.movements).toEqual(whBefore.movements)
    expect(p.domains.warehouse.documents).toEqual(whBefore.documents)
    expect(p.domains.production.orders).toEqual(prodBefore.orders)

    const items = p.domains.masterData.items ?? []
    const winnerItemId = a.ok ? ITEM_A : ITEM_B
    expect(items.filter((i: { id: string }) => i.id === winnerItemId)).toHaveLength(1)
    expect(items.filter((i: { id: string }) => i.id === (a.ok ? ITEM_B : ITEM_A))).toHaveLength(0)

    // Retry winner idempotencyKey → success, no duplicate domain rows
    const retry = await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: winnerKey,
      commandType: 'masterdata.item.upsert',
      command: {
        id: winnerItemId,
        code: a.ok ? 'A' : 'B',
        name: a.ok ? 'Item A' : 'Item B',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
      },
    })
    expect(retry.ok).toBe(true)
    expect(retry.idempotent === true || retry.recoveredFromEmbeddedReceipt === true).toBe(true)
    const itemsAfter = payload().domains.masterData.items ?? []
    expect(itemsAfter.filter((i: { id: string }) => i.id === winnerItemId)).toHaveLength(1)

    calls.updateCas.mockClear()
    const conflictingRetry = await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: winnerKey,
      commandType: 'masterdata.item.upsert',
      command: {
        id: winnerItemId,
        code: a.ok ? 'A' : 'B',
        name: 'changed payload',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
      },
    })
    expect(conflictingRetry).toMatchObject({ ok: false, error: 'g5_idempotency_conflict' })
    expect(calls.updateCas).not.toHaveBeenCalled()
  })

  it('concurrent G3 production.order.confirm: one 409, loser retry succeeds', async () => {
    grant({
      ...ALL_CAPS,
      'production.read': true,
      'production.recipe.draft.edit': true,
      'production.recipe.approve': true,
      'production.order.edit': true,
      'production.order.confirm': true,
      [G3_CAPS.ORDER_CONFIRM]: true,
      productionLineIds: ['*', '1'],
    })
    const svc5 = await g5()
    expect(
      (
        await svc5.executeG5Command({
          actor,
          storeId: STORE,
          idempotencyKey: 'md2',
          commandType: 'masterdata.domain.activate',
          command: { reason: 'g55' },
        })
      ).ok,
    ).toBe(true)
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    let p = payload()
    p = h.markWarehouseDomainActive(p, 'u1')
    p = h.markProductionDomainActive(p, 'u1')
    // packagingBomRequired=false products so confirm doesn't need BOM
    p.domains.masterData = {
      ...(p.domains.masterData ?? {}),
      finishedProducts: [
        { id: 'fp-a', code: 'A', name: 'A', active: true, packagingBomRequired: false },
        { id: 'fp-b', code: 'B', name: 'B', active: true, packagingBomRequired: false },
      ],
      items: [{ id: 'mat-1', code: 'M', name: 'Mat', baseUnit: 'pcs', active: true }],
      packagingBoms: [],
    }
    p.domains.warehouse.movements = [
      { id: 'm1', type: 'receipt', warehouseId: WH, itemId: 'mat-1', quantity: 100, at: DATE },
    ]
    p.domains.production.orders = []
    p.domains.production.recipeVersions = []
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
    dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

    const svc3 = await g3()
    await svc3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'rv',
      commandType: 'production.recipe.draft.save',
      command: {
        versionId: 'rv-1',
        recipeId: 'rec-1',
        versionNumber: 1,
        components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'pcs', normQty: 1 }],
        normBase: 'per_m2',
      },
    })
    await svc3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'rv-ap',
      commandType: 'production.recipe.version.approve',
      command: { versionId: 'rv-1' },
    })
    for (const [orderId, fp] of [
      ['ord-a', 'fp-a'],
      ['ord-b', 'fp-b'],
    ] as const) {
      expect(
        (
          await svc3.executeG3Command({
            actor,
            storeId: STORE,
            idempotencyKey: `d-${orderId}`,
            commandType: 'production.order.draft.save',
            command: {
              orderId,
              finishedProductId: fp,
              formulationRecipeId: 'rec-1',
              totalQtyMp: 1,
              startDate: DATE,
              endDate: DATE,
              lineId: '1',
            },
          })
        ).ok,
      ).toBe(true)
    }

    const startRev = Number(dcState.critical!.revision)
    const barrier = installCasBarrier(2)
    const [c1, c2] = await Promise.all([
      svc3.executeG3Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'confirm-a',
        commandType: 'production.order.confirm',
        command: { orderId: 'ord-a', rawWarehouseId: WH },
      }),
      svc3.executeG3Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'confirm-b',
        commandType: 'production.order.confirm',
        command: { orderId: 'ord-b', rawWarehouseId: WH },
      }),
    ])
    barrier.restore()

    expect(barrier.observedRevisions.every((r) => r === startRev)).toBe(true)
    const oks = [c1, c2].filter((r) => r.ok)
    const fails = [c1, c2].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(fails).toHaveLength(1)
    expect(fails[0].status).toBe(409)
    expect(fails[0].error).toBe('revision_conflict')

    const loserOrderId = c1.ok ? 'ord-b' : 'ord-a'
    const loserKey = c1.ok ? 'confirm-b' : 'confirm-a'
    // Fresh read + new idempotency key succeeds for the loser order
    const retry = await svc3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: `${loserKey}-retry`,
      commandType: 'production.order.confirm',
      command: { orderId: loserOrderId, rawWarehouseId: WH },
    })
    expect(retry.ok, String(retry.error)).toBe(true)
    const orders = payload().domains.production.orders
    expect(orders.find((o: { id: string }) => o.id === 'ord-a')?.status).toBe('active')
    expect(orders.find((o: { id: string }) => o.id === 'ord-b')?.status).toBe('active')
  })
})
