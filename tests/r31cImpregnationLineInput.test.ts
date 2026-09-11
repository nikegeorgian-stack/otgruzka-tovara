import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  collectApprovedImpregnationLineInputs,
  type ApprovedImpregnationLineInput,
} from '@/lib/production/impregnationLineInput'
import type { ProductionStore } from '@/lib/production/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

const ORDER_ID = 'production-order-c'
const LINE_ID = '1'
const WAREHOUSE_ID = 'warehouse-production'
const LOCATION_ID = 'line-location-1'
const RUN_ID = 'mixer-run-c-001'
const RECEIPT_ID = 'mixer-receipt-c-001'
const ITEM_ID = 'impregnation-rp-0003'
const BATCH_NO = 'IMP-C-001'

type Decision = NonNullable<ProductionStore['impregnationQcDecisions']>[number]

function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: ORDER_ID,
    orderNumber: 'ЗП-2026-003',
    customer: 'EDU',
    productName: 'Celloplex 160',
    category: 'cat4',
    totalQtyMp: 100,
    startDate: '2026-09-10',
    endDate: '2026-09-10',
    lineId: LINE_ID,
    priority: 'normal',
    status: 'active',
    planMode: 'even',
    recalcMode: 'auto',
    dayPlans: [],
    history: [],
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  }
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'qc-decision-v1',
    decisionKey: `impregnation-qc:${RUN_ID}:v1`,
    decisionRevision: 1,
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    batchRunId: RUN_ID,
    batchReceiptDocumentId: RECEIPT_ID,
    outputWarehouseItemId: ITEM_ID,
    outputQuantity: 10,
    batchNo: BATCH_NO,
    labStatus: 'pass',
    decision: 'approved',
    decisionMethod: 'measured',
    visualOk: true,
    effective: true,
    actorUid: 'technologist-1',
    decidedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  }
}

function production(decisions: Decision[] = [decision()]): ProductionStore {
  return {
    requests: [],
    planner: { orders: [], nextOrderSeq: 1 },
    impregnationQcDecisions: decisions,
  }
}

function warehouse(): WarehouseStore {
  return {
    locations: [
      { id: WAREHOUSE_ID, name: 'Production warehouse', sortOrder: 1 },
      { id: LOCATION_ID, name: 'Line 1', sortOrder: 2 },
    ],
    categories: [],
    items: [
      {
        id: ITEM_ID,
        internalCode: 'FC-000160',
        name: 'Impregnation RP-0003',
        categoryId: '',
        warehouseId: WAREHOUSE_ID,
        unit: 'kg',
        active: true,
        sortOrder: 1,
      },
    ],
    documents: [
      {
        id: RECEIPT_ID,
        number: 'ПР-IMP-C-001',
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'batch_receipt',
        status: 'posted',
        date: '2026-09-10',
        warehouseId: WAREHOUSE_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
        batchRunId: RUN_ID,
        lines: [
          {
            lineId: 'receipt-line-1',
            itemId: ITEM_ID,
            quantity: 10,
            unitSnapshot: 'kg',
            locationId: LOCATION_ID,
            batchNo: BATCH_NO,
          } as WarehouseStore['documents'][number]['lines'][number] & { locationId: string },
        ],
        createdAt: '2026-09-10T09:59:00.000Z',
      },
    ],
    movements: [
      {
        id: 'mixer-receipt-movement-c-001',
        documentId: RECEIPT_ID,
        documentLineId: 'receipt-line-1',
        type: 'receipt',
        itemId: ITEM_ID,
        quantity: 10,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
        batchRunId: RUN_ID,
        batchNo: BATCH_NO,
        date: '2026-09-10',
        createdAt: '2026-09-10T09:59:00.000Z',
      } as WarehouseStore['movements'][number] & {
        productionLineId: string
        batchRunId: string
      },
    ],
    invoiceRegistry: [],
    auditLog: [],
  }
}

function collect(input?: {
  production?: ProductionStore
  warehouse?: WarehouseStore
  order?: ProductionOrder
  productionWarehouseId?: string
  productionLocationId?: string
}): ApprovedImpregnationLineInput[] {
  return collectApprovedImpregnationLineInputs({
    production: input?.production ?? production(),
    warehouse: input?.warehouse ?? warehouse(),
    order: input?.order ?? order(),
    productionWarehouseId: input?.productionWarehouseId ?? WAREHOUSE_ID,
    productionLocationId: input?.productionLocationId ?? LOCATION_ID,
  })
}

function addIssueMovement(
  store: WarehouseStore,
  quantity: number,
  overrides: Record<string, unknown> = {},
) {
  store.movements.push({
    id: `line-consumption-${store.movements.length}`,
    documentId: 'shift-consumption-1',
    type: 'issue',
    itemId: ITEM_ID,
    quantity,
    warehouseId: WAREHOUSE_ID,
    locationId: LOCATION_ID,
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    batchRunId: RUN_ID,
    batchNo: BATCH_NO,
    date: '2026-09-10',
    createdAt: '2026-09-10T11:00:00.000Z',
    ...overrides,
  } as WarehouseStore['movements'][number] & {
    productionLineId: string
    batchRunId: string
  })
}

