import { describe, expect, it } from 'vitest'
import { applyProductionRequestPost } from '../server/fst/_g3RequestPost.mjs'
import {
  CANONICAL_ORDER_LINEAGE_MISMATCH,
  CANONICAL_ORDER_REPLAN_REQUIRED,
  LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN,
  LEGACY_REQUEST_POST_PARTIAL_FOOTPRINT_FORBIDDEN,
  LEGACY_REQUEST_POST_REPLAY_MISMATCH,
  guardCanonicalOrderChange,
  resolveCompletedLegacyRequestPostReplay,
} from '../server/fst/_g3CanonicalLineage.mjs'

const WAREHOUSE = 'wh-main'
const PACK_WAREHOUSE = 'wh-pack'
const LOCATION = 'loc-line'
const PACK_LOCATION = 'loc-pack'
const ORDER = 'order-canonical'
const REQUEST = 'request-complete'
const DATE = '2026-09-10'
const NOW = `${DATE}T10:00:00.000Z`
const ACTOR = { uid: 'operator', email: 'operator@example.test' }

function warehouse() {
  return {
    locations: [
      { id: LOCATION, active: true },
      { id: PACK_LOCATION, active: true },
    ],
    items: [
      { id: 'raw-mesh', unit: 'roll', warehouseId: WAREHOUSE, active: true },
      { id: 'raw-impregnation', unit: 'kg', warehouseId: WAREHOUSE, active: true },
      { id: 'semi-finished', unit: 'm', warehouseId: WAREHOUSE, active: true },
      { id: 'finished-good', unit: 'm', warehouseId: WAREHOUSE, active: true },
    ],
    documents: [
      {
        id: 'seed',
        type: 'receipt',
        purpose: 'purchase',
        warehouseId: WAREHOUSE,
        status: 'posted',
        date: DATE,
        lines: [
          { lineId: 'seed-mesh', itemId: 'raw-mesh', quantity: 100 },
          { lineId: 'seed-imp', itemId: 'raw-impregnation', quantity: 100 },
        ],
      },
    ],
    movements: [
      {
        id: 'seed-mesh-movement',
        documentId: 'seed',
        type: 'receipt',
        warehouseId: WAREHOUSE,
        itemId: 'raw-mesh',
        quantity: 100,
        date: DATE,
      },
      {
        id: 'seed-imp-movement',
        documentId: 'seed',
        type: 'receipt',
        warehouseId: WAREHOUSE,
        itemId: 'raw-impregnation',
        quantity: 100,
        date: DATE,
      },
    ],
    auditLog: [],
    materialShortages: [],
    productionLineBindings: [
      {
        lineId: 'line-1',
        productionWarehouseId: WAREHOUSE,
        productionLocationId: LOCATION,
      },
      {
        lineId: 'pack',
        productionWarehouseId: PACK_WAREHOUSE,
        productionLocationId: PACK_LOCATION,
      },
    ],
  }
}

function production() {
  return {
    orders: [
      {
        id: ORDER,
        lineId: 'line-1',
        finishedProductId: 'finished-good',
        semiFinishedItemId: 'semi-finished',
      },
    ],
    shiftReports: [],
    wipBatches: [],
    finishedGoodsLots: [],
    auditLog: [],
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST,
    lineId: 'line-1',
    orderId: ORDER,
    shiftDate: DATE,
    shiftSlot: 'day',
    outputMp: 12.5,
    outputRolls: 2,
    semiFinishedItemId: 'semi-finished',
    warehouseItemId: 'semi-finished',
    consumeLines: [
      { itemId: 'raw-mesh', warehouseId: WAREHOUSE, quantity: 3 },
      { itemId: 'raw-impregnation', warehouseId: WAREHOUSE, quantity: 4 },
    ],
    ...overrides,
  }
}

function completed(overrides: Record<string, unknown> = {}) {
  const input = command(overrides)
  const applied = applyProductionRequestPost(
    production(),
    warehouse(),
    input,
    ACTOR,
    NOW,
  )
  expect(applied.ok).toBe(true)
  return { input, production: applied.production, warehouse: applied.warehouse }
}

function completedPack() {
  const input = command({
    requestId: `${REQUEST}-pack`,
    lineId: 'pack',
    outputMp: 20,
    outputRolls: 4,
    semiFinishedItemId: 'semi-finished',
    warehouseItemId: 'finished-good',
    finishedProductId: 'finished-good',
    packWarehouseId: PACK_WAREHOUSE,
    packLocationId: PACK_LOCATION,
    fgWarehouseId: PACK_WAREHOUSE,
    fgLocationId: PACK_LOCATION,
    consumeLines: [],
  })
  const applied = applyProductionRequestPost(
    production(),
    warehouse(),
    input,
    ACTOR,
    NOW,
  )
  expect(applied.ok).toBe(true)
  return { input, production: applied.production, warehouse: applied.warehouse }
}

