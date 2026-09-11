import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import type { ProductionOrder } from '@/lib/planner/types'
import type { FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import { isLotAvailableForShipment } from '@/lib/production/finishedGoodsLots'
import type { ProductionPackagingReport } from '@/lib/production/packagingReports'
import type { ProductionShiftReport } from '@/lib/production/shiftReports'
import type { AppStore } from '@/lib/types'
import type { LoadingShipment, WarehouseDocument } from '@/lib/warehouse/types'
import { collectOrderLoadingShipments } from '@/lib/sales/loadingLink'
import type { SalesOrder, SalesOrderLine } from '@/lib/sales/types'
import { PRODUCTION_CYCLE_STAGE_META } from './stageCatalog'
import { canNavigateProductionCycleView, primaryResponsibleRole } from './roleAccess'
import {
  PRODUCTION_CYCLE_STAGE_IDS,
  type ProductionCycleContext,
  type ProductionCycleEvidence,
  type ProductionCycleNextAction,
  type ProductionCycleOutcome,
  type ProductionCycleSnapshot,
  type ProductionCycleStageId,
  type ProductionCycleStageState,
  type ProductionCycleStageView,
  type ProductionCycleSubject,
} from './types'

type ResolvedCycle = {
  context: ProductionCycleContext
  salesOrder?: SalesOrder
  productionOrders: ProductionOrder[]
  primaryPo?: ProductionOrder
  lots: FinishedGoodsLot[]
  primaryLot?: FinishedGoodsLot
  packagingReports: ProductionPackagingReport[]
  loadingShipments: LoadingShipment[]
  finishedProductId?: string
  productName?: string
  requestedLotId?: string
}

function salesOrderReferencesProductionOrder(order: SalesOrder, productionOrderId: string): boolean {
  return (order.lines ?? []).some((line) =>
    (line.productionOrderIds ?? []).some((id) => id === productionOrderId),
  )
}

function salesLinkedProductionOrderIds(order: SalesOrder): Set<string> {
  return new Set(
    (order.lines ?? []).flatMap((line) =>
      (line.productionOrderIds ?? []).filter((id): id is string => Boolean(id)),
    ),
  )
}

function resolveCycle(store: AppStore, input: ProductionCycleContext): ResolvedCycle | null {
  if (!store || typeof store !== 'object') return null

  const salesOrders = store.sales?.orders ?? []
  const plannerOrders = store.production?.planner?.orders ?? []
  const lots = store.production?.finishedGoodsLots ?? []
  const packagingReports = store.production?.packagingReports ?? []
  const allLoading = store.warehouse?.loadingShipments ?? []

  let salesOrder = input.salesOrderId
    ? salesOrders.find((o) => o.id === input.salesOrderId)
    : undefined
  if (salesOrder && (salesOrder.status as string) === 'fulfilled') {
    // G5 terminal `fulfilled` — soft UI / cycle read-model uses `completed` (no store write).
    salesOrder = {
      ...salesOrder,
      status: 'completed',
      commercialStatus: 'completed',
      fulfillmentStatus: 'shipped',
    }
  }
  let primaryLot = input.lotId ? lots.find((l) => l.id === input.lotId) : undefined
  let primaryPo = input.productionOrderId
    ? plannerOrders.find((o) => o.id === input.productionOrderId)
    : undefined

  if (primaryLot && !primaryPo) {
    primaryPo = plannerOrders.find((o) => o.id === primaryLot!.productionOrderId)
  }
  if (primaryLot && primaryPo && primaryLot.productionOrderId !== primaryPo.id) {
    primaryLot = undefined
  }
  if (primaryPo && !salesOrder && primaryPo.salesOrderId) {
    salesOrder = salesOrders.find((o) => o.id === primaryPo!.salesOrderId)
  }
  if (primaryPo && !salesOrder) {
    salesOrder = salesOrders.find((o) => salesOrderReferencesProductionOrder(o, primaryPo!.id))
  }
  // Soft list may be empty while G5/cycle anchors (planner/loading) still carry salesOrderId.
  if (!salesOrder && input.salesOrderId && !primaryPo) {
    const linkedBySo = plannerOrders.filter((o) => o.salesOrderId === input.salesOrderId)
    primaryPo =
      linkedBySo.find((o) => o.status !== 'cancelled') ?? linkedBySo[0] ?? undefined
  }
  if (salesOrder && !primaryPo) {
    const explicitIds = salesLinkedProductionOrderIds(salesOrder)
    const linked = plannerOrders.filter(
      (o) => o.salesOrderId === salesOrder!.id || explicitIds.has(o.id),
    )
    primaryPo =
      linked.find((o) => o.status !== 'cancelled') ??
      linked[0] ??
      undefined
  }

  const finishedProductId =
    input.finishedProductId ||
    primaryLot?.finishedProductId ||
    primaryPo?.finishedProductId ||
    salesOrder?.lines?.[0]?.finishedProductId

  const hasDanglingContext = Boolean(
    input.salesOrderId || input.productionOrderId || input.lotId || input.finishedProductId,
  )

  // Unknown UUID / empty domains: still return a safe empty journey (no throw).
  if (!salesOrder && !primaryPo && !primaryLot && !finishedProductId) {
    if (!hasDanglingContext) return null
    return {
      context: { ...input },
      productionOrders: [],
      lots: [],
      packagingReports: [],
      loadingShipments: [],
    }
  }

  const productionOrders = (() => {
    if (salesOrder) {
      const explicitIds = salesLinkedProductionOrderIds(salesOrder)
      const linked = plannerOrders.filter(
        (o) => o.salesOrderId === salesOrder.id || explicitIds.has(o.id),
      )
      if (linked.length) return linked
    }
    if (input.salesOrderId) {
      const linked = plannerOrders.filter((o) => o.salesOrderId === input.salesOrderId)
      if (linked.length) return linked
    }
    if (primaryPo) return [primaryPo]
    return []
  })()

  const poIds = new Set(productionOrders.map((o) => o.id))
  const cycleLots = lots.filter(
    (l) => {
      if (poIds.size > 0) return poIds.has(l.productionOrderId)
      if (primaryLot) return l.id === primaryLot.id
      return finishedProductId != null && l.finishedProductId === finishedProductId
    },
  )
  if (!primaryLot && cycleLots.length) {
    primaryLot = cycleLots.find((l) => isLotAvailableForShipment(l)) ?? cycleLots[0]
  }

  const cyclePackaging = packagingReports.filter(
    (r) => poIds.has(r.productionOrderId) || (primaryPo && r.productionOrderId === primaryPo.id),
  )

  const salesOrderKey = salesOrder?.id ?? input.salesOrderId
  const loadingShipments = salesOrderKey
    ? collectOrderLoadingShipments(allLoading, salesOrderKey).all
    : []

  const fp = finishedProductId
    ? store.finishedProducts?.items?.find((i) => i.id === finishedProductId)
    : undefined

  return {
    context: {
      salesOrderId: salesOrder?.id ?? input.salesOrderId,
      productionOrderId: primaryPo?.id ?? input.productionOrderId,
      lotId: primaryLot?.id ?? input.lotId,
      finishedProductId,
    },
    salesOrder,
    productionOrders,
    primaryPo,
    lots: cycleLots,
    primaryLot,
    packagingReports: cyclePackaging,
    loadingShipments,
    finishedProductId,
    productName: fp?.name ?? primaryPo?.productName ?? salesOrder?.lines?.[0]?.productName,
    requestedLotId: input.lotId,
  }
}

/** Human label first; UUID only as short technical fallback. */
export function displayCycleRef(human?: string | null, id?: string | null): string {
  const label = (human ?? '').trim()
  if (label) return label
  const raw = (id ?? '').trim()
  if (!raw) return '—'
  if (raw.length <= 12) return raw
  return `${raw.slice(0, 8)}…`
}

function bomItemIds(po?: ProductionOrder): Set<string> {
  const ids = new Set<string>()
  const components = po?.packagingBomSnapshot?.components
  if (Array.isArray(components)) {
    for (const line of components) {
      if (line.warehouseItemId) ids.add(line.warehouseItemId)
      if (line.itemId) ids.add(line.itemId)
    }
  }
  if (po?.rawMaterialItemId) ids.add(po.rawMaterialItemId)
  if (po?.palletItemId) ids.add(po.palletItemId)
  if (po?.boxItemId) ids.add(po.boxItemId)
  return ids
}

function postedDocs(store: AppStore): WarehouseDocument[] {
  return (store.warehouse?.documents ?? []).filter((d) => d.status === 'posted')
}

type CanonicalMixerNode = {
  taskNumber?: string
  batchRunId: string
  batchNo: string
  issueDocumentId: string
  receiptDocumentId: string
  outputWarehouseItemId: string
  outputQuantity: number
}

type CanonicalQcNode = CanonicalMixerNode & {
  decisionId: string
}

type CanonicalShiftNode = CanonicalQcNode & {
  report: ProductionShiftReport
}

type CanonicalPackagingNode = CanonicalShiftNode & {
  packagingReport: ProductionPackagingReport
  fgReceiptDocumentId: string
}

type CanonicalLotNode = CanonicalPackagingNode & {
  lot: FinishedGoodsLot
}

type CanonicalWipLineage = {
  mixers: CanonicalMixerNode[]
  decisions: CanonicalQcNode[]
  shifts: CanonicalShiftNode[]
  packaging: CanonicalPackagingNode[]
  lots: CanonicalLotNode[]
  primaryLot?: CanonicalLotNode
  salesLine?: SalesOrderLine
  loadingShipments: LoadingShipment[]
  postedShipments: LoadingShipment[]
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finitePositive(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function uniqueNonEmptyIds(values: unknown[]): boolean {
  const ids = values.map(text)
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function sameIdSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (!uniqueNonEmptyIds(left) || !uniqueNonEmptyIds(right)) return false
  return JSON.stringify(left.map(text).sort()) === JSON.stringify(right.map(text).sort())
}

function exactPostedDocument(
  store: AppStore,
  id: string,
  predicate: (document: WarehouseDocument) => boolean,
): WarehouseDocument | undefined {
  const matches = postedDocs(store).filter(
    (document) => document.id === id && !document.cancelledAt && predicate(document),
  )
  return matches.length === 1 ? matches[0] : undefined
}

function sameDocumentLineQuantities(left: WarehouseDocument, right: WarehouseDocument): boolean {
  const signature = (line: WarehouseDocument['lines'][number]) =>
    JSON.stringify([
      text(line.itemId),
      Number(line.quantity),
      text(line.batchNo),
      text(line.expiryDate).slice(0, 10),
      text(line.productionOrderId),
      text(line.productionLineId),
    ])
  const leftLines = left.lines ?? []
  const rightLines = right.lines ?? []
  if (
    leftLines.length === 0 ||
    leftLines.length !== rightLines.length ||
    [...leftLines, ...rightLines].some((line) => !finitePositive(line.quantity))
  ) {
    return false
  }
  return (
    JSON.stringify(leftLines.map(signature).sort()) ===
    JSON.stringify(rightLines.map(signature).sort())
  )
}

function canonicalMaterialIssue(
  store: AppStore,
  po: ProductionOrder,
): WarehouseDocument | undefined {
  const issues = postedDocs(store).filter(
    (document) =>
      !document.cancelledAt &&
      document.type === 'issue' &&
      document.purpose === 'production_issue' &&
      document.docRole === 'transfer_issue' &&
      document.productionOrderId === po.id &&
      document.productionLineId === po.lineId &&
      Boolean(text(document.transferPairId)) &&
      (document.lines ?? []).length > 0 &&
      (document.lines ?? []).every(
        (line) =>
          line.productionOrderId === po.id &&
          line.productionLineId === po.lineId &&
          (!po.rawMaterialItemId || line.itemId === po.rawMaterialItemId),
      ),
  )
  return issues.find((issue) => {
    const pairDocuments = postedDocs(store).filter(
      (document) => !document.cancelledAt && document.transferPairId === issue.transferPairId,
    )
    const receipts = pairDocuments.filter(
      (document) =>
        document.type === 'receipt' &&
        document.purpose === 'production_receipt' &&
        document.docRole === 'transfer_receipt' &&
        document.transferPairId === issue.transferPairId &&
        document.productionOrderId === po.id &&
        document.productionLineId === po.lineId &&
        (document.lines ?? []).every(
          (line) =>
            line.productionOrderId === po.id &&
            line.productionLineId === po.lineId &&
            (!po.rawMaterialItemId || line.itemId === po.rawMaterialItemId),
        ),
    )
    return (
      pairDocuments.length === 2 &&
      receipts.length === 1 &&
      pairDocuments.includes(issue) &&
      sameDocumentLineQuantities(issue, receipts[0]!)
    )
  })
}

function canonicalMixerNodes(store: AppStore, po: ProductionOrder): CanonicalMixerNode[] {
  const recipeId = text(po.formulationRecipeId)
  const outputWarehouseItemId = text(po.impregnationOutputItemId)
  if (!recipeId || !outputWarehouseItemId) return []

  const runs = store.formulations?.batchRuns ?? []
  const tasks = store.formulations?.mixTasks ?? []
  const nodes: CanonicalMixerNode[] = []
  for (const task of tasks) {
    const batchRunId = text(task.batchRunId)
    if (
      task.status !== 'done' ||
      task.sourceOrderId !== po.id ||
      task.lineId !== po.lineId ||
      task.recipeId !== recipeId ||
      !batchRunId
    ) {
      continue
    }
    const matchingRuns = runs.filter((run) => run.id === batchRunId)
    if (matchingRuns.length !== 1) continue
    const run = matchingRuns[0]!
    const issueDocumentId = text(run.issueDocumentId)
    const receiptDocumentId = text(run.receiptDocumentId)
    if (
      run.status !== 'confirmed' ||
      run.mixTaskId !== task.id ||
      run.productionOrderId !== po.id ||
      run.productionLineId !== po.lineId ||
      run.recipeId !== recipeId ||
      run.outputWarehouseItemId !== outputWarehouseItemId ||
      !finitePositive(run.outputKg) ||
      !issueDocumentId ||
      !receiptDocumentId
    ) {
      continue
    }
    const runIssueDocuments = postedDocs(store).filter(
      (document) =>
        !document.cancelledAt &&
        document.type === 'issue' &&
        document.docRole === 'batch_issue' &&
        document.batchRunId === run.id &&
        document.productionOrderId === po.id &&
        document.productionLineId === po.lineId,
    )
    const runReceiptDocuments = postedDocs(store).filter(
      (document) =>
        !document.cancelledAt &&
        document.type === 'receipt' &&
        document.docRole === 'batch_receipt' &&
        document.batchRunId === run.id &&
        document.productionOrderId === po.id &&
        document.productionLineId === po.lineId &&
        (document.lines ?? []).some(
          (line) =>
            line.itemId === outputWarehouseItemId &&
            line.batchRunId === run.id &&
            line.productionOrderId === po.id &&
            line.productionLineId === po.lineId &&
            finitePositive(line.quantity),
        ),
    )
    if (
      runIssueDocuments.length !== 1 ||
      runIssueDocuments[0]!.id !== issueDocumentId ||
      (runIssueDocuments[0]!.lines ?? []).length === 0 ||
      (runIssueDocuments[0]!.lines ?? []).some((line) => !finitePositive(line.quantity)) ||
      runReceiptDocuments.length !== 1 ||
      runReceiptDocuments[0]!.id !== receiptDocumentId
    ) {
      continue
    }
    nodes.push({
      taskNumber: task.taskNumber,
      batchRunId: run.id,
      batchNo: run.documentNumber,
      issueDocumentId,
      receiptDocumentId,
      outputWarehouseItemId,
      outputQuantity: Number(run.outputKg),
    })
  }
  return nodes
}

function canonicalWipLineage(store: AppStore, resolved: ResolvedCycle): CanonicalWipLineage | null {
  const po = resolved.primaryPo
  if (!po || po.wipContractVersion !== 1) return null

  const mixers = canonicalMixerNodes(store, po)
  const decisions: CanonicalQcNode[] = []
  for (const mixer of mixers) {
    const matches = (store.production?.impregnationQcDecisions ?? []).filter((decision) => {
      const decisionId = text(decision.id ?? decision.decisionId)
      return !(
        !decisionId ||
        decision.effective !== true ||
        Boolean(text(decision.supersededByDecisionId)) ||
        decision.decision !== 'approved' ||
        decision.productionOrderId !== po.id ||
        decision.productionLineId !== po.lineId ||
        decision.batchRunId !== mixer.batchRunId ||
        decision.batchNo !== mixer.batchNo ||
        decision.batchIssueDocumentId !== mixer.issueDocumentId ||
        decision.batchReceiptDocumentId !== mixer.receiptDocumentId ||
        decision.outputWarehouseItemId !== mixer.outputWarehouseItemId ||
        !finitePositive(decision.outputQuantity) ||
        Math.abs(Number(decision.outputQuantity) - mixer.outputQuantity) > 1e-9
      )
    })
    if (matches.length !== 1) continue
    decisions.push({
      ...mixer,
      decisionId: text(matches[0]!.id ?? matches[0]!.decisionId),
    })
  }

  const shifts: CanonicalShiftNode[] = []
  for (const decision of decisions) {
    for (const report of store.production?.shiftReports ?? []) {
      if (
        report.status !== 'confirmed' ||
        report.wipContractVersion !== 1 ||
        report.productionOrderId !== po.id ||
        report.lineId !== po.lineId ||
        report.batchRunId !== decision.batchRunId ||
        report.impregnationQcDecisionId !== decision.decisionId ||
        report.semiFinishedItemId !== po.semiFinishedItemId ||
        !finitePositive(report.outputM2) ||
        !(report.materialLines ?? []).some(
          (line) =>
            line.itemId === decision.outputWarehouseItemId &&
            line.batchRunId === decision.batchRunId &&
            finitePositive(line.actualInputQty),
        )
      ) {
        continue
      }
      const wipReceiptDocumentId = text(report.wipReceiptDocumentId)
      if (
        !wipReceiptDocumentId ||
        !exactPostedDocument(
          store,
          wipReceiptDocumentId,
          (document) =>
            document.type === 'receipt' &&
            document.docRole === 'production_wip_receipt' &&
            document.productionOrderId === po.id &&
            document.productionLineId === po.lineId &&
            document.shiftReportId === report.id,
        )
      ) {
        continue
      }
      shifts.push({ ...decision, report })
    }
  }

  const packaging: CanonicalPackagingNode[] = []
  for (const report of resolved.packagingReports) {
    const sourceShiftReportIds = report.sourceShiftReportIds ?? []
    const sourceShifts = sourceShiftReportIds.map((id) => {
      const matches = shifts.filter((candidate) => candidate.report.id === id)
      return matches.length === 1 ? matches[0] : undefined
    })
    if (
      resolved.packagingReports.filter((candidate) => candidate.id === report.id).length !== 1 ||
      report.status !== 'confirmed' ||
      report.wipContractVersion !== 1 ||
      report.productionOrderId !== po.id ||
      report.finishedProductId !== po.finishedProductId ||
      report.warehouseItemId !== po.warehouseItemId ||
      report.semiFinishedItemId !== po.semiFinishedItemId ||
      !finitePositive(report.outputM2) ||
      !text(report.finishedGoodsLotId) ||
      sourceShiftReportIds.length === 0 ||
      !uniqueNonEmptyIds(sourceShiftReportIds) ||
      sourceShifts.some((shift) => !shift) ||
      (report.wipLines ?? []).length === 0 ||
      (report.wipLines ?? []).some(
        (line) =>
          !sourceShiftReportIds.includes(line.shiftReportId) ||
          line.productionOrderId !== po.id ||
          line.semiFinishedItemId !== po.semiFinishedItemId ||
          line.itemId !== po.semiFinishedItemId ||
          !finitePositive(line.quantity),
      )
    ) {
      continue
    }
    const authoritativeDocumentIds = Array.isArray(
      (report as ProductionPackagingReport & { documentIds?: unknown }).documentIds,
    )
      ? (report as ProductionPackagingReport & { documentIds: unknown[] }).documentIds.map(text)
      : []
    const candidateDocumentIds = [text(report.fgReceiptDocumentId), ...authoritativeDocumentIds]
      .filter(Boolean)
      .filter((id, index, values) => values.indexOf(id) === index)
    const fgReceiptDocuments = candidateDocumentIds
      .map((id) =>
        exactPostedDocument(
          store,
          id,
          (document) =>
            document.type === 'receipt' &&
            document.docRole === 'production_fg_receipt' &&
            document.productionOrderId === po.id &&
            document.packagingReportId === report.id &&
            document.finishedGoodsLotId === report.finishedGoodsLotId,
        ),
      )
      .filter((document): document is WarehouseDocument => Boolean(document))
    if (fgReceiptDocuments.length !== 1) continue
    packaging.push({
      ...sourceShifts[0]!,
      packagingReport: report,
      fgReceiptDocumentId: fgReceiptDocuments[0]!.id,
    })
  }

  const lots: CanonicalLotNode[] = []
  for (const packaged of packaging) {
    const report = packaged.packagingReport
    const matchingLots = resolved.lots.filter((lot) => lot.id === report.finishedGoodsLotId)
    if (matchingLots.length !== 1) continue
    const lot = matchingLots[0]!
    if (
      lot.wipContractVersion !== 1 ||
      lot.productionOrderId !== po.id ||
      lot.packagingReportId !== report.id ||
      lot.finishedProductId !== po.finishedProductId ||
      lot.warehouseItemId !== po.warehouseItemId ||
      !sameIdSet(lot.sourceShiftReportIds, report.sourceShiftReportIds) ||
      !finitePositive(lot.quantityProduced)
    ) {
      continue
    }
    lots.push({ ...packaged, lot })
  }

  const primaryLot = resolved.requestedLotId
    ? lots.find((node) => node.lot.id === resolved.requestedLotId)
    : lots.find((node) => isLotAvailableForShipment(node.lot)) ?? lots[0]

  const salesLineMatches = resolved.salesOrder?.lines.filter(
    (line) =>
      (line.productionOrderIds ?? []).includes(po.id) &&
      (!po.salesLineId || line.id === po.salesLineId) &&
      (!po.finishedProductId || line.finishedProductId === po.finishedProductId),
  ) ?? []
  const salesLine =
    salesLineMatches.length === 1 &&
    (!po.salesOrderId || po.salesOrderId === resolved.salesOrder?.id)
      ? salesLineMatches[0]
      : undefined

  const loadingShipments =
    primaryLot && salesLine && resolved.salesOrder
      ? resolved.loadingShipments.filter(
          (shipment) =>
            resolved.loadingShipments.filter((candidate) => candidate.id === shipment.id).length ===
              1 &&
            Boolean(text(shipment.id)) &&
            (shipment.status === 'draft' || shipment.status === 'posted') &&
            shipment.salesOrderId === resolved.salesOrder!.id &&
            shipment.salesLineId === salesLine.id &&
            shipment.finishedGoodsLotId === primaryLot.lot.id &&
            shipment.finishedProductId === primaryLot.lot.finishedProductId &&
            shipment.warehouseItemId === primaryLot.lot.warehouseItemId &&
            shipment.warehouseId === primaryLot.lot.warehouseId &&
            shipment.locationId === primaryLot.lot.locationId &&
            shipment.lotNumber === primaryLot.lot.batchNo &&
            finitePositive(shipment.quantity),
        )
      : []
  const postedShipments = loadingShipments.filter((shipment) => {
    if (shipment.status !== 'posted') return false
    const documentIds = shipment.documentIds ?? (shipment.postedDocumentId ? [shipment.postedDocumentId] : [])
    if (documentIds.length !== 1 || !uniqueNonEmptyIds(documentIds)) return false
    const document = exactPostedDocument(
      store,
      documentIds[0]!,
      (candidate) =>
        candidate.type === 'issue' &&
        candidate.docRole === 'finished_goods_shipment' &&
        candidate.shipmentId === shipment.id &&
        candidate.salesOrderId === shipment.salesOrderId &&
        candidate.salesLineId === shipment.salesLineId &&
        candidate.finishedGoodsLotId === shipment.finishedGoodsLotId &&
        candidate.warehouseId === shipment.warehouseId &&
        (candidate.lines ?? []).length === 1 &&
        candidate.lines[0]!.itemId === shipment.warehouseItemId &&
        candidate.lines[0]!.batchNo === shipment.lotNumber &&
        candidate.lines[0]!.locationId === shipment.locationId &&
        Math.abs(Number(candidate.lines[0]!.quantity) - Number(shipment.quantity)) <= 1e-9,
    )
    if (!document) return false
    const movements = (store.warehouse?.movements ?? []).filter(
      (movement) =>
        movement.documentId === document.id &&
        movement.type === 'issue' &&
        movement.shipmentId === shipment.id &&
        movement.salesOrderId === shipment.salesOrderId &&
        movement.salesLineId === shipment.salesLineId &&
        movement.finishedGoodsLotId === shipment.finishedGoodsLotId &&
        movement.warehouseId === shipment.warehouseId &&
        movement.locationId === shipment.locationId &&
        movement.itemId === shipment.warehouseItemId &&
        movement.batchNo === shipment.lotNumber &&
        Math.abs(Number(movement.quantity) - Number(shipment.quantity)) <= 1e-9,
    )
    return movements.length === 1 && finitePositive(movements[0]!.quantity)
  })

  return {
    mixers,
    decisions,
    shifts,
    packaging,
    lots,
    primaryLot,
    salesLine,
    loadingShipments,
    postedShipments,
  }
}

function evidenceRecipe(resolved: ResolvedCycle): ProductionCycleEvidence {
  const po = resolved.primaryPo
  if (po?.wipContractVersion === 1) {
    if (
      po.formulationRecipeId &&
      po.recipeNormSnapshot?.recipeId === po.formulationRecipeId &&
      po.impregnationOutputItemId &&
      po.semiFinishedItemId
    ) {
      return { done: true, refLabel: po.orderNumber }
    }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.recipe',
    }
  }
  if (po?.packagingRecipeId || po?.formulationRecipeId || po?.packagingBomSnapshot || po?.recipeNormSnapshot) {
    return {
      done: true,
      refLabel: po.orderNumber,
    }
  }
  if (po?.formulationRecipeStatus === 'assigned') {
    return { done: true, refLabel: po.orderNumber }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.recipe',
  }
}

function matchingProcurementOrders(store: AppStore, resolved: ResolvedCycle) {
  const itemIds = bomItemIds(resolved.primaryPo)
  const orders = store.procurement?.orders ?? []
  return orders.filter((po) => {
    if (po.status === 'cancelled' || po.status === 'draft') return false
    const receivedLike = ['partial', 'received', 'arrived', 'customs', 'in_transit', 'shipped', 'ordered', 'production'].includes(
      String(po.status),
    )
    if (!receivedLike) return false
    if (itemIds.size === 0) return po.status === 'received' || po.status === 'partial'
    return (po.lines ?? []).some((l) => l.warehouseItemId && itemIds.has(l.warehouseItemId))
  })
}

function evidenceProcurement(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
  const hit = matchingProcurementOrders(store, resolved)[0]
  if (hit) {
    return { done: true, refLabel: hit.orderNumber }
  }
  // Downstream proof: material already issued / line confirmed ⇒ procurement path existed
  if (
    resolved.primaryPo?.wipContractVersion !== 1 &&
    (evidenceMaterialIssue(store, resolved).done || evidenceLine(store, resolved, null).done)
  ) {
    return { done: true, refLabel: undefined }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.procurement',
  }
}

function evidenceReceipt(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
  const itemIds = bomItemIds(resolved.primaryPo)
  const docs = postedDocs(store).filter((d) => d.type === 'receipt')
  if (resolved.primaryPo?.wipContractVersion === 1) {
    const procurementOrders = matchingProcurementOrders(store, resolved)
    const hit = docs.find((document) => {
      const purchaseOrder = procurementOrders.find(
        (order) =>
          order.id === document.purchaseOrderId &&
          (order.warehouseDocumentIds ?? []).includes(document.id),
      )
      return Boolean(
        purchaseOrder &&
          !document.cancelledAt &&
          document.purpose === 'purchase' &&
          String(document.docRole) === 'procurement_receipt' &&
          (document.lines ?? []).some(
            (line) => line.itemId && itemIds.has(line.itemId) && finitePositive(line.quantity),
          ),
      )
    })
    if (hit) return { done: true, refLabel: hit.number }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.receipt',
    }
  }
  const hit = docs.find((d) => {
    if (resolved.primaryPo && d.productionOrderId === resolved.primaryPo.id) return true
    if (itemIds.size === 0) return false
    return (d.lines ?? []).some((l) => l.itemId && itemIds.has(l.itemId))
  })
  if (hit) return { done: true, refLabel: hit.number }
  if (evidenceMaterialIssue(store, resolved).done || evidenceLine(store, resolved, null).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.receipt',
  }
}

function evidenceProductionOrder(resolved: ResolvedCycle): ProductionCycleEvidence {
  if (resolved.primaryPo?.wipContractVersion === 1) {
    if (resolved.primaryPo.status === 'active' || resolved.primaryPo.status === 'completed') {
      return { done: true, refLabel: resolved.primaryPo.orderNumber }
    }
    return {
      done: false,
      missingConditionKey:
        resolved.primaryPo.status === 'cancelled'
          ? 'productionCycle.missing.productionOrderCancelled'
          : 'productionCycle.missing.productionOrder',
    }
  }
  const active = resolved.productionOrders.find((o) => o.status !== 'cancelled')
  if (active) {
    return {
      done: true,
      refLabel: active.orderNumber,
    }
  }
  if (resolved.productionOrders.some((o) => o.status === 'cancelled')) {
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.productionOrderCancelled',
    }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.productionOrder',
  }
}

