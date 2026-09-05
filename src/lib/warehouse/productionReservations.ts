/**
 * PHASE W3 — document-backed production material reservations.
 * Reserve/unreserve only via WarehouseDocument (type=reservation); never bare movements.
 */
import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import { materialLinesForOrder, type OrderMaterialLine } from '@/lib/planner/materialNeeds'
import { reservedQtyForOrder } from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  isWarehouseAccountingActive,
  WAREHOUSE_NOT_INITIALIZED,
} from './accountingStatus'
import { appendWarehouseAudit } from './audit'
import { nextDocumentNumber } from './docNumbering'
import { postWarehouseDocument } from './documents'
import { computeItemBalance, toBaseQty } from './stock'
import type {
  MaterialShortageRecord,
  MaterialShortageStatus,
  StockMovement,
  WarehouseDocument,
  WarehouseDocumentLine,
  WarehouseDocumentPurpose,
  WarehouseStore,
} from './types'

export const BARE_RESERVE_BLOCKED = 'warehouse.reserve.errBareBlocked' as const
export const UNIT_MISMATCH_ERROR = 'warehouse.reserve.errUnitMismatch' as const
export const MISSING_ITEM_ID_ERROR = 'warehouse.reserve.errMissingItemId' as const
export const REALLOCATION_REASON_REQUIRED = 'warehouse.reserve.errReallocationReason' as const
export const FOREIGN_RESERVE_ERROR = 'warehouse.reserve.errForeignReserve' as const
export const BATCH_OVERRIDE_REASON_REQUIRED = 'warehouse.reserve.errBatchOverrideReason' as const

export type ProvisioningStatus =
  | 'not_reserved'
  | 'partially_reserved'
  | 'fully_reserved'
  | 'partially_issued'
  | 'released'
  | 'shortage'
  | 'blocked'

export type ReservationLinePlan = {
  materialLineKey: string
  itemId: string
  itemCode?: string
  itemName: string
  unit: string
  warehouseId: string
  requiredQty: number
  alreadyReserved: number
  available: number
  reserveNow: number
  shortageQty: number
  batchNo?: string
  expiryDate?: string
  blockReason?: string
}

export type ProductionReservationResult = {
  ok: boolean
  idempotent?: boolean
  documentId?: string
  documentIds?: string[]
  lines: ReservationLinePlan[]
  shortages: MaterialShortageRecord[]
  provisioningStatus: ProvisioningStatus
  error?: string
  messageKey?: string
  blockedLines?: ReservationLinePlan[]
}

export type ReallocateReservationInput = {
  sourceProductionOrderId: string
  targetProductionOrderId: string
  itemId: string
  warehouseId: string
  quantity: number
  reason: string
  actor?: { id?: string; name?: string; roleId?: AccessRoleId }
  /** Optional access store for chief_engineer capability check */
  access?: AccessStore | null
  idempotencyKey: string
  batchNo?: string
  expiryDate?: string
  batchOverrideReason?: string
}

const BASE_REALLOCATION_ROLES: AccessRoleId[] = ['operations_director']

/**
 * PHASE P1B — reallocation rights:
 * - operations_director: allowed
 * - planner: no dedicated role — grant via access.userAllowReservationReallocation (user ids)
 * - sysadmin: emergency only with non-empty reason
 * - chief_engineer (and other roles): only when roleAllowReservationReallocation[role]=true AND reason
 * - warehouse_keeper / workshop_master: always denied
 */
export function canManualReallocateReservations(
  user: { id?: string; roleId?: AccessRoleId; active?: boolean } | null | undefined,
  access?: AccessStore | null,
  opts?: { reason?: string },
): boolean {
  if (!user?.roleId) return false
  if (user.active === false) return false
  if (user.roleId === 'warehouse_keeper' || user.roleId === 'workshop_master') return false
  if (BASE_REALLOCATION_ROLES.includes(user.roleId)) return true
  const reasonOk = Boolean(opts?.reason?.trim())
  if (user.roleId === 'sysadmin') return reasonOk
  // Explicit planner assignment (user id allowlist) — same bar as director
  if (user.id && access?.userAllowReservationReallocation?.includes(user.id)) {
    return true
  }
  if (access?.roleAllowReservationReallocation?.[user.roleId] === true && reasonOk) {
    return true
  }
  return false
}

/** Auto-reserve on confirm is allowed for planner operators (not warehouse-only). */
export function canTriggerProductionReservation(user: AppUser | null | undefined): boolean {
  if (!user?.active) return false
  if (user.roleId === 'warehouse_keeper') return false
  if (user.roleId === 'employee' || user.roleId === 'timeclock' || user.roleId === 'cook') {
    return false
  }
  return (
    user.roleId === 'sysadmin' ||
    user.roleId === 'operations_director' ||
    user.roleId === 'chief_engineer' ||
    user.roleId === 'technologist' ||
    user.roleId === 'procurement_manager'
  )
}

export function isReservationDocument(doc: Pick<WarehouseDocument, 'type' | 'purpose'>): boolean {
  return (
    doc.type === 'reservation' ||
    doc.purpose === 'production_reservation' ||
    doc.purpose === 'production_reservation_increase' ||
    doc.purpose === 'production_reservation_release' ||
    doc.purpose === 'production_reservation_reallocation'
  )
}

export function isReservationReleasePurpose(
  purpose: WarehouseDocumentPurpose | undefined,
): boolean {
  return purpose === 'production_reservation_release'
}

/** Movement type for a reservation document purpose. */
export function reservationMovementType(
  purpose: WarehouseDocumentPurpose | undefined,
): 'reserve' | 'unreserve' {
  return isReservationReleasePurpose(purpose) ? 'unreserve' : 'reserve'
}

