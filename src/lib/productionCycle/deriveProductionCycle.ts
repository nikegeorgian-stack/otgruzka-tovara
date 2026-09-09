import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import type { ProductionOrder } from '@/lib/planner/types'
import type { FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import { isLotAvailableForShipment } from '@/lib/production/finishedGoodsLots'
import type { ProductionPackagingReport } from '@/lib/production/packagingReports'
import type { AppStore } from '@/lib/types'
import type { LoadingShipment, WarehouseDocument } from '@/lib/warehouse/types'
import { collectOrderLoadingShipments } from '@/lib/sales/loadingLink'
import type { SalesOrder } from '@/lib/sales/types'
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
  if (primaryPo && !salesOrder && primaryPo.salesOrderId) {
    salesOrder = salesOrders.find((o) => o.id === primaryPo!.salesOrderId)
  }
  // Soft list may be empty while G5/cycle anchors (planner/loading) still carry salesOrderId.
  if (!salesOrder && input.salesOrderId && !primaryPo) {
    const linkedBySo = plannerOrders.filter((o) => o.salesOrderId === input.salesOrderId)
    primaryPo =
      linkedBySo.find((o) => o.status !== 'cancelled') ?? linkedBySo[0] ?? undefined
  }
  if (salesOrder && !primaryPo) {
    const linked = plannerOrders.filter((o) => o.salesOrderId === salesOrder!.id)
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
      const linked = plannerOrders.filter((o) => o.salesOrderId === salesOrder.id)
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
    (l) =>
      (primaryLot && l.id === primaryLot.id) ||
      poIds.has(l.productionOrderId) ||
      (finishedProductId != null && l.finishedProductId === finishedProductId && poIds.size === 0),
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

function evidenceRecipe(resolved: ResolvedCycle): ProductionCycleEvidence {
  const po = resolved.primaryPo
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

function evidenceProcurement(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
  const itemIds = bomItemIds(resolved.primaryPo)
  const orders = store.procurement?.orders ?? []
  const hit = orders.find((po) => {
    if (po.status === 'cancelled' || po.status === 'draft') return false
    const receivedLike = ['partial', 'received', 'arrived', 'customs', 'in_transit', 'shipped', 'ordered', 'production'].includes(
      String(po.status),
    )
    if (!receivedLike) return false
    if (itemIds.size === 0) return po.status === 'received' || po.status === 'partial'
    return (po.lines ?? []).some((l) => l.warehouseItemId && itemIds.has(l.warehouseItemId))
  })
  if (hit) {
    return { done: true, refLabel: hit.orderNumber }
  }
  // Downstream proof: material already issued / line confirmed ⇒ procurement path existed
  if (evidenceMaterialIssue(store, resolved).done || evidenceLine(store, resolved).done) {
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
  const hit = docs.find((d) => {
    if (resolved.primaryPo && d.productionOrderId === resolved.primaryPo.id) return true
    if (itemIds.size === 0) return false
    return (d.lines ?? []).some((l) => l.itemId && itemIds.has(l.itemId))
  })
  if (hit) return { done: true, refLabel: hit.number }
  if (evidenceMaterialIssue(store, resolved).done || evidenceLine(store, resolved).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.receipt',
  }
}

function evidenceProductionOrder(resolved: ResolvedCycle): ProductionCycleEvidence {
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
  if (evidenceLine(store, resolved).done || evidencePackaging(resolved).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.materialIssue',
  }
}

function evidenceMixer(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
  const recipeId = resolved.primaryPo?.formulationRecipeId
  const poId = resolved.primaryPo?.id
  const tasks = store.formulations?.mixTasks ?? []
  const done = tasks.find(
    (t) =>
      t.status === 'done' &&
      ((poId && t.sourceOrderId === poId) || (recipeId && t.recipeId === recipeId)),
  )
  if (done) return { done: true, refLabel: done.taskNumber }
  if (evidenceLine(store, resolved).done || evidencePackaging(resolved).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.mixer',
  }
}

function evidenceImpregnation(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
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
  if (evidenceLine(store, resolved).done || evidencePackaging(resolved).done) {
    return { done: true }
  }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.impregnation',
  }
}

function evidenceLine(store: AppStore, resolved: ResolvedCycle): ProductionCycleEvidence {
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

function evidencePackaging(resolved: ResolvedCycle): ProductionCycleEvidence {
  const hit = resolved.packagingReports.find((r) => r.status === 'confirmed')
  if (hit) return { done: true, refLabel: hit.number }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.packaging',
  }
}

function evidenceOtc(resolved: ResolvedCycle): ProductionCycleEvidence {
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
  if (evidencePackaging(resolved).done) {
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

function evidenceSales(resolved: ResolvedCycle): ProductionCycleEvidence {
  const o = resolved.salesOrder
  if (!o) {
    return { done: false, missingConditionKey: 'productionCycle.missing.sales' }
  }
  if (o.status === 'cancelled' || o.commercialStatus === 'cancelled') {
    return { done: false, missingConditionKey: 'productionCycle.missing.salesCancelled' }
  }
  if (o.status === 'draft' && o.commercialStatus === 'draft') {
    return {
      done: false,
      refLabel: o.orderNumber,
      missingConditionKey: 'productionCycle.missing.salesConfirm',
      missingConditionParams: { order: o.orderNumber },
    }
  }
  return { done: true, refLabel: o.orderNumber }
}

function evidenceLoading(resolved: ResolvedCycle): ProductionCycleEvidence {
  const hit = resolved.loadingShipments[0]
  if (hit) return { done: true, refLabel: hit.number }
  return {
    done: false,
    missingConditionKey: 'productionCycle.missing.loading',
  }
}

function evidenceShipment(resolved: ResolvedCycle): ProductionCycleEvidence {
  const posted = resolved.loadingShipments.find((s) => s.status === 'posted')
  if (posted) return { done: true, refLabel: posted.number }
  const draft = resolved.loadingShipments.find((s) => s.status === 'draft')
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
): Record<ProductionCycleStageId, ProductionCycleEvidence> {
  return {
    recipe: evidenceRecipe(resolved),
    procurement: evidenceProcurement(store, resolved),
    receipt: evidenceReceipt(store, resolved),
    production_order: evidenceProductionOrder(resolved),
    material_issue: evidenceMaterialIssue(store, resolved),
    mixer: evidenceMixer(store, resolved),
    impregnation: evidenceImpregnation(store, resolved),
    line: evidenceLine(store, resolved),
    packaging: evidencePackaging(resolved),
    otc: evidenceOtc(resolved),
    sales: evidenceSales(resolved),
    loading: evidenceLoading(resolved),
    shipment: evidenceShipment(resolved),
  }
}

function resolveOutcome(
  resolved: ResolvedCycle,
  evidence: Record<ProductionCycleStageId, ProductionCycleEvidence>,
): ProductionCycleOutcome {
  const sales = resolved.salesOrder
  if (sales && (sales.status === 'cancelled' || sales.commercialStatus === 'cancelled')) {
    return 'cancelled'
  }
  const pos = resolved.productionOrders
  if (pos.length > 0 && pos.every((o) => o.status === 'cancelled')) {
    return 'cancelled'
  }
  if (evidence.shipment.done) {
    const fulfilled =
      sales &&
      (sales.status === 'completed' ||
        sales.status === 'shipped' ||
        sales.fulfillmentStatus === 'shipped' ||
        sales.commercialStatus === 'completed')
    const lotDone =
      resolved.lots.length > 0 &&
      resolved.lots.every((l) => (l.quantityRemaining ?? 0) <= 1e-9 && (l.quantityShipped ?? 0) > 0)
    if (fulfilled || lotDone || !sales) return 'completed'
    return 'completed'
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

  const evidence = collectEvidence(store, resolved)
  const outcome = resolveOutcome(resolved, evidence)
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