function evidenceMaterialIssue(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
  if (resolved.primaryPo?.wipContractVersion === 1) {
    const issue = canonicalMaterialIssue(store, resolved.primaryPo)
    if (issue) return { done: true, refLabel: issue.number }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.materialIssue',
    }
  }
  const poIds = new Set(resolved.productionOrders.map((o) => o.id))
  if (resolved.primaryPo) poIds.add(resolved.primaryPo.id)
  const docs = postedDocs(store).filter(
    (d) =>
      d.type === 'issue' &&
      d.productionOrderId &&
      poIds.has(d.productionOrderId) &&
      (d.purpose === 'production_issue' || d.purpose == null),
  )
  if (docs[0]) return { done: true, refLabel: docs[0].number }
  const movements = store.warehouse?.movements ?? []
  const mov = movements.find(
    (m) => m.productionOrderId && poIds.has(m.productionOrderId) && m.type === 'issue',
  )
  if (mov) return { done: true, refLabel: mov.documentNo }
  // Confirmed shift / packaging already consumed materials authoritatively
  if (evidenceLine(store, resolved, null).done || evidencePackaging(resolved, null).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.materialIssue',
  }
}

function evidenceMixer(
  store: AppStore,
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  if (canonical) {
    const mixer = canonical.mixers[0]
    if (mixer) return { done: true, refLabel: mixer.taskNumber ?? mixer.batchNo }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.mixer',
    }
  }
  const recipeId = resolved.primaryPo?.formulationRecipeId
  const poId = resolved.primaryPo?.id
  const tasks = store.formulations?.mixTasks ?? []
  const done = tasks.find(
    (t) =>
      t.status === 'done' &&
      ((poId && t.sourceOrderId === poId) || (recipeId && t.recipeId === recipeId)),
  )
  if (done) return { done: true, refLabel: done.taskNumber }
  if (evidenceLine(store, resolved, null).done || evidencePackaging(resolved, null).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.mixer',
  }
}

