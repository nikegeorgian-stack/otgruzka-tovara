/**
 * PHASE G5.3 — print UI wiring helpers (snapshots + click-path kinds).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isCancelledStatus,
  isG5WarehousePrintDoc,
  purchaseOrderToPrintModel,
  receiptToPrintModel,
  reversalToPrintModel,
  salesOrderToPrintModel,
  shouldPrintChange,
  warehouseDocToReversalPrintModel,
} from '@/lib/print/g5PrintFromDomain'

describe('G5.3 print UI wiring helpers', () => {
  it('salesOrderToPrintModel prefers snapshots over live directory names', () => {
    const model = salesOrderToPrintModel(
      {
        id: 'so-1',
        orderNumber: 'ЗК-001',
        revision: 2,
        status: 'confirmed',
        customerId: 'c-live',
        customerCodeSnapshot: 'CUST-SNAP',
        customerNameSnapshot: 'Snap Customer',
        lines: [
          {
            lineId: 'sol-1',
            finishedProductId: 'fp-live',
            productCodeSnapshot: 'FP-SNAP',
            productNameSnapshot: 'Snap Product',
            unit: 'm2',
            quantity: 10,
            shippedQty: 2,
          },
        ],
      },
      {
        showPrices: false,
        directories: {
          customers: [{ id: 'c-live', code: 'LIVE-C', name: 'Live Customer' }],
          products: [{ id: 'fp-live', code: 'LIVE-FP', name: 'Live Product' }],
        },
      },
    )

    expect(model.kind).toBe('sales_order')
    expect(model.banner).toBe('ИЗМЕНЕНИЕ')
    expect(model.customerCodeSnapshot).toBe('CUST-SNAP')
    expect(model.customerNameSnapshot).toBe('Snap Customer')
    expect(model.lines[0].productCodeSnapshot).toBe('FP-SNAP')
    expect(model.lines[0].productNameSnapshot).toBe('Snap Product')
    expect(JSON.stringify(model)).not.toContain('Live Customer')
    expect(JSON.stringify(model)).not.toContain('Live Product')
  })

  it('freezes live directory names once when snapshots missing', () => {
    const model = salesOrderToPrintModel(
      {
        id: 'so-2',
        revision: 1,
        customerId: 'c-1',
        lines: [
          {
            id: 'l1',
            finishedProductId: 'fp-1',
            unit: 'mp',
            qtyMp: 5,
          },
        ],
      },
      {
        directories: {
          customers: [{ id: 'c-1', code: 'C1', name: 'Frozen Cust' }],
          products: [{ id: 'fp-1', code: 'P1', name: 'Frozen Prod' }],
        },
      },
    )
    expect(model.banner).toBeUndefined()
    expect(model.customerNameSnapshot).toBe('Frozen Cust')
    expect(model.lines[0].productNameSnapshot).toBe('Frozen Prod')
  })

  it('purchaseOrderToPrintModel uses PO snapshots and marks change via shouldPrintChange', () => {
    const order = {
      id: 'po-1',
      orderNumber: 'ЗЗ-9',
      revision: 3,
      status: 'ordered',
      supplierId: 's-live',
      supplierNameSnapshot: 'Snap Supplier',
      supplierCodeSnapshot: 'SUP-S',
      lines: [
        {
          lineId: 'pol-1',
          itemId: 'item-live',
          itemCodeSnapshot: 'RM-SNAP',
          itemNameSnapshot: 'Resin Snap',
          unit: 'kg',
          requestedQty: 100,
          receivedQty: 20,
        },
      ],
    }
    const model = purchaseOrderToPrintModel(order, {
      directories: {
        suppliers: [{ id: 's-live', code: 'LIVE-S', name: 'Live Supplier' }],
        items: [{ id: 'item-live', code: 'LIVE-RM', name: 'Live Resin' }],
      },
      showPrices: true,
    })
    expect(model.kind).toBe('purchase_order')
    expect(model.banner).toBe('ИЗМЕНЕНИЕ')
    expect(model.supplierNameSnapshot).toBe('Snap Supplier')
    expect(model.lines[0].itemNameSnapshot).toBe('Resin Snap')
    expect(JSON.stringify(model)).not.toContain('Live Supplier')
    expect(shouldPrintChange(order)).toBe(true)
    expect(shouldPrintChange({ revision: 1 }, { statusChanged: true })).toBe(true)
    expect(shouldPrintChange({ revision: 1 })).toBe(false)
  })

  it('reversalToPrintModel produces correct kind/banner for change and storno', () => {
    const change = reversalToPrintModel({
      kind: 'change',
      id: 'rev-c',
      originalDocRef: 'ЗЗ-9',
      revision: 2,
      reason: 'qty bump',
    })
    expect(change.kind).toBe('reversal')
    expect(change.banner).toBe('ИЗМЕНЕНИЕ')
    expect(change.reversalKind).toBe('change')

    const storno = reversalToPrintModel({
      kind: 'storno',
      id: 'rev-s',
      originalDocRef: 'ЗК-1',
      revision: 1,
      reason: 'cancelled',
      order: {
        id: 'so-x',
        customerNameSnapshot: 'Acme',
        lines: [
          {
            lineId: 'l1',
            productCodeSnapshot: 'FP',
            productNameSnapshot: 'Panel',
            unit: 'm2',
            quantity: 3,
          },
        ],
      },
    })
    expect(storno.banner).toBe('СТОРНО')
    expect(storno.lines[0].itemNameSnapshot).toBe('Panel')
    expect(isCancelledStatus('cancelled')).toBe(true)
    expect(isCancelledStatus('confirmed')).toBe(false)
  })

  it('receiptToPrintModel links PO number and remaining qty from snapshots', () => {
    const model = receiptToPrintModel(
      {
        id: 'wh-1',
        number: 'ПР-1',
        purchaseOrderId: 'po-1',
        warehouseId: 'wh',
        warehouseNameSnapshot: 'Main Snap',
        lines: [
          {
            lineId: 'rl-1',
            itemCodeSnapshot: 'RM-1',
            itemNameSnapshot: 'Resin',
            unit: 'kg',
            quantity: 40,
            batchNo: 'B1',
            expiryDate: '2027-01-01',
          },
        ],
      },
      {
        id: 'po-1',
        orderNumber: 'ЗЗ-10',
        lines: [
          {
            lineId: 'rl-1',
            requestedQty: 100,
            receivedQty: 40,
            itemCodeSnapshot: 'RM-1',
            itemNameSnapshot: 'Resin',
            unit: 'kg',
          },
        ],
      },
    )
    expect(model.kind).toBe('receipt')
    expect(model.purchaseOrderRef).toBe('ЗЗ-10')
    expect(model.warehouseDocumentNumber).toBe('ПР-1')
    expect(model.lines[0].batchNo).toBe('B1')
    expect(model.lines[0].remainingPoQty).toBe(60)
  })

  it('warehouseDocToReversalPrintModel uses СТОРНО banner', () => {
    const model = warehouseDocToReversalPrintModel({
      id: 'wh-r',
      number: 'ПР-1-R',
      reversesDocumentId: 'wh-orig',
      cancellationReason: 'wrong batch',
      lines: [
        {
          lineId: 'x',
          itemCodeSnapshot: 'RM',
          itemNameSnapshot: 'Resin',
          unit: 'kg',
          quantity: 10,
        },
      ],
    })
    expect(model.kind).toBe('reversal')
    expect(model.banner).toBe('СТОРНО')
    expect(model.originalDocRef).toBe('wh-orig')
    expect(isG5WarehousePrintDoc({ purchaseOrderId: 'po-1' })).toBe(true)
    expect(isG5WarehousePrintDoc({ type: 'receipt' })).toBe(false)
  })

  it('click-path: mock handlers called with expected model kinds', () => {
    const openPrint = vi.fn()
    const order = {
      id: 'po-click',
      orderNumber: 'ЗЗ-CLICK',
      revision: 2,
      status: 'ordered',
      supplierNameSnapshot: 'S',
      lines: [
        {
          lineId: 'l1',
          itemCodeSnapshot: 'I',
          itemNameSnapshot: 'N',
          unit: 'kg',
          requestedQty: 1,
          receivedQty: 0,
        },
      ],
    }

    // Simulate PurchaseOrderModal / ProcurementPage handlers
    const handlePrintOrder = (o: typeof order, opts: { showPrices: boolean }) => {
      openPrint(purchaseOrderToPrintModel(o, { showPrices: opts.showPrices }))
    }
    const handlePrintChange = (o: typeof order, opts: { showPrices: boolean }) => {
      openPrint(
        reversalToPrintModel({
          kind: 'change',
          id: `${o.id}-change`,
          originalDocRef: o.orderNumber,
          revision: o.revision,
          order: o,
          showPrices: opts.showPrices,
        }),
      )
    }
    const handlePrintCancel = (o: typeof order & { status: string }, opts: { showPrices: boolean }) => {
      openPrint(
        reversalToPrintModel({
          kind: 'storno',
          id: `${o.id}-cancel`,
          originalDocRef: o.orderNumber,
          order: o,
          showPrices: opts.showPrices,
        }),
      )
    }

    handlePrintOrder(order, { showPrices: false })
    handlePrintChange(order, { showPrices: true })
    handlePrintCancel({ ...order, status: 'cancelled' }, { showPrices: false })

    expect(openPrint).toHaveBeenCalledTimes(3)
    expect(openPrint.mock.calls[0][0].kind).toBe('purchase_order')
    expect(openPrint.mock.calls[1][0].kind).toBe('reversal')
    expect(openPrint.mock.calls[1][0].banner).toBe('ИЗМЕНЕНИЕ')
    expect(openPrint.mock.calls[2][0].kind).toBe('reversal')
    expect(openPrint.mock.calls[2][0].banner).toBe('СТОРНО')
  })
})

describe('G5.3 BOM approve UI surface', () => {
  it('PackagingRecipesDirectoryPanel exposes g5-bom-approve when canApproveBom', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/directories/PackagingRecipesDirectoryPanel.tsx'),
      'utf8',
    )
    expect(src).toContain('data-testid="g5-bom-approve"')
    expect(src).toContain('onApproveBom')
    expect(src).toContain('canApproveBom')
  })

  it('directoriesSlice approvePackagingBom calls g5MasterdataBomApprove', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/store/slices/directoriesSlice.ts'),
      'utf8',
    )
    expect(src).toContain('async approvePackagingBom')
    expect(src).toContain('g5MasterdataBomApprove')
  })
})
