import type { PlannerOrderCategory } from '@/lib/planner/types'
import type { ProductionLineId } from '@/lib/production/types'

/** Legacy единый статус (канбан / старые экраны) — зеркало commercial+fulfillment */
export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'completed'
  | 'cancelled'

/** Коммерческий статус ЗК (ручной) */
export type SalesCommercialStatus =
  | 'draft'
  | 'confirmed'
  | 'on_hold'
  | 'cancelled'
  | 'completed'

/** Статус исполнения ЗК (расчётный из прогресса) */
export type SalesFulfillmentStatus =
  | 'unplanned'
  | 'partially_planned'
  | 'planned'
  | 'in_production'
  | 'partially_ready'
  | 'ready_to_ship'
  | 'partially_shipped'
  | 'shipped'

export type SalesOrderPriority = 'normal' | 'urgent'

/** Тип этикетки на упаковке */
export type SalesLabelType = 'none' | 'ours' | 'customer'

/** Количественный прогресс строки ЗК (п.м) */
export type SalesLineProgress = {
  orderedQty: number
  cancelledQty: number
  reservedFinishedGoodsQty: number
  productionAllocatedQty: number
  productionStartedQty: number
  producedGoodQty: number
  qcApprovedQty: number
  readyToShipQty: number
  shipmentReservedQty: number
  shippedQty: number
  remainingToPlanQty: number
  remainingToProduceQty: number
  remainingToShipQty: number
}

/** Резерв ГП / отгрузки под строку ЗК */
export type SalesStockReservation = {
  id: string
  salesOrderId: string
  salesLineId: string
  warehouseItemId: string
  quantity: number
  reservationType: 'sales_order' | 'shipment'
  status: 'active' | 'released' | 'consumed'
  /** Движение склада type=reserve (если создано) */
  warehouseMovementId?: string
  createdAt: string
  note?: string
}

/** Связь строки ЗК с объёмом производственного заказа */
export type SalesProductionAllocation = {
  id: string
  salesOrderId: string
  salesLineId: string
  productionOrderId: string
  plannedGoodQty: number
  producedAllocatedQty: number
  readyAllocatedQty: number
  shippedQty: number
  status: 'active' | 'cancelled' | 'completed'
  createdAt: string
}

/** Позиция заказа клиента (одна номенклатура ГП) */
export type SalesOrderLine = {
  id: string
  finishedProductId?: string
  productName: string
  category: PlannerOrderCategory
  colorLogo?: string
  productColor?: string
  /** Заказанный объём, п.м */
  qtyMp: number
  /** Единица G5/SQL (`m2`, `mp`, …) — влияет на калькуляцию погрузки */
  unit?: string
  /** Отменённый объём строки, п.м (аддитивно) */
  cancelledQty?: number
  /** Площадь, м² (исходные данные заказа; п.м. пересчитывается по ширине) */
  qtyAreaM2?: number
  /** Ширина рулона, м — для пересчёта м² → п.м. */
  rollWidthM?: number
  /** Целевая граммовка, г/м² — для запроса технологу */
  targetGsm?: number
  labelType?: SalesLabelType
  labelNote?: string
  /** Предпочтительная линия */
  preferredLineId?: ProductionLineId
  /** Связанные производственные заказы (планировщик) */
  productionOrderIds: string[]
  /** Снимок прогресса (пересчитывается при normalize / plan) */
  progress?: SalesLineProgress
  /** Упаковка для погрузки (если известна) */
  rolls?: number
  boxes?: number
  palletPlaces?: number
  rollsPerBox?: number
  /** Длина рулона, м */
  rollLengthM?: number
  /** Калькуляция погрузки (склад) по этой позиции */
  loadingShipmentId?: string
  note?: string
}

export type SalesOrderHistoryEntry = {
  id: string
  at: string
  type: 'created' | 'status' | 'note' | 'planned'
  message: string
}

