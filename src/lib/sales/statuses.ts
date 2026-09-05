import type { SalesCommercialStatus, SalesFulfillmentStatus, SalesOrderStatus } from './types'

/** Разбор старого единого status → commercial + fulfillment */
export function splitLegacySalesStatus(status: SalesOrderStatus | string | undefined): {
  commercialStatus: SalesCommercialStatus
  fulfillmentStatus: SalesFulfillmentStatus
} {
  switch (status) {
    case 'cancelled':
      return { commercialStatus: 'cancelled', fulfillmentStatus: 'unplanned' }
    case 'completed':
      return { commercialStatus: 'completed', fulfillmentStatus: 'shipped' }
    case 'shipped':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'shipped' }
    case 'in_production':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'in_production' }
    case 'confirmed':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'unplanned' }
    case 'on_hold':
      return { commercialStatus: 'on_hold', fulfillmentStatus: 'unplanned' }
    case 'draft':
    default:
      return { commercialStatus: 'draft', fulfillmentStatus: 'unplanned' }
  }
}

/** Зеркало для канбана / старых селектов */
export function deriveLegacySalesStatus(
  commercial: SalesCommercialStatus,
  fulfillment: SalesFulfillmentStatus,
): SalesOrderStatus {
  if (commercial === 'cancelled') return 'cancelled'
  if (commercial === 'completed') return 'completed'
  if (commercial === 'draft') return 'draft'
  if (commercial === 'on_hold') return 'confirmed'
  if (
    fulfillment === 'shipped' ||
    fulfillment === 'partially_shipped'
  ) {
    return 'shipped'
  }
  if (
    fulfillment === 'in_production' ||
    fulfillment === 'partially_ready' ||
    fulfillment === 'ready_to_ship'
  ) {
    return 'in_production'
  }
  if (commercial === 'confirmed') return 'confirmed'
  return 'draft'
}

/** Ручная смена legacy-статуса с канбана */
export function applyManualLegacyStatus(status: SalesOrderStatus): {
  commercialStatus: SalesCommercialStatus
  fulfillmentStatus: SalesFulfillmentStatus
} {
  switch (status) {
    case 'draft':
      return { commercialStatus: 'draft', fulfillmentStatus: 'unplanned' }
    case 'confirmed':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'unplanned' }
    case 'in_production':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'in_production' }
    case 'shipped':
      return { commercialStatus: 'confirmed', fulfillmentStatus: 'shipped' }
    case 'completed':
      return { commercialStatus: 'completed', fulfillmentStatus: 'shipped' }
    case 'cancelled':
      return { commercialStatus: 'cancelled', fulfillmentStatus: 'unplanned' }
    default:
      return splitLegacySalesStatus(status)
  }
}

export function isSalesOrderOpen(
  commercial: SalesCommercialStatus,
): boolean {
  return commercial !== 'cancelled' && commercial !== 'completed'
}
