/**
 * Planner material reserve — thin facade over PHASE W3 document-backed reservations.
 * Bare reserve/unreserve movements are no longer created here.
 */
import {
  confirmProductionOrderReservation,
  planProductionReservationLines,
  releaseProductionOrderReservation,
  type ProductionReservationResult,
  type ReservationLinePlan,
} from '@/lib/warehouse/productionReservations'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { materialLinesForOrder } from './materialNeeds'
import { availabilityForOrderLine } from './materialStock'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { ProductionOrder } from './types'

export type MaterialReserveLineResult = {
  itemId: string
  itemName: string
  requested: number
  reserved: number
  skipped: number
}

export type MaterialReserveResult = {
  ok: boolean
  lines: MaterialReserveLineResult[]
  messageKey?: string
  messageVars?: Record<string, string | number>
  documentId?: string
  provisioningStatus?: ProductionReservationResult['provisioningStatus']
}

function mapLines(plans: ReservationLinePlan[]): MaterialReserveLineResult[] {
  return plans.map((p) => ({
    itemId: p.itemId,
    itemName: p.itemName,
    requested: Math.max(0, p.requiredQty - p.alreadyReserved),
    reserved: p.reserveNow,
    skipped: p.shortageQty,
  }))
}

export function reserveOrderMaterialsInStore(
  order: ProductionOrder,
  warehouse: WarehouseStore,
  opts?: { actor?: { id?: string; name?: string }; transactionGroupId?: string },
): { store: WarehouseStore; result: MaterialReserveResult } {
  if (!materialLinesForOrder(order, warehouse.items).length) {
    return {
      store: warehouse,
      result: { ok: false, lines: [], messageKey: 'planner.material.noLines' },
    }
  }
  const out = confirmProductionOrderReservation(warehouse, order, {
    actor: opts?.actor,
    transactionGroupId: opts?.transactionGroupId,
  })
  return {
    store: out.store,
    result: {
      ok: out.result.ok,
      lines: mapLines(out.result.lines),
      messageKey:
        out.result.messageKey ??
        (out.result.ok ? 'planner.material.reserved' : out.result.error),
      documentId: out.result.documentId,
      provisioningStatus: out.result.provisioningStatus,
    },
  }
}

export function unreserveOrderMaterialsInStore(
  order: ProductionOrder,
  warehouse: WarehouseStore,
  opts?: { actor?: { id?: string; name?: string }; transactionGroupId?: string; reason?: string },
): { store: WarehouseStore; result: MaterialReserveResult } {
  const out = releaseProductionOrderReservation(warehouse, order, {
    actor: opts?.actor,
    transactionGroupId: opts?.transactionGroupId,
    reason: opts?.reason ?? 'manual_unreserve',
  })
  return {
    store: out.store,
    result: {
      ok: out.result.ok,
      lines: mapLines(out.result.lines),
      messageKey: out.result.messageKey,
      documentId: out.result.documentId,
      provisioningStatus: out.result.provisioningStatus,
    },
  }
}

/** Preview only — no store mutation. */
export function buildReserveMovements(
  order: ProductionOrder,
  warehouse: WarehouseStore,
): { movements: []; lines: MaterialReserveLineResult[] } {
  const planned = planProductionReservationLines(order, warehouse, { mode: 'confirm' })
  return { movements: [], lines: mapLines(planned.lines) }
}

/** @deprecated Bare unreserve removed — use unreserveOrderMaterialsInStore. */
export function buildUnreserveMovements(): [] {
  return []
}

/** @deprecated Bare apply removed in W3. */
export function applyWarehouseMovements(warehouse: WarehouseStore): WarehouseStore {
  return warehouse
}

export function historyNoteForReserve(lines: MaterialReserveLineResult[]): string {
  const parts = lines
    .filter((l) => l.reserved > 0)
    .map((l) => `${l.itemName} ${l.reserved}`)
  return parts.length
    ? `Резерв материалов (документ): ${parts.join(', ')}`
    : 'Резерв материалов (документ)'
}

export function historyNoteForUnreserve(order: ProductionOrder): string {
  return `Снят резерв материалов (документ) · ${order.orderNumber}`
}

/** Проверка перед резервом без записи */
export function previewReserve(order: ProductionOrder, warehouse: WarehouseStore) {
  const balances = computeAllBalances(warehouse)
  return materialLinesForOrder(order, warehouse.items).map((line) => {
    const row = availabilityForOrderLine(order, line, warehouse)
    return { ...row, balance: balances.get(line.itemId)?.balance ?? 0 }
  })
}
