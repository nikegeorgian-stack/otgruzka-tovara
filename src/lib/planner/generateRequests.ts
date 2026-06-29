import {
  defaultBrigadeForLine,
  defaultForemanId,
  requestShiftKey,
} from '@/lib/production/brigades'
import { emptyProductionRequest } from '@/lib/production/init'
import { newId } from '@/lib/production/files'
import type {
  ProductionLineId,
  ProductionPlanSegment,
  ProductionRequest,
  ProductionShift,
} from '@/lib/production/types'
import type { Employee, MonthSheet } from '@/lib/types'
import { attachDayPackagingPlan } from './packagingOrder'
import type { PackagingRecipe } from '@/lib/packaging/types'
import type { PlannerDayPlan, ProductionOrder } from './types'

export type PlannerTask = {
  order: ProductionOrder
  dayPlan: PlannerDayPlan
  planMp: number
  lineId: ProductionLineId
}

export function dayPlanMp(dp: PlannerDayPlan): number {
  if (!dp.isWorkingDay) return 0
  return dp.manualPlanMp ?? dp.operationalPlanMp ?? 0
}

/** Задачи планировщика на дату (только активные заказы с объёмом > 0). */
export function collectPlannerTasksForDate(
  orders: ProductionOrder[],
  date: string,
  orderIds?: string[],
): PlannerTask[] {
  const tasks: PlannerTask[] = []
  for (const order of orders) {
    if (order.status !== 'active') continue
    if (orderIds?.length && !orderIds.includes(order.id)) continue
    const dp = order.dayPlans.find((p) => p.date === date)
    if (!dp) continue
    const planMp = dayPlanMp(dp)
    if (planMp <= 0) continue
    tasks.push({
      order,
      dayPlan: dp,
      planMp,
      lineId: dp.lineId ?? order.lineId,
    })
  }
  return tasks.sort((a, b) => {
    if (a.order.priority === 'urgent' && b.order.priority !== 'urgent') return -1
    if (b.order.priority === 'urgent' && a.order.priority !== 'urgent') return 1
    return (a.order.orderNumber || a.order.productName).localeCompare(
      b.order.orderNumber || b.order.productName,
      'ru',
    )
  })
}

/** Сводка по линиям на дату: сколько п.м запланировано на каждой линии. */
export function lineAllocationForDate(
  orders: ProductionOrder[],
  date: string,
  orderIds?: string[],
): { lineId: ProductionLineId; totalMp: number; tasks: PlannerTask[] }[] {
  const tasks = collectPlannerTasksForDate(orders, date, orderIds)
  const byLine = new Map<ProductionLineId, PlannerTask[]>()
  for (const task of tasks) {
    const list = byLine.get(task.lineId) ?? []
    list.push(task)
    byLine.set(task.lineId, list)
  }
  return (['1', '2'] as ProductionLineId[])
    .map((lineId) => {
      const lineTasks = byLine.get(lineId) ?? []
      return {
        lineId,
        totalMp: lineTasks.reduce((s, t) => s + t.planMp, 0),
        tasks: lineTasks,
      }
    })
    .filter((row) => row.totalMp > 0)
}

function plannerSourceNote(tasks: PlannerTask[]): string {
  const numbers = [...new Set(tasks.map((t) => t.order.orderNumber).filter(Boolean))]
  if (numbers.length === 1) return numbers[0]
  return numbers.join(', ')
}

function buildPlanSegments(tasks: PlannerTask[]): ProductionPlanSegment[] {
  return tasks.map((t) => ({
    id: newId(),
    orderId: t.order.id,
    dayPlanId: t.dayPlan.id,
    orderNumber: t.order.orderNumber,
    customer: t.order.customer,
    productName: t.order.productName,
    colorLogo: t.order.colorLogo ?? '',
    plannedQtyMp: t.planMp,
    note: t.dayPlan.note || t.order.note || undefined,
  }))
}

function materialFieldsFromTasks(
  tasks: PlannerTask[],
  recipes: PackagingRecipe[],
  locale: 'ru' | 'ka',
) {
  const primary = tasks[0]?.order
  if (!primary) return {}
  const recipe = recipes.find((r) => r.id === primary.packagingRecipeId)
  const dayMp = tasks.reduce((s, t) => s + t.planMp, 0)
  const packagingPlan =
    recipe && primary.metersPerRoll
      ? attachDayPackagingPlan(dayMp, primary, recipe, locale) ?? undefined
      : undefined
  return {
    rawMaterialItemId: primary.rawMaterialItemId,
    rawRollQty: packagingPlan?.rawRollsEstimated,
    packagingRecipeId: primary.packagingRecipeId,
    packagingPlan,
  }
}