export function assertUnitCompatible(
  itemUnit: string,
  inputUnit: string | undefined,
  conversions?: { unit: string; factor: number }[],
): { ok: true } | { ok: false; error: typeof UNIT_MISMATCH_ERROR } {
  if (!inputUnit || inputUnit === itemUnit) return { ok: true }
  const conv = conversions?.find((c) => c.unit === inputUnit)
  if (!conv || !(conv.factor > 0)) return { ok: false, error: UNIT_MISMATCH_ERROR }
  return { ok: true }
}

export type BatchLot = {
  batchNo: string
  expiryDate?: string
  available: number
  receivedAt: string
}

/** FEFO when expiry present; otherwise FIFO by receipt time. */
export function allocateBatchesFefoFifo(
  lots: BatchLot[],
  qty: number,
): { batchNo: string; expiryDate?: string; quantity: number }[] {
  if (qty <= 0) return []
  const sorted = [...lots].sort((a, b) => {
    const aExp = a.expiryDate?.trim()
    const bExp = b.expiryDate?.trim()
    if (aExp && bExp) return aExp.localeCompare(bExp)
    if (aExp && !bExp) return -1
    if (!aExp && bExp) return 1
    return a.receivedAt.localeCompare(b.receivedAt)
  })
  let left = qty
  const out: { batchNo: string; expiryDate?: string; quantity: number }[] = []
  for (const lot of sorted) {
    if (left <= 0) break
    const take = Math.min(lot.available, left)
    if (take <= 0) continue
    out.push({ batchNo: lot.batchNo, expiryDate: lot.expiryDate, quantity: take })
    left -= take
  }
  return out
}

export function buildBatchLotsFromMovements(
  movements: StockMovement[],
  itemId: string,
  warehouseId: string,
): BatchLot[] {
  const map = new Map<string, BatchLot>()
  for (const m of movements) {
    if (m.itemId !== itemId || m.warehouseId !== warehouseId) continue
    if (m.type === 'receipt' && m.batchNo) {
      const key = `${m.batchNo}::${m.expiryDate ?? ''}`
      const prev = map.get(key)
      const qty = Math.abs(m.quantity)
      if (prev) {
        prev.available += qty
        if (m.createdAt < prev.receivedAt) prev.receivedAt = m.createdAt
      } else {
        map.set(key, {
          batchNo: m.batchNo,
          expiryDate: m.expiryDate,
          available: qty,
          receivedAt: m.createdAt,
        })
      }
    }
    if ((m.type === 'issue' || m.type === 'reserve') && m.batchNo) {
      const key = `${m.batchNo}::${m.expiryDate ?? ''}`
      const prev = map.get(key)
      if (prev) prev.available = Math.max(0, prev.available - Math.abs(m.quantity))
    }
  }
  return [...map.values()].filter((l) => l.available > 0)
}

export function compareProductionOrderReservePriority(
  a: ProductionOrder,
  b: ProductionOrder,
): number {
  const prio = (o: ProductionOrder) => (o.priority === 'urgent' ? 0 : 1)
  const byPrio = prio(a) - prio(b)
  if (byPrio !== 0) return byPrio
  const byStart = (a.startDate || '').localeCompare(b.startDate || '')
  if (byStart !== 0) return byStart
  const aConfirm =
    a.history.find((h) => h.type === 'activated')?.at ?? a.createdAt
  const bConfirm =
    b.history.find((h) => h.type === 'activated')?.at ?? b.createdAt
  return aConfirm.localeCompare(bConfirm)
}

export function shortageIdempotencyKey(
  orderId: string,
  itemId: string,
  warehouseId: string,
  materialLineKey: string,
): string {
  return `shortage::${orderId}::${itemId}::${warehouseId}::${materialLineKey}`
}

export function upsertMaterialShortages(
  store: WarehouseStore,
  records: Omit<MaterialShortageRecord, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>[],
  now = new Date().toISOString(),
): WarehouseStore {
  const existing = [...(store.materialShortages ?? [])]
  const byKey = new Map(existing.map((r) => [r.idempotencyKey, r]))

  for (const next of records) {
    const prev = byKey.get(next.idempotencyKey)
    const status: MaterialShortageStatus =
      next.shortageQty <= 0 ? 'resolved' : next.reservedQty > 0 ? 'partial' : 'open'
    if (prev) {
      const updated: MaterialShortageRecord = {
        ...prev,
        ...next,
        id: prev.id,
        createdAt: prev.createdAt,
        updatedAt: now,
        status,
        resolvedAt: status === 'resolved' ? prev.resolvedAt ?? now : undefined,
      }
      byKey.set(next.idempotencyKey, updated)
    } else {
      byKey.set(next.idempotencyKey, {
        ...next,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        status,
        resolvedAt: status === 'resolved' ? now : undefined,
      })
    }
  }

  return { ...store, materialShortages: [...byKey.values()] }
}

function materialLineKey(line: OrderMaterialLine): string {
  return `${line.role}::${line.itemId}`
}

