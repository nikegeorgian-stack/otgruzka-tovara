import type { AppStore } from '@/lib/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { finishedWarehouseLocationId } from '@/lib/warehouse/loadingProfile'
import { LOADING_CONTAINERS } from '@/lib/warehouse/loading'
import type { UpsertLoadingShipmentInput } from '@/lib/warehouse/loadingShipments'
import type { LoadingShipment, LoadingShipmentLine, WarehouseStore } from '@/lib/warehouse/types'
import type { SalesOrder, SalesOrderLine } from './types'

const BOX_TARE_KG = 5
const PALLET_TARE_KG = 26
const STACK_NOTE = 'Палета → 2 коробки'

function inferContainerId(logistics?: string): string {
  if (!logistics) return 'c45'
  const s = logistics.toLowerCase()
  if (/45/.test(s)) return 'c45'
  if (/40\s*hc|40hc/.test(s)) return 'c40hc'
  if (/40/.test(s)) return 'c40'
  if (/20/.test(s)) return 'c20'
  if (/фура|truck/.test(s)) return 'fura'
  return 'c45'
}

function buildShipmentLine(line: SalesOrderLine, fp?: FinishedProduct): LoadingShipmentLine | null {
  const width = line.rollWidthM ?? fp?.rollWidthM ?? 0
  const gsm = line.targetGsm ?? fp?.grammageGsm ?? 0
  const areaM2 = line.qtyAreaM2 ?? 0
  const rolls = line.rolls ?? 0

  if (!line.productName.trim() || rolls <= 0 || width <= 0 || areaM2 <= 0) {
    return null
  }

  const areaPerRoll = areaM2 / rolls
  const rollLengthM =
    line.rollLengthM && line.rollLengthM > 0
      ? line.rollLengthM
      : Math.round((areaPerRoll / width) * 1000) / 1000
  const weightPerRollKg =
    gsm > 0 ? Math.round(((areaPerRoll * gsm) / 1000) * 1000) / 1000 : 0
  const rollsPerBox = line.rollsPerBox ?? 32
  const rollsPerPallet =
    line.palletPlaces && line.boxes && line.boxes > 0
      ? Math.round(rolls / line.palletPlaces)
      : 2 * rollsPerBox

  return {
    id: crypto.randomUUID(),
    finishedProductId: line.finishedProductId,
    name: line.productName,
    note: STACK_NOTE,
    rollLengthM,
    grammageGsm: gsm,
    rollWidthM: width,
    rolls,
    weightPerRollKg,
    areaPerRollM2: Math.round(areaPerRoll * 100) / 100,
    rollsPerBox,
    topRolls: 0,
    rollsPerPallet,
    palletLayers: 1,
    boxLayers: 2,
    palletTareKg: PALLET_TARE_KG,
    boxes: line.boxes ?? 0,
    boxTareKg: BOX_TARE_KG,
    palletPlaces: line.palletPlaces ?? 0,
    color: line.productColor ? undefined : 'белая',
    labelNote: line.labelNote,
    logoNote: '---',
  }
}

export function loadingShipmentForSalesLine(
  shipments: LoadingShipment[],
  salesOrderId: string,
  salesLineId: string,
): LoadingShipment | undefined {
  return shipments.find(
    (s) => s.salesOrderId === salesOrderId && s.salesLineId === salesLineId,
  )
}

export type SalesOrderLinkInfo = {
  orderId: string
  orderNumber: string
  lineId?: string
  lineName?: string
}

/** Связанный заказ клиента для документа погрузки */
export function resolveSalesOrderLink(
  shipment: Pick<LoadingShipment, 'salesOrderId' | 'salesLineId'>,
  orders: SalesOrder[],
): SalesOrderLinkInfo | null {
  if (!shipment.salesOrderId) return null
  const order = orders.find((o) => o.id === shipment.salesOrderId)
  if (!order) {
    return { orderId: shipment.salesOrderId, orderNumber: '—' }
  }
  const line = shipment.salesLineId
    ? order.lines.find((l) => l.id === shipment.salesLineId)
    : undefined
  return {
    orderId: order.id,
    orderNumber: order.orderNumber || '—',
    lineId: shipment.salesLineId,
    lineName: line?.productName,
  }
}