function evidenceImpregnation(
  store: AppStore,
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  if (canonical) {
    const approved = canonical.decisions[0]
    if (approved) return { done: true, refLabel: approved.batchNo }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.impregnation',
    }
  }
  const recipeId = resolved.primaryPo?.formulationRecipeId
  const batchNo = resolved.primaryLot?.batchNo
  const records = store.technologistQc?.impregnationQc ?? []
  const pass = records.find(
    (r) =>
      r.computed?.status === 'pass' &&
      ((recipeId && r.recipeId === recipeId) || (batchNo && r.batchNumber === batchNo)),
  )
  if (pass) {
    return {
      done: true,
      refLabel: pass.batchNumber || pass.recipeCode,
    }
  }
  if (evidenceLine(store, resolved, null).done || evidencePackaging(resolved, null).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.impregnation',
  }
}

function evidenceLine(
  store: AppStore,
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  if (canonical) {
    const shift = canonical.shifts[0]
    if (shift) return { done: true, refLabel: shift.report.number }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.line',
    }
  }
  const poIds = new Set(resolved.productionOrders.map((o) => o.id))
  if (resolved.primaryPo) poIds.add(resolved.primaryPo.id)
  const reports = store.production?.shiftReports ?? []
  const hit = reports.find((r) => poIds.has(r.productionOrderId) && r.status === 'confirmed')
  if (hit) return { done: true, refLabel: hit.number }
  const requests = store.production?.requests ?? []
  const req = requests.find(
    (r) => r.orderId && poIds.has(r.orderId) && r.status === 'posted',
  )
  if (req) return { done: true, refLabel: req.plannerSourceNote || req.id.slice(0, 8) }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.line',
  }
}