describe('R3.1C strict legacy production.request.post replay', () => {
  it('rejects a new request with the dedicated no-write error', () => {
    const prod = production()
    const wh = warehouse()
    const before = JSON.stringify({ prod, wh })

    const result = resolveCompletedLegacyRequestPostReplay(prod, wh, command())

    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN)
    expect(JSON.stringify({ prod, wh })).toBe(before)
  })

  it('accepts only the exact completed footprint and returns original references', () => {
    const state = completed()
    const before = JSON.stringify(state)

    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      state.warehouse,
      state.input,
    )

    expect(result.ok).toBe(true)
    expect(result.result).toMatchObject({
      requestId: REQUEST,
      reportId: `sr-reqpost-${REQUEST}`,
      wipBatchId: `wip-reqpost-${REQUEST}`,
      idempotent: true,
      canonicalReplayVerified: true,
    })
    expect(result.production).toBe(state.production)
    expect(result.warehouse).toBe(state.warehouse)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects a partial historical footprint instead of repairing it', () => {
    const state = completed()
    const receiptId = `wh-doc-reqpost-${REQUEST}-wip`
    const partialWarehouse = {
      ...state.warehouse,
      movements: state.warehouse.movements.filter(
        (movement: { documentId?: string }) => movement.documentId !== receiptId,
      ),
    }

    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      partialWarehouse,
      state.input,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_PARTIAL_FOOTPRINT_FORBIDDEN)
    expect(result.reason).toBe('wip_receipt_movement_missing')
  })

  it.each([
    ['quantity', { outputMp: 13 }],
    ['order', { orderId: 'other-order' }],
    ['line', { lineId: 'line-2' }],
    ['location', { packLocationId: 'other-location' }],
    ['consume quantity', {
      consumeLines: [
        { itemId: 'raw-mesh', warehouseId: WAREHOUSE, quantity: 3.5 },
        { itemId: 'raw-impregnation', warehouseId: WAREHOUSE, quantity: 4 },
      ],
    }],
  ])('rejects changed %s replay payload', (_name, changed) => {
    const state = completed()
    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      state.warehouse,
      command(changed),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_REPLAY_MISMATCH)
  })

  it('rejects duplicate persisted effects', () => {
    const state = completed()
    const receipt = state.warehouse.documents.find(
      (document: { id?: string }) => document.id === `wh-doc-reqpost-${REQUEST}-wip`,
    )
    const duplicateWarehouse = {
      ...state.warehouse,
      documents: [...state.warehouse.documents, { ...receipt }],
    }

    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      duplicateWarehouse,
      state.input,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_REPLAY_MISMATCH)
    expect(result.reason).toBe('required_document_duplicate')
  })

  it('proves an exact pack graph with a distinct packaging warehouse', () => {
    const state = completedPack()
    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      state.warehouse,
      state.input,
    )

    expect(result.ok).toBe(true)
    expect(result.result).toMatchObject({
      finishedGoodsLotId: `lot-reqpost-${REQUEST}-pack`,
      packWarehouseId: PACK_WAREHOUSE,
      packLocationId: PACK_LOCATION,
      g4QcEntry: true,
    })
  })

  it('allows downstream lot state to advance without changing immutable production facts', () => {
    const state = completedPack()
    const progressedProduction = {
      ...state.production,
      finishedGoodsLots: state.production.finishedGoodsLots.map(
        (lot: Record<string, unknown>) => ({
          ...lot,
          qcStatus: 'released',
          quantityQcReleased: 20,
          quantityShipped: 5,
          quantityRemaining: 15,
        }),
      ),
    }

    const result = resolveCompletedLegacyRequestPostReplay(
      progressedProduction,
      state.warehouse,
      state.input,
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    ['report', 'shiftReports'],
    ['WIP batch', 'wipBatches'],
    ['audit', 'auditLog'],
  ])('rejects a completed-looking graph with missing %s', (_name, key) => {
    const state = completed()
    const partialProduction = { ...state.production, [key]: [] }
    const result = resolveCompletedLegacyRequestPostReplay(
      partialProduction,
      state.warehouse,
      state.input,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_PARTIAL_FOOTPRINT_FORBIDDEN)
  })

  it('detects a global deterministic movement-id collision', () => {
    const state = completed()
    const movementId = `mov-wh-doc-reqpost-${REQUEST}-wip-1`
    const duplicateWarehouse = {
      ...state.warehouse,
      movements: [
        ...state.warehouse.movements,
        {
          id: movementId,
          documentId: 'unrelated-document',
          type: 'receipt',
          warehouseId: 'unrelated-warehouse',
          itemId: 'unrelated-item',
          quantity: 1,
        },
      ],
    }
    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      duplicateWarehouse,
      state.input,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_REPLAY_MISMATCH)
    expect(result.reason).toBe('wip_receipt_movement_duplicate')
  })

  it('rejects an extra document linked only through the deterministic report', () => {
    const state = completed()
    const extraWarehouse = {
      ...state.warehouse,
      documents: [
        ...state.warehouse.documents,
        {
          id: 'nondeterministic-extra',
          type: 'issue',
          status: 'posted',
          shiftReportId: `sr-reqpost-${REQUEST}`,
        },
      ],
    }
    const result = resolveCompletedLegacyRequestPostReplay(
      state.production,
      extraWarehouse,
      state.input,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_REPLAY_MISMATCH)
    expect(result.reason).toBe('unexpected_request_document')
  })
})

