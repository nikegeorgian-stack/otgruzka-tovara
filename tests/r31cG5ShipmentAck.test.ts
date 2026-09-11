import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptG5ShipmentCancelAck,
  acceptG5ShipmentPostAck,
  requireSingleG5ShipmentUsage,
} from '@/lib/warehouse/g5ShipmentAck'
import {
  canonicalG5ShipmentCancel,
  canonicalG5ShipmentPost,
  stableG5ShipmentJson,
} from '@/lib/warehouse/g5ShipmentIntegrityCore.mjs'

const POST = {
  shipmentId: 'shipment-1',
  salesOrderId: 'sales-1',
  salesLineId: 'line-1',
  finishedProductId: 'fp-1',
  finishedGoodsLotId: 'lot-1',
  quantity: 10,
  warehouseId: 'fg-wh',
  date: '2026-09-10',
  counterpartyId: 'customer-1',
  minimumCriticalRevision: 7,
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableG5ShipmentJson(value)).digest('hex')
}

function postAck() {
  const commandFingerprint = fingerprint(canonicalG5ShipmentPost(POST))
  const shipment = {
    id: POST.shipmentId,
    number: 'ПГ-20260910-01',
    status: 'posted',
    kind: 'finished_goods_shipment',
    groupKind: 'finished_goods_shipment',
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedProductId: POST.finishedProductId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseItemId: 'fg-item-1',
    unitSnapshot: 'm2',
    lotNumber: 'FG-LOT-1',
    warehouseId: POST.warehouseId,
    locationId: 'fg-loc',
    date: POST.date,
    counterpartyId: POST.counterpartyId,
    quantity: POST.quantity,
    qcDecisionId: 'decision-1',
    lotRevisionAtPost: 3,
    documentIds: ['doc-1'],
    commandFingerprint,
    postCommandFingerprint: commandFingerprint,
  }
  const document = {
    id: 'doc-1',
    status: 'posted',
    type: 'issue',
    purpose: 'loading',
    docRole: 'finished_goods_shipment',
    shipmentId: POST.shipmentId,
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseId: POST.warehouseId,
    date: POST.date,
    counterpartyId: POST.counterpartyId,
    commandFingerprint,
    number: 'РС-2026-001',
    lines: [
      {
        lineId: 'doc-line-1',
        itemId: 'fg-item-1',
        quantity: POST.quantity,
        batchNo: 'FG-LOT-1',
        locationId: 'fg-loc',
        unitSnapshot: 'm2',
      },
    ],
  }
  const movement = {
    id: 'movement-1',
    documentId: 'doc-1',
    documentLineId: 'doc-line-1',
    type: 'issue',
    shipmentId: POST.shipmentId,
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseId: POST.warehouseId,
    locationId: 'fg-loc',
    itemId: 'fg-item-1',
    batchNo: 'FG-LOT-1',
    date: POST.date,
    quantity: POST.quantity,
    unitSnapshot: 'm2',
    commandFingerprint,
  }
  const lot = {
    id: POST.finishedGoodsLotId,
    qcStatus: 'released',
    finishedProductId: POST.finishedProductId,
    warehouseId: POST.warehouseId,
    warehouseItemId: 'fg-item-1',
    locationId: 'fg-loc',
    lotNumber: 'FG-LOT-1',
    currentDecisionId: 'decision-1',
    lotRevision: 3,
    quantityQcReleased: 50,
    quantityShipped: 10,
    quantityRemaining: 40,
  }
  const order = {
    id: POST.salesOrderId,
    status: 'partially_shipped',
    lines: [
      {
        lineId: POST.salesLineId,
        finishedProductId: POST.finishedProductId,
        quantity: 40,
        shippedQty: 10,
        remainingQty: 30,
      },
    ],
  }
  return {
    criticalRevision: 8,
    touchesWarehouse: true,
    commandFingerprint,
    shipmentId: POST.shipmentId,
    status: 'posted',
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedProductId: POST.finishedProductId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseItemId: 'fg-item-1',
    unitSnapshot: 'm2',
    lotNumber: 'FG-LOT-1',
    warehouseId: POST.warehouseId,
    locationId: 'fg-loc',
    date: POST.date,
    counterpartyId: POST.counterpartyId,
    quantity: POST.quantity,
    quantityQcReleased: 50,
    quantityShipped: 10,
    quantityRemaining: 40,
    salesLineQuantity: 40,
    salesLineQuantityShipped: 10,
    salesLineQuantityRemaining: 30,
    salesStatus: 'partially_shipped',
    qcDecisionId: 'decision-1',
    lotRevisionAtPost: 3,
    documentId: 'doc-1',
    movementIds: ['movement-1'],
    warehouse: { loadingShipments: [shipment], documents: [document], movements: [movement] },
    production: {
      finishedGoodsLots: [lot],
      qcDecisions: [
        { id: 'decision-1', lotId: POST.finishedGoodsLotId, status: 'released', lotRevision: 3 },
      ],
    },
    sales: { orders: [order] },
  }
}