function evidencePackaging(
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  const hit = canonical
    ? canonical.packaging[0]?.packagingReport
    : resolved.packagingReports.find((r) => r.status === 'confirmed')
  if (hit) return { done: true, refLabel: hit.number }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.packaging',
  }
}

function evidenceOtc(
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  if (canonical) {
    const lot = canonical.primaryLot?.lot
    if (lot?.serverQcDecisionId && lot.serverQcDecisionStatus === 'released') {
      return { done: true, refLabel: lot.batchNo }
    }
    if (lot && (lot.qcStatus === 'pending' || lot.qcStatus === 'in_review')) {
      return {
        done: false,
        refLabel: lot.batchNo,
        missingConditionKey: 'productionCycle.missing.otcPending',
        missingConditionParams: { batch: lot.batchNo },
      }
    }
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.otcLot',
    }
  }
  const released = resolved.lots.find(
    (l) =>
      l.serverQcDecisionStatus === 'released' ||
      (l.serverQcDecisionStatus == null && l.qcStatus === 'released'),
  )
  if (released) {
    return { done: true, refLabel: released.batchNo }
  }
  const pending = resolved.lots.find((l) => l.qcStatus === 'pending' || l.qcStatus === 'in_review')
  if (pending) {
    return {
      done: false,
      refLabel: pending.batchNo,
      missingConditionKey: 'productionCycle.missing.otcPending',
      missingConditionParams: { batch: pending.batchNo },
    }
  }
  if (evidencePackaging(resolved, null).done) {
    return {
      done: false,
      missingConditionKey: 'productionCycle.missing.otcLot',
    }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.otcLot',
  }
}

