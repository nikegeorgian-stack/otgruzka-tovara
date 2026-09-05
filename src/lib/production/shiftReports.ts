/**
 * PHASE P1B — production shift report: norm vs fact, confirm atomicity orchestration.
 */
import type { AccessStore, AccessRoleId, AppUser } from '@/lib/access/types'
import type { RecipeNormSnapshot } from '@/lib/formulations/recipeApproval'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionLineId, ProductionShift, ProductionStore } from '@/lib/production/types'
import { canMasterOperateLine, normalizeProductionLineId } from '@/lib/production/masterLineScope'
import type { AppStore } from '@/lib/types'
import {
  allocateBatchesFefoFifo,
  assertUnitCompatible,
  buildBatchLotsFromMovements,
  BATCH_OVERRIDE_REASON_REQUIRED,
  UNIT_MISMATCH_ERROR,
  MISSING_ITEM_ID_ERROR,
} from '@/lib/warehouse/productionReservations'
import { computeLineMaterialBalances } from '@/lib/warehouse/productionMaterialHandoff'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'
import type { WarehouseStore } from '@/lib/warehouse/types'
import {
  postShiftReportWarehouseEffects,
  postShiftReportCorrectionReversals,
  type ShiftConfirmWarehouseResult,
} from '@/lib/warehouse/productionShiftConsumption'

export type ShiftReportStatus = 'draft' | 'confirmed' | 'cancelled'

export type ShiftMaterialActualLine = {
  lineId: string
  itemId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unitSnapshot: string
  /** Norm for actual output (from order snapshot) */
  normQty: number
  /** Total qty removed from line (includes waste) */
  actualInputQty: number
  wasteQty: number
  /** actualInputQty - wasteQty */
  processConsumedQty: number
  deviationQty: number
  deviationPct: number
  tolerancePct: number
  deviationReason?: string
  batchNo?: string
  expiryDate?: string
  batchOverrideReason?: string
}

export type ShiftWasteLine = {
  lineId: string
  itemId: string
  batchNo?: string
  expiryDate?: string
  quantity: number
  unitSnapshot: string
  reasonCode: string
  comment?: string
}

export type ProductionShiftReport = {
  id: string
  number: string
  status: ShiftReportStatus
  productionOrderId: string
  lineId: ProductionLineId
  shiftDate: string
  shift: ProductionShift
  responsibleUserId?: string
  responsibleNameSnapshot?: string
  responsibleRoleSnapshot?: AccessRoleId
  recipeNormSnapshot: RecipeNormSnapshot
  productionLocationId: string
  packagingLocationId: string
  scrapLocationId: string
  materialLines: ShiftMaterialActualLine[]
  wasteLines: ShiftWasteLine[]
  outputM2: number
  rollCount: number
  m2PerRollSnapshot?: number
  conversionTolerancePct?: number
  conversionDeviationReason?: string
  semiFinishedItemId: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  confirmedBy?: string
  confirmedByName?: string
  idempotencyKey: string
  /** Links prior confirmed report when this is a correction addendum */
  correctsReportId?: string
  correctionReason?: string
  consumptionDocumentId?: string
  wipReceiptDocumentId?: string
  wasteTransferPairId?: string
  transactionGroupId?: string
}

export const SHIFT_FORBIDDEN = 'production.shift.errForbidden' as const
export const SHIFT_LINE_FORBIDDEN = 'production.shift.errLineForbidden' as const
export const SHIFT_NO_SNAPSHOT = 'production.shift.errNoSnapshot' as const
export const SHIFT_SETUP = 'production.shift.errSetup' as const
export const SHIFT_DEVIATION_REASON = 'production.shift.errDeviationReason' as const
export const SHIFT_CONVERSION = 'production.shift.errConversion' as const
export const SHIFT_IMMUTABLE = 'production.shift.errImmutable' as const
export const SHIFT_INSUFFICIENT = 'production.shift.errInsufficientAtLine' as const
export const SHIFT_WASTE_REASON = 'production.shift.errWasteReason' as const
export const SHIFT_WASTE_EXCEEDS = 'production.shift.errWasteExceeds' as const
export const SHIFT_IDEMPOTENCY_CONFLICT = 'production.shift.errIdempotencyConflict' as const