function cancelAck() {
  const base = postAck()
  const cancel = {
    shipmentId: POST.shipmentId,
    reason: 'customer request',
    date: POST.date,
    minimumCriticalRevision: 8,
  }
  const cancelFingerprint = fingerprint(canonicalG5ShipmentCancel(cancel))
  const source = base.warehouse.documents[0]
  const sourceMovement = base.warehouse.movements[0]
  const shipment = {
    ...base.warehouse.loadingShipments[0],
    status: 'cancelled',
    groupKind: 'finished_goods_shipment_cancel',
    cancellationReason: cancel.reason,
    cancellationDate: cancel.date,
    cancelCommandFingerprint: cancelFingerprint,
    reversalDocumentIds: ['doc-reversal-1'],
  }
  const reversal = {
    id: 'doc-reversal-1',
    status: 'posted',
    type: 'receipt',
    docRole: 'finished_goods_shipment_cancel',
    reversesDocumentId: 'doc-1',
    shipmentId: POST.shipmentId,
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseId: POST.warehouseId,
    cancellationReason: cancel.reason,
    date: cancel.date,
    commandFingerprint: cancelFingerprint,
    lines: [{ ...source.lines[0], lineId: 'doc-line-reversal-1' }],
  }
  const reversalMovement = {
    id: 'movement-reversal-1',
    documentId: 'doc-reversal-1',
    documentLineId: 'doc-line-reversal-1',
    type: 'receipt',
    reversesMovementId: sourceMovement.id,
    shipmentId: POST.shipmentId,
    salesOrderId: POST.salesOrderId,
    salesLineId: POST.salesLineId,
    finishedGoodsLotId: POST.finishedGoodsLotId,
    warehouseId: POST.warehouseId,
    locationId: 'fg-loc',
    itemId: 'fg-item-1',
    batchNo: 'FG-LOT-1',
    date: cancel.date,
    quantity: POST.quantity,
    unitSnapshot: 'm2',
    commandFingerprint: cancelFingerprint,
  }
  return {
    expected: cancel,
    ack: {
      ...base,
      criticalRevision: 9,
      commandFingerprint: cancelFingerprint,
      status: 'cancelled',
      reason: cancel.reason,
      date: cancel.date,
      quantityShipped: 0,
      quantityRemaining: 50,
      salesLineQuantityShipped: 0,
      salesLineQuantityRemaining: 40,
      salesStatus: 'confirmed',
      reversalDocumentIds: ['doc-reversal-1'],
      reversalMovementIds: ['movement-reversal-1'],
      warehouse: {
        loadingShipments: [shipment],
        documents: [source, reversal],
        movements: [sourceMovement, reversalMovement],
      },
      production: {
        ...base.production,
        finishedGoodsLots: [
          { ...base.production.finishedGoodsLots[0], quantityShipped: 0, quantityRemaining: 50 },
        ],
      },
      sales: {
        orders: [
          {
            ...base.sales.orders[0],
            status: 'confirmed',
            lines: [
              {
                ...base.sales.orders[0].lines[0],
                shippedQty: 0,
                remainingQty: 40,
              },
            ],
          },
        ],
      },
    },
  }
}