function evidenceSales(
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  const o = resolved.salesOrder
  if (!o || (canonical && !canonical.salesLine)) {
    return { done: false, missingConditionKey: 'productionCycle.missing.sales' }
  }
  if (o.status === 'cancelled' || o.commercialStatus === 'cancelled') {
    return { done: false, missingConditionKey: 'productionCycle.missing.salesCancelled' }
  }
  const canonicalSalesConfirmed =
    canonical == null ||
    (['confirmed', 'in_production', 'shipped', 'completed'].includes(o.status) &&
      (o.commercialStatus === 'confirmed' || o.commercialStatus === 'completed'))
  if (!canonicalSalesConfirmed || (o.status === 'draft' && o.commercialStatus === 'draft')) {
    return {
      done: false,
      refLabel: o.orderNumber,
      missingConditionKey: 'productionCycle.missing.salesConfirm',
      missingConditionParams: { order: o.orderNumber },
    }
  }
  return { done: true, refLabel: o.orderNumber }
}

function evidenceLoading(
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  const hit = canonical ? canonical.loadingShipments[0] : resolved.loadingShipments[0]
  if (hit) return { done: true, refLabel: hit.number }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.loading',
  }
}

function evidenceShipment(
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): ProductionCycleEvidence {
  const posted = canonical
    ? canonical.postedShipments[0]
    : resolved.loadingShipments.find((s) => s.status === 'posted')
  if (posted) return { done: true, refLabel: posted.number }
  const draft = canonical
    ? canonical.loadingShipments.find((s) => s.status === 'draft')
    : resolved.loadingShipments.find((s) => s.status === 'draft')
  if (draft) {
    return {
      done: false,
      refLabel: draft.number,
      missingConditionKey: 'productionCycle.missing.shipmentPost',
      missingConditionParams: { doc: draft.number },
    }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.shipment',
  }
}