export function canCreateShiftReport(user: AppUser | null | undefined): boolean {
  if (!user?.active) return false
  return (
    user.roleId === 'workshop_master' ||
    user.roleId === 'operations_director' ||
    user.roleId === 'sysadmin'
  )
}

export function canConfirmShiftReport(
  store: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>,
  user: AppUser | null | undefined,
  lineId: string,
  access?: AccessStore | null,
): boolean {
  if (!canCreateShiftReport(user)) return false
  if (user!.roleId === 'warehouse_keeper') return false
  return canMasterOperateLine(store, user, lineId, access)
}

export function canCorrectShiftReport(user: AppUser | null | undefined): boolean {
  if (!user?.active) return false
  return user.roleId === 'operations_director' || user.roleId === 'sysadmin'
}

export function computeNormQtyForOutput(
  snapshot: RecipeNormSnapshot,
  itemId: string,
  outputM2: number,
): { normQty: number; tolerancePct: number; unitSnapshot: string } | undefined {
  const comp = snapshot.components.find((c) => c.warehouseItemId === itemId)
  if (!comp) return undefined
  let normQty = comp.normQty
  if (snapshot.normBase === 'per_m2') {
    normQty = comp.normQty * outputM2
  } else if (snapshot.normBase === 'per_batch' && snapshot.batchSize && snapshot.batchSize > 0) {
    // Treat batchSize as m² equivalent coverage of the batch when order uses m² output
    normQty = (comp.normQty / snapshot.batchSize) * outputM2
  } else if (snapshot.normBase === 'per_roll') {
    normQty = comp.normQty * outputM2 // caller should pass roll-scaled if needed
  }
  return {
    normQty,
    tolerancePct: comp.tolerancePct,
    unitSnapshot: comp.unitSnapshot,
  }
}

export function deviationPct(actual: number, norm: number): number {
  if (Math.abs(norm) < 1e-9) return actual === 0 ? 0 : 100
  return ((actual - norm) / Math.abs(norm)) * 100
}

