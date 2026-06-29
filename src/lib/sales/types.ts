import type { PlannerOrderCategory } from '@/lib/planner/types'
import type { ProductionLineId } from '@/lib/production/types'

/** Статус заказа клиента */
export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'completed'
  | 'cancelled'

export type SalesOrderPriority = 'normal' | 'urgent'

/** Тип этикетки на упаковке */
export type SalesLabelType = 'none' | 'ours' | 'customer'

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
  status: SalesOrderStatus
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

export function salesStatusLabel(status: SalesOrderStatus, locale: 'ru' | 'ka'): string {
  const row = SALES_ORDER_STATUSES.find((s) => s.key === status)
  if (!row) return status
  return locale === 'ka' ? row.labelKa : row.labelRu
}

export function salesStatusTone(status: SalesOrderStatus): string {
  return SALES_ORDER_STATUSES.find((s) => s.key === status)?.tone ?? 'neutral'
}

/** Активные (незакрытые) статусы для аналитики */
export const OPEN_SALES_STATUSES: SalesOrderStatus[] = [
  'draft',
  'confirmed',
  'in_production',
]
