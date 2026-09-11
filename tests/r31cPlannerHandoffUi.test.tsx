/**
 * R3.1C — Planner exposes one canonical issue-to-line action per exact reservation document.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AppUser } from '../src/lib/access/types'
import type { ProductionOrder } from '../src/lib/planner/types'
import type {
  ProductionLineLocationBinding,
  StockMovement,
  WarehouseDocument,
  WarehouseItem,
  WarehouseLocation,
} from '../src/lib/warehouse/types'

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tf: (key: string) => key,
    locale: 'ru',
  }),
}))

const order: ProductionOrder = {
  id: 'order-1',
  orderNumber: 'ЗП-2026-101',
  customer: 'EDU',
  productName: 'Celloplex 160',
  category: 'ratl1',
  totalQtyMp: 100,
  startDate: '2026-09-10',
  endDate: '2026-09-11',
  lineId: '1',
  priority: 'normal',
  status: 'active',
  planMode: 'even',
  recalcMode: 'auto',
  rawMaterialItemId: 'raw-item-1',
  packagingPlan: {
    recipeName: 'Учебная упаковка',
    stackDescription: '1 рулон',
    rollsPerPallet: 1,
    palletUnits: 1,
    palletsNeeded: 1,
    boxesNeeded: 0,
    topRolls: 1,
    rawRollsEstimated: 5,
  },
  dayPlans: [],
  history: [],
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
}

const reservationDocument: WarehouseDocument = {
  id: 'reservation-1',
  type: 'reservation',
  number: 'РЗ-2026-001',
  date: '2026-09-10',
  warehouseId: 'raw-wh-1',
  purpose: 'production_reservation',
  productionOrderId: order.id,
  status: 'posted',
  lines: [
    {
      lineId: 'reservation-line-1',
      itemId: 'raw-item-1',
      quantity: 5,
      inputUnit: 'рулон',
      batchNo: 'RAW-LOT-1',
      expiryDate: '2027-09-10',
    },
    {
      lineId: 'reservation-line-box',
      itemId: 'box-item-1',
      quantity: 2,
    },
    {
      lineId: 'reservation-line-pallet',
      itemId: 'pallet-item-1',
      quantity: 1,
    },
  ],
  createdAt: '2026-09-10T08:01:00.000Z',
}

const reserveMovement: StockMovement = {
  id: 'reserve-movement-1',
  itemId: 'raw-item-1',
  warehouseId: 'raw-wh-1',
  type: 'reserve',
  quantity: 5,
  date: '2026-09-10',
  documentId: reservationDocument.id,
  documentLineId: 'reservation-line-1',
  productionOrderId: order.id,
  createdAt: '2026-09-10T08:01:00.000Z',
}

const packagingReserveMovements: StockMovement[] = [
  {
    ...reserveMovement,
    id: 'reserve-movement-box',
    itemId: 'box-item-1',
    quantity: 2,
    documentLineId: 'reservation-line-box',
  },
  {
    ...reserveMovement,
    id: 'reserve-movement-pallet',
    itemId: 'pallet-item-1',
    quantity: 1,
    documentLineId: 'reservation-line-pallet',
  },
]

const reservationMovements = [reserveMovement, ...packagingReserveMovements]

const warehouseItems: WarehouseItem[] = [
  {
    id: 'raw-item-1',
    internalCode: 'RM-001',
    name: 'Сетка',
    categoryId: 'raw',
    warehouseId: 'raw-wh-1',
    unit: 'рулон',
    active: true,
    sortOrder: 1,
  },
  {
    id: 'box-item-1',
    internalCode: 'BOX-001',
    name: 'Коробка',
    categoryId: 'packaging',
    warehouseId: 'raw-wh-1',
    unit: 'шт',
    active: true,
    sortOrder: 2,
  },
  {
    id: 'pallet-item-1',
    internalCode: 'PALLET-001',
    name: 'Палета',
    categoryId: 'packaging',
    warehouseId: 'raw-wh-1',
    unit: 'шт',
    active: true,
    sortOrder: 3,
  },
]

const warehouseLocations: WarehouseLocation[] = [
  { id: 'raw-wh-1', name: 'Основной', sortOrder: 1 },
  { id: 'line-wh-1', name: 'Производство', sortOrder: 2 },
  { id: 'line-location-1', name: 'Линия 1', sortOrder: 3 },
]

const lineBinding: ProductionLineLocationBinding = {
  id: 'line-binding-1',
  lineId: '1',
  productionWarehouseId: 'line-wh-1',
  productionLocationId: 'line-location-1',
}

const keeper = {
  id: 'keeper-1',
  login: 'keeper',
  displayName: 'Кладовщик',
  roleId: 'warehouse_keeper',
  passwordHash: '',
  passwordSalt: '',
  active: true,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
} satisfies AppUser

describe('R3.1C Planner canonical material handoff', () => {
  it('exposes the narrow warehouse handoff tab only to the web keeper/sysadmin', async () => {
    const { canViewWarehouseCanonicalHandoff } = await import(
      '../src/lib/warehouse/warehouseHandoffView'
    )
    const { WAREHOUSE_WEB_TABS } = await import(
      '../src/components/warehouse/warehouseTypes'
    )

    expect(WAREHOUSE_WEB_TABS).toContain('materials')
    expect(canViewWarehouseCanonicalHandoff(true, keeper)).toBe(true)
    expect(
      canViewWarehouseCanonicalHandoff(true, {
        ...keeper,
        roleId: 'operations_director',
      }),
    ).toBe(false)
    expect(canViewWarehouseCanonicalHandoff(false, keeper)).toBe(false)
  })

  it('builds the command only from the exact posted reservation document', async () => {
    const {
      plannerReservationHandoffIdempotencyKey,
      preparePlannerReservationHandoff,
    } = await import('../src/lib/planner/plannerReservationHandoff')

    const result = preparePlannerReservationHandoff({
      order,
      reservationDocument,
      warehouseItems,
      warehouseMovements: reservationMovements,
      warehouseDocuments: [reservationDocument],
      warehouseLocations,
      productionLineBindings: [lineBinding],
      warehouseAccounting: [
        { id: 'raw-wh-1', warehouseId: 'raw-wh-1', status: 'active' },
        { id: 'line-wh-1', warehouseId: 'line-wh-1', status: 'active' },
      ],
      currentUser: keeper,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.rawWarehouseId).toBe(reservationDocument.warehouseId)
    expect(result.input.reservationDocumentId).toBe(reservationDocument.id)
    expect(result.input.lines).toEqual([
      {
        itemId: 'raw-item-1',
        quantity: 5,
        inputUnit: 'рулон',
        batchNo: 'RAW-LOT-1',
        expiryDate: '2027-09-10',
      },
    ])
    expect(result.input.lines.some((line) => line.itemId === 'box-item-1')).toBe(false)
    expect(result.input.lines.some((line) => line.itemId === 'pallet-item-1')).toBe(false)
    expect(result.input.idempotencyKey).toBe(
      plannerReservationHandoffIdempotencyKey(order.id, reservationDocument.id),
    )
  })

  it('fails closed for role, duplicate line binding, and exhausted reserve', async () => {
    const { preparePlannerReservationHandoff } = await import(
      '../src/lib/planner/plannerReservationHandoff'
    )
    const base = {
      order,
      reservationDocument,
      warehouseItems,
      warehouseMovements: reservationMovements,
      warehouseDocuments: [reservationDocument],
      warehouseLocations,
      productionLineBindings: [lineBinding],
      warehouseAccounting: [
        { id: 'raw-wh-1', warehouseId: 'raw-wh-1', status: 'active' as const },
        { id: 'line-wh-1', warehouseId: 'line-wh-1', status: 'active' as const },
      ],
      currentUser: keeper,
    }

    expect(
      preparePlannerReservationHandoff({
        ...base,
        currentUser: { ...keeper, roleId: 'operations_director' },
      }),
    ).toEqual({ ok: false, code: 'forbidden_role' })

    expect(
      preparePlannerReservationHandoff({
        ...base,
        productionLineBindings: [lineBinding, { ...lineBinding, id: 'line-binding-2' }],
      }),
    ).toEqual({ ok: false, code: 'line_binding_not_unique' })

    expect(
      preparePlannerReservationHandoff({
        ...base,
        warehouseMovements: [
          ...reservationMovements,
          {
            ...reserveMovement,
            id: 'unreserve-movement-1',
            documentId: 'release-1',
            type: 'unreserve',
          },
        ],
      }),
    ).toEqual({ ok: false, code: 'reservation_not_remaining' })
  })

  it('fails closed when the exact raw-material row is absent or ambiguous', async () => {
    const { preparePlannerReservationHandoff } = await import(
      '../src/lib/planner/plannerReservationHandoff'
    )
    const base = {
      order,
      reservationDocument,
      warehouseItems,
      warehouseMovements: reservationMovements,
      warehouseDocuments: [reservationDocument],
      warehouseLocations,
      productionLineBindings: [lineBinding],
      warehouseAccounting: [
        { id: 'raw-wh-1', warehouseId: 'raw-wh-1', status: 'active' as const },
        { id: 'line-wh-1', warehouseId: 'line-wh-1', status: 'active' as const },
      ],
      currentUser: keeper,
    }

    expect(
      preparePlannerReservationHandoff({
        ...base,
        order: { ...order, rawMaterialItemId: undefined },
      }),
    ).toEqual({ ok: false, code: 'raw_material_not_configured' })

    expect(
      preparePlannerReservationHandoff({
        ...base,
        reservationDocument: {
          ...reservationDocument,
          lines: reservationDocument.lines.filter((line) => line.itemId !== 'raw-item-1'),
        },
      }),
    ).toEqual({ ok: false, code: 'raw_material_line_missing' })

    expect(
      preparePlannerReservationHandoff({
        ...base,
        reservationDocument: {
          ...reservationDocument,
          lines: [
            ...reservationDocument.lines,
            {
              ...reservationDocument.lines[0]!,
              lineId: 'reservation-line-raw-duplicate',
              quantity: 1,
            },
          ],
        },
      }),
    ).toEqual({ ok: false, code: 'raw_material_line_ambiguous' })

    expect(
      preparePlannerReservationHandoff({
        ...base,
        warehouseMovements: reservationMovements.map((movement) =>
          movement.itemId === 'raw-item-1' ? { ...movement, quantity: 4 } : movement,
        ),
      }),
    ).toEqual({ ok: false, code: 'reservation_evidence_mismatch' })
  })

  it('renders one visible canonical action for the exact reservation document', async () => {
    const { PlannerMaterialsPanel } = await import(
      '../src/components/planner/PlannerMaterialsPanel'
    )
    const html = renderToStaticMarkup(
      createElement(PlannerMaterialsPanel, {
        orders: [order],
        warehouseItems,
        warehouseMovements: reservationMovements,
        warehouseDocuments: [reservationDocument],
        warehouseLocations,
        productionLineBindings: [lineBinding],
        warehouseAccounting: [
          { id: 'raw-wh-1', warehouseId: 'raw-wh-1', status: 'active' },
          { id: 'line-wh-1', warehouseId: 'line-wh-1', status: 'active' },
        ],
        onReserveOrder: () => ({ ok: true, lines: [] }),
        onUnreserveOrder: () => true,
        onTransferProductionOrderMaterials: async () => ({ ok: true }),
        currentUser: keeper,
      }),
    )

    expect(html).toContain('data-command-type="production.material.issueToLine"')
    expect(html).toContain('data-reservation-document-id="reservation-1"')
    expect(html).toContain('РЗ-2026-001')
    expect(html).toContain('Передать на линию')
    expect(html).not.toContain('production.request.post')
  })
})