function nextShiftReportNumber(reports: ProductionShiftReport[], date: string): string {
  const day = date.replace(/-/g, '')
  const prefix = `СО-${day}-`
  let max = 0
  for (const r of reports) {
    if (!r.number.startsWith(prefix)) continue
    const n = Number(r.number.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export type ConfirmShiftReportInput = {
  report: Omit<
    ProductionShiftReport,
    | 'id'
    | 'number'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
    | 'confirmedAt'
    | 'processConsumedQty'
  > & { id?: string; number?: string }
  productionOrder: ProductionOrder
  actor: {
    id?: string
    name?: string
    roleId?: AccessRoleId
  }
  access?: AccessStore | null
  appScope: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>
  idempotencyKey: string
  transactionGroupId?: string
  /** Emergency sysadmin reason */
  emergencyReason?: string
}

export type ConfirmShiftReportResult = {
  ok: boolean
  error?: string
  idempotent?: boolean
  report?: ProductionShiftReport
  warehouse?: ShiftConfirmWarehouseResult
}

/**
 * Validate and confirm a shift report. Returns updated production + warehouse stores.
 * All warehouse effects are applied only after validation; on warehouse failure original stores returned.
 */
export function confirmProductionShiftReport(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ConfirmShiftReportInput,
): {
  production: ProductionStore
  warehouse: WarehouseStore
  result: ConfirmShiftReportResult
} {
  const userLike = {
    id: input.actor.id ?? '',
    login: '',
    displayName: input.actor.name ?? '',
    roleId: input.actor.roleId ?? 'workshop_master',
    passwordHash: '',
    passwordSalt: '',
    active: true,
  } as AppUser

  if (input.actor.roleId === 'warehouse_keeper') {
    return {
      production,
      warehouse,
      result: { ok: false, error: SHIFT_FORBIDDEN },
    }
  }

  const lineId = normalizeProductionLineId(input.report.lineId)
  if (!lineId || lineId === 'pack') {
    return { production, warehouse, result: { ok: false, error: SHIFT_LINE_FORBIDDEN } }
  }

  if (!canConfirmShiftReport(input.appScope, userLike, lineId, input.access)) {
    if (input.actor.roleId === 'sysadmin' && !input.emergencyReason?.trim()) {
      return { production, warehouse, result: { ok: false, error: SHIFT_FORBIDDEN } }
    }
    if (input.actor.roleId !== 'sysadmin' && input.actor.roleId !== 'operations_director') {
      return { production, warehouse, result: { ok: false, error: SHIFT_LINE_FORBIDDEN } }
    }
  }

  const existing = (production.shiftReports ?? []).find(
    (r) => r.idempotencyKey === input.idempotencyKey && r.status !== 'cancelled',
  )
  if (existing) {
    const same =
      existing.productionOrderId === input.report.productionOrderId &&
      existing.outputM2 === input.report.outputM2 &&
      existing.rollCount === input.report.rollCount &&
      existing.materialLines.length === input.report.materialLines.length
    if (!same) {
      return {
        production,
        warehouse,
        result: { ok: false, error: SHIFT_IDEMPOTENCY_CONFLICT },
      }
    }
    return {
      production,
      warehouse,
      result: { ok: true, idempotent: true, report: existing },
    }
  }

  const order = input.productionOrder
  const snapshot = order.recipeNormSnapshot ?? input.report.recipeNormSnapshot
  if (!snapshot?.components?.length) {
    return { production, warehouse, result: { ok: false, error: SHIFT_NO_SNAPSHOT } }
  }

  const semiId = order.semiFinishedItemId ?? input.report.semiFinishedItemId
  if (!semiId?.trim()) {
    return { production, warehouse, result: { ok: false, error: SHIFT_SETUP } }
  }

  const lineResolve = resolveProductionLineLocation(warehouse, lineId)
  if (!lineResolve.ok) {
    return { production, warehouse, result: { ok: false, error: lineResolve.error } }
  }

  const packBinding = resolveProductionLineLocation(warehouse, 'pack')
  if (!packBinding.ok) {
    return { production, warehouse, result: { ok: false, error: SHIFT_SETUP } }
  }

  // Stable scrap location only — no name matching
  const scrapId =
    input.report.scrapLocationId?.trim() || warehouse.scrapLocationId?.trim() || ''
  if (!scrapId || !warehouse.locations.some((l) => l.id === scrapId)) {
    return { production, warehouse, result: { ok: false, error: SHIFT_SETUP } }
  }

  const outputM2 = Math.max(0, input.report.outputM2)
  const rollCount = Math.max(0, input.report.rollCount)
  const m2PerRoll = order.m2PerRoll ?? input.report.m2PerRollSnapshot
  const convTol = input.report.conversionTolerancePct ?? 5
  if (m2PerRoll && m2PerRoll > 0 && rollCount > 0) {
    const expected = rollCount * m2PerRoll
    const pct = deviationPct(outputM2, expected)
    if (Math.abs(pct) > convTol && !input.report.conversionDeviationReason?.trim()) {
      return { production, warehouse, result: { ok: false, error: SHIFT_CONVERSION } }
    }
  }

  const materialLines: ShiftMaterialActualLine[] = []
  for (const raw of input.report.materialLines) {
    if (!raw.itemId?.trim()) {
      return { production, warehouse, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const item = warehouse.items.find((i) => i.id === raw.itemId)
    if (!item) {
      return { production, warehouse, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const unitCheck = assertUnitCompatible(item.unit, raw.unitSnapshot, item.unitConversions)
    if (!unitCheck.ok) {
      return { production, warehouse, result: { ok: false, error: UNIT_MISMATCH_ERROR } }
    }

    const normInfo = computeNormQtyForOutput(snapshot, raw.itemId, outputM2)
    const normQty = normInfo?.normQty ?? raw.normQty
    const tolerancePct = normInfo?.tolerancePct ?? raw.tolerancePct
    const actualInputQty = Math.max(0, raw.actualInputQty)
    const wasteQty = Math.max(0, raw.wasteQty ?? 0)
    if (wasteQty > actualInputQty + 1e-9) {
      return { production, warehouse, result: { ok: false, error: SHIFT_WASTE_EXCEEDS } }
    }
    const processConsumedQty = actualInputQty - wasteQty
    const devQty = actualInputQty - normQty
    const devPct = deviationPct(actualInputQty, normQty)
    if (Math.abs(devPct) > tolerancePct + 1e-9 && !raw.deviationReason?.trim()) {
      return { production, warehouse, result: { ok: false, error: SHIFT_DEVIATION_REASON } }
    }

    // At-line remaining check
    const atLine = computeLineMaterialBalances(warehouse, {
      productionOrderId: order.id,
      productionLocationId: lineResolve.productionLocationId,
      itemId: raw.itemId,
    })
    const remaining = atLine.reduce((s, r) => s + r.remainingQty, 0)
    if (actualInputQty > remaining + 1e-9) {
      return { production, warehouse, result: { ok: false, error: SHIFT_INSUFFICIENT } }
    }

    let batchNo = raw.batchNo
    let expiryDate = raw.expiryDate
    if (batchNo && !raw.batchOverrideReason?.trim()) {
      // Manual batch without reason — only allowed if FEFO would pick same
      const lots = buildBatchLotsFromMovements(
        warehouse.movements.filter((m) => m.productionOrderId === order.id),
        raw.itemId,
        lineResolve.productionLocationId,
      )
      const auto = allocateBatchesFefoFifo(lots, actualInputQty)[0]
      if (auto && auto.batchNo !== batchNo) {
        return { production, warehouse, result: { ok: false, error: BATCH_OVERRIDE_REASON_REQUIRED } }
      }
    }
    if (!batchNo) {
      const lots = buildBatchLotsFromMovements(
        warehouse.movements.filter(
          (m) =>
            m.warehouseId === lineResolve.productionLocationId &&
            (m.productionOrderId === order.id || m.type === 'receipt'),
        ),
        raw.itemId,
        lineResolve.productionLocationId,
      )
      // Prefer order-tagged lots via line balances
      const balRows = atLine.filter((r) => r.remainingQty > 0)
      if (balRows[0]?.batchNo) {
        batchNo = balRows[0].batchNo
        expiryDate = balRows[0].expiryDate
      } else {
        const alloc = allocateBatchesFefoFifo(lots, actualInputQty)[0]
        batchNo = alloc?.batchNo
        expiryDate = alloc?.expiryDate
      }
    }

    materialLines.push({
      lineId: raw.lineId || crypto.randomUUID(),
      itemId: raw.itemId,
      itemCodeSnapshot: raw.itemCodeSnapshot ?? item.internalCode,
      itemNameSnapshot: raw.itemNameSnapshot ?? item.name,
      unitSnapshot: raw.unitSnapshot || item.unit,
      normQty,
      actualInputQty,
      wasteQty,
      processConsumedQty,
      deviationQty: devQty,
      deviationPct: devPct,
      tolerancePct,
      deviationReason: raw.deviationReason,
      batchNo,
      expiryDate,
      batchOverrideReason: raw.batchOverrideReason,
    })
  }

  const wasteLines: ShiftWasteLine[] = []
  for (const w of input.report.wasteLines ?? []) {
    if (w.quantity <= 0) continue
    if (!w.reasonCode?.trim() && !w.comment?.trim()) {
      return { production, warehouse, result: { ok: false, error: SHIFT_WASTE_REASON } }
    }
    wasteLines.push({
      ...w,
      lineId: w.lineId || crypto.randomUUID(),
      unitSnapshot: w.unitSnapshot || 'kg',
    })
  }
  // Waste qty on material lines must match explicit waste lines (no silent waste transfer)
  for (const m of materialLines) {
    const covering = wasteLines.filter((w) => w.itemId === m.itemId)
    const sum = covering.reduce((s, w) => s + w.quantity, 0)
    if (m.wasteQty > 0) {
      if (Math.abs(sum - m.wasteQty) > 1e-6) {
        return { production, warehouse, result: { ok: false, error: SHIFT_WASTE_EXCEEDS } }
      }
      if (!covering.length || covering.some((w) => !w.reasonCode?.trim() && !w.comment?.trim())) {
        return { production, warehouse, result: { ok: false, error: SHIFT_WASTE_REASON } }
      }
    } else if (sum > 1e-9) {
      return { production, warehouse, result: { ok: false, error: SHIFT_WASTE_EXCEEDS } }
    }
  }

  const now = new Date().toISOString()
  const reports = production.shiftReports ?? []
  const report: ProductionShiftReport = {
    id: input.report.id ?? crypto.randomUUID(),
    number: input.report.number ?? nextShiftReportNumber(reports, input.report.shiftDate),
    status: 'confirmed',
    productionOrderId: order.id,
    lineId,
    shiftDate: input.report.shiftDate,
    shift: input.report.shift,
    responsibleUserId: input.actor.id,
    responsibleNameSnapshot: input.actor.name,
    responsibleRoleSnapshot: input.actor.roleId,
    recipeNormSnapshot: snapshot,
    productionLocationId: lineResolve.productionLocationId,
    packagingLocationId: packBinding.productionLocationId,
    scrapLocationId: scrapId,
    materialLines,
    wasteLines,
    outputM2,
    rollCount,
    m2PerRollSnapshot: m2PerRoll,
    conversionTolerancePct: convTol,
    conversionDeviationReason: input.report.conversionDeviationReason,
    semiFinishedItemId: semiId,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: input.actor.id,
    confirmedByName: input.actor.name,
    idempotencyKey: input.idempotencyKey,
    correctsReportId: input.report.correctsReportId,
    correctionReason: input.report.correctionReason,
    transactionGroupId: input.transactionGroupId ?? input.idempotencyKey,
  }

  const whOut = postShiftReportWarehouseEffects(warehouse, {
    report,
    actor: input.actor,
    transactionGroupId: report.transactionGroupId!,
  })
  if (!whOut.result.ok) {
    return {
      production,
      warehouse,
      result: { ok: false, error: whOut.result.error },
    }
  }

  const confirmed: ProductionShiftReport = {
    ...report,
    consumptionDocumentId: whOut.result.consumptionDocumentId,
    wipReceiptDocumentId: whOut.result.wipReceiptDocumentId,
    wasteTransferPairId: whOut.result.wasteTransferPairId,
  }

  return {
    production: {
      ...production,
      shiftReports: [...reports, confirmed],
    },
    warehouse: whOut.store,
    result: {
      ok: true,
      report: confirmed,
      warehouse: whOut.result,
    },
  }
}

export function isShiftReportImmutable(report: ProductionShiftReport): boolean {
  return report.status === 'confirmed'
}

export const SHIFT_CORRECTION_REASON = 'production.shift.errCorrectionReason' as const
export const SHIFT_CORRECTION_FORBIDDEN = 'production.shift.errCorrectionForbidden' as const

/**
 * Correction = new confirmed addendum + reversal documents for prior warehouse effects.
 * Original report and documents remain; originals are not deleted / unposted destructively.
 */
export function confirmShiftReportCorrection(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ConfirmShiftReportInput & {
    originalReportId: string
    correctionReason: string
  },
): {
  production: ProductionStore
  warehouse: WarehouseStore
  result: ConfirmShiftReportResult
} {
  if (!canCorrectShiftReport({
    id: input.actor.id ?? '',
    login: '',
    displayName: input.actor.name ?? '',
    roleId: input.actor.roleId ?? 'operations_director',
    passwordHash: '',
    passwordSalt: '',
    active: true,
  } as AppUser)) {
    return {
      production,
      warehouse,
      result: { ok: false, error: SHIFT_CORRECTION_FORBIDDEN },
    }
  }
  if (input.actor.roleId === 'sysadmin' && !input.emergencyReason?.trim() && !input.correctionReason?.trim()) {
    return { production, warehouse, result: { ok: false, error: SHIFT_CORRECTION_FORBIDDEN } }
  }
  if (!input.correctionReason?.trim()) {
    return { production, warehouse, result: { ok: false, error: SHIFT_CORRECTION_REASON } }
  }

  const original = (production.shiftReports ?? []).find((r) => r.id === input.originalReportId)
  if (!original || original.status !== 'confirmed') {
    return { production, warehouse, result: { ok: false, error: SHIFT_IMMUTABLE } }
  }

  const rev = postShiftReportCorrectionReversals(warehouse, {
    original,
    actor: input.actor,
    reason: input.correctionReason.trim(),
    transactionGroupId: input.transactionGroupId ?? input.idempotencyKey,
  })
  if (!rev.result.ok) {
    return { production, warehouse, result: { ok: false, error: rev.result.error } }
  }

  return confirmProductionShiftReport(production, rev.store, {
    ...input,
    report: {
      ...input.report,
      correctsReportId: original.id,
      correctionReason: input.correctionReason.trim(),
      scrapLocationId: input.report.scrapLocationId || original.scrapLocationId,
      packagingLocationId: input.report.packagingLocationId || original.packagingLocationId,
      productionLocationId: input.report.productionLocationId || original.productionLocationId,
      semiFinishedItemId: input.report.semiFinishedItemId || original.semiFinishedItemId,
      recipeNormSnapshot: input.report.recipeNormSnapshot || original.recipeNormSnapshot,
    },
  })
}