export function buildProductionRequestFromPlannerTasks(
  tasks: PlannerTask[],
  date: string,
  lineId: ProductionLineId,
  shift: ProductionShift,
  brigades: string[],
  employees: Employee[],
  monthSheet: MonthSheet | null | undefined,
  existing?: ProductionRequest,
  recipes: PackagingRecipe[] = [],
  locale: 'ru' | 'ka' = 'ru',
): ProductionRequest | null {
  if (!tasks.length) return null

  const brigadeName =
    tasks.find((t) => t.dayPlan.brigadeName)?.dayPlan.brigadeName ??
    defaultBrigadeForLine(lineId, brigades)
  const foremanId = defaultForemanId(brigadeName, employees, monthSheet)
  const now = new Date().toISOString()
  const base =
    existing ??
    emptyProductionRequest(date, lineId, shift, brigadeName)

  const orderNumbers = plannerSourceNote(tasks)

  return {
    ...base,
    date,
    lineId,
    shift,
    brigadeName,
    foremanId,
    orderId: tasks.length === 1 ? tasks[0].order.id : undefined,
    planSegments: buildPlanSegments(tasks),
    fromPlanner: true,
    plannerSourceNote: orderNumbers,
    ...materialFieldsFromTasks(tasks, recipes, locale),
    status:
      existing?.status === 'posted'
        ? 'posted'
        : existing?.status === 'saved'
          ? 'saved'
          : 'draft',
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  }
}

export type GeneratePlannerRequestsOptions = {
  orders: ProductionOrder[]
  requests: ProductionRequest[]
  date: string
  shift?: ProductionShift
  employees: Employee[]
  brigades: string[]
  monthSheet?: MonthSheet | null
  /** Только эти заказы (иначе все активные на дату) */
  orderIds?: string[]
  /** Обновлять черновики, созданные из планировщика */
  overwritePlannerDrafts?: boolean
  packagingRecipes?: PackagingRecipe[]
  locale?: 'ru' | 'ka'
}

export type GeneratePlannerRequestsResult = {
  created: number
  updated: number
  skipped: number
  requests: ProductionRequest[]
  touched: ProductionRequest[]
  messages: string[]
}

export function generateProductionRequestsFromPlanner(
  opts: GeneratePlannerRequestsOptions,
): GeneratePlannerRequestsResult {
  const shift = opts.shift ?? 'day'
  const overwrite = opts.overwritePlannerDrafts !== false
  const recipes = opts.packagingRecipes ?? []
  const locale = opts.locale ?? 'ru'
  const tasks = collectPlannerTasksForDate(opts.orders, opts.date, opts.orderIds)
  const messages: string[] = []
  let created = 0
  let updated = 0
  let skipped = 0

  const buckets = new Map<string, PlannerTask[]>()
  for (const task of tasks) {
    const key = requestShiftKey(opts.date, task.lineId, shift)
    const list = buckets.get(key) ?? []
    list.push(task)
    buckets.set(key, list)
  }

  const nextRequests = [...opts.requests]
  const touched: ProductionRequest[] = []

  for (const [key, bucketTasks] of buckets) {
    const [, lineId, shiftKey] = key.split('|') as [string, ProductionLineId, ProductionShift]
    const existing = nextRequests.find(
      (r) => requestShiftKey(r.date, r.lineId, r.shift) === key,
    )

    if (existing?.status === 'posted' || existing?.status === 'saved') {
      skipped++
      messages.push(`skip_posted:${lineId}:${shiftKey}`)
      continue
    }

    if (existing && !existing.fromPlanner && !overwrite) {
      skipped++
      messages.push(`skip_manual:${lineId}:${shiftKey}`)
      continue
    }

    const built = buildProductionRequestFromPlannerTasks(
      bucketTasks,
      opts.date,
      lineId,
      shiftKey,
      opts.brigades,
      opts.employees,
      opts.monthSheet,
      existing,
      recipes,
      locale,
    )
    if (!built) continue

    const idx = nextRequests.findIndex((r) => r.id === built.id)
    if (idx >= 0) {
      nextRequests[idx] = built
      updated++
    } else {
      nextRequests.push(built)
      created++
    }
    touched.push(built)
  }

  if (!tasks.length) {
    messages.push('no_tasks')
  }

  return { created, updated, skipped, requests: nextRequests, touched, messages }
}

/** Заявка для одной смены (для подхвата в форму без сохранения всего дня). */
export function previewRequestFromPlanner(
  orders: ProductionOrder[],
  date: string,
  lineId: ProductionLineId,
  shift: ProductionShift,
  brigades: string[],
  employees: Employee[],
  monthSheet: MonthSheet | null | undefined,
  orderIds?: string[],
  recipes: PackagingRecipe[] = [],
  locale: 'ru' | 'ka' = 'ru',
): ProductionRequest | null {
  const tasks = collectPlannerTasksForDate(orders, date, orderIds).filter(
    (t) => t.lineId === lineId,
  )
  if (!tasks.length) return null
  return buildProductionRequestFromPlannerTasks(
    tasks,
    date,
    lineId,
    shift,
    brigades,
    employees,
    monthSheet,
    undefined,
    recipes,
    locale,
  )
}

/** ID заказов, связанных с заявкой (уровень заявки + сегменты). */
export function linkedOrderIdsFromRequest(req: ProductionRequest): string[] {
  const ids = new Set<string>()
  if (req.orderId) ids.add(req.orderId)
  for (const seg of req.planSegments) {
    if (seg.orderId) ids.add(seg.orderId)
  }
  return [...ids]
}
