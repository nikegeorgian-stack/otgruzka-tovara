import type { AppUser } from '@/lib/access/types'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  canPostProductionMaterialHandoff,
  type ProductionMaterialTransferInput,
} from '@/lib/warehouse/productionMaterialHandoff'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'
import type {
  ProductionLineLocationBinding,
  StockMovement,
  WarehouseAccountingState,
  WarehouseDocument,
  WarehouseItem,
  WarehouseLocation,
  WarehouseStore,
} from '@/lib/warehouse/types'

export type PlannerHandoffBlockCode =
  | 'order_not_active'
  | 'forbidden_role'
  | 'reservation_document_mismatch'
  | 'reservation_not_posted'
  | 'reservation_not_positive'
  | 'reservation_evidence_mismatch'
  | 'reservation_already_issued'
  | 'reservation_partially_changed'
  | 'reservation_not_remaining'
  | 'raw_material_not_configured'
  | 'raw_material_line_missing'
  | 'raw_material_line_ambiguous'
  | 'raw_warehouse_missing'
  | 'line_binding_not_unique'
  | 'line_binding_invalid'
  | 'warehouse_item_missing'
  | 'unlinked_handoff_exists'

export type PlannerHandoffPreparation =
  | {
      ok: true
      input: ProductionMaterialTransferInput
      quantity: number
      productionLocationId: string
    }
  | { ok: false; code: PlannerHandoffBlockCode; detail?: string }

const HANDOFF_EPSILON = 1e-9

export function plannerReservationHandoffIdempotencyKey(
  orderId: string,
  reservationDocumentId: string,
): string {
  return `production::material::issue-to-line::${orderId}::reservation::${reservationDocumentId}`
}

function isCanonicalHandoffDocument(doc: WarehouseDocument): boolean {
  return (
    doc.purpose === 'production_material_transfer' ||
    doc.docRole === 'production_transfer_issue' ||
    doc.docRole === 'production_transfer_receipt' ||
    doc.docRole === 'transfer_issue' ||
    doc.docRole === 'transfer_receipt'
  )
}

function remainingReserveAtWarehouse(
  movements: StockMovement[],
  orderId: string,
  warehouseId: string,
  itemId: string,
): number {
  let remaining = 0
  for (const movement of movements) {
    if (
      movement.productionOrderId !== orderId ||
      movement.warehouseId !== warehouseId ||
      movement.itemId !== itemId
    ) {
      continue
    }
    if (movement.type === 'reserve') remaining += Math.abs(movement.quantity)
    if (movement.type === 'unreserve') remaining -= Math.abs(movement.quantity)
    if (
      movement.type === 'issue' &&
      (movement as StockMovement & { consumesReserve?: boolean }).consumesReserve === true
    ) {
      remaining -= Math.abs(movement.quantity)
    }
  }
  return Math.max(0, remaining)
}

/**
 * Build one fail-closed handoff from one exact posted reservation document.
 * No warehouse, line, item, or quantity is inferred from names or array order.
 */
