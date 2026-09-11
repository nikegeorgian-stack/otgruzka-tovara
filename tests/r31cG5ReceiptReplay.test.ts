import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'

const state = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as Record<string, unknown> | null,
  receipts: new Map<string, Record<string, unknown>>(),
}

const calls = {
  getPrincipal: vi.fn(),
  getCritical: vi.fn(),
  getReceipt: vi.fn(),
  upsertCritical: vi.fn(),
  updateCas: vi.fn(),
  insertReceipt: vi.fn(),
}

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'sales-user', email: 'sales@example.test', claims: {} }
const CUSTOMER = 'customer-c'
const PRODUCT = 'product-c'
const PRODUCTION_ORDER = 'production-order-c'
const DATE = '2026-09-10'
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((capability) => [capability, true])),
)

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  state.principals.clear()
  state.critical = null
  state.receipts.clear()
  state.principals.set(`${STORE}::${actor.uid}`, {
    id: `${STORE}::${actor.uid}`,
    firebaseUid: actor.uid,
    storeId: STORE,
    roleId: 'sales',
    capabilitiesJson: JSON.stringify(ALL_CAPS),
    active: true,
    revision: 1,
  })
  calls.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => ({
      data: {
        fstPrincipalAccesses: [
          state.principals.get(`${vars.storeId}::${vars.firebaseUid}`),
        ].filter(Boolean),
      },
    }),
  )
  calls.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: state.critical },
  }))
  calls.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: state.receipts.get(vars.id) ?? null },
  }))
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    state.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!state.critical || state.critical.revision !== vars.expectedRevision) {
      throw new Error('revision_conflict')
    }
    state.critical = {
      ...state.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
      updatedByUid: vars.updatedByUid,
    }
  })
  calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (state.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    state.receipts.set(String(row.id), row)
  })
})

afterEach(() => vi.resetModules())

async function service() {
  return import('../server/fst/_g5SalesProcurementService.mjs')
}

async function command(
  svc: Awaited<ReturnType<typeof service>>,
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  return svc.executeG5Command({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType,
    command: payload,
  })
}

function draft(quantity = 10) {
  return {
    id: 'sales-c',
    customerId: CUSTOMER,
    orderDate: DATE,
    priority: 1,
    lines: [
      {
        lineId: 'sales-line-c',
        finishedProductId: PRODUCT,
        quantity,
        unit: 'm2',
        requestedShipDate: DATE,
      },
    ],
  }
}

function draftFor(id: string, lineId: string, quantity = 10) {
  return {
    ...draft(quantity),
    id,
    lines: [{ ...draft(quantity).lines[0], lineId }],
  }
}

function setProductionOrders(orders: Array<Record<string, unknown>>) {
  const payload = JSON.parse(String(state.critical?.payloadJson))
  payload.domains.production.orders = orders
  state.critical = { ...state.critical, payloadJson: JSON.stringify(payload) }
}

function installCasBarrier(count = 2) {
  const realCas = calls.updateCas.getMockImplementation()!
  const pending: Array<{
    args: unknown[]
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }> = []
  calls.updateCas.mockImplementation(
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        pending.push({ args, resolve, reject })
        if (pending.length < count) return
        void (async () => {
          const [winner, ...losers] = pending
          try {
            winner.resolve(await realCas(...winner.args))
          } catch (error) {
            winner.reject(error)
          }
          for (const loser of losers) {
            try {
              loser.resolve(await realCas(...loser.args))
            } catch (error) {
              loser.reject(error)
            }
          }
        })()
      }),
  )
  return () => calls.updateCas.mockImplementation(realCas)
}

async function bootstrap(svc: Awaited<ReturnType<typeof service>>) {
  expect((await command(svc, 'masterdata.domain.activate', { reason: 'test' }, 'activate-md')).ok).toBe(true)
  expect((await command(svc, 'sales.domain.activate', { reason: 'test' }, 'activate-sales')).ok).toBe(true)
  expect(
    (
      await command(
        svc,
        'masterdata.product.upsert',
        { id: PRODUCT, code: 'CP160', name: 'Celloplex 160' },
        'product',
      )
    ).ok,
  ).toBe(true)
  expect(
    (
      await command(
        svc,
        'masterdata.customer.upsert',
        { id: CUSTOMER, code: 'EDU-C', name: 'Учебный клиент' },
        'customer',
      )
    ).ok,
  ).toBe(true)
}