export type SalesOrder = {
  id: string
  /** Номер заказа клиента ЗК-YYYY-NNN */
  orderNumber: string
  counterpartyId?: string
  customer: string
  /** Legacy зеркало — синхронизируется с commercial+fulfillment */
  status: SalesOrderStatus
  commercialStatus: SalesCommercialStatus
  fulfillmentStatus: SalesFulfillmentStatus
  priority: SalesOrderPriority
  /** Дата заказа (ISO YYYY-MM-DD) */
  orderDate: string
  /** Срок поставки (ISO YYYY-MM-DD) */
  dueDate?: string
  /** Регион / страна поставки */
  region?: string
  /** Условия логистики (CIF, контейнер…) */
  logistics?: string
  /** Рекомендуемая дата старта производства */
  suggestedProductionStart?: string
  /** Связанные документы погрузки на складе */
  loadingShipmentIds?: string[]
  /** Сводная калькуляция погрузки на весь заказ (контейнер) */
  combinedLoadingShipmentId?: string
  lines: SalesOrderLine[]
  note?: string
  history: SalesOrderHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export type SalesStore = {
  orders: SalesOrder[]
  nextOrderSeq: number
  /** Резервы ГП / отгрузки (аддитивно) */
  reservations?: SalesStockReservation[]
  /** Аллокации ПЗ на строки ЗК (аддитивно) */
  allocations?: SalesProductionAllocation[]
}

export const SALES_ORDER_STATUSES: {
  key: SalesOrderStatus
  labelRu: string
  labelKa: string
  tone: 'neutral' | 'info' | 'warn' | 'good' | 'danger'
}[] = [
  { key: 'draft', labelRu: 'Черновик', labelKa: 'მონახაზი', tone: 'neutral' },
  { key: 'confirmed', labelRu: 'Подтверждён', labelKa: 'დადასტურებული', tone: 'info' },
  { key: 'in_production', labelRu: 'В производстве', labelKa: 'წარმოებაში', tone: 'warn' },
  { key: 'shipped', labelRu: 'Отгружен', labelKa: 'გადაზიდული', tone: 'good' },
  { key: 'completed', labelRu: 'Выполнен', labelKa: 'შესრულებული', tone: 'good' },
  { key: 'cancelled', labelRu: 'Отменён', labelKa: 'გაუქმებული', tone: 'danger' },
]

export const SALES_COMMERCIAL_STATUSES: {
  key: SalesCommercialStatus
  labelRu: string
  labelKa: string
  tone: 'neutral' | 'info' | 'warn' | 'good' | 'danger'
}[] = [
  { key: 'draft', labelRu: 'Черновик', labelKa: 'მონახაზი', tone: 'neutral' },
  { key: 'confirmed', labelRu: 'Подтверждён', labelKa: 'დადასტურებული', tone: 'info' },
  { key: 'on_hold', labelRu: 'На паузе', labelKa: 'პაუზაზე', tone: 'warn' },
  { key: 'cancelled', labelRu: 'Отменён', labelKa: 'გაუქმებული', tone: 'danger' },
  { key: 'completed', labelRu: 'Выполнен', labelKa: 'შესრულებული', tone: 'good' },
]

export const SALES_FULFILLMENT_STATUSES: {
  key: SalesFulfillmentStatus
  labelRu: string
  labelKa: string
  tone: 'neutral' | 'info' | 'warn' | 'good' | 'danger'
}[] = [
  { key: 'unplanned', labelRu: 'Не запланирован', labelKa: 'დაუგეგმავი', tone: 'neutral' },
  { key: 'partially_planned', labelRu: 'Частично запланирован', labelKa: 'ნაწილობრივ დაგეგმილი', tone: 'info' },
  { key: 'planned', labelRu: 'Запланирован', labelKa: 'დაგეგმილი', tone: 'info' },
  { key: 'in_production', labelRu: 'В производстве', labelKa: 'წარმოებაში', tone: 'warn' },
  { key: 'partially_ready', labelRu: 'Частично готов', labelKa: 'ნაწილობრივ მზად', tone: 'warn' },
  { key: 'ready_to_ship', labelRu: 'Готов к отгрузке', labelKa: 'მზად გადაზიდვისთვის', tone: 'good' },
  { key: 'partially_shipped', labelRu: 'Частично отгружен', labelKa: 'ნაწილობრივ გადაზიდული', tone: 'good' },
  { key: 'shipped', labelRu: 'Отгружен', labelKa: 'გადაზიდული', tone: 'good' },
]

import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'

export function salesStatusLabel(status: SalesOrderStatus, locale: Locale): string {
  const row = SALES_ORDER_STATUSES.find((s) => s.key === status)
  if (!row) return status
  return labelRuKa(locale, row.labelRu, row.labelKa)
}

export function salesStatusTone(status: SalesOrderStatus): string {
  return SALES_ORDER_STATUSES.find((s) => s.key === status)?.tone ?? 'neutral'
}

export function salesCommercialLabel(status: SalesCommercialStatus, locale: Locale): string {
  const row = SALES_COMMERCIAL_STATUSES.find((s) => s.key === status)
  if (!row) return status
  return labelRuKa(locale, row.labelRu, row.labelKa)
}

export function salesFulfillmentLabel(status: SalesFulfillmentStatus, locale: Locale): string {
  const row = SALES_FULFILLMENT_STATUSES.find((s) => s.key === status)
  if (!row) return status
  return labelRuKa(locale, row.labelRu, row.labelKa)
}

/** Активные (незакрытые) статусы для аналитики */
export const OPEN_SALES_STATUSES: SalesOrderStatus[] = [
  'draft',
  'confirmed',
  'in_production',
]
