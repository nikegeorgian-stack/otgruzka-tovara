/**
 * PHASE G2.1 — FEFO/FIFO batch allocation + client/server parity.
 */
import { describe, expect, it } from 'vitest'
import * as server from '../server/fst/_g2BatchAllocation.mjs'
import * as client from '../src/lib/warehouse/batchAllocation'

const FIXTURE_MOVEMENTS = [
  {
    id: 'm1',
    itemId: 'item-a',
    warehouseId: 'wh1',
    locationId: 'loc1',
    type: 'receipt',
    quantity: 10,
    batchNo: 'B-LATE',
    expiryDate: '2026-12-01',
    at: '2026-01-10T10:00:00.000Z',
  },
  {
    id: 'm2',
    itemId: 'item-a',
    warehouseId: 'wh1',
    locationId: 'loc1',
    type: 'receipt',
    quantity: 8,
    batchNo: 'B-EARLY',
    expiryDate: '2026-06-01',
    at: '2026-01-12T10:00:00.000Z',
  },
  {
    id: 'm3',
    itemId: 'item-b',
    warehouseId: 'wh1',
    type: 'receipt',
    quantity: 5,
    batchNo: 'FIFO-1',
    at: '2026-02-01T10:00:00.000Z',
  },
  {
    id: 'm4',
    itemId: 'item-b',
    warehouseId: 'wh1',
    type: 'receipt',
    quantity: 7,
    batchNo: 'FIFO-2',
    at: '2026-02-05T10:00:00.000Z',
  },
  {
    id: 'm5',
    itemId: 'item-a',
    warehouseId: 'wh1',
    locationId: 'loc1',
    type: 'reserve',
    quantity: 3,
    batchNo: 'B-EARLY',
    expiryDate: '2026-06-01',
    at: '2026-03-01T10:00:00.000Z',
  },
  // Same name different itemId — must not mix
  {
    id: 'm6',
    itemId: 'item-other',
    warehouseId: 'wh1',
    type: 'receipt',
    quantity: 100,
    batchNo: 'B-EARLY',
    expiryDate: '2026-06-01',
    at: '2026-01-01T10:00:00.000Z',
  },
]

describe('G2.1 FEFO/FIFO core', () => {
  it('FEFO picks nearer expiry first', () => {
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    const out = server.allocateBatchesFefoFifo(lots, 5, { today: '2026-04-01' })
    expect(out.ok).toBe(true)
    expect(out.allocations[0].batchNo).toBe('B-EARLY')
    expect(out.allocations[0].quantity).toBe(5)
  })

  it('FIFO without expiry uses earliest receipt', () => {
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-b',
      warehouseId: 'wh1',
    })
    const out = server.allocateBatchesFefoFifo(lots, 6)
    expect(out.ok).toBe(true)
    expect(out.allocations[0].batchNo).toBe('FIFO-1')
    expect(out.allocations[0].quantity).toBe(5)
    expect(out.allocations[1].batchNo).toBe('FIFO-2')
    expect(out.allocations[1].quantity).toBe(1)
  })

  it('splits across multiple lots', () => {
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    // B-EARLY available = 8-3 reserve = 5; need 9 → 5 + 4 from B-LATE
    const out = server.allocateBatchesFefoFifo(lots, 9, { today: '2026-04-01' })
    expect(out.ok).toBe(true)
    expect(out.allocations).toHaveLength(2)
    expect(out.allocations[0]).toMatchObject({ batchNo: 'B-EARLY', quantity: 5 })
    expect(out.allocations[1]).toMatchObject({ batchNo: 'B-LATE', quantity: 4 })
  })

  it('shortfall leaves no successful allocation', () => {
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-b',
      warehouseId: 'wh1',
    })
    const out = server.allocateBatchesFefoFifo(lots, 999)
    expect(out.ok).toBe(false)
    expect(out.error).toBe(server.BATCH_INSUFFICIENT)
  })

  it('reserved qty is unavailable to ordinary issue', () => {
    const avail = server.ordinaryAvailableQty(FIXTURE_MOVEMENTS, 'item-a', 'wh1')
    // physical 18 - reserved 3 = 15
    expect(avail).toBe(15)
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    const early = lots.find((l: { batchNo: string }) => l.batchNo === 'B-EARLY')
    expect(early.available).toBe(5)
  })

  it('manual override without reason is forbidden', () => {
    const out = server.allocateIssueLineBatches({
      movements: FIXTURE_MOVEMENTS,
      itemId: 'item-a',
      warehouseId: 'wh1',
      quantity: 1,
      manualBatchNo: 'B-LATE',
      manualOverrideReason: '',
    })
    expect(out.ok).toBe(false)
    expect(out.error).toBe(server.BATCH_OVERRIDE_REASON_REQUIRED)
  })

  it('same batchNo on different itemId does not mix', () => {
    const lots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    expect(lots.every((l: { itemId: string }) => l.itemId === 'item-a')).toBe(true)
    const total = lots.reduce((s: number, l: { physical: number }) => s + l.physical, 0)
    expect(total).toBe(18)
  })

  it('reversal restores qty to the correct lot', () => {
    const afterIssue = [
      ...FIXTURE_MOVEMENTS,
      {
        id: 'iss',
        itemId: 'item-a',
        warehouseId: 'wh1',
        locationId: 'loc1',
        type: 'issue',
        quantity: 2,
        batchNo: 'B-EARLY',
        expiryDate: '2026-06-01',
        at: '2026-04-01T12:00:00.000Z',
      },
    ]
    const before = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    const mid = server.buildBatchLotsFromMovements(afterIssue, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    const earlyBefore = before.find((l: { batchNo: string }) => l.batchNo === 'B-EARLY').physical
    const earlyMid = mid.find((l: { batchNo: string }) => l.batchNo === 'B-EARLY').physical
    expect(earlyMid).toBe(earlyBefore - 2)

    const afterRev = [
      ...afterIssue,
      {
        id: 'rev',
        itemId: 'item-a',
        warehouseId: 'wh1',
        locationId: 'loc1',
        type: 'receipt',
        quantity: 2,
        batchNo: 'B-EARLY',
        expiryDate: '2026-06-01',
        at: '2026-04-02T12:00:00.000Z',
      },
    ]
    const restored = server.buildBatchLotsFromMovements(afterRev, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    expect(restored.find((l: { batchNo: string }) => l.batchNo === 'B-EARLY').physical).toBe(
      earlyBefore,
    )
  })
})

describe('G2.1 client/server parity', () => {
  it('identical fixture → identical allocations', () => {
    const sLots = server.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    const cLots = client.buildBatchLotsFromMovements(FIXTURE_MOVEMENTS as never, {
      itemId: 'item-a',
      warehouseId: 'wh1',
    })
    expect(cLots).toEqual(sLots)

    const sAlloc = server.allocateBatchesFefoFifo(sLots, 9, { today: '2026-04-01' })
    const cAlloc = client.allocateBatchesFefoFifo(cLots, 9, { today: '2026-04-01' })
    expect(cAlloc).toEqual(sAlloc)
  })
})
