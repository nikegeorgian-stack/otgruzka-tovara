/**
 * R2.9L — production.request.post atomicity: G2 WH + G3 WIP (+ G4 QC lot for pack).
 * Soft posted must not appear without durable effects; replay is idempotent.
 */
import { describe, expect, it } from 'vitest'
import {
  applyProductionRequestPost,
  normalizeRequestPostIdempotencyKey,
} from '../server/fst/_g3RequestPost.mjs'
import { G3_CAPS } from '../server/fst/_g3Capabilities.mjs'

const WH = 'wh-main'
const LOC = 'loc-prod'
const DATE = '2026-09-08'
const REQ = 'edu-cello-line-req-20260908'
const ORDER = 'edu-cello-planner-order-20260908'
const ACTOR = { uid: 'u-test', email: 'test@example.com' }
const NOW = `${DATE}T12:00:00.000Z`

function emptyWh(extraDocs = [], extraMovs = []) {
  return {
    locations: [{ id: LOC, name: 'Выработка', active: true }],
    items: [
      { id: 'i-mesh', name: 'Mesh', unit: 'рул', warehouseId: WH, active: true },
      { id: 'i-imp', name: 'РП-0003', unit: 'кг', warehouseId: WH, active: true },
      { id: 'i-sf', name: 'SF Celloplex', unit: 'п.м', warehouseId: WH, active: true },
      { id: 'i-fg', name: 'FG Celloplex', unit: 'п.м', warehouseId: WH, active: true },
    ],
    documents: [
      {
        id: 'doc-seed',
        type: 'receipt',
        number: 'ПР-SEED',
        date: DATE,
        warehouseId: WH,
        status: 'posted',
        purpose: 'purchase',
        lines: [
          { itemId: 'i-mesh', quantity: 20 },
          { itemId: 'i-imp', quantity: 200 },
        ],
        createdAt: NOW,
        postedAt: NOW,
      },
      ...extraDocs,
    ],
    movements: [
      {
        id: 'm1',
        type: 'receipt',
        itemId: 'i-mesh',
        quantity: 20,
        warehouseId: WH,
        documentId: 'doc-seed',
        at: NOW,
        date: DATE,
      },
      {
        id: 'm2',
        type: 'receipt',
        itemId: 'i-imp',
        quantity: 200,
        warehouseId: WH,
        documentId: 'doc-seed',
        at: NOW,
        date: DATE,
      },
      ...extraMovs,
    ],
    auditLog: [],
    productionLineBindings: [
      {
        lineId: 'line1',
        productionWarehouseId: WH,
        productionLocationId: LOC,
      },
      {
        lineId: 'pack',
        productionWarehouseId: WH,
        productionLocationId: LOC,
      },
    ],
  }
}

function emptyProd() {
  return {
    orders: [
      {
        id: ORDER,
        lineId: 'line1',
        finishedProductId: 'fp-1',
        semiFinishedItemId: 'i-sf',
        recipeNormSnapshot: { recipeVersionId: 'rv-1', contentHash: 'h' },
      },
    ],
    shiftReports: [],
    wipBatches: [],
    finishedGoodsLots: [],
    auditLog: [],
  }
}

function impregnationCmd(overrides = {}) {
  return {
    requestId: REQ,
    lineId: 'line1',
    orderId: ORDER,
    shiftDate: DATE,
    shiftSlot: 'day',
    outputMp: 12.5,
    outputRolls: 2,
    semiFinishedItemId: 'i-sf',
    warehouseItemId: 'i-sf',
    consumeLines: [
      { itemId: 'i-mesh', quantity: 2, warehouseId: WH },
      { itemId: 'i-imp', quantity: 150, warehouseId: WH },
    ],
    ...overrides,
  }
}

describe('R2.9L normalize idempotency key', () => {
  it('canonicalizes to prod-req-post:${requestId}', () => {
    expect(normalizeRequestPostIdempotencyKey(REQ, '')).toBe(`prod-req-post:${REQ}`)
    expect(normalizeRequestPostIdempotencyKey(REQ, REQ)).toBe(`prod-req-post:${REQ}`)
    expect(normalizeRequestPostIdempotencyKey(REQ, 'other')).toBe(`prod-req-post:${REQ}`)
  })
})

describe('R2.9L G3 capability production.request.post', () => {
  it('is a real G3 cap (not a broken alias)', () => {
    expect(G3_CAPS.REQUEST_POST).toBe('production.request.post')
    expect(Object.values(G3_CAPS)).toContain('production.request.post')
  })
})

