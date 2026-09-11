import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'

const dcState = {
  principal: null as Record<string, unknown> | null,
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
  upsertPrincipal: vi.fn(),
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

const STORE_ID = 'fibercell-main'
const ACTOR = { uid: 'procurement-user', email: 'procurement@example.test', claims: {} }
const DATE = '2026-09-10'
const WAREHOUSE_ID = 'wh-main'
const LOCATION_ID = 'loc-receipt'
const SUPPLIER_ID = 'supplier-1'
const ITEM_A = 'raw-a'
const ITEM_B = 'raw-b'
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((capability) => [capability, true])),
)

beforeEach(() => {
  dcState.critical = null
  dcState.receipts.clear()
  dcState.principal = {
    id: `${STORE_ID}::${ACTOR.uid}`,
    firebaseUid: ACTOR.uid,
    storeId: STORE_ID,
    roleId: 'procurement',
    capabilitiesJson: JSON.stringify(ALL_CAPS),
    active: true,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  }
  for (const call of Object.values(calls)) call.mockReset()
  calls.getPrincipal.mockImplementation(async () => ({
    data: { fstPrincipalAccesses: dcState.principal ? [dcState.principal] : [] },
  }))
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
    if (!dcState.critical || dcState.critical.revision !== vars.expectedRevision) {
      throw new Error('revision_conflict')
    }
    dcState.critical = { ...dcState.critical, ...vars }
  })
  calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (dcState.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    dcState.receipts.set(String(row.id), row)
  })
})

afterEach(() => vi.resetModules())

type G5Service = {
  executeG5Command: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

async function execute(
  service: G5Service,
  commandType: string,
  command: Record<string, unknown>,
  idempotencyKey: string,
) {
  return service.executeG5Command({
    actor: ACTOR,
    storeId: STORE_ID,
    idempotencyKey,
    commandType,
    command,
  })
}

function payload() {
  return JSON.parse(String(dcState.critical?.payloadJson)) as {
    domains: {
      procurement: { orders: Array<Record<string, unknown>> }
      warehouse: {
        locations: Array<Record<string, unknown>>
        documents: Array<Record<string, unknown>>
        movements: Array<Record<string, unknown>>
      }
    }
  }
}

async function setup(): Promise<G5Service> {
  const service = await import('../server/fst/_g5SalesProcurementService.mjs')
  for (const [commandType, key] of [
    ['masterdata.domain.activate', 'activate-master'],
    ['sales.domain.activate', 'activate-sales'],
    ['procurement.domain.activate', 'activate-procurement'],
  ] as const) {
    expect((await execute(service, commandType, { reason: 'test' }, key)).ok).toBe(true)
  }
  const helpers = await import('../server/fst/_g1CriticalHelpers.mjs')
  const marked = helpers.markWarehouseDomainActive(payload(), ACTOR.uid)
  marked.domains.warehouse.locations = [
    { id: WAREHOUSE_ID, warehouseId: WAREHOUSE_ID, active: true },
    { id: LOCATION_ID, warehouseId: WAREHOUSE_ID, active: true },
  ]
  dcState.critical!.payloadJson = helpers.serializeCriticalPayload(marked)
  for (const [id, code] of [
    [ITEM_A, 'RAW-A'],
    [ITEM_B, 'RAW-B'],
  ]) {
    expect(
      (
        await execute(
          service,
          'masterdata.item.upsert',
          { id, code, name: code, baseUnit: 'kg' },
          `item-${id}`,
        )
      ).ok,
    ).toBe(true)
  }
  expect(
    (
      await execute(
        service,
        'masterdata.supplier.upsert',
        {
          id: SUPPLIER_ID,
          code: 'SUP-1',
          name: 'Canonical supplier',
          suppliedItemIds: [ITEM_A, ITEM_B],
        },
        'supplier',
      )
    ).ok,
  ).toBe(true)
  return service
}

function createCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-clean-c',
    supplierId: SUPPLIER_ID,
    destinationWarehouseId: WAREHOUSE_ID,
    orderDate: DATE,
    requestedDeliveryDate: DATE,
    scope: 'domestic',
    category: 'raw_material',
    currency: 'GEL',
    lines: [
      { itemId: ITEM_A, requestedQty: 2.5, unit: 'kg' },
      { itemId: ITEM_B, requestedQty: 4, unit: 'kg' },
    ],
    ...overrides,
  }
}

