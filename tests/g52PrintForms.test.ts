/**
 * PHASE G5.2 — print models from fixture snapshots (no live directory lookup).
 */
import { describe, expect, it } from 'vitest'
import { buildG5PurchaseOrderPrintModel } from '@/lib/print/g5PurchaseOrderPrint'
import { buildG5ReceiptPrintModel } from '@/lib/print/g5ReceiptPrint'
import { buildG5ReversalPrintModel } from '@/lib/print/g5ReversalPrint'
import { buildG5SalesOrderPrintModel } from '@/lib/print/g5SalesOrderPrint'

describe('G5.2 print forms', () => {
  it('builds sales order print from snapshots only (no live names)', () => {
    const model = buildG5SalesOrderPrintModel(
      {
        id: 'so-1',
        number: 'ЗК-001',
        revision: 2,
        status: 'confirmed',
        customerCodeSnapshot: 'CUST-01',
        customerNameSnapshot: 'Acme Snap',
        actorName: 'Ivan Petrov',
        at: '2026-09-04T10:00:00.000Z',
        lines: [
          {
            lineId: 'sol-1',
            productCodeSnapshot: 'FP-SNAP',
            productNameSnapshot: 'Membrane Snap',
            unit: 'm2',
            qty: 100,
            shippedQty: 40,
            // remaining omitted — computed
            requestedShipDate: '2026-09-20',
            priority: 1,
          },
        ],
      },
      { showPrices: false },
    )

    expect(model.banner).toBe('ИЗМЕНЕНИЕ')
    expect(model.customerNameSnapshot).toBe('Acme Snap')
    expect(model.customerCodeSnapshot).toBe('CUST-01')
    expect(model.lines[0].productCodeSnapshot).toBe('FP-SNAP')
    expect(model.lines[0].productNameSnapshot).toBe('Membrane Snap')
    expect(model.lines[0].remainingQty).toBe(60)
    expect(model.showPrices).toBe(false)
    expect(model.signaturePlaces.length).toBeGreaterThan(0)
    // Must not invent directory names beyond snapshots
    expect(JSON.stringify(model)).not.toContain('Live Customer')
    expect(JSON.stringify(model)).not.toContain('directory')
  })

  it('marks sales order ИЗМЕНЕНИЕ only when revision > 1', () => {
    const first = buildG5SalesOrderPrintModel({
      id: 'so-2',
      revision: 1,
      customerCodeSnapshot: 'C',
      customerNameSnapshot: 'N',
      lines: [{ lineId: 'l1', unit: 'kg', qty: 10 }],
    })
    expect(first.banner).toBeUndefined()

    const changed = buildG5SalesOrderPrintModel({
      id: 'so-2',
      revision: 3,
      customerCodeSnapshot: 'C',
      customerNameSnapshot: 'N',
      lines: [{ lineId: 'l1', unit: 'kg', qty: 10, shippedQty: 2, remainingQty: 8 }],
    })
    expect(changed.banner).toBe('ИЗМЕНЕНИЕ')
    expect(changed.lines[0].remainingQty).toBe(8)
  })

  it('builds purchase order with MOQ / orderMultiple / shortages snapshots', () => {
    const model = buildG5PurchaseOrderPrintModel(
      {
        id: 'po-1',
        number: 'ЗЗ-10',
        revision: 1,
        supplierCodeSnapshot: 'SUP-9',
        supplierNameSnapshot: 'Supplier Snap',
        currency: 'USD',
        approvedByName: 'Approver A',
        approvedAt: '2026-09-01T12:00:00.000Z',
        lines: [
          {
            lineId: 'pol-1',
            itemCodeSnapshot: 'RM-1',
            itemNameSnapshot: 'Resin Snap',
            unit: 'kg',
            requestedQty: 500,
            receivedQty: 100,
            moq: 50,
            orderMultiple: 25,
            unitPrice: 12.5,
            currency: 'USD',
            requiredDate: '2026-09-15',
            eta: '2026-09-18',
            sourceShortageIds: ['sh-1', 'sh-2'],
          },
        ],
      },
      { showPrices: true },
    )

    expect(model.showPrices).toBe(true)
    expect(model.supplierNameSnapshot).toBe('Supplier Snap')
    expect(model.lines[0].remainingQty).toBe(400)
    expect(model.lines[0].moq).toBe(50)
    expect(model.lines[0].orderMultiple).toBe(25)
    expect(model.lines[0].sourceShortageIds).toEqual(['sh-1', 'sh-2'])
    expect(model.approvedByName).toBe('Approver A')
    expect(model.banner).toBeUndefined()

    const revised = buildG5PurchaseOrderPrintModel({
      id: 'po-1',
      revision: 2,
      supplierNameSnapshot: 'Supplier Snap',
      lines: [{ lineId: 'pol-1', unit: 'kg', requestedQty: 500, receivedQty: 100 }],
    })
    expect(revised.banner).toBe('ИЗМЕНЕНИЕ')
  })

  it('builds receipt with remaining PO qty math and warehouse doc number', () => {
    const model = buildG5ReceiptPrintModel({
      id: 'rcpt-1',
      number: 'ПР-77',
      purchaseOrderId: 'po-1',
      purchaseOrderNumber: 'ЗЗ-10',
      warehouseNameSnapshot: 'Main WH Snap',
      locationNameSnapshot: 'A-1',
      warehouseDocumentNumber: 'WH-R-100',
      actorName: 'Keeper K',
      at: '2026-09-04T11:00:00.000Z',
      lines: [
        {
          lineId: 'rl-1',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Resin Snap',
          unit: 'kg',
          receivedQty: 100,
          poRequestedQty: 500,
          poReceivedQtyAfter: 150,
          batchNo: 'B-9',
          expiryDate: '2027-01-01',
        },
      ],
    })

    expect(model.purchaseOrderRef).toBe('ЗЗ-10')
    expect(model.warehouseNameSnapshot).toBe('Main WH Snap')
    expect(model.warehouseDocumentNumber).toBe('WH-R-100')
    expect(model.lines[0].remainingPoQty).toBe(350) // 500 - 150
    expect(model.lines[0].batchNo).toBe('B-9')
    expect(model.lines[0].itemNameSnapshot).toBe('Resin Snap')
  })

  it('builds reversal with СТОРНО / ИЗМЕНЕНИЕ banners', () => {
    const storno = buildG5ReversalPrintModel({
      id: 'rev-1',
      originalDocRef: 'WH-R-100',
      kind: 'storno',
      revision: 1,
      reason: 'Wrong batch',
      actorName: 'Ops',
      at: '2026-09-04T12:00:00.000Z',
      lines: [
        {
          lineId: 'x1',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Resin Snap',
          unit: 'kg',
          qty: -100,
        },
      ],
    })
    expect(storno.banner).toBe('СТОРНО')
    expect(storno.originalDocRef).toBe('WH-R-100')
    expect(storno.reason).toBe('Wrong batch')

    const change = buildG5ReversalPrintModel({
      id: 'rev-2',
      originalDocRef: 'ЗК-001',
      kind: 'change',
      revision: 2,
      reason: 'Qty bump',
    })
    expect(change.banner).toBe('ИЗМЕНЕНИЕ')
  })
})
