/**
 * PHASE G5 — deny-by-default master-data / sales / planning / procurement capabilities.
 * Canonical ACL = FstPrincipalAccess.capabilitiesJson (never AppStore roleId / roleViews).
 */

export const G5_CAPS = Object.freeze({
  MASTERDATA_READ: 'masterdata.read',
  MASTERDATA_ITEM_MANAGE: 'masterdata.item.manage',
  MASTERDATA_PRODUCT_MANAGE: 'masterdata.product.manage',
  MASTERDATA_CUSTOMER_MANAGE: 'masterdata.customer.manage',
  MASTERDATA_SUPPLIER_MANAGE: 'masterdata.supplier.manage',
  MASTERDATA_BOM_MANAGE: 'masterdata.bom.manage',
  MASTERDATA_BOM_APPROVE: 'masterdata.bom.approve',
  MASTERDATA_ARCHIVE: 'masterdata.archive',

  SALES_READ: 'sales.read',
  SALES_ORDER_EDIT: 'sales.order.edit',
  SALES_ORDER_CONFIRM: 'sales.order.confirm',
  SALES_ORDER_CANCEL: 'sales.order.cancel',
  SALES_PRIORITY_CHANGE: 'sales.priority.change',
  SALES_SHIPMENT_POST: 'sales.shipment.post',
  SALES_SHIPMENT_CANCEL: 'sales.shipment.cancel',

  PLANNING_READ: 'planning.read',
  PLANNING_MRP_RUN: 'planning.mrp.run',
  PLANNING_PRODUCTION_DRAFT_CREATE: 'planning.productionDraft.create',
  PLANNING_SHORTAGE_MANAGE: 'planning.shortage.manage',
  PLANNING_MANUAL_PRODUCTION: 'planning.manualProduction.create',

  PROCUREMENT_READ: 'procurement.read',
  PROCUREMENT_DRAFT_EDIT: 'procurement.draft.edit',
  PROCUREMENT_ORDER_SUBMIT: 'procurement.order.submit',
  PROCUREMENT_ORDER_APPROVE: 'procurement.order.approve',
  PROCUREMENT_ORDER_MARK_ORDERED: 'procurement.order.markOrdered',
  PROCUREMENT_ORDER_CANCEL: 'procurement.order.cancel',
  PROCUREMENT_RECEIPT_POST: 'procurement.receipt.post',
  PROCUREMENT_PAYMENT_VIEW: 'procurement.payment.view',
  PROCUREMENT_PAYMENT_RECORD: 'procurement.payment.record',
})

export function defaultG5Capabilities(partial = {}) {
  const out = {}
  for (const key of Object.values(G5_CAPS)) {
    out[key] = partial[key] === true
  }
  return out
}