export function preparePlannerReservationHandoff(args: {
  order: ProductionOrder
  reservationDocument: WarehouseDocument
  warehouseItems: WarehouseItem[]
  warehouseMovements: StockMovement[]
  warehouseDocuments: WarehouseDocument[]
  warehouseLocations: WarehouseLocation[]
  productionLineBindings: ProductionLineLocationBinding[]
  warehouseAccounting?: WarehouseAccountingState[]
  currentUser?: AppUser | null
}): PlannerHandoffPreparation {
  const {
    order,
    reservationDocument,
    warehouseItems,
    warehouseMovements,
    warehouseDocuments,
    warehouseLocations,
    productionLineBindings,
    warehouseAccounting,
    currentUser,
  } = args

  if (order.status !== 'active') return { ok: false, code: 'order_not_active' }
  if (!canPostProductionMaterialHandoff(currentUser)) {
    return { ok: false, code: 'forbidden_role' }
  }
  if (
    reservationDocument.type !== 'reservation' ||
    reservationDocument.productionOrderId !== order.id ||
    reservationDocument.purpose === 'production_reservation_release'
  ) {
    return { ok: false, code: 'reservation_document_mismatch' }
  }
  if (reservationDocument.status !== 'posted') {
    return { ok: false, code: 'reservation_not_posted' }
  }

  const rawWarehouseId = reservationDocument.warehouseId?.trim()
  if (!rawWarehouseId || !warehouseLocations.some((location) => location.id === rawWarehouseId)) {
    return { ok: false, code: 'raw_warehouse_missing' }
  }

  const matchingBindings = productionLineBindings.filter((binding) => {
    const canonicalLineId = String(binding.lineId ?? '').trim()
    return canonicalLineId ? canonicalLineId === order.lineId : binding.id === order.lineId
  })
  if (matchingBindings.length !== 1) {
    return { ok: false, code: 'line_binding_not_unique' }
  }
  const warehouse = {
    items: warehouseItems,
    movements: warehouseMovements,
    documents: warehouseDocuments,
    locations: warehouseLocations,
    productionLineBindings,
    accountingByWarehouse: warehouseAccounting,
  } as WarehouseStore
  const lineLocation = resolveProductionLineLocation(warehouse, order.lineId)
  if (!lineLocation.ok) {
    return { ok: false, code: 'line_binding_invalid', detail: lineLocation.error }
  }

  const idempotencyKey = plannerReservationHandoffIdempotencyKey(
    order.id,
    reservationDocument.id,
  )
  const existingExactHandoff = warehouseDocuments.some(
    (document) =>
      document.productionOrderId === order.id &&
      document.status === 'posted' &&
      isCanonicalHandoffDocument(document) &&
      (document.reservationDocumentId === reservationDocument.id ||
        document.idempotencyKey === idempotencyKey ||
        document.idempotencyKey?.startsWith(`${idempotencyKey}::`)),
  )
  if (existingExactHandoff) {
    return { ok: false, code: 'reservation_already_issued' }
  }
  const unlinkedHandoff = warehouseDocuments.some(
    (document) =>
      document.productionOrderId === order.id &&
      document.status === 'posted' &&
      isCanonicalHandoffDocument(document) &&
      !document.reservationDocumentId &&
      !document.idempotencyKey?.startsWith(
        `production::material::issue-to-line::${order.id}::reservation::`,
      ),
  )
  if (unlinkedHandoff) return { ok: false, code: 'unlinked_handoff_exists' }

  const rawMaterialItemId = order.rawMaterialItemId?.trim()
  if (!rawMaterialItemId) return { ok: false, code: 'raw_material_not_configured' }
  const rawDocumentLines = reservationDocument.lines.filter(
    (line) => line.itemId === rawMaterialItemId,
  )
  if (!rawDocumentLines.length) return { ok: false, code: 'raw_material_line_missing' }
  if (rawDocumentLines.length !== 1) {
    return { ok: false, code: 'raw_material_line_ambiguous' }
  }
  const positiveLines = rawDocumentLines.filter(
    (line) => Number.isFinite(line.quantity) && line.quantity > 0,
  )
  if (!positiveLines.length) return { ok: false, code: 'reservation_not_positive' }
  if (
    positiveLines.some(
      (line) => !line.itemId?.trim() || !warehouseItems.some((item) => item.id === line.itemId),
    )
  ) {
    return { ok: false, code: 'warehouse_item_missing' }
  }

  const rawLine = positiveLines[0]!
  const rawReserveMovements = warehouseMovements.filter(
    (movement) =>
      movement.documentId === reservationDocument.id &&
      movement.productionOrderId === order.id &&
      movement.warehouseId === rawWarehouseId &&
      movement.type === 'reserve' &&
      movement.itemId === rawMaterialItemId,
  )
  const movementQuantity = rawReserveMovements.reduce(
    (sum, movement) => sum + Math.abs(movement.quantity),
    0,
  )
  if (
    !rawLine.lineId ||
    rawReserveMovements.some((movement) => movement.documentLineId !== rawLine.lineId) ||
    Math.abs(movementQuantity - rawLine.quantity) > HANDOFF_EPSILON
  ) {
    return { ok: false, code: 'reservation_evidence_mismatch' }
  }

  const remaining = remainingReserveAtWarehouse(
    warehouseMovements,
    order.id,
    rawWarehouseId,
    rawMaterialItemId,
  )
  if (remaining <= HANDOFF_EPSILON) {
    return { ok: false, code: 'reservation_not_remaining' }
  }
  if (remaining + HANDOFF_EPSILON < rawLine.quantity) {
    return { ok: false, code: 'reservation_partially_changed' }
  }

  return {
    ok: true,
    quantity: positiveLines.reduce((sum, line) => sum + line.quantity, 0),
    productionLocationId: lineLocation.productionLocationId,
    input: {
      productionOrder: order,
      rawWarehouseId,
      lines: positiveLines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        inputUnit: line.inputUnit,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
      })),
      actor: currentUser
        ? {
            id: currentUser.id,
            name: currentUser.displayName,
            roleId: currentUser.roleId,
          }
        : undefined,
      comment: `Передача по резерву ${reservationDocument.number}`,
      reservationDocumentId: reservationDocument.id,
      idempotencyKey,
      transactionGroupId: idempotencyKey,
    },
  }
}