function collectEvidence(
  store: AppStore,
  resolved: ResolvedCycle,
  canonical: CanonicalWipLineage | null,
): Record<ProductionCycleStageId, ProductionCycleEvidence> {
  return {
    recipe: evidenceRecipe(resolved),
    procurement: evidenceProcurement(store, resolved),
    receipt: evidenceReceipt(store, resolved),
    production_order: evidenceProductionOrder(resolved),
    material_issue: evidenceMaterialIssue(store, resolved),
    mixer: evidenceMixer(store, resolved, canonical),
    impregnation: evidenceImpregnation(store, resolved, canonical),
    line: evidenceLine(store, resolved, canonical),
    packaging: evidencePackaging(resolved, canonical),
    otc: evidenceOtc(resolved, canonical),
    sales: evidenceSales(resolved, canonical),
    loading: evidenceLoading(resolved, canonical),
    shipment: evidenceShipment(resolved, canonical),
  }
}

function resolveOutcome(
  resolved: ResolvedCycle,
  evidence: Record<ProductionCycleStageId, ProductionCycleEvidence>,
  canonical: CanonicalWipLineage | null,
): ProductionCycleOutcome {
  const sales = resolved.salesOrder
  if (sales && (sales.status === 'cancelled' || sales.commercialStatus === 'cancelled')) {
    return 'cancelled'
  }
  const pos = resolved.productionOrders
  if (pos.length > 0 && pos.every((o) => o.status === 'cancelled')) {
    return 'cancelled'
  }
  const fullChainDone = PRODUCTION_CYCLE_STAGE_IDS.every((stageId) => evidence[stageId].done)
  if (fullChainDone && evidence.shipment.done) {
    const fulfilled =
      sales &&
      (sales.status === 'completed' ||
        sales.status === 'shipped' ||
        sales.fulfillmentStatus === 'shipped' ||
        sales.commercialStatus === 'completed')
    const completionLots = canonical
      ? canonical.primaryLot
        ? [canonical.primaryLot.lot]
        : []
      : resolved.lots
    const lotDone =
      completionLots.length > 0 &&
      completionLots.every((l) => (l.quantityRemaining ?? 0) <= 1e-9 && (l.quantityShipped ?? 0) > 0)
    if (fulfilled && lotDone) return 'completed'
  }
  return 'in_progress'
}