describe('R3.1C G5 shipment ACK and single-lot gate', () => {
  it('accepts one exact authoritative post ACK and only then invokes mirror callback', async () => {
    const mirror = vi.fn()
    const result = await acceptG5ShipmentPostAck(postAck(), POST, mirror)
    expect(result).toMatchObject({ ok: true, criticalRevision: 8 })
    expect(mirror).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['malformed', () => ({ ...postAck(), warehouse: undefined })],
    ['stale', () => ({ ...postAck(), criticalRevision: 7 })],
    [
      'wrong tuple',
      () => {
        const ack = postAck()
        ack.warehouse.documents[0].lines[0].quantity = 9
        return ack
      },
    ],
    ['wrong fingerprint', () => ({ ...postAck(), commandFingerprint: '0'.repeat(64) })],
  ])('rejects %s post ACK without invoking mirror callback', async (_label, makeAck) => {
    const mirror = vi.fn()
    const result = await acceptG5ShipmentPostAck(makeAck(), POST, mirror)
    expect(result).toEqual({ ok: false, error: 'sales_shipment_ack_mismatch' })
    expect(mirror).not.toHaveBeenCalled()
  })

  it.each([
    [
      'document item',
      () => {
        const ack = postAck()
        ack.warehouse.documents[0].lines[0].itemId = 'different-item'
        return ack
      },
    ],
    [
      'document location',
      () => {
        const ack = postAck()
        ack.warehouse.documents[0].lines[0].locationId = 'different-location'
        return ack
      },
    ],
    [
      'document batch',
      () => {
        const ack = postAck()
        ack.warehouse.documents[0].lines[0].batchNo = 'different-batch'
        return ack
      },
    ],
    [
      'document unit',
      () => {
        const ack = postAck()
        ack.warehouse.documents[0].lines[0].unitSnapshot = 'kg'
        return ack
      },
    ],
    [
      'movement unit',
      () => {
        const ack = postAck()
        ack.warehouse.movements[0].unitSnapshot = 'kg'
        return ack
      },
    ],
  ])('rejects wrong %s tuple before mirroring', async (_label, makeAck) => {
    const mirror = vi.fn()
    expect(await acceptG5ShipmentPostAck(makeAck(), POST, mirror)).toEqual({
      ok: false,
      error: 'sales_shipment_ack_mismatch',
    })
    expect(mirror).not.toHaveBeenCalled()
  })

  it('rejects extra cancelled movement, duplicate shipment identity, and non-finite ledger quantity', async () => {
    const fixtures = [
      (() => {
        const ack = postAck()
        const extra = { ...ack.warehouse.movements[0], id: 'movement-cancelled-extra' }
        Object.assign(extra, { cancelled: true })
        ack.warehouse.movements.push(extra)
        return ack
      })(),
      (() => {
        const ack = postAck()
        ack.warehouse.loadingShipments.push({ ...ack.warehouse.loadingShipments[0] })
        return ack
      })(),
      (() => {
        const ack = postAck()
        ack.warehouse.loadingShipments.push({
          ...ack.warehouse.loadingShipments[0],
          id: 'shipment-nan',
          quantity: Number.NaN,
          documentIds: [],
        })
        return ack
      })(),
    ]

    for (const ack of fixtures) {
      const mirror = vi.fn()
      expect(await acceptG5ShipmentPostAck(ack, POST, mirror)).toEqual({
        ok: false,
        error: 'sales_shipment_ack_mismatch',
      })
      expect(mirror).not.toHaveBeenCalled()
    }
  })

  it('accepts an exact cancel ACK and rejects a wrong reversal without mirror', async () => {
    const fixture = cancelAck()
    const mirror = vi.fn()
    expect(await acceptG5ShipmentCancelAck(fixture.ack, fixture.expected, mirror)).toMatchObject({
      ok: true,
      reversalDocumentIds: ['doc-reversal-1'],
    })
    expect(mirror).toHaveBeenCalledTimes(1)

    const wrong = cancelAck()
    wrong.ack.warehouse.movements[1].quantity = 9
    const blockedMirror = vi.fn()
    expect(
      await acceptG5ShipmentCancelAck(wrong.ack, wrong.expected, blockedMirror),
    ).toEqual({ ok: false, error: 'sales_shipment_ack_mismatch' })
    expect(blockedMirror).not.toHaveBeenCalled()
  })

  it('rejects mismatched cancel document lines and unexpected cancelled movements without mirror', async () => {
    const wrongLine = cancelAck()
    wrongLine.ack.warehouse.documents[1].lines[0].itemId = 'different-item'
    const extraMovement = cancelAck()
    const extra = {
      ...extraMovement.ack.warehouse.movements[1],
      id: 'movement-cancelled-extra',
    }
    Object.assign(extra, { cancelled: true })
    extraMovement.ack.warehouse.movements.push(extra)

    for (const fixture of [wrongLine, extraMovement]) {
      const mirror = vi.fn()
      expect(
        await acceptG5ShipmentCancelAck(fixture.ack, fixture.expected, mirror),
      ).toEqual({ ok: false, error: 'sales_shipment_ack_mismatch' })
      expect(mirror).not.toHaveBeenCalled()
    }
  })

  it('fails closed before a server loop for zero or multiple lot usages', () => {
    expect(requireSingleG5ShipmentUsage([])).toEqual({
      ok: false,
      error: 'warehouse.loading.errEmpty',
    })
    expect(requireSingleG5ShipmentUsage([{ lotId: 'a' }, { lotId: 'b' }])).toEqual({
      ok: false,
      error: 'sales_shipment_single_lot_required',
    })
    expect(requireSingleG5ShipmentUsage([{ lotId: 'a' }])).toEqual({
      ok: true,
      usage: { lotId: 'a' },
    })
  })
})