describe('R3.1C authoritative procurement server contract', () => {
  it('creates one server-numbered draft and replays only the identical payload', async () => {
    const service = await setup()
    const first = await execute(
      service,
      'procurement.draft.create',
      createCommand(),
      'create-clean-c',
    )
    expect(first).toMatchObject({ ok: true, id: 'po-clean-c', status: 'draft' })
    expect(first.orderNumber).toMatch(/^ЗЗ-2026-\d+$/)
    const order = first.order as { lines: Array<{ lineId: string }> }
    expect(order.lines).toHaveLength(2)
    expect(new Set(order.lines.map((line) => line.lineId)).size).toBe(2)

    const revision = dcState.critical?.revision
    const replay = await execute(
      service,
      'procurement.draft.create',
      createCommand(),
      'create-clean-c',
    )
    expect(replay).toMatchObject({ ok: true, idempotent: true, id: 'po-clean-c' })
    expect(dcState.critical?.revision).toBe(revision)

    const changed = await execute(
      service,
      'procurement.draft.create',
      createCommand({ lines: [{ itemId: ITEM_A, requestedQty: 99, unit: 'kg' }] }),
      'create-clean-c',
    )
    expect(changed).toMatchObject({
      ok: false,
      error: 'procurement_draft_create_idempotency_conflict',
    })
    expect(dcState.critical?.revision).toBe(revision)
  })

  it.each([
    ['supplier', { supplierId: 'missing-supplier' }],
    ['destination', { destinationWarehouseId: 'missing-warehouse' }],
    ['item', { lines: [{ itemId: 'missing-item', requestedQty: 1, unit: 'kg' }] }],
    ['unit', { lines: [{ itemId: ITEM_A, requestedQty: 1, unit: 'm2' }] }],
    [
      'duplicate item',
      {
        lines: [
          { itemId: ITEM_A, requestedQty: 1, unit: 'kg' },
          { itemId: ITEM_A, requestedQty: 2, unit: 'kg' },
        ],
      },
    ],
    ['nonfinite', { lines: [{ itemId: ITEM_A, requestedQty: Number.NaN, unit: 'kg' }] }],
  ])('rejects invalid %s without a write', async (_label, overrides) => {
    const service = await setup()
    const revision = dcState.critical?.revision
    const before = JSON.stringify(payload().domains.procurement.orders)
    const result = await execute(
      service,
      'procurement.draft.create',
      createCommand(overrides),
      `bad-${_label}`,
    )
    expect(result.ok).toBe(false)
    expect(dcState.critical?.revision).toBe(revision)
    expect(JSON.stringify(payload().domains.procurement.orders)).toBe(before)
  })

  it('posts all remaining lines once with an exact replay graph', async () => {
    const service = await setup()
    const created = await execute(
      service,
      'procurement.draft.create',
      createCommand(),
      'create-receipt-order',
    )
    for (const [type, key] of [
      ['procurement.order.submit', 'submit'],
      ['procurement.order.approve', 'approve'],
      ['procurement.order.markOrdered', 'ordered'],
    ] as const) {
      expect((await execute(service, type, { id: 'po-clean-c' }, key)).ok).toBe(true)
    }
    const lines = (created.order as { lines: Array<Record<string, unknown>> }).lines.map(
      (line) => ({
        lineId: line.lineId,
        itemId: line.itemId,
        quantity: line.requestedQty,
        unit: line.unit,
        locationId: LOCATION_ID,
      }),
    )
    const command = {
      purchaseOrderId: 'po-clean-c',
      warehouseId: WAREHOUSE_ID,
      date: DATE,
      lines,
    }
    const first = await execute(
      service,
      'procurement.receipt.post',
      command,
      'receipt-clean-c',
    )
    expect(first).toMatchObject({
      ok: true,
      purchaseOrderId: 'po-clean-c',
      status: 'received',
      movementsCount: 2,
    })
    expect((first.document as { lines: unknown[] }).lines).toHaveLength(2)
    expect(first.movements).toHaveLength(2)
    const revision = dcState.critical?.revision

    const replay = await execute(
      service,
      'procurement.receipt.post',
      command,
      'receipt-clean-c',
    )
    expect(replay).toMatchObject({ ok: true, idempotent: true, movementsCount: 2 })
    expect(dcState.critical?.revision).toBe(revision)

    for (const [suffix, badLines] of [
      ['duplicate', [lines[0], lines[0]]],
      ['extra', [...lines, { ...lines[0], lineId: 'unknown-line' }]],
      ['nonfinite', [{ ...lines[0], quantity: Number.POSITIVE_INFINITY }]],
    ] as const) {
      const before = JSON.stringify(payload())
      const bad = await execute(
        service,
        'procurement.receipt.post',
        { ...command, lines: badLines },
        `bad-receipt-${suffix}`,
      )
      expect(bad.ok).toBe(false)
      expect(JSON.stringify(payload())).toBe(before)
    }

    const changedReplay = await execute(
      service,
      'procurement.receipt.post',
      { ...command, lines: [{ ...lines[0], quantity: 1 }] },
      'receipt-clean-c',
    )
    expect(changedReplay).toMatchObject({
      ok: false,
      error: 'procurement_receipt_idempotency_conflict',
    })

    const corrupted = payload()
    const originalMovement = corrupted.domains.warehouse.movements[0]!
    corrupted.domains.warehouse.movements.push({
      ...originalMovement,
      id: 'unexpected-duplicate-movement',
    })
    const helpers = await import('../server/fst/_g1CriticalHelpers.mjs')
    dcState.critical!.payloadJson = helpers.serializeCriticalPayload(corrupted)
    const corruptedRevision = dcState.critical?.revision
    const corruptReplay = await execute(
      service,
      'procurement.receipt.post',
      command,
      'receipt-clean-c',
    )
    expect(corruptReplay).toMatchObject({
      ok: false,
      error: 'procurement_receipt_authoritative_state_mismatch',
    })
    expect(dcState.critical?.revision).toBe(corruptedRevision)
  })
})
