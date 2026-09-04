/**
 * PHASE G5.3 — print snapshot preference + activation flags (BOM/MRP covered in g53PackagingBomMrp).
 */
import { describe, expect, it } from 'vitest'
import { purchaseOrderToPrintModel, salesOrderToPrintModel } from '../src/lib/print/g5PrintFromDomain'
import { g5FlagsFromStore } from '../src/lib/planner/g5Activation'
import { packagingRecipeToBomComponents } from '../src/lib/planner/g5PackagingBom'
import { G5_ACTIVATION_CONFIRM_PHRASE } from '../src/lib/planner/g5ActivationScan'
import type { PackagingRecipe } from '../src/lib/packaging/types'

describe('G5.3 invariants', () => {
  it('print helpers prefer snapshots over live names', () => {
    const model = salesOrderToPrintModel(
      {
        id: 'so-1',
        orderNumber: 'SO-1',
        revision: 2,
        customerCodeSnapshot: 'C-OLD',
        customerNameSnapshot: 'Old Customer',
        customer: 'ShouldNotAppear',
        lines: [
          {
            id: 'l1',
            productCodeSnapshot: 'P-OLD',
            productNameSnapshot: 'Old Product',
            productName: 'Live Name',
            qtyMp: 10,
            shippedQty: 2,
          },
        ],
      },
      { showPrices: false },
    )
    expect(model.kind).toBe('sales_order')
    expect(model.banner).toBe('ИЗМЕНЕНИЕ')
    expect(model.customerNameSnapshot).toBe('Old Customer')
    expect(JSON.stringify(model)).not.toContain('Live Name')
    expect(JSON.stringify(model)).not.toContain('ShouldNotAppear')
  })

  it('PO print uses supplier snapshot', () => {
    const model = purchaseOrderToPrintModel(
      {
        id: 'po-1',
        orderNumber: 'PO-1',
        status: 'approved',
        supplierNameSnapshot: 'Snap Supplier',
        supplierCodeSnapshot: 'S-1',
        lines: [
          { id: 'pl1', itemCodeSnapshot: 'I-1', itemNameSnapshot: 'Film', quantity: 5, unit: 'kg' },
        ],
      },
      { showPrices: false },
    )
    expect(model.kind).toBe('purchase_order')
    expect(JSON.stringify(model)).toContain('Snap Supplier')
  })

  it('g5FlagsFromStore does not invent activation for ordinary store', () => {
    const flags = g5FlagsFromStore({
      production: {},
      warehouse: {},
    } as Parameters<typeof g5FlagsFromStore>[0])
    expect(flags.masterDataActive).toBe(false)
    expect(flags.salesPlanningActive).toBe(false)
    expect(flags.procurementActive).toBe(false)
  })

  it('activation confirm phrase is exact typed gate (not a soft toggle)', () => {
    expect(G5_ACTIVATION_CONFIRM_PHRASE).toBe('ACTIVATE G5')
  })

  it('explicit components beat stack; pallet/box are ordinary itemIds', () => {
    const recipe = {
      id: 'r1',
      code: 'R1',
      name: 'R1',
      active: true,
      palletItemId: 'should-ignore',
      boxItemId: 'should-ignore-box',
      rollsPerBox: 4,
      stack: ['pallet', 'box'],
      components: [
        { itemId: 'item-film', quantity: 2, unit: 'm' },
        { itemId: 'item-label', quantity: 1, unit: 'pcs', wasteFactor: 0.05 },
      ],
    } as PackagingRecipe & {
      components: Array<{ itemId: string; quantity: number; unit: string; wasteFactor?: number }>
    }
    const comps = packagingRecipeToBomComponents(recipe)
    expect(comps.map((c) => c.itemId)).toEqual(['item-film', 'item-label'])
    expect(comps.some((c) => c.itemId === 'should-ignore')).toBe(false)
  })
})
