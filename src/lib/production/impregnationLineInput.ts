import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionStore } from '@/lib/production/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type ApprovedImpregnationLineInput = {
  decisionId: string
  decisionKey: string
  decisionRevision: number
  batchRunId: string
  batchNo: string
  batchReceiptDocumentId: string
  outputWarehouseItemId: string
  outputQuantity: number
  availableQuantity: number
  unitSnapshot: string
}

function stableId(value: unknown): string {
  return String(value ?? '').trim()
}

function movementIsActive(movement: WarehouseStore['movements'][number]): boolean {
  return (movement as WarehouseStore['movements'][number] & { cancelled?: boolean }).cancelled !== true
}

/**
 * Project only authoritative, effective, approved mixer batches that physically
 * remain at the exact production warehouse/location tuple for this order.
 * Conflicting effective decisions fail closed by removing that batch entirely.
 */
export function collectApprovedImpregnationLineInputs(args: {
  production: ProductionStore
  warehouse: WarehouseStore
  order: ProductionOrder
  productionWarehouseId: string
  productionLocationId: string
}): ApprovedImpregnationLineInput[] {
  const orderId = stableId(args.order.id)
  const lineId = stableId(args.order.lineId)
  const decisions = (args.production.impregnationQcDecisions ?? []).filter(
    (decision) =>
      decision.effective === true &&
      !stableId(decision.supersededByDecisionId) &&
      stableId(decision.productionOrderId) === orderId &&
      stableId(decision.productionLineId) === lineId,
  )

  const byBatch = new Map<string, typeof decisions>()
  for (const decision of decisions) {
    const batchRunId = stableId(decision.batchRunId)
    if (!batchRunId) continue
    byBatch.set(batchRunId, [...(byBatch.get(batchRunId) ?? []), decision])
  }

  const result: ApprovedImpregnationLineInput[] = []
  for (const [batchRunId, rows] of byBatch) {
    if (rows.length !== 1) continue
    const decision = rows[0]!
    if (decision.decision !== 'approved') continue

    const decisionId = stableId(decision.id) || stableId(decision.decisionId)
    const decisionKey = stableId(decision.decisionKey)
    const receiptId = stableId(decision.batchReceiptDocumentId)
    const outputItemId = stableId(decision.outputWarehouseItemId)
    const batchNo = stableId(decision.batchNo)
    if (!decisionId || !decisionKey || !receiptId || !outputItemId || !batchNo) continue

    const receiptMatches = args.warehouse.documents.filter(
      (document) => stableId(document.id) === receiptId,
    )
    if (receiptMatches.length !== 1) continue
    const receipt = receiptMatches[0]!
    if (
      receipt.status !== 'posted' ||
      receipt.type !== 'receipt' ||
      receipt.docRole !== 'batch_receipt' ||
      stableId(receipt.batchRunId) !== batchRunId ||
      stableId(receipt.productionOrderId) !== orderId ||
      stableId(receipt.productionLineId) !== lineId ||
      stableId(receipt.warehouseId) !== args.productionWarehouseId
    ) {
      continue
    }
    const receiptLines = (receipt.lines ?? []).filter(
      (line) => stableId(line.itemId) === outputItemId && stableId(line.batchNo) === batchNo,
    )
    if (
      receiptLines.length !== 1 ||
      stableId(receiptLines[0]?.locationId) !== args.productionLocationId
    ) {
      continue
    }

    const allReceiptMovements = args.warehouse.movements.filter(
      (movement) => stableId(movement.documentId) === receiptId,
    )
    if (
      allReceiptMovements.length !== receiptLines.length ||
      allReceiptMovements.some((movement) => !movementIsActive(movement))
    ) {
      continue
    }
    const receiptMovements = allReceiptMovements.filter(
      (movement) =>
        movement.type === 'receipt' &&
        stableId(movement.documentLineId) === stableId(receiptLines[0]?.lineId) &&
        stableId(movement.productionOrderId) === orderId &&
        stableId(
          (movement as WarehouseStore['movements'][number] & { productionLineId?: string })
            .productionLineId,
        ) === lineId &&
        stableId(
          (movement as WarehouseStore['movements'][number] & { batchRunId?: string })
            .batchRunId,
        ) === batchRunId &&
        stableId(movement.warehouseId) === args.productionWarehouseId &&
        stableId(movement.locationId) === args.productionLocationId &&
        stableId(movement.itemId) === outputItemId &&
        stableId(movement.batchNo) === batchNo,
    )
    const receiptMovementQuantities = receiptMovements.map((movement) =>
      Number(movement.quantity),
    )
    const documentedQuantities = receiptLines.map((line) => Number(line.quantity))
    if (
      receiptMovements.length !== 1 ||
      receiptMovementQuantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 0) ||
      documentedQuantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 0)
    ) {
      continue
    }
    const receiptQuantity = receiptMovementQuantities.reduce((sum, quantity) => sum + quantity, 0)
    const documentedQuantity = documentedQuantities.reduce((sum, quantity) => sum + quantity, 0)
    const decisionQuantity = Number(decision.outputQuantity)
    if (
      !(receiptQuantity > 0) ||
      Math.abs(receiptQuantity - documentedQuantity) > 1e-9 ||
      !Number.isFinite(decisionQuantity) ||
      decisionQuantity <= 0 ||
      Math.abs(receiptQuantity - decisionQuantity) > 1e-9
    ) {
      continue
    }

    let availableQuantity = 0
    let ledgerInvalid = false
    for (const movement of args.warehouse.movements) {
      if (
        !movementIsActive(movement) ||
        stableId(movement.productionOrderId) !== orderId ||
        stableId(
          (movement as WarehouseStore['movements'][number] & { productionLineId?: string })
            .productionLineId,
        ) !== lineId ||
        stableId(
          (movement as WarehouseStore['movements'][number] & { batchRunId?: string })
            .batchRunId,
        ) !== batchRunId ||
        stableId(movement.warehouseId) !== args.productionWarehouseId ||
        stableId(movement.locationId) !== args.productionLocationId ||
        stableId(movement.itemId) !== outputItemId ||
        stableId(movement.batchNo) !== batchNo
      ) {
        continue
      }
      if (movement.type === 'receipt' || movement.type === 'issue') {
        const quantity = Number(movement.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) {
          ledgerInvalid = true
          break
        }
        if (movement.type === 'receipt') availableQuantity += quantity
        else availableQuantity -= quantity
      }
    }
    if (ledgerInvalid || !(availableQuantity > 1e-9)) continue

    const item = args.warehouse.items.find((candidate) => candidate.id === outputItemId)
    const unitSnapshot = stableId(item?.unit)
    if (!item || item.active === false || !unitSnapshot) continue

    result.push({
      decisionId,
      decisionKey,
      decisionRevision: Number(decision.decisionRevision) || 1,
      batchRunId,
      batchNo,
      batchReceiptDocumentId: receiptId,
      outputWarehouseItemId: outputItemId,
      outputQuantity: receiptQuantity,
      availableQuantity,
      unitSnapshot,
    })
  }

  return result.sort(
    (left, right) =>
      right.decisionRevision - left.decisionRevision ||
      left.batchNo.localeCompare(right.batchNo),
  )
}