export function planProductionReservationLines(
  order: ProductionOrder,
  warehouse: WarehouseStore,
  opts?: {
    /** Extra required qty delta (increase); default = full need minus already reserved */
    mode?: 'confirm' | 'increase' | 'release_remaining'
    inputUnitByItemId?: Record<string, string>
    manualBatchByItemId?: Record<
      string,
      { batchNo: string; expiryDate?: string; reason?: string }
    >
  },
): { lines: ReservationLinePlan[]; blocked: ReservationLinePlan[]; ok: boolean; error?: string } {
  const mode = opts?.mode ?? 'confirm'
  const needs = materialLinesForOrder(order, warehouse.items)
  const lines: ReservationLinePlan[] = []
  const blocked: ReservationLinePlan[] = []

  if (mode === 'release_remaining') {
    const itemIds = new Set<string>()
    for (const m of warehouse.movements) {
      if (m.productionOrderId === order.id) itemIds.add(m.itemId)
    }
    for (const line of needs) itemIds.add(line.itemId)
    for (const itemId of itemIds) {
      const item = warehouse.items.find((i) => i.id === itemId)
      if (!item) continue
      const remaining = reservedQtyForOrder(warehouse.movements, order.id, itemId)
      if (remaining <= 0) continue
      lines.push({
        materialLineKey: `release::${itemId}`,
        itemId,
        itemCode: item.internalCode,
        itemName: item.name,
        unit: item.unit,
        warehouseId: item.warehouseId,
        requiredQty: remaining,
        alreadyReserved: remaining,
        available: remaining,
        reserveNow: remaining,
        shortageQty: 0,
      })
    }
    return { lines, blocked, ok: true }
  }

  for (const need of needs) {
    if (!need.itemId) {
      const row: ReservationLinePlan = {
        materialLineKey: materialLineKey(need),
        itemId: '',
        itemName: need.itemName || '—',
        unit: need.unit,
        warehouseId: '',
        requiredQty: need.quantity,
        alreadyReserved: 0,
        available: 0,
        reserveNow: 0,
        shortageQty: need.quantity,
        blockReason: MISSING_ITEM_ID_ERROR,
      }
      blocked.push(row)
      continue
    }

    const item = warehouse.items.find((i) => i.id === need.itemId)
    if (!item) {
      blocked.push({
        materialLineKey: materialLineKey(need),
        itemId: need.itemId,
        itemName: need.itemName,
        unit: need.unit,
        warehouseId: '',
        requiredQty: need.quantity,
        alreadyReserved: 0,
        available: 0,
        reserveNow: 0,
        shortageQty: need.quantity,
        blockReason: MISSING_ITEM_ID_ERROR,
      })
      continue
    }

    const inputUnit = opts?.inputUnitByItemId?.[item.id]
    const unitCheck = assertUnitCompatible(item.unit, inputUnit, item.unitConversions)
    if (!unitCheck.ok) {
      blocked.push({
        materialLineKey: materialLineKey(need),
        itemId: item.id,
        itemCode: item.internalCode,
        itemName: item.name,
        unit: item.unit,
        warehouseId: item.warehouseId,
        requiredQty: need.quantity,
        alreadyReserved: 0,
        available: 0,
        reserveNow: 0,
        shortageQty: need.quantity,
        blockReason: UNIT_MISMATCH_ERROR,
      })
      continue
    }

    if (!isWarehouseAccountingActive(warehouse, item.warehouseId)) {
      blocked.push({
        materialLineKey: materialLineKey(need),
        itemId: item.id,
        itemCode: item.internalCode,
        itemName: item.name,
        unit: item.unit,
        warehouseId: item.warehouseId,
        requiredQty: need.quantity,
        alreadyReserved: reservedQtyForOrder(warehouse.movements, order.id, item.id),
        available: 0,
        reserveNow: 0,
        shortageQty: need.quantity,
        blockReason: WAREHOUSE_NOT_INITIALIZED,
      })
      continue
    }

    const requiredBase = inputUnit
      ? toBaseQty(item, need.quantity, inputUnit)
      : need.quantity
    const already = reservedQtyForOrder(warehouse.movements, order.id, item.id)
    const stillNeed = Math.max(0, requiredBase - already)
    const bal = computeItemBalance(item.id, warehouse.movements, item.warehouseId)
    const available = Math.max(0, bal.available)
    const reserveNow = Math.min(stillNeed, available)
    const shortageQty = Math.max(0, stillNeed - reserveNow)

    const manual = opts?.manualBatchByItemId?.[item.id]
    let batchNo: string | undefined
    let expiryDate: string | undefined
    if (manual?.batchNo) {
      if (!manual.reason?.trim()) {
        blocked.push({
          materialLineKey: materialLineKey(need),
          itemId: item.id,
          itemCode: item.internalCode,
          itemName: item.name,
          unit: item.unit,
          warehouseId: item.warehouseId,
          requiredQty: requiredBase,
          alreadyReserved: already,
          available,
          reserveNow: 0,
          shortageQty: stillNeed,
          blockReason: BATCH_OVERRIDE_REASON_REQUIRED,
        })
        continue
      }
      batchNo = manual.batchNo
      expiryDate = manual.expiryDate
    } else if (reserveNow > 0) {
      const lots = buildBatchLotsFromMovements(warehouse.movements, item.id, item.warehouseId)
      const alloc = allocateBatchesFefoFifo(lots, reserveNow)
      if (alloc[0]) {
        batchNo = alloc[0].batchNo
        expiryDate = alloc[0].expiryDate
      }
    }

    lines.push({
      materialLineKey: materialLineKey(need),
      itemId: item.id,
      itemCode: item.internalCode,
      itemName: item.name,
      unit: item.unit,
      warehouseId: item.warehouseId,
      requiredQty: requiredBase,
      alreadyReserved: already,
      available,
      reserveNow: mode === 'increase' ? reserveNow : reserveNow,
      shortageQty,
      batchNo,
      expiryDate,
    })
  }

  if (blocked.length && !lines.length) {
    return {
      lines,
      blocked,
      ok: false,
      error: blocked[0]?.blockReason ?? MISSING_ITEM_ID_ERROR,
    }
  }
  return { lines, blocked, ok: true }
}