function buildSubject(resolved: ResolvedCycle): ProductionCycleSubject {
  const title = displayCycleRef(
    resolved.salesOrder?.orderNumber ||
      resolved.primaryPo?.orderNumber ||
      resolved.primaryLot?.batchNo ||
      resolved.productName,
    resolved.salesOrder?.id ||
      resolved.context.salesOrderId ||
      resolved.primaryPo?.id ||
      resolved.context.productionOrderId ||
      resolved.primaryLot?.id ||
      resolved.context.lotId,
  )
  const parts: string[] = []
  if (resolved.productName) parts.push(resolved.productName)
  if (resolved.salesOrder?.customer) parts.push(resolved.salesOrder.customer)
  else if (resolved.primaryPo?.customer) parts.push(resolved.primaryPo.customer)
  return {
    title,
    subtitle: parts.length ? parts.join(' · ') : undefined,
    salesOrderNumber: resolved.salesOrder?.orderNumber,
    productionOrderNumber: resolved.primaryPo?.orderNumber,
    lotBatchNo: resolved.primaryLot?.batchNo,
    productName: resolved.productName,
    customer: resolved.salesOrder?.customer ?? resolved.primaryPo?.customer,
  }
}

export type DeriveProductionCycleOptions = {
  access?: AccessStore | null
  user?: AppUser | null
  adminCabinet?: AdminCabinetId | null
}