describe('R3.1C generic G5 command receipt replay', () => {
  it('validates the sales draft tuple and initializes progress/linkage on the server', async () => {
    const svc = await service()
    await bootstrap(svc)
    const forged = draft() as Record<string, unknown> & { lines: Array<Record<string, unknown>> }
    forged.lines[0] = {
      ...forged.lines[0],
      linkedProductionOrderIds: [],
      producedQty: 9,
      releasedQty: 8,
      shippedQty: 7,
      remainingQty: 3,
    }
    const saved = await command(svc, 'sales.order.draft.save', forged, 'strict-draft')
    expect(saved).toMatchObject({ ok: true, status: 'draft' })
    expect(saved.order).toMatchObject({
      salesOrderContractVersion: 'g5-sales-order-v1',
      customerId: CUSTOMER,
      customerNameSnapshot: 'Учебный клиент',
      priority: 1,
      orderDate: DATE,
    })
    expect(saved.order.lines).toEqual([
      expect.objectContaining({
        lineId: expect.stringMatching(/^sol-[0-9a-f-]{36}$/),
        productNameSnapshot: 'Celloplex 160',
        unit: 'm2',
        linkedProductionOrderIds: [],
        producedQty: 0,
        releasedQty: 0,
        shippedQty: 0,
        remainingQty: 10,
      }),
    ])
    expect(saved.order.lines[0].lineId).not.toBe('sales-line-c')

    const invalidCases: Array<[string, Record<string, unknown>]> = [
      [
        'forged-production-link',
        {
          ...draft(),
          id: 'forged-production-link',
          lines: [
            {
              ...draft().lines[0],
              lineId: 'forged-production-link-line',
              linkedProductionOrderIds: ['client-forged-po'],
            },
          ],
        },
      ],
      ['bad-priority', { ...draft(), id: 'bad-priority', priority: 7 }],
      ['bad-date', { ...draft(), id: 'bad-date', orderDate: '2026-02-31' }],
      [
        'bad-unit',
        {
          ...draft(),
          id: 'bad-unit',
          lines: [{ ...draft().lines[0], lineId: 'bad-unit-line', unit: 'kg' }],
        },
      ],
      [
        'bad-quantity',
        {
          ...draft(),
          id: 'bad-quantity',
          lines: [{ ...draft().lines[0], lineId: 'bad-quantity-line', quantity: 'Infinity' }],
        },
      ],
      [
        'duplicate-lines',
        {
          ...draft(),
          id: 'duplicate-lines',
          lines: [draft().lines[0], { ...draft().lines[0], finishedProductId: PRODUCT }],
        },
      ],
    ]
    for (const [key, payload] of invalidCases) {
      calls.updateCas.mockClear()
      const rejected = await command(svc, 'sales.order.draft.save', payload, key)
      expect(rejected.ok, key).toBe(false)
      expect(calls.updateCas, key).not.toHaveBeenCalled()
    }
  })

  it('persists only exact unique WIP-v1 production links and revalidates them on confirm/replay', async () => {
    const svc = await service()
    await bootstrap(svc)
    setProductionOrders([
      {
        id: PRODUCTION_ORDER,
        wipContractVersion: 1,
        finishedProductId: PRODUCT,
        status: 'completed',
        totalQtyMp: 10,
      },
      {
        id: 'wrong-product-po',
        wipContractVersion: 1,
        finishedProductId: 'other-product',
        status: 'completed',
      },
      {
        id: 'legacy-po',
        finishedProductId: PRODUCT,
        status: 'completed',
      },
    ])

    const linkedDraft = draftFor('sales-linked', 'sales-linked-line')
    linkedDraft.lines[0] = {
      ...linkedDraft.lines[0],
      linkedProductionOrderIds: [PRODUCTION_ORDER],
    }
    const saved = await command(svc, 'sales.order.draft.save', linkedDraft, 'linked-draft')
    expect(saved).toMatchObject({
      ok: true,
      order: {
        lines: [expect.objectContaining({ linkedProductionOrderIds: [PRODUCTION_ORDER] })],
      },
    })

    // A status/progress change does not alter the semantic link tuple, so exact replay stays valid.
    const beforeReplay = JSON.parse(String(state.critical?.payloadJson))
    beforeReplay.domains.production.orders[0].status = 'closed'
    beforeReplay.domains.production.orders[0].producedQtyMp = 10
    state.critical = { ...state.critical, payloadJson: JSON.stringify(beforeReplay) }
    expect(
      await command(svc, 'sales.order.draft.save', linkedDraft, 'linked-draft'),
    ).toMatchObject({ ok: true, idempotent: true })

    const confirmed = await command(
      svc,
      'sales.order.confirm',
      { id: 'sales-linked' },
      'linked-confirm',
    )
    expect(confirmed).toMatchObject({
      ok: true,
      status: 'confirmed',
      order: {
        lines: [expect.objectContaining({ linkedProductionOrderIds: [PRODUCTION_ORDER] })],
      },
    })

    for (const [suffix, linkedProductionOrderIds, error] of [
      ['missing', ['missing-po'], 'production_order_not_found'],
      ['wrong-product', ['wrong-product-po'], 'production_order_lineage_mismatch'],
      ['legacy', ['legacy-po'], 'production_order_lineage_mismatch'],
      ['duplicate', [PRODUCTION_ORDER, PRODUCTION_ORDER], 'invalid_production_links'],
    ] as const) {
      const candidate = draftFor(`sales-${suffix}`, `line-${suffix}`)
      candidate.lines[0] = { ...candidate.lines[0], linkedProductionOrderIds }
      calls.updateCas.mockClear()
      expect(
        await command(svc, 'sales.order.draft.save', candidate, `link-${suffix}`),
      ).toMatchObject({ ok: false, error })
      expect(calls.updateCas).not.toHaveBeenCalled()
    }

    const staleDraft = draftFor('sales-stale-link', 'line-stale-link')
    staleDraft.lines[0] = {
      ...staleDraft.lines[0],
      linkedProductionOrderIds: [PRODUCTION_ORDER],
    }
    expect(
      await command(svc, 'sales.order.draft.save', staleDraft, 'stale-link-draft'),
    ).toMatchObject({ ok: true })
    const stalePayload = JSON.parse(String(state.critical?.payloadJson))
    stalePayload.domains.production.orders[0].finishedProductId = 'other-product'
    state.critical = { ...state.critical, payloadJson: JSON.stringify(stalePayload) }
    calls.updateCas.mockClear()
    expect(
      await command(svc, 'sales.order.confirm', { id: 'sales-stale-link' }, 'stale-link-confirm'),
    ).toMatchObject({ ok: false, error: 'production_order_lineage_mismatch' })
    expect(calls.updateCas).not.toHaveBeenCalled()
    expect(
      await command(svc, 'sales.order.draft.save', staleDraft, 'stale-link-draft'),
    ).toMatchObject({ ok: false, error: 'g5_receipt_state_mismatch' })
  })

  it('allocates sales numbers under CAS and preserves the winning number on edit', async () => {
    const svc = await service()
    await bootstrap(svc)
    const restore = installCasBarrier()
    const [first, second] = await Promise.all([
      command(svc, 'sales.order.draft.save', draftFor('sales-a', 'line-a'), 'draft-a'),
      command(svc, 'sales.order.draft.save', draftFor('sales-b', 'line-b'), 'draft-b'),
    ])
    restore()
    const winner = first.ok ? first : second
    const loser = first.ok ? second : first
    expect(winner).toMatchObject({ ok: true, orderNumber: 'ЗК-2026-001' })
    expect(loser).toMatchObject({ ok: false, error: 'revision_conflict' })

    const loserId = first.ok ? 'sales-b' : 'sales-a'
    const loserLineId = first.ok ? 'line-b' : 'line-a'
    const loserKey = first.ok ? 'draft-b' : 'draft-a'
    const retry = await command(
      svc,
      'sales.order.draft.save',
      draftFor(loserId, loserLineId),
      loserKey,
    )
    expect(retry).toMatchObject({ ok: true, orderNumber: 'ЗК-2026-002' })

    const winnerId = first.ok ? 'sales-a' : 'sales-b'
    const winnerLineId = String(winner.order.lines[0].lineId)
    const edited = await command(
      svc,
      'sales.order.draft.save',
      draftFor(winnerId, winnerLineId, 12),
      'winner-edit',
    )
    expect(edited).toMatchObject({ ok: true, orderNumber: 'ЗК-2026-001' })
    const authoritative = JSON.parse(String(state.critical?.payloadJson)).domains.sales.orders
    expect(new Set(authoritative.map((row: { orderNumber: string }) => row.orderNumber))).toEqual(
      new Set(['ЗК-2026-001', 'ЗК-2026-002']),
    )
  })

  it('binds command type and payload, then returns a current projection after unrelated CAS', async () => {
    const svc = await service()
    await bootstrap(svc)
    const first = await command(svc, 'sales.order.draft.save', draft(), 'sales-draft')
    expect(first).toMatchObject({ ok: true, id: 'sales-c', orderNumber: 'ЗК-2026-001' })
    expect(String(first.commandFingerprint)).toMatch(
      /^g5:sales\.order\.draft\.save:v1:sha256:[a-f0-9]{64}$/,
    )
    const stored = JSON.parse(String(state.receipts.get('sales-draft')?.resultJson))
    expect(stored.commandFingerprint).toBe(first.commandFingerprint)
    expect(stored.replayGuard?.version).toBe('g5-replay-guard-v1')
    expect(stored.sales).toBeUndefined()
    expect(stored.masterData).toBeUndefined()

    const unrelated = await command(
      svc,
      'masterdata.customer.upsert',
      { id: 'customer-other', code: 'OTHER', name: 'Другой клиент' },
      'customer-other',
    )
    expect(unrelated.ok).toBe(true)
    const currentRevision = Number(state.critical?.revision)
    calls.updateCas.mockClear()

    const replay = await command(svc, 'sales.order.draft.save', draft(), 'sales-draft')
    expect(replay).toMatchObject({
      ok: true,
      idempotent: true,
      criticalRevision: currentRevision,
      id: 'sales-c',
    })
    expect(replay.masterData.customers.some((row: { id: string }) => row.id === 'customer-other')).toBe(true)
    expect(replay.sales.orders.filter((row: { id: string }) => row.id === 'sales-c')).toHaveLength(1)
    expect(calls.updateCas).not.toHaveBeenCalled()

    expect(
      await command(svc, 'sales.order.draft.save', draft(11), 'sales-draft'),
    ).toMatchObject({ ok: false, error: 'g5_idempotency_conflict' })
    expect(
      await command(svc, 'sales.order.confirm', { id: 'sales-c' }, 'sales-draft'),
    ).toMatchObject({ ok: false, error: 'g5_idempotency_conflict' })
    expect(calls.updateCas).not.toHaveBeenCalled()
  })

  it('recovers an embedded-only receipt with current state and no second CAS', async () => {
    const svc = await service()
    await bootstrap(svc)
    expect((await command(svc, 'sales.order.draft.save', draft(), 'embedded-draft')).ok).toBe(true)
    expect(state.receipts.delete('embedded-draft')).toBe(true)
    calls.updateCas.mockClear()
    calls.insertReceipt.mockClear()

    const replay = await command(svc, 'sales.order.draft.save', draft(), 'embedded-draft')
    expect(replay).toMatchObject({
      ok: true,
      idempotent: true,
      recoveredFromEmbeddedReceipt: true,
      criticalRevision: Number(state.critical?.revision),
    })
    expect(calls.updateCas).not.toHaveBeenCalled()
    expect(calls.insertReceipt).toHaveBeenCalledTimes(1)
    expect(state.receipts.has('embedded-draft')).toBe(true)
  })

  it('rejects replay after its authoritative target changed under a different CAS', async () => {
    const svc = await service()
    await bootstrap(svc)
    expect((await command(svc, 'sales.order.draft.save', draft(), 'old-draft')).ok).toBe(true)
    expect((await command(svc, 'sales.order.draft.save', draft(12), 'new-draft')).ok).toBe(true)
    calls.updateCas.mockClear()

    expect(await command(svc, 'sales.order.draft.save', draft(), 'old-draft')).toMatchObject({
      ok: false,
      error: 'g5_receipt_state_mismatch',
    })
    expect(calls.updateCas).not.toHaveBeenCalled()
  })
})