function provisioningFromPlans(
  lines: ReservationLinePlan[],
  order: ProductionOrder,
  warehouse: WarehouseStore,
): ProvisioningStatus {
  if (!lines.length && !materialLinesForOrder(order, warehouse.items).length) {
    return 'not_reserved'
  }
  const need = lines.reduce((s, l) => s + l.requiredQty, 0)
  const reserved = lines.reduce((s, l) => s + l.alreadyReserved + l.reserveNow, 0)
  const shortage = lines.reduce((s, l) => s + l.shortageQty, 0)
  if (shortage > 0 && reserved > 0) return 'shortage'
  if (shortage > 0 && reserved <= 0) return 'shortage'
  if (reserved <= 0) return 'not_reserved'
  if (need > 0 && reserved + 1e-9 >= need) return 'fully_reserved'
  return 'partially_reserved'
}

export function computeOrderProvisioningStatus(
  order: ProductionOrder,
  warehouse: Pick<
    WarehouseStore,
    'items' | 'movements' | 'accountingByWarehouse' | 'materialShortages'
  >,
): ProvisioningStatus {
  const plan = planProductionReservationLines(order, warehouse as WarehouseStore, {
    mode: 'confirm',
  })
  if (!plan.ok && plan.blocked.some((b) => b.blockReason === WAREHOUSE_NOT_INITIALIZED)) {
    return 'blocked'
  }
  if (plan.blocked.length && !plan.lines.length) return 'blocked'
  const lines = plan.lines
  const need = lines.reduce((s, l) => s + l.requiredQty, 0)
  const reserved = lines.reduce((s, l) => s + l.alreadyReserved, 0)
  const openShort = (warehouse.materialShortages ?? []).some(
    (s) => s.productionOrderId === order.id && s.status !== 'resolved' && s.shortageQty > 0,
  )
  if (openShort) return 'shortage'
  if (reserved <= 0) return 'not_reserved'
  if (need > 0 && reserved + 1e-9 >= need) return 'fully_reserved'
  if (lines.some((l) => l.shortageQty > 0)) return 'shortage'
  return 'partially_reserved'
}

function buildShortageRecords(
  order: ProductionOrder,
  plans: ReservationLinePlan[],
  documentId: string | undefined,
  now: string,
): Omit<MaterialShortageRecord, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>[] {
  return plans.map((p) => {
    const reservedQty = p.alreadyReserved + p.reserveNow
    const shortageQty = Math.max(0, p.requiredQty - reservedQty)
    return {
      productionOrderId: order.id,
      materialLineKey: p.materialLineKey,
      itemId: p.itemId,
      warehouseId: p.warehouseId,
      requiredDate: order.startDate || now.slice(0, 10),
      requiredQty: p.requiredQty,
      reservedQty,
      shortageQty,
      orderPriority: order.priority === 'urgent' ? 'urgent' : 'normal',
      status: (shortageQty <= 0 ? 'resolved' : reservedQty > 0 ? 'partial' : 'open') as MaterialShortageStatus,
      sourceReservationDocumentId: documentId,
      idempotencyKey: shortageIdempotencyKey(
        order.id,
        p.itemId,
        p.warehouseId,
        p.materialLineKey,
      ),
    }
  })
}

function postReservationDoc(
  store: WarehouseStore,
  input: {
    purpose: WarehouseDocumentPurpose
    order: ProductionOrder
    warehouseId: string
    lines: WarehouseDocumentLine[]
    idempotencyKey: string
    comment?: string
    reason?: string
    correctsDocumentId?: string
    relatedDocumentIds?: string[]
    actor?: { id?: string; name?: string }
    transactionGroupId?: string
    date?: string
  },
): { store: WarehouseStore; result: { ok: boolean; documentId?: string; error?: string; idempotent?: boolean } } {
  const date = input.date ?? new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const isRelease = isReservationReleasePurpose(input.purpose)
  const number = nextDocumentNumber(store.documents, 'reservation', date)
  const posted = postWarehouseDocument(store, {
    type: 'reservation',
    number,
    date,
    documentDateTime: now,
    warehouseId: input.warehouseId,
    purpose: input.purpose,
    productionOrderId: input.order.id,
    basisType: 'production_order',
    basisId: input.order.id,
    basisNumber: input.order.orderNumber,
    comment: input.comment,
    reservationReason: input.reason,
    correctsDocumentId: input.correctsDocumentId,
    relatedDocumentIds: input.relatedDocumentIds,
    idempotencyKey: input.idempotencyKey,
    transactionGroupId: input.transactionGroupId,
    docRole: isRelease ? 'production_reservation_release' : 'production_reservation',
    lines: input.lines,
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
    skipFieldValidation: input.lines.every((l) => l.quantity === 0),
  })
  if (!posted.result.ok) {
    return {
      store,
      result: {
        ok: false,
        error: posted.result.error,
      },
    }
  }
  const documentId = posted.result.documentId
  const beforeDocs = store.documents.length
  const afterDocs = posted.store.documents.length
  return {
    store: posted.store,
    result: {
      ok: true,
      documentId,
      idempotent: afterDocs === beforeDocs,
    },
  }
}