/**
 * Чистый read-model производственного цикла.
 * Статусы только из существующих полей store (G2/G3/G4/G5) — без новой проводки.
 */
export function deriveProductionCycle(
  store: AppStore,
  context: ProductionCycleContext,
  opts: DeriveProductionCycleOptions = {},
): ProductionCycleSnapshot | null {
  const resolved = resolveCycle(store, context)
  if (!resolved) return null

  const canonical = canonicalWipLineage(store, resolved)
  const evidence = collectEvidence(store, resolved, canonical)
  const outcome = resolveOutcome(resolved, evidence, canonical)
  const firstIncomplete = PRODUCTION_CYCLE_STAGE_IDS.findIndex((id) => !evidence[id].done)

  const stages: ProductionCycleStageView[] = PRODUCTION_CYCLE_STAGE_IDS.map((id, index) => {
    const meta = PRODUCTION_CYCLE_STAGE_META[id]
    const ev = evidence[id]
    const canNavigate = canNavigateProductionCycleView(
      opts.access,
      opts.user,
      meta.viewId,
      opts.adminCabinet,
    )

    let state: ProductionCycleStageState
    if (outcome === 'cancelled') {
      state = 'cancelled'
    } else if (outcome === 'completed' || ev.done) {
      state = 'done'
    } else if (firstIncomplete < 0) {
      state = 'done'
    } else if (index === firstIncomplete) {
      state = 'current'
      if (
        ev.missingConditionKey === 'productionCycle.missing.otcPending' ||
        ev.missingConditionKey === 'productionCycle.missing.shipmentPost' ||
        ev.missingConditionKey === 'productionCycle.missing.salesConfirm' ||
        ev.missingConditionKey === 'productionCycle.missing.productionOrderCancelled'
      ) {
        state = 'blocked'
      }
    } else if (index > firstIncomplete) {
      state = 'waiting'
    } else {
      state = 'blocked'
    }

    return {
      id,
      state,
      meta,
      evidence: ev,
      canNavigate,
      requiredRoleHint: canNavigate ? undefined : primaryResponsibleRole(id),
    }
  })

  const currentStageId =
    outcome === 'cancelled' || outcome === 'completed'
      ? null
      : (PRODUCTION_CYCLE_STAGE_IDS[firstIncomplete] ?? null)

  let nextAction: ProductionCycleNextAction | null = null
  if (currentStageId) {
    const stage = stages.find((s) => s.id === currentStageId)!
    nextAction = {
      stageId: currentStageId,
      actionKey: stage.meta.actionKey,
      viewId: stage.meta.viewId,
      viewLabelKey: stage.meta.viewLabelKey,
      responsibleRoleIds: stage.meta.responsibleRoleIds,
      canNavigate: stage.canNavigate,
      blocked: stage.state === 'blocked',
      missingConditionKey: stage.evidence.missingConditionKey,
      missingConditionParams: stage.evidence.missingConditionParams,
      refLabel: stage.evidence.refLabel,
    }
  }

  return {
    context: resolved.context,
    subject: buildSubject(resolved),
    outcome,
    stages,
    currentStageId,
    nextAction,
    anchors: {
      salesOrderId: resolved.context.salesOrderId,
      productionOrderId: resolved.context.productionOrderId,
      lotId: resolved.context.lotId,
      finishedProductId: resolved.context.finishedProductId,
    },
  }
}

/** Текущий этап (для тестов / компактных виджетов). */
export function resolveCurrentProductionCycleStage(
  store: AppStore,
  context: ProductionCycleContext,
): ProductionCycleStageId | null {
  return deriveProductionCycle(store, context)?.currentStageId ?? null
}