describe('R3.1C approved impregnation line inputs', () => {
  it('projects an approved batch only from the exact order/line/warehouse/location/item/batch tuple', () => {
    expect(collect()).toEqual([
      {
        decisionId: 'qc-decision-v1',
        decisionKey: `impregnation-qc:${RUN_ID}:v1`,
        decisionRevision: 1,
        batchRunId: RUN_ID,
        batchNo: BATCH_NO,
        batchReceiptDocumentId: RECEIPT_ID,
        outputWarehouseItemId: ITEM_ID,
        outputQuantity: 10,
        availableQuantity: 10,
        unitSnapshot: 'kg',
      },
    ])
  })

  it('selects the one current effective approval after an older decision is superseded', () => {
    const oldDecision = decision({
      effective: false,
      supersededByDecisionId: 'qc-decision-v2',
      supersededAt: '2026-09-10T10:30:00.000Z',
    })
    const currentDecision = decision({
      id: 'qc-decision-v2',
      decisionKey: `impregnation-qc:${RUN_ID}:v2`,
      decisionRevision: 2,
      supersedesDecisionId: oldDecision.id,
      decidedAt: '2026-09-10T10:30:00.000Z',
    })

    expect(collect({ production: production([oldDecision, currentDecision]) })).toEqual([
      expect.objectContaining({
        decisionId: currentDecision.id,
        decisionKey: currentDecision.decisionKey,
        decisionRevision: 2,
      }),
    ])
  })

  it.each([
    ['a rejected current decision', [decision({ decision: 'rejected', labStatus: 'fail' })]],
    ['an explicitly ineffective approval', [decision({ effective: false })]],
    ['an approval without an effective marker', [decision({ effective: undefined })]],
    [
      'an approval marked as superseded',
      [decision({ supersededByDecisionId: 'qc-decision-v2' })],
    ],
    [
      'two conflicting effective decisions for one batch run',
      [
        decision(),
        decision({
          id: 'qc-decision-conflict',
          decisionKey: `impregnation-qc:${RUN_ID}:v2`,
          decisionRevision: 2,
        }),
      ],
    ],
    [
      'an approved and a rejected effective decision for one batch run',
      [
        decision(),
        decision({
          id: 'qc-decision-rejected-v2',
          decisionKey: `impregnation-qc:${RUN_ID}:v2`,
          decisionRevision: 2,
          decision: 'rejected',
          labStatus: 'fail',
        }),
      ],
    ],
  ])('fails closed for %s', (_label, decisions) => {
    expect(collect({ production: production(decisions) })).toEqual([])
  })

  it.each([
    [
      'decision order',
      (_store: WarehouseStore, decisions: Decision[]) => {
        decisions[0]!.productionOrderId = 'other-order'
      },
    ],
    [
      'decision line',
      (_store: WarehouseStore, decisions: Decision[]) => {
        decisions[0]!.productionLineId = '2'
      },
    ],
    [
      'receipt order',
      (store: WarehouseStore) => {
        store.documents[0]!.productionOrderId = 'other-order'
      },
    ],
    [
      'receipt line',
      (store: WarehouseStore) => {
        store.documents[0]!.productionLineId = '2'
      },
    ],
    [
      'receipt warehouse',
      (store: WarehouseStore) => {
        store.documents[0]!.warehouseId = 'other-warehouse'
      },
    ],
    [
      'receipt location',
      (store: WarehouseStore) => {
        ;(store.documents[0]!.lines[0] as { locationId?: string }).locationId = 'other-location'
      },
    ],
    [
      'receipt item',
      (store: WarehouseStore) => {
        store.documents[0]!.lines[0]!.itemId = 'other-item'
      },
    ],
    [
      'receipt batch number',
      (store: WarehouseStore) => {
        store.documents[0]!.lines[0]!.batchNo = 'OTHER-BATCH'
      },
    ],
    [
      'receipt movement order',
      (store: WarehouseStore) => {
        store.movements[0]!.productionOrderId = 'other-order'
      },
    ],
    [
      'receipt movement line',
      (store: WarehouseStore) => {
        ;(store.movements[0] as { productionLineId?: string }).productionLineId = '2'
      },
    ],
    [
      'receipt movement warehouse',
      (store: WarehouseStore) => {
        store.movements[0]!.warehouseId = 'other-warehouse'
      },
    ],
    [
      'receipt movement location',
      (store: WarehouseStore) => {
        store.movements[0]!.locationId = 'other-location'
      },
    ],
    [
      'receipt movement item',
      (store: WarehouseStore) => {
        store.movements[0]!.itemId = 'other-item'
      },
    ],
    [
      'receipt movement batch run',
      (store: WarehouseStore) => {
        ;(store.movements[0] as { batchRunId?: string }).batchRunId = 'other-run'
      },
    ],
    [
      'receipt movement batch number',
      (store: WarehouseStore) => {
        store.movements[0]!.batchNo = 'OTHER-BATCH'
      },
    ],
  ])('rejects a mismatched %s without a partial candidate', (_label, mutate) => {
    const store = warehouse()
    const decisions = [decision()]
    mutate(store, decisions)
    expect(collect({ warehouse: store, production: production(decisions) })).toEqual([])
  })

  it.each([
    [
      'receipt document quantity',
      (store: WarehouseStore, decisions: Decision[]) => {
        void decisions
        store.documents[0]!.lines[0]!.quantity = 9
      },
    ],
    [
      'receipt movement quantity',
      (store: WarehouseStore, decisions: Decision[]) => {
        void decisions
        store.movements[0]!.quantity = 9
      },
    ],
    [
      'QC decision output quantity',
      (_store: WarehouseStore, decisions: Decision[]) => {
        decisions[0]!.outputQuantity = 9
      },
    ],
  ])('rejects a mismatched %s', (_label, mutate) => {
    const store = warehouse()
    const decisions = [decision()]
    mutate(store, decisions)
    expect(collect({ warehouse: store, production: production(decisions) })).toEqual([])
  })

  it.each([
    ['NaN receipt', 'receipt', Number.NaN],
    ['infinite receipt', 'receipt', Number.POSITIVE_INFINITY],
    ['non-numeric receipt', 'receipt', 'not-a-number'],
    ['NaN issue', 'issue', Number.NaN],
    ['infinite issue', 'issue', Number.POSITIVE_INFINITY],
    ['non-numeric issue', 'issue', 'not-a-number'],
  ])('fails closed for an exact-tuple %s quantity', (_label, kind, quantity) => {
    const store = warehouse()
    if (kind === 'receipt') store.movements[0]!.quantity = quantity as number
    else addIssueMovement(store, quantity as number)
    expect(collect({ warehouse: store })).toEqual([])
  })

  it('requires exactly one receipt movement linked to the one document line', () => {
    const duplicated = warehouse()
    duplicated.movements.push({
      ...duplicated.movements[0]!,
      id: 'duplicate-receipt-movement',
    })
    expect(collect({ warehouse: duplicated })).toEqual([])

    const wrongLine = warehouse()
    wrongLine.movements[0]!.documentLineId = 'foreign-line'
    expect(collect({ warehouse: wrongLine })).toEqual([])
  })

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
  ])('rejects a %s QC decision output quantity', (_label, outputQuantity) => {
    expect(
      collect({
        production: production([decision({ outputQuantity })]),
      }),
    ).toEqual([])
  })

  it('returns the positive remaining batch balance and excludes a fully consumed batch', () => {
    const partiallyConsumed = warehouse()
    addIssueMovement(partiallyConsumed, 4)
    expect(collect({ warehouse: partiallyConsumed })).toEqual([
      expect.objectContaining({ outputQuantity: 10, availableQuantity: 6 }),
    ])

    const fullyConsumed = warehouse()
    addIssueMovement(fullyConsumed, 10)
    expect(collect({ warehouse: fullyConsumed })).toEqual([])
  })

  it.each([
    ['another order', { productionOrderId: 'other-order' }],
    ['another line', { productionLineId: '2' }],
    ['another warehouse', { warehouseId: 'other-warehouse' }],
    ['another location', { locationId: 'other-location' }],
    ['another item', { itemId: 'other-item' }],
    ['another mixer run', { batchRunId: 'other-run' }],
    ['another batch number', { batchNo: 'OTHER-BATCH' }],
  ])('does not subtract an issue from %s', (_label, overrides) => {
    const store = warehouse()
    addIssueMovement(store, 4, overrides)
    expect(collect({ warehouse: store })).toEqual([
      expect.objectContaining({ availableQuantity: 10 }),
    ])
  })

  it('ignores a cancelled exact-tuple issue movement', () => {
    const store = warehouse()
    addIssueMovement(store, 10, { cancelled: true })
    expect(collect({ warehouse: store })).toEqual([
      expect.objectContaining({ availableQuantity: 10 }),
    ])
  })

  it.each([
    [
      'inactive item',
      (store: WarehouseStore) => {
        store.items[0]!.active = false
      },
    ],
    [
      'missing unit snapshot',
      (store: WarehouseStore) => {
        store.items[0]!.unit = ''
      },
    ],
  ])('does not expose an input backed by an invalid item: %s', (_label, mutate) => {
    const store = warehouse()
    mutate(store)
    expect(collect({ warehouse: store })).toEqual([])
  })
})

describe('R3.1C shift-report UI lineage contract', () => {
  it('uses the authoritative selector and persists both QC-decision and mixer-run IDs', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/production/ProductionShiftReportPanel.tsx'),
      'utf8',
    )

    expect(source).toContain('collectApprovedImpregnationLineInputs({')
    expect(source).toContain('canonicalLineageRequired')
    expect(source).toContain('data-testid="production-shift-impregnation-batch"')
    expect(source).toContain('data-testid="production-shift-impregnation-quantity"')
    expect(source).toContain('impregnationQcDecisionId: selectedImpregnation.decisionId')
    expect(source).toContain('batchRunId: selectedImpregnation.batchRunId')
    expect(source).toContain('impregnationInput > selectedImpregnation.availableQuantity')
  })
})