/** Confirm / activate: create reservation document + shortages (idempotent). */
export function confirmProductionOrderReservation(
  store: WarehouseStore,
  order: ProductionOrder,
  opts?: {
    actor?: { id?: string; name?: string; roleId?: AccessRoleId }
    idempotencyKey?: string
    transactionGroupId?: string
    manualBatchByItemId?: Record<
      string,
      { batchNo: string; expiryDate?: string; reason?: string }
    >
  },
): { store: WarehouseStore; result: ProductionReservationResult } {
  const idempotencyKey =
    opts?.idempotencyKey ?? `warehouse::production_reservation::${order.id}::confirm`
  const existing = store.documents.find(
    (d) => d.idempotencyKey === idempotencyKey && d.status !== 'cancelled',
  )
  if (existing) {
    const plan = planProductionReservationLines(order, store, { mode: 'confirm' })
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        lines: plan.lines,
        shortages: (store.materialShortages ?? []).filter(
          (s) => s.productionOrderId === order.id,
        ),
        provisioningStatus: computeOrderProvisioningStatus(order, store),
        messageKey: 'planner.material.alreadyReserved',
      },
    }
  }

  const planned = planProductionReservationLines(order, store, {
    mode: 'confirm',
    manualBatchByItemId: opts?.manualBatchByItemId,
  })

  if (!planned.ok) {
    return {
      store,
      result: {
        ok: false,
        lines: planned.lines,
        blockedLines: planned.blocked,
        shortages: store.materialShortages ?? [],
        provisioningStatus: 'blocked',
        error: planned.error,
        messageKey: planned.error,
      },
    }
  }

  if (!planned.lines.length && planned.blocked.length) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        blockedLines: planned.blocked,
        shortages: [],
        provisioningStatus: 'blocked',
        error: planned.blocked[0]?.blockReason,
        messageKey: planned.blocked[0]?.blockReason,
      },
    }
  }

  if (!planned.lines.length) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'not_reserved',
        messageKey: 'planner.material.noLines',
      },
    }
  }

  // Group by warehouse (multi-warehouse materials → one doc per wh)
  const byWh = new Map<string, ReservationLinePlan[]>()
  for (const line of planned.lines) {
    const list = byWh.get(line.warehouseId) ?? []
    list.push(line)
    byWh.set(line.warehouseId, list)
  }

  let next = store
  const documentIds: string[] = []
  const now = new Date().toISOString()

  for (const [warehouseId, group] of byWh) {
    const docLines = group.map((p) => ({
      lineId: crypto.randomUUID(),
      itemId: p.itemId,
      quantity: p.reserveNow,
      requiredQty: p.requiredQty,
      reservedQty: p.alreadyReserved + p.reserveNow,
      shortageQty: p.shortageQty,
      itemCodeSnapshot: p.itemCode,
      itemNameSnapshot: p.itemName,
      unitSnapshot: p.unit,
      plannedQty: p.requiredQty,
      actualQty: p.reserveNow,
      batchNo: p.batchNo,
      expiryDate: p.expiryDate,
    }))
    // Allow posting even when all quantities are 0 (shortage-only snapshot)
    const posted = postReservationDoc(next, {
      purpose: 'production_reservation',
      order,
      warehouseId,
      lines: docLines.some((l) => l.quantity > 0)
        ? docLines.filter((l) => l.quantity > 0).length
          ? docLines
          : docLines
        : docLines.map((l) => ({ ...l, quantity: 0 })),
      idempotencyKey:
        byWh.size === 1 ? idempotencyKey : `${idempotencyKey}::wh::${warehouseId}`,
      comment: `Резерв материалов · ${order.orderNumber}`,
      actor: opts?.actor,
      transactionGroupId: opts?.transactionGroupId,
    })
    if (!posted.result.ok) {
      return {
        store,
        result: {
          ok: false,
          lines: planned.lines,
          shortages: [],
          provisioningStatus: 'blocked',
          error: posted.result.error,
        },
      }
    }
    next = posted.store
    if (posted.result.documentId) documentIds.push(posted.result.documentId)

    // Shortage-only: if all qty 0, still ensure document exists — postWarehouseDocument may reject empty qty lines
    if (!posted.result.documentId) {
      return { store, result: { ok: false, lines: planned.lines, shortages: [], provisioningStatus: 'blocked', error: 'post_failed' } }
    }

    const shortages = buildShortageRecords(
      order,
      group,
      posted.result.documentId,
      now,
    )
    next = upsertMaterialShortages(next, shortages, now)
  }

  next = appendWarehouseAudit(next, {
    action: 'document_post',
    detail: `Резерв материалов · заказ ${order.orderNumber} · док. ${documentIds.join(',')}`,
    actorId: opts?.actor?.id,
    actorName: opts?.actor?.name,
  })

  return {
    store: next,
    result: {
      ok: true,
      documentId: documentIds[0],
      documentIds,
      lines: planned.lines,
      shortages: (next.materialShortages ?? []).filter((s) => s.productionOrderId === order.id),
      provisioningStatus: provisioningFromPlans(planned.lines, order, next),
      messageKey: planned.lines.some((l) => l.shortageQty > 0)
        ? 'planner.material.partial'
        : 'planner.material.reserved',
    },
  }
}

