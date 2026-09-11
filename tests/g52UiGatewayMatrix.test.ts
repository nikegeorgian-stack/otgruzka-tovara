/**
 * PHASE G5.2 — UI gateway matrix (static coverage).
 *
 * Each named wrapper on g5ServerClient must map to the expected commandType string.
 *
 * Matrix (report requirement):
 *   g5MasterdataDomainActivate            → masterdata.domain.activate
 *   g5MasterdataItemUpsert                → masterdata.item.upsert
 *   g5MasterdataItemArchive               → masterdata.item.archive
 *   g5MasterdataProductUpsert             → masterdata.product.upsert
 *   g5MasterdataProductArchive            → masterdata.product.archive
 *   g5MasterdataCustomerUpsert            → masterdata.customer.upsert
 *   g5MasterdataCustomerArchive           → masterdata.customer.archive
 *   g5MasterdataSupplierUpsert            → masterdata.supplier.upsert
 *   g5MasterdataSupplierArchive           → masterdata.supplier.archive
 *   g5MasterdataBomUpsert                 → masterdata.bom.upsert
 *   g5MasterdataBomApprove                → masterdata.bom.approve
 *   g5MasterdataBomArchive                → masterdata.bom.archive
 *   g5SalesDomainActivate                 → sales.domain.activate
 *   g5SalesDraftSave                      → sales.order.draft.save
 *   g5SalesDraftDelete                    → sales.order.draft.delete
 *   g5SalesConfirm                        → sales.order.confirm
 *   g5SalesChange                         → sales.order.change
 *   g5SalesCancel                         → sales.order.cancel
 *   g5SalesPriority                       → sales.order.priority.set
 *   g5SalesFulfillmentSync                → sales.fulfillment.syncFromShipments
 *   g5SalesShipmentPost                   → sales.shipment.post
 *   g5SalesShipmentCancel                 → sales.shipment.cancel
 *   g5RunMrp                              → planning.mrp.run
 *   g5AcceptProductionDrafts              → planning.mrp.acceptProductionDrafts
 *   g5AcknowledgeShortage                 → planning.shortage.acknowledge
 *   g5ResolveShortageManual               → planning.shortage.resolveManual
 *   g5ProductionRecommendationCreateManual → planning.productionRecommendation.createManual
 *   g5ProcurementDomainActivate           → procurement.domain.activate
 *   g5GenerateProcurementDrafts           → procurement.generateDraftsFromMrp
 *   g5ProcurementDraftCreate              → procurement.draft.create
 *   g5ProcurementDraftEdit                → procurement.draft.edit
 *   g5ProcurementOrderChange              → procurement.order.change
 *   g5ProcurementSubmit                   → procurement.order.submit
 *   g5ProcurementApprove                  → procurement.order.approve
 *   g5ProcurementMarkOrdered              → procurement.order.markOrdered
 *   g5ProcurementCancel                   → procurement.order.cancel
 *   g5ProcurementReceiptPost              → procurement.receipt.post
 *   g5ProcurementPaymentRecord            → procurement.payment.record
 */
import { describe, expect, it } from 'vitest'
import * as g5Client from '../src/lib/planner/g5ServerClient'
import {
  G5_UI_GATEWAY_MATRIX,
  type G5NamedWrapper,
} from '../src/lib/planner/g5ServerClient'

describe('G5.2 UI gateway matrix', () => {
  it('every matrix row has a named wrapper with matching commandType', () => {
    expect(G5_UI_GATEWAY_MATRIX.length).toBe(38)

    for (const row of G5_UI_GATEWAY_MATRIX) {
      const fn = (g5Client as Record<string, unknown>)[row.wrapper] as G5NamedWrapper | undefined
      expect(fn, `missing wrapper export: ${row.wrapper}`).toBeTypeOf('function')
      expect(fn!.commandType).toBe(row.commandType)
    }
  })

  it('required G5.2 actions are present in the matrix', () => {
    const types = new Set(G5_UI_GATEWAY_MATRIX.map((r) => r.commandType))
    for (const required of [
      'masterdata.domain.activate',
      'sales.domain.activate',
      'sales.order.confirm',
      'sales.shipment.post',
      'sales.shipment.cancel',
      'planning.mrp.run',
      'procurement.domain.activate',
      'procurement.generateDraftsFromMrp',
      'procurement.draft.create',
      'procurement.draft.edit',
      'procurement.order.submit',
      'procurement.order.approve',
      'procurement.order.markOrdered',
      'procurement.receipt.post',
    ]) {
      expect(types.has(required as (typeof G5_UI_GATEWAY_MATRIX)[number]['commandType'])).toBe(true)
    }
  })
})