describe('R2.9L impregnation request.post atomicity', () => {
  it('if consume stock fails, no docs / wip / lot are created (not posted)', () => {
    const wh = emptyWh()
    // drain mesh
    wh.movements.push({
      id: 'm-drain',
      type: 'issue',
      itemId: 'i-mesh',
      quantity: 20,
      warehouseId: WH,
      documentId: 'x',
      at: NOW,
      date: DATE,
    })
    const beforeDocs = wh.documents.length
    const out = applyProductionRequestPost(emptyProd(), wh, impregnationCmd(), ACTOR, NOW)
    expect(out.ok).toBe(false)
    expect(out.error).toBe('insufficient_stock')
    expect(wh.documents.length).toBe(beforeDocs)
  })

  it('success creates exactly one WIP receipt + issue set, one wipBatch, no FG lot', () => {
    const out = applyProductionRequestPost(
      emptyProd(),
      emptyWh(),
      impregnationCmd(),
      ACTOR,
      NOW,
    )
    expect(out.ok).toBe(true)
    expect(out.result.status).toBe('posted')
    const docs = out.warehouse.documents.filter((d) => d.productionRequestId === REQ)
    const receipts = docs.filter((d) => d.type === 'receipt')
    const issues = docs.filter((d) => d.type === 'issue')
    expect(receipts).toHaveLength(1)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(out.production.wipBatches.filter((b) => b.productionRequestId === REQ)).toHaveLength(1)
    expect(out.production.shiftReports.filter((r) => r.productionRequestId === REQ)).toHaveLength(1)
    expect(out.production.finishedGoodsLots ?? []).toHaveLength(0)
    expect(out.result.g4QcEntry).toBeFalsy()

    const movs = out.warehouse.movements.filter((m) => m.productionRequestId === REQ)
    expect(movs.length).toBeGreaterThanOrEqual(2)
  })

  it('replay returns same IDs without duplicating docs/wip', () => {
    const first = applyProductionRequestPost(
      emptyProd(),
      emptyWh(),
      impregnationCmd(),
      ACTOR,
      NOW,
    )
    expect(first.ok).toBe(true)
    const second = applyProductionRequestPost(
      first.production,
      first.warehouse,
      impregnationCmd(),
      ACTOR,
      NOW,
    )
    expect(second.ok).toBe(true)
    expect(second.result.idempotent).toBe(true)
    expect(second.result.wipBatchId).toBe(first.result.wipBatchId)
    expect(second.result.reportId).toBe(first.result.reportId)
    expect(
      second.warehouse.documents.filter((d) => d.productionRequestId === REQ),
    ).toHaveLength(
      first.warehouse.documents.filter((d) => d.productionRequestId === REQ).length,
    )
    expect(second.production.wipBatches.filter((b) => b.productionRequestId === REQ)).toHaveLength(1)
  })

  it('repairs missing WIP when issue already exists (partial historical)', () => {
    const issueId = `wh-doc-reqpost-${REQ}-issue-${WH}`
    const partialWh = emptyWh(
      [
        {
          id: issueId,
          type: 'issue',
          purpose: 'production_issue',
          docRole: 'production_issue',
          warehouseId: WH,
          date: DATE,
          number: 'ИС-PARTIAL',
          lines: [
            { lineId: 'a', itemId: 'i-mesh', quantity: 2 },
            { lineId: 'b', itemId: 'i-imp', quantity: 150 },
          ],
          status: 'posted',
          productionRequestId: REQ,
          productionOrderId: ORDER,
          postedAt: NOW,
          createdAt: NOW,
        },
      ],
      [
        {
          id: 'pm1',
          type: 'issue',
          itemId: 'i-mesh',
          quantity: 2,
          warehouseId: WH,
          documentId: issueId,
          at: NOW,
          date: DATE,
          productionRequestId: REQ,
        },
        {
          id: 'pm2',
          type: 'issue',
          itemId: 'i-imp',
          quantity: 150,
          warehouseId: WH,
          documentId: issueId,
          at: NOW,
          date: DATE,
          productionRequestId: REQ,
        },
      ],
    )
    const out = applyProductionRequestPost(emptyProd(), partialWh, impregnationCmd(), ACTOR, NOW)
    expect(out.ok).toBe(true)
    expect(out.result.idempotent).not.toBe(true)
    const docs = out.warehouse.documents.filter((d) => d.productionRequestId === REQ)
    expect(docs.filter((d) => d.id === issueId)).toHaveLength(1)
    expect(docs.filter((d) => d.type === 'receipt')).toHaveLength(1)
    expect(out.production.wipBatches).toHaveLength(1)
  })
})