/** Increase order qty → additional reservation document. */
export function increaseProductionOrderReservation(
  store: WarehouseStore,
  order: ProductionOrder,
  opts?: {
    actor?: { id?: string; name?: string }
    idempotencyKey?: string
    transactionGroupId?: string
    reason?: string
  },
): { store: WarehouseStore; result: ProductionReservationResult } {
  const planned = planProductionReservationLines(order, store, { mode: 'increase' })
  if (!planned.ok) {
    return {
      store,
      result: {
        ok: false,
        lines: planned.lines,
        blockedLines: planned.blocked,
        shortages: store.materialShortages ?? [],
        provisioningStatus: 'blocked',
        error: planned.error,
      },
    }
  }
  const toReserve = planned.lines.filter((l) => l.reserveNow > 0)
  const idempotencyKey =
    opts?.idempotencyKey ??
    `warehouse::production_reservation_increase::${order.id}::need::${planned.lines
      .map((l) => `${l.itemId}:${l.requiredQty}`)
      .join('|')}`

  const existing = store.documents.find(
    (d) => d.idempotencyKey === idempotencyKey && d.status !== 'cancelled',
  )
  if (existing) {
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        lines: planned.lines,
        shortages: (store.materialShortages ?? []).filter(
          (s) => s.productionOrderId === order.id,
        ),
        provisioningStatus: computeOrderProvisioningStatus(order, store),
      },
    }
  }

  if (!toReserve.length) {
    const now = new Date().toISOString()
    const next = upsertMaterialShortages(
      store,
      buildShortageRecords(order, planned.lines, undefined, now),
      now,
    )
    return {
      store: next,
      result: {
        ok: true,
        lines: planned.lines,
        shortages: (next.materialShortages ?? []).filter(
          (s) => s.productionOrderId === order.id,
        ),
        provisioningStatus: provisioningFromPlans(planned.lines, order, next),
        messageKey: 'planner.material.reserveNone',
      },
    }
  }

  const warehouseId = toReserve[0]!.warehouseId
  const docLines = toReserve.map((p) => ({
    lineId: crypto.randomUUID(),
    itemId: p.itemId,
    quantity: p.reserveNow,
    requiredQty: p.requiredQty,
    reservedQty: p.alreadyReserved + p.reserveNow,
    shortageQty: p.shortageQty,
    itemCodeSnapshot: p.itemCode,
    itemNameSnapshot: p.itemName,
    unitSnapshot: p.unit,
    batchNo: p.batchNo,
    expiryDate: p.expiryDate,
  }))
  const posted = postReservationDoc(store, {
    purpose: 'production_reservation_increase',
    order,
    warehouseId,
    lines: docLines,
    idempotencyKey,
    comment: `Увеличение резерва · ${order.orderNumber}`,
    reason: opts?.reason,
    actor: opts?.actor,
    transactionGroupId: opts?.transactionGroupId,
  })
  if (!posted.result.ok || !posted.result.documentId) {
    return {
      store,
      result: {
        ok: false,
        lines: planned.lines,
        shortages: [],
        provisioningStatus: 'blocked',
        error: posted.result.error,
      },
    }
  }
  const now = new Date().toISOString()
  const next = upsertMaterialShortages(
    posted.store,
    buildShortageRecords(order, planned.lines, posted.result.documentId, now),
    now,
  )
  return {
    store: next,
    result: {
      ok: true,
      documentId: posted.result.documentId,
      lines: planned.lines,
      shortages: (next.materialShortages ?? []).filter((s) => s.productionOrderId === order.id),
      provisioningStatus: provisioningFromPlans(planned.lines, order, next),
    },
  }
}

/** Release remaining (unissued) reserve — cancel or decrease. */
export function releaseProductionOrderReservation(
  store: WarehouseStore,
  order: ProductionOrder,
  opts?: {
    actor?: { id?: string; name?: string }
    idempotencyKey?: string
    transactionGroupId?: string
    reason?: string
    /** Release only specific item quantities (decrease); default = all remaining */
    releaseByItemId?: Record<string, number>
  },
): { store: WarehouseStore; result: ProductionReservationResult } {
  const planned = planProductionReservationLines(order, store, { mode: 'release_remaining' })
  let releaseLines = planned.lines
  if (opts?.releaseByItemId) {
    releaseLines = planned.lines
      .map((l) => {
        const cap = opts.releaseByItemId![l.itemId]
        if (cap == null) return null
        const qty = Math.min(l.reserveNow, Math.max(0, cap))
        if (qty <= 0) return null
        return { ...l, reserveNow: qty, requiredQty: qty }
      })
      .filter(Boolean) as ReservationLinePlan[]
  }

  const idempotencyKey =
    opts?.idempotencyKey ??
    `warehouse::production_reservation_release::${order.id}::${opts?.releaseByItemId
      ? Object.entries(opts.releaseByItemId)
          .map(([k, v]) => `${k}:${v}`)
          .join('|')
      : 'cancel'}`

  const existing = store.documents.find(
    (d) => d.idempotencyKey === idempotencyKey && d.status !== 'cancelled',
  )
  if (existing) {
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        lines: releaseLines,
        shortages: (store.materialShortages ?? []).filter(
          (s) => s.productionOrderId === order.id,
        ),
        provisioningStatus: 'released',
      },
    }
  }

  if (!releaseLines.length) {
    return {
      store,
      result: {
        ok: true,
        lines: [],
        shortages: (store.materialShortages ?? []).filter(
          (s) => s.productionOrderId === order.id,
        ),
        provisioningStatus: 'released',
        messageKey: 'planner.material.alreadyReserved',
      },
    }
  }

  const warehouseId = releaseLines[0]!.warehouseId
  const docLines = releaseLines.map((p) => ({
    lineId: crypto.randomUUID(),
    itemId: p.itemId,
    quantity: p.reserveNow,
    requiredQty: p.requiredQty,
    reservedQty: 0,
    shortageQty: 0,
    itemCodeSnapshot: p.itemCode,
    itemNameSnapshot: p.itemName,
    unitSnapshot: p.unit,
  }))
  const posted = postReservationDoc(store, {
    purpose: 'production_reservation_release',
    order,
    warehouseId,
    lines: docLines,
    idempotencyKey,
    comment: `Освобождение резерва · ${order.orderNumber}`,
    reason: opts?.reason,
    actor: opts?.actor,
    transactionGroupId: opts?.transactionGroupId,
  })
  if (!posted.result.ok || !posted.result.documentId) {
    return {
      store,
      result: {
        ok: false,
        lines: releaseLines,
        shortages: [],
        provisioningStatus: 'blocked',
        error: posted.result.error,
      },
    }
  }

  const now = new Date().toISOString()
  const afterPlan = planProductionReservationLines(order, posted.store, { mode: 'confirm' })
  const next = upsertMaterialShortages(
    posted.store,
    buildShortageRecords(order, afterPlan.lines, posted.result.documentId, now),
    now,
  )
  return {
    store: next,
    result: {
      ok: true,
      documentId: posted.result.documentId,
      lines: releaseLines,
      shortages: (next.materialShortages ?? []).filter((s) => s.productionOrderId === order.id),
      provisioningStatus: 'released',
    },
  }
}

