import { guessColorFromText, isValidProductColor } from '@/lib/finishedProducts/colors'
import { newId } from '@/lib/production/files'
import type {
  FormulationRecipeStatus,
  PlannerDayPlan,
  PlannerHistoryEntry,
  PlannerStore,
  ProductionOrder,
} from './types'

export function createDefaultPlanner(): PlannerStore {
  return { orders: [], nextOrderSeq: 1 }
}

function normalizeDayPlan(dp: PlannerDayPlan): PlannerDayPlan {
  return {
    id: dp.id || newId(),
    date: dp.date,
    basePlanMp: Number(dp.basePlanMp) || 0,
    operationalPlanMp: Number(dp.operationalPlanMp) || 0,
    manualPlanMp: dp.manualPlanMp,
    lineId: dp.lineId === '2' ? '2' : '1',
    brigadeName: dp.brigadeName?.trim() || undefined,
    note: dp.note?.trim() || undefined,
    isWorkingDay: dp.isWorkingDay !== false,
  }
}

function normalizeHistory(h: PlannerHistoryEntry): PlannerHistoryEntry {
  return {
    id: h.id || newId(),
    at: h.at || new Date().toISOString(),
    type: h.type,
    message: h.message?.trim() ?? '',
  }
}

const VALID_RECIPE_STATUS = new Set<FormulationRecipeStatus>([
  'pending',
  'requested',
  'assigned',
])

function normalizeRecipeStatus(
  raw: FormulationRecipeStatus | undefined,
  recipeId?: string,
): FormulationRecipeStatus | undefined {
  if (raw && VALID_RECIPE_STATUS.has(raw)) return raw
  if (recipeId) return 'assigned'
  return undefined
}

export function normalizeProductionOrder(order: ProductionOrder): ProductionOrder {
  return {
    ...order,
    orderNumber: order.orderNumber?.trim() || `ЗП-${new Date().getFullYear()}-001`,
    counterpartyId: order.counterpartyId || undefined,
    customer: order.customer?.trim() ?? '',
    finishedProductId: order.finishedProductId || undefined,
    productName: order.productName?.trim() ?? '',
    category: order.category ?? 'ratl1',
    totalQtyMp: Number(order.totalQtyMp) || 0,
    lineId: order.lineId === '2' ? '2' : '1',
    priority: order.priority === 'urgent' ? 'urgent' : 'normal',
    status:
      order.status === 'active' ||
      order.status === 'paused' ||
      order.status === 'completed' ||
      order.status === 'cancelled'
        ? order.status
        : 'draft',
    planMode: order.planMode === 'manual' ? 'manual' : 'even',
    recalcMode: order.recalcMode === 'manual' ? 'manual' : 'auto',
    colorLogo: order.colorLogo?.trim() || undefined,
    productColor: isValidProductColor(order.productColor)
      ? order.productColor
      : guessColorFromText(order.colorLogo),
    note: order.note?.trim() || undefined,
    rawMaterialKind: order.rawMaterialKind || undefined,
    rawMaterialItemId: order.rawMaterialItemId || undefined,
    packagingRecipeId: order.packagingRecipeId || undefined,
    formulationRecipeId: order.formulationRecipeId || undefined,
    formulationRecipeStatus: normalizeRecipeStatus(
      order.formulationRecipeStatus,
      order.formulationRecipeId,
    ),
    targetGsm: order.targetGsm && order.targetGsm > 0 ? order.targetGsm : undefined,
    labelNote: order.labelNote?.trim() || undefined,
    salesOrderId: order.salesOrderId || undefined,
    salesLineId: order.salesLineId || undefined,
    lineAssignmentPending: order.lineAssignmentPending === true,
    palletItemId: order.palletItemId || undefined,
    boxItemId: order.boxItemId || undefined,
    metersPerRoll:
      order.metersPerRoll && order.metersPerRoll > 0 ? order.metersPerRoll : undefined,
    packagingPlan: order.packagingPlan,
    dayPlans: (order.dayPlans ?? []).map(normalizeDayPlan),
    history: (order.history ?? []).map(normalizeHistory),
    createdAt: order.createdAt || new Date().toISOString(),
    updatedAt: order.updatedAt || new Date().toISOString(),
  }
}

export function normalizePlanner(raw: PlannerStore | undefined): PlannerStore {
  const orders = (raw?.orders ?? []).map((o) =>
    normalizeProductionOrder(o as ProductionOrder),
  )
  const maxSeq = orders.reduce((max, o) => {
    const m = o.orderNumber.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return {
    orders,
    nextOrderSeq: Math.max(raw?.nextOrderSeq ?? 1, maxSeq + 1),
  }
}

export function emptyProductionOrder(
  startDate: string,
  endDate: string,
): ProductionOrder {
  const now = new Date().toISOString()
  return {
    id: newId(),
    orderNumber: '',
    counterpartyId: undefined,
    customer: '',
    finishedProductId: undefined,
    productName: '',
    category: 'ratl1',
    totalQtyMp: 0,
    startDate,
    endDate,
    lineId: '1',
    priority: 'normal',
    status: 'draft',
    planMode: 'even',
    recalcMode: 'auto',
    dayPlans: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  }
}