describe('R2.9L pack request.post G4 QC entry', () => {
  it('if FG path required and pack succeeds, exactly one pending QC lot', () => {
    const cmd = impregnationCmd({
      lineId: 'pack',
      warehouseItemId: 'i-fg',
      finishedProductId: 'fp-1',
      semiFinishedItemId: 'i-sf',
      consumeLines: [],
    })
    const prod = emptyProd()
    prod.orders[0].lineId = 'pack'
    const out = applyProductionRequestPost(prod, emptyWh(), cmd, ACTOR, NOW)
    expect(out.ok).toBe(true)
    expect(out.result.g4QcEntry).toBe(true)
    expect(out.production.finishedGoodsLots).toHaveLength(1)
    expect(out.production.finishedGoodsLots[0].qcStatus).toBe('pending')
    expect(out.production.finishedGoodsLots[0].id).toBe(`lot-reqpost-${REQ}`)

    const replay = applyProductionRequestPost(out.production, out.warehouse, cmd, ACTOR, NOW)
    expect(replay.result.idempotent).toBe(true)
    expect(replay.production.finishedGoodsLots).toHaveLength(1)
  })
})

describe('R2.9L request.post binding/order snapshot fallback', () => {
  it('accepts explicit warehouse binding + orderSnapshot when critical empty', () => {
    const prod = { orders: [], shiftReports: [], wipBatches: [], finishedGoodsLots: [], auditLog: [] }
    const wh = emptyWh()
    wh.productionLineBindings = []
    const out = applyProductionRequestPost(
      prod,
      wh,
      impregnationCmd({
        consumeLines: [],
        productionWarehouseId: WH,
        productionLocationId: LOC,
        orderSnapshot: {
          id: ORDER,
          lineId: 'line1',
          finishedProductId: 'fp-1',
          semiFinishedItemId: 'i-sf',
        },
      }),
      ACTOR,
      NOW,
    )
    expect(out.ok).toBe(true)
    expect(out.production.wipBatches).toHaveLength(1)
    expect(
      out.warehouse.documents.some((d) => d.productionRequestId === REQ && d.type === 'receipt'),
    ).toBe(true)
  })

  it('replay with packLocationId realigns existing WIP location without duplicating docs', () => {
    const first = applyProductionRequestPost(
      emptyProd(),
      emptyWh(),
      impregnationCmd({
        consumeLines: [],
        productionWarehouseId: WH,
        productionLocationId: LOC,
      }),
      ACTOR,
      NOW,
    )
    expect(first.ok).toBe(true)
    const packLoc = 'edu-loc-pack'
    const replay = applyProductionRequestPost(
      first.production,
      first.warehouse,
      impregnationCmd({
        consumeLines: [],
        productionWarehouseId: WH,
        productionLocationId: LOC,
        packLocationId: packLoc,
      }),
      ACTOR,
      NOW,
    )
    expect(replay.ok).toBe(true)
    expect(replay.result.realignedPackLocation).toBe(true)
    const wipDocs = replay.warehouse.documents.filter(
      (d) => d.productionRequestId === REQ && d.type === 'receipt',
    )
    expect(wipDocs).toHaveLength(1)
    expect(wipDocs[0].lines[0].locationId).toBe(packLoc)
    expect(replay.production.wipBatches[0].locationId).toBe(packLoc)
    expect(
      replay.warehouse.movements.filter((m) => m.productionRequestId === REQ && m.type === 'receipt'),
    ).toHaveLength(1)
  })
})

describe('R2.9L false completed state guards', () => {
  it('G2-equivalent failure leaves production without posted request effects', () => {
    const out = applyProductionRequestPost(
      emptyProd(),
      emptyWh(),
      impregnationCmd({ consumeLines: [{ itemId: 'i-mesh', quantity: 999, warehouseId: WH }] }),
      ACTOR,
      NOW,
    )
    expect(out.ok).toBe(false)
    expect(out.production).toBeUndefined()
    expect(out.warehouse).toBeUndefined()
  })
})