/**
 * Explicit reallocation: release source + reserve target in one logical op.
 * Caller must wrap store apply; this function is atomic on WarehouseStore snapshot
 * (returns original store on any failure).
 */
export function reallocateProductionReservation(
  store: WarehouseStore,
  sourceOrder: ProductionOrder,
  targetOrder: ProductionOrder,
  input: ReallocateReservationInput,
): { store: WarehouseStore; result: ProductionReservationResult } {
  if (!input.reason?.trim()) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: REALLOCATION_REASON_REQUIRED,
        messageKey: REALLOCATION_REASON_REQUIRED,
      },
    }
  }
  if (
    !canManualReallocateReservations(input.actor, input.access, { reason: input.reason })
  ) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: 'warehouse.reserve.errForbidden',
        messageKey: 'warehouse.reserve.errForbidden',
      },
    }
  }

  const existing = store.documents.find(
    (d) => d.idempotencyKey === input.idempotencyKey && d.status !== 'cancelled',
  )
  if (existing) {
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        lines: [],
        shortages: store.materialShortages ?? [],
        provisioningStatus: computeOrderProvisioningStatus(targetOrder, store),
      },
    }
  }

  const qty = Math.max(0, input.quantity)
  if (qty <= 0) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: 'warehouse.doc.errLines',
      },
    }
  }

  const own = reservedQtyForOrder(
    store.movements,
    sourceOrder.id,
    input.itemId,
  )
  if (own + 1e-9 < qty) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: FOREIGN_RESERVE_ERROR,
        messageKey: FOREIGN_RESERVE_ERROR,
      },
    }
  }

  // Foreign check: cannot take another order's reserve beyond own
  const item = store.items.find((i) => i.id === input.itemId)
  if (!item || item.id !== input.itemId) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: MISSING_ITEM_ID_ERROR,
      },
    }
  }

  if (input.batchNo && !input.batchOverrideReason?.trim()) {
    // Manual batch on reallocate requires reason when overriding FEFO
    const lots = buildBatchLotsFromMovements(store.movements, input.itemId, input.warehouseId)
    const auto = allocateBatchesFefoFifo(lots, qty)[0]
    if (auto && auto.batchNo !== input.batchNo) {
      return {
        store,
        result: {
          ok: false,
          lines: [],
          shortages: [],
          provisioningStatus: 'blocked',
          error: BATCH_OVERRIDE_REASON_REQUIRED,
        },
      }
    }
  }

  const releaseKey = `${input.idempotencyKey}::release`
  const reserveKey = `${input.idempotencyKey}::reserve`

  const released = releaseProductionOrderReservation(store, sourceOrder, {
    actor: input.actor,
    idempotencyKey: releaseKey,
    reason: input.reason,
    releaseByItemId: { [input.itemId]: qty },
    transactionGroupId: input.idempotencyKey,
  })
  if (!released.result.ok) {
    return { store, result: released.result }
  }

  // Build target reserve for exact qty (may be partial if available dropped — fail closed)
  const bal = computeItemBalance(input.itemId, released.store.movements, input.warehouseId)
  if (bal.available + 1e-9 < qty) {
    return {
      store,
      result: {
        ok: false,
        lines: [],
        shortages: [],
        provisioningStatus: 'blocked',
        error: 'warehouse.doc.errInsufficientStock',
      },
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const lots = buildBatchLotsFromMovements(
    released.store.movements,
    input.itemId,
    input.warehouseId,
  )
  const autoBatch = allocateBatchesFefoFifo(lots, qty)[0]
  const batchNo = input.batchNo ?? autoBatch?.batchNo
  const expiryDate = input.expiryDate ?? autoBatch?.expiryDate

  const posted = postReservationDoc(released.store, {
    purpose: 'production_reservation_reallocation',
    order: targetOrder,
    warehouseId: input.warehouseId,
    lines: [
      {
        lineId: crypto.randomUUID(),
        itemId: input.itemId,
        quantity: qty,
        requiredQty: qty,
        reservedQty: qty,
        shortageQty: 0,
        itemCodeSnapshot: item.internalCode,
        itemNameSnapshot: item.name,
        unitSnapshot: item.unit,
        batchNo,
        expiryDate,
        batchOverrideReason: input.batchOverrideReason,
      },
    ],
    idempotencyKey: reserveKey,
    comment: `Перераспределение резерва ← ${sourceOrder.orderNumber} → ${targetOrder.orderNumber}`,
    reason: input.reason,
    relatedDocumentIds: released.result.documentId
      ? [released.result.documentId]
      : undefined,
    actor: input.actor,
    transactionGroupId: input.idempotencyKey,
    date,
  })
  if (!posted.result.ok) {
    return { store, result: { ...released.result, ok: false, error: posted.result.error } }
  }

  // Link release doc to reserve
  let next = posted.store
  if (released.result.documentId && posted.result.documentId) {
    next = {
      ...next,
      documents: next.documents.map((d) => {
        if (d.id === released.result.documentId) {
          return {
            ...d,
            relatedDocumentIds: [...(d.relatedDocumentIds ?? []), posted.result.documentId!],
            purpose: 'production_reservation_reallocation' as const,
          }
        }
        if (d.id === posted.result.documentId) {
          return {
            ...d,
            correctsDocumentId: released.result.documentId,
            relatedDocumentIds: [released.result.documentId!],
          }
        }
        return d
      }),
    }
  }

  const srcPlan = planProductionReservationLines(sourceOrder, next, { mode: 'confirm' })
  const tgtPlan = planProductionReservationLines(targetOrder, next, { mode: 'confirm' })
  next = upsertMaterialShortages(
    next,
    [
      ...buildShortageRecords(sourceOrder, srcPlan.lines, released.result.documentId, now),
      ...buildShortageRecords(targetOrder, tgtPlan.lines, posted.result.documentId, now),
    ],
    now,
  )
  next = appendWarehouseAudit(next, {
    action: 'document_post',
    detail: `Перераспределение резерва ${qty} · ${sourceOrder.orderNumber} → ${targetOrder.orderNumber} · ${input.reason}`,
    itemId: input.itemId,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: next,
    result: {
      ok: true,
      documentId: posted.result.documentId,
      documentIds: [released.result.documentId, posted.result.documentId].filter(
        Boolean,
      ) as string[],
      lines: tgtPlan.lines,
      shortages: (next.materialShortages ?? []).filter(
        (s) =>
          s.productionOrderId === sourceOrder.id ||
          s.productionOrderId === targetOrder.id,
      ),
      provisioningStatus: computeOrderProvisioningStatus(targetOrder, next),
    },
  }
}

/** Sync reservation after active order qty/material change. */
export function syncReservationAfterOrderChange(
  store: WarehouseStore,
  prev: ProductionOrder,
  nextOrder: ProductionOrder,
  opts?: { actor?: { id?: string; name?: string }; transactionGroupId?: string },
): { store: WarehouseStore; result: ProductionReservationResult } {
  if (nextOrder.status === 'cancelled' && prev.status !== 'cancelled') {
    return releaseProductionOrderReservation(store, nextOrder, {
      actor: opts?.actor,
      reason: 'order_cancelled',
      transactionGroupId: opts?.transactionGroupId,
    })
  }
  if (nextOrder.status !== 'active' && nextOrder.status !== 'paused') {
    return {
      store,
      result: {
        ok: true,
        lines: [],
        shortages: store.materialShortages ?? [],
        provisioningStatus: 'not_reserved',
      },
    }
  }

  const prevNeed = materialLinesForOrder(prev, store.items)
  const nextNeed = materialLinesForOrder(nextOrder, store.items)
  const prevMap = new Map(prevNeed.map((l) => [l.itemId, l.quantity]))
  const releaseByItemId: Record<string, number> = {}
  let needIncrease = false

  for (const line of nextNeed) {
    const was = prevMap.get(line.itemId) ?? 0
    if (line.quantity > was + 1e-9) needIncrease = true
    if (line.quantity < was - 1e-9) {
      const reserved = reservedQtyForOrder(store.movements, nextOrder.id, line.itemId)
      const excess = Math.max(0, reserved - line.quantity)
      if (excess > 0) releaseByItemId[line.itemId] = excess
    }
  }
  for (const [itemId, qty] of prevMap) {
    if (!nextNeed.some((l) => l.itemId === itemId) && qty > 0) {
      const reserved = reservedQtyForOrder(store.movements, nextOrder.id, itemId)
      if (reserved > 0) releaseByItemId[itemId] = reserved
    }
  }

  let next = store
  if (Object.keys(releaseByItemId).length) {
    const released = releaseProductionOrderReservation(next, nextOrder, {
      actor: opts?.actor,
      releaseByItemId,
      reason: 'order_qty_decrease',
      transactionGroupId: opts?.transactionGroupId,
    })
    if (!released.result.ok) return released
    next = released.store
  }
  if (needIncrease) {
    return increaseProductionOrderReservation(next, nextOrder, {
      actor: opts?.actor,
      reason: 'order_qty_increase',
      transactionGroupId: opts?.transactionGroupId,
    })
  }
  const plan = planProductionReservationLines(nextOrder, next, { mode: 'confirm' })
  const now = new Date().toISOString()
  next = upsertMaterialShortages(
    next,
    buildShortageRecords(nextOrder, plan.lines, undefined, now),
    now,
  )
  return {
    store: next,
    result: {
      ok: true,
      lines: plan.lines,
      shortages: (next.materialShortages ?? []).filter(
        (s) => s.productionOrderId === nextOrder.id,
      ),
      provisioningStatus: computeOrderProvisioningStatus(nextOrder, next),
    },
  }
}

export function listReservationDocumentsForOrder(
  store: Pick<WarehouseStore, 'documents'>,
  orderId: string,
): WarehouseDocument[] {
  return store.documents
    .filter((d) => d.productionOrderId === orderId && isReservationDocument(d))
    .sort((a, b) =>
      (a.documentDateTime || a.createdAt).localeCompare(b.documentDateTime || b.createdAt),
    )
}

export function isLegacyBareReserveMovement(m: StockMovement): boolean {
  return (m.type === 'reserve' || m.type === 'unreserve') && !m.documentId
}