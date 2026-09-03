import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'
import { planFormulationBatch } from './batch'
import type { FormulationMixTask, FormulationRecipe } from './types'

export type MixTaskReserveLineResult = {
  itemId: string
  itemName: string
  requested: number
  reserved: number
  skipped: number
}

export type MixTaskReserveResult = {
  ok: boolean
  lines: MixTaskReserveLineResult[]
  messageKey?: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function reservedQtyForMixTask(
  warehouse: WarehouseStore,
  mixTaskId: string,
  itemId: string,
): number {
  let reserved = 0
  for (const m of warehouse.movements) {
    if (m.mixTaskId !== mixTaskId || m.itemId !== itemId) continue
    if (m.type === 'reserve') reserved += Math.abs(m.quantity)
    else if (m.type === 'unreserve') reserved -= Math.abs(m.quantity)
  }
  return Math.max(0, Math.round(reserved * 1000) / 1000)
}

export function buildMixTaskReserveMovements(
  task: FormulationMixTask,
  recipe: FormulationRecipe,
  warehouse: WarehouseStore,
  date = todayIso(),
): { movements: StockMovement[]; lines: MixTaskReserveLineResult[] } {
  const plan = planFormulationBatch(
    recipe,
    warehouse,
    task.targetVolumeL,
    task.warehouseId,
    { allowNegativeStock: true },
  )
  const balances = computeAllBalances(warehouse, task.warehouseId)
  const movements: StockMovement[] = []
  const lines: MixTaskReserveLineResult[] = []

  for (const line of plan.lines) {
    const already = reservedQtyForMixTask(warehouse, task.id, line.warehouseItemId)
    const need = Math.max(0, line.consumeKg - already)
    const available = balances.get(line.warehouseItemId)?.available ?? 0
    const toReserve = Math.min(need, Math.max(0, available))
    const skipped = Math.max(0, need - toReserve)
    lines.push({
      itemId: line.warehouseItemId,
      itemName: line.name,
      requested: need,
      reserved: toReserve,
      skipped,
    })
    if (toReserve <= 0) continue
    const item = warehouse.items.find((i) => i.id === line.warehouseItemId)
    movements.push({
      id: crypto.randomUUID(),
      itemId: line.warehouseItemId,
      warehouseId: item?.warehouseId || task.warehouseId || warehouse.locations[0]?.id || '',
      type: 'reserve',
      quantity: toReserve,
      date,
      mixTaskId: task.id,
      comment: `${task.taskNumber} · ${line.name}`,
      createdAt: new Date().toISOString(),
    })
  }

  return { movements, lines }
}

export function buildMixTaskUnreserveMovements(
  task: FormulationMixTask,
  warehouse: WarehouseStore,
  date = todayIso(),
): StockMovement[] {
  const itemIds = new Set<string>()
  for (const m of warehouse.movements) {
    if (m.mixTaskId === task.id) itemIds.add(m.itemId)
  }
  const movements: StockMovement[] = []
  for (const itemId of itemIds) {
    const qty = reservedQtyForMixTask(warehouse, task.id, itemId)
    if (qty <= 0) continue
    const item = warehouse.items.find((i) => i.id === itemId)
    movements.push({
      id: crypto.randomUUID(),
      itemId,
      warehouseId: item?.warehouseId || task.warehouseId || warehouse.locations[0]?.id || '',
      type: 'unreserve',
      quantity: qty,
      date,
      mixTaskId: task.id,
      comment: `${task.taskNumber} · снятие резерва`,
      createdAt: new Date().toISOString(),
    })
  }
  return movements
}

export function reserveMixTaskInStore(
  task: FormulationMixTask,
  recipe: FormulationRecipe,
  warehouse: WarehouseStore,
): { store: WarehouseStore; result: MixTaskReserveResult } {
  const { movements, lines } = buildMixTaskReserveMovements(task, recipe, warehouse)
  if (!movements.length) {
    return {
      store: warehouse,
      result: {
        ok: lines.some((l) => l.requested > 0 && l.reserved > 0),
        lines,
        messageKey: lines.every((l) => l.requested <= 0)
          ? 'mixer.reserve.already'
          : 'mixer.reserve.nothing',
      },
    }
  }
  const date = todayIso()
  const now = new Date().toISOString()
  const warehouseId = movements[0]!.warehouseId
  const number = nextDocumentNumber(warehouse.documents, 'reservation', date)
  const posted = postWarehouseDocument(warehouse, {
    type: 'reservation',
    number,
    date,
    documentDateTime: now,
    warehouseId,
    purpose: 'production_reservation',
    mixTaskId: task.id,
    comment: `Резерв · ${task.taskNumber}`,
    idempotencyKey: `mix-reserve::${task.id}::${movements.map((m) => `${m.itemId}:${m.quantity}`).join('|')}`,
    docRole: 'production_reservation',
    lines: movements.map((m) => {
      const item = warehouse.items.find((i) => i.id === m.itemId)
      return {
        lineId: crypto.randomUUID(),
        itemId: m.itemId,
        quantity: m.quantity,
        requiredQty: m.quantity,
        reservedQty: m.quantity,
        shortageQty: 0,
        itemCodeSnapshot: item?.internalCode,
        itemNameSnapshot: item?.name,
        unitSnapshot: item?.unit,
      }
    }),
    status: 'posted',
    postedAt: now,
  })
  if (!posted.result.ok) {
    return {
      store: warehouse,
      result: { ok: false, lines, messageKey: posted.result.error },
    }
  }
  let store = posted.store
  store = appendWarehouseAudit(store, {
    action: 'document_post',
    detail: `Резерв под задание ${task.taskNumber} · док. ${number}`,
  })
  const reservedAny = lines.some((l) => l.reserved > 0)
  return {
    store,
    result: {
      ok: reservedAny,
      lines,
      messageKey: reservedAny ? 'mixer.reserve.ok' : 'mixer.reserve.nothing',
    },
  }
}

export function unreserveMixTaskInStore(
  task: FormulationMixTask,
  warehouse: WarehouseStore,
): { store: WarehouseStore; ok: boolean } {
  const movements = buildMixTaskUnreserveMovements(task, warehouse)
  if (!movements.length) return { store: warehouse, ok: false }
  const date = todayIso()
  const now = new Date().toISOString()
  const warehouseId = movements[0]!.warehouseId
  const number = nextDocumentNumber(warehouse.documents, 'reservation', date)
  const posted = postWarehouseDocument(warehouse, {
    type: 'reservation',
    number,
    date,
    documentDateTime: now,
    warehouseId,
    purpose: 'production_reservation_release',
    mixTaskId: task.id,
    comment: `Снятие резерва · ${task.taskNumber}`,
    idempotencyKey: `mix-unreserve::${task.id}::${movements.map((m) => `${m.itemId}:${m.quantity}`).join('|')}`,
    docRole: 'production_reservation_release',
    lines: movements.map((m) => {
      const item = warehouse.items.find((i) => i.id === m.itemId)
      return {
        lineId: crypto.randomUUID(),
        itemId: m.itemId,
        quantity: m.quantity,
        itemCodeSnapshot: item?.internalCode,
        itemNameSnapshot: item?.name,
        unitSnapshot: item?.unit,
      }
    }),
    status: 'posted',
    postedAt: now,
  })
  if (!posted.result.ok) return { store: warehouse, ok: false }
  const store = appendWarehouseAudit(posted.store, {
    action: 'document_post',
    detail: `Снятие резерва ${task.taskNumber} · док. ${number}`,
  })
  return { store, ok: true }
}

export type MixTaskReserveOverviewLine = {
  itemId: string
  itemName: string
  qty: number
}

export type MixTaskReserveOverviewRow = {
  taskId: string
  taskNumber: string
  recipeCode: string
  recipeName: string
  plannedDate: string
  status: FormulationMixTask['status']
  lines: MixTaskReserveOverviewLine[]
  totalQty: number
}

/** Активные резервы по заданиям миксеру (для склада). */
export function listActiveMixTaskReserves(
  warehouse: WarehouseStore,
  mixTasks: FormulationMixTask[],
): MixTaskReserveOverviewRow[] {
  const nameById = new Map(warehouse.items.map((i) => [i.id, i.name]))
  const taskById = new Map(mixTasks.map((t) => [t.id, t]))
  const byTask = new Map<string, Map<string, number>>()

  for (const m of warehouse.movements) {
    if (!m.mixTaskId) continue
    if (m.type !== 'reserve' && m.type !== 'unreserve') continue
    const task = taskById.get(m.mixTaskId)
    if (!task || task.status !== 'open') continue
    let items = byTask.get(m.mixTaskId)
    if (!items) {
      items = new Map()
      byTask.set(m.mixTaskId, items)
    }
    const prev = items.get(m.itemId) ?? 0
    const delta = m.type === 'reserve' ? Math.abs(m.quantity) : -Math.abs(m.quantity)
    items.set(m.itemId, prev + delta)
  }

  const rows: MixTaskReserveOverviewRow[] = []
  for (const [taskId, items] of byTask) {
    const task = taskById.get(taskId)
    if (!task) continue
    const lines: MixTaskReserveOverviewLine[] = []
    let totalQty = 0
    for (const [itemId, raw] of items) {
      const qty = Math.max(0, Math.round(raw * 1000) / 1000)
      if (qty <= 0) continue
      lines.push({
        itemId,
        itemName: nameById.get(itemId) ?? itemId,
        qty,
      })
      totalQty += qty
    }
    if (!lines.length) continue
    lines.sort((a, b) => a.itemName.localeCompare(b.itemName, 'ru'))
    rows.push({
      taskId,
      taskNumber: task.taskNumber,
      recipeCode: task.recipeCode,
      recipeName: task.recipeName,
      plannedDate: task.plannedDate,
      status: task.status,
      lines,
      totalQty: Math.round(totalQty * 1000) / 1000,
    })
  }

  return rows.sort(
    (a, b) =>
      a.plannedDate.localeCompare(b.plannedDate) ||
      a.taskNumber.localeCompare(b.taskNumber),
  )
}