export function buildLoadingShipmentInputFromSales(
  order: SalesOrder,
  line: SalesOrderLine,
  warehouse: WarehouseStore,
  finishedProducts: FinishedProduct[],
): UpsertLoadingShipmentInput | null {
  const whId = finishedWarehouseLocationId(warehouse)
  if (!whId) return null

  const fp = line.finishedProductId
    ? finishedProducts.find((p) => p.id === line.finishedProductId)
    : undefined
  const shipmentLine = buildShipmentLine(line, fp)
  if (!shipmentLine) return null

  const containerId = inferContainerId(order.logistics)
  const container = LOADING_CONTAINERS.find((c) => c.id === containerId) ?? LOADING_CONTAINERS[4]!

  return {
    date: order.orderDate,
    warehouseId: whId,
    containerId,
    payloadKg: container.payloadKg,
    palletPlacesLimit: line.palletPlaces ?? container.palletPlaces,
    counterpartyId: order.counterpartyId,
    counterpartyName: order.customer,
    orderNo: `${order.orderNumber || order.customer} · ${line.productName}`,
    orderPlacedDate: order.orderDate,
    clientDueDate: order.dueDate,
    plannedProductionDate: order.suggestedProductionStart,
    region: order.region,
    logistics: order.logistics,
    orderNotes: order.note,
    salesOrderId: order.id,
    salesLineId: line.id,
    lines: [shipmentLine],
  }
}

export type OrderLoadingLinks = {
  combined?: LoadingShipment
  byLineId: Map<string, LoadingShipment>
  all: LoadingShipment[]
  allIds: string[]
}

/** Все калькуляции погрузки, привязанные к заказу клиента */
export function collectOrderLoadingShipments(
  shipments: LoadingShipment[],
  orderId: string,
): OrderLoadingLinks {
  const all = shipments.filter((s) => s.salesOrderId === orderId)
  const combined = all.find((s) => !s.salesLineId)
  const byLineId = new Map<string, LoadingShipment>()
  for (const s of all) {
    if (s.salesLineId) byLineId.set(s.salesLineId, s)
  }
  return {
    combined,
    byLineId,
    all,
    allIds: [...new Set(all.map((s) => s.id))],
  }
}

/** Сводная калькуляция: все позиции заказа в одном документе (контейнер) */
export function buildCombinedLoadingShipmentInputFromSales(
  order: SalesOrder,
  warehouse: WarehouseStore,
  finishedProducts: FinishedProduct[],
): UpsertLoadingShipmentInput | null {
  const whId = finishedWarehouseLocationId(warehouse)
  if (!whId || order.lines.length === 0) return null

  const shipmentLines: LoadingShipmentLine[] = []
  for (const line of order.lines) {
    const fp = line.finishedProductId
      ? finishedProducts.find((p) => p.id === line.finishedProductId)
      : undefined
    const sl = buildShipmentLine(line, fp)
    if (sl) shipmentLines.push(sl)
  }
  if (!shipmentLines.length) return null

  const containerId = inferContainerId(order.logistics)
  const container = LOADING_CONTAINERS.find((c) => c.id === containerId) ?? LOADING_CONTAINERS[4]!
  const totalPlaces = order.lines.reduce((s, l) => s + (l.palletPlaces ?? 0), 0)
  const totalArea = order.lines.reduce((s, l) => s + (l.qtyAreaM2 ?? 0), 0)
  const totalRolls = order.lines.reduce((s, l) => s + (l.rolls ?? 0), 0)
  const estGrossKg = shipmentLines.reduce(
    (s, l) => s + l.rolls * l.weightPerRollKg + l.boxes * l.boxTareKg + l.palletPlaces * l.palletTareKg,
    0,
  )

  return {
    date: order.orderDate,
    warehouseId: whId,
    containerId,
    payloadKg: Math.max(container.payloadKg, Math.ceil(estGrossKg * 1.02)),
    palletPlacesLimit: Math.max(totalPlaces, container.palletPlaces),
    counterpartyId: order.counterpartyId,
    counterpartyName: order.customer,
    orderNo: order.orderNumber || order.customer,
    orderPlacedDate: order.orderDate,
    clientDueDate: order.dueDate,
    plannedProductionDate: order.suggestedProductionStart,
    region: order.region,
    logistics: order.logistics,
    orderNotes: [
      order.note,
      totalRolls ? `${totalRolls} рул.` : '',
      totalArea ? `${Math.round(totalArea)} м²` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    salesOrderId: order.id,
    lines: shipmentLines,
  }
}

/** Обновить ссылки заказа клиента из документов погрузки на складе */
export function syncSalesOrderLoadingInStore(store: AppStore, orderId: string): AppStore {
  const idx = store.sales.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return store

  const links = collectOrderLoadingShipments(store.warehouse.loadingShipments ?? [], orderId)
  const order = store.sales.orders[idx]!
  const lines = order.lines.map((l) => ({
    ...l,
    loadingShipmentId: links.byLineId.get(l.id)?.id ?? undefined,
  }))

  const orders = [...store.sales.orders]
  orders[idx] = {
    ...order,
    lines,
    loadingShipmentIds: links.allIds,
    combinedLoadingShipmentId: links.combined?.id ?? undefined,
    updatedAt: new Date().toISOString(),
  }
  return { ...store, sales: { ...store.sales, orders } }
}