function canonicalOrder() {
  return {
    id: ORDER,
    status: 'active',
    wipContractVersion: 1,
    totalQtyMp: 100,
    rawMaterialItemId: 'raw-mesh',
    rawMaterialQty: 5,
    semiFinishedItemId: 'semi-finished',
    reservationDocumentId: 'reservation-1',
  }
}

function canonicalWarehouse() {
  return {
    documents: [
      {
        id: 'reservation-1',
        status: 'posted',
        purpose: 'production_reservation',
        docRole: 'production_reservation',
        productionOrderId: ORDER,
        warehouseId: WAREHOUSE,
        lines: [{ lineId: 'reserve-line', itemId: 'raw-mesh', quantity: 5 }],
      },
    ],
    movements: [
      {
        id: 'reserve-movement',
        documentId: 'reservation-1',
        documentLineId: 'reserve-line',
        productionOrderId: ORDER,
        warehouseId: WAREHOUSE,
        itemId: 'raw-mesh',
        quantity: 5,
        type: 'reserve',
      },
    ],
    materialShortages: [],
  }
}

describe('R3.1C canonical WIP-v1 order.change guard', () => {
  it('allows a proven exact no-op without mutating either input', () => {
    const order = canonicalOrder()
    const wh = canonicalWarehouse()
    const before = JSON.stringify({ order, wh })

    const result = guardCanonicalOrderChange(order, wh, {
      orderId: ORDER,
      rawWarehouseId: WAREHOUSE,
      totalQtyMp: 100,
      rawMaterialItemId: 'raw-mesh',
      rawMaterialQty: 5,
      semiFinishedItemId: 'semi-finished',
    })

    expect(result).toMatchObject({
      ok: true,
      canonical: true,
      idempotent: true,
      canonicalLineagePreserved: true,
    })
    expect(JSON.stringify({ order, wh })).toBe(before)
  })

  it.each([
    ['raw warehouse', { orderId: ORDER, rawWarehouseId: 'other-warehouse', totalQtyMp: 100 }],
    ['raw item', { orderId: ORDER, rawWarehouseId: WAREHOUSE, rawMaterialItemId: 'other-item', totalQtyMp: 100 }],
    ['WIP item', { orderId: ORDER, rawWarehouseId: WAREHOUSE, semiFinishedItemId: 'other-wip', totalQtyMp: 100 }],
  ])('rejects changed canonical %s', (_name, changed) => {
    const result = guardCanonicalOrderChange(canonicalOrder(), canonicalWarehouse(), changed)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(CANONICAL_ORDER_LINEAGE_MISMATCH)
  })

  it.each([
    ['production quantity', { orderId: ORDER, rawWarehouseId: WAREHOUSE, totalQtyMp: 101 }],
    ['raw quantity', { orderId: ORDER, rawWarehouseId: WAREHOUSE, totalQtyMp: 100, rawMaterialQty: 6 }],
  ])('requires an explicit replan for changed %s', (_name, changed) => {
    const result = guardCanonicalOrderChange(canonicalOrder(), canonicalWarehouse(), changed)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(CANONICAL_ORDER_REPLAN_REQUIRED)
  })

  it('leaves untagged historical orders on the legacy path', () => {
    const result = guardCanonicalOrderChange(
      { ...canonicalOrder(), wipContractVersion: undefined },
      canonicalWarehouse(),
      { rawWarehouseId: WAREHOUSE, totalQtyMp: 101 },
    )
    expect(result).toEqual({ ok: true, canonical: false })
  })

  it('ignores a downstream non-reserve issue when proving the raw source warehouse', () => {
    const wh = canonicalWarehouse()
    wh.movements.push({
      id: 'line-consumption',
      documentId: 'line-issue',
      productionOrderId: ORDER,
      warehouseId: 'line-warehouse',
      itemId: 'raw-mesh',
      quantity: 1,
      type: 'issue',
      consumesReserve: false,
    })
    const result = guardCanonicalOrderChange(canonicalOrder(), wh, {
      orderId: ORDER,
      rawWarehouseId: WAREHOUSE,
      totalQtyMp: 100,
    })
    expect(result.ok).toBe(true)
    expect(result.canonicalLineagePreserved).toBe(true)
  })

  it('rejects a reservation document whose movement does not mesh', () => {
    const wh = canonicalWarehouse()
    wh.movements[0] = { ...wh.movements[0], quantity: 4 }
    const result = guardCanonicalOrderChange(canonicalOrder(), wh, {
      orderId: ORDER,
      rawWarehouseId: WAREHOUSE,
      totalQtyMp: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe(CANONICAL_ORDER_LINEAGE_MISMATCH)
    expect(result.reason).toBe('reservation_movement_mismatch')
  })
})
