/**
 * PHASE P1C — packaging reports, FG lot creation, and WIP consumption.
 */
import type { AccessStore, AccessRoleId, AppUser } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'
import type { ProductionLineId, ProductionShift, ProductionStore } from './types'
import { canMasterOperateLine, normalizeProductionLineId } from './masterLineScope'
import type { WarehouseStore } from '@/lib/warehouse/types'
import {
  allocateBatchesFefoFifo,
  assertUnitCompatible,
  buildBatchLotsFromMovements,
  BATCH_OVERRIDE_REASON_REQUIRED,
  UNIT_MISMATCH_ERROR,
  MISSING_ITEM_ID_ERROR,
} from '@/lib/warehouse/productionReservations'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'
import {
  postPackagingReportWarehouseEffects,
  reversePackagingReportWarehouseEffects,
  type PackagingReportWarehouseResult,
} from '@/lib/warehouse/productionPackagingConsumption'
import type { FinishedGoodsLot } from './finishedGoodsLots'

export type PackagingReportStatus = 'draft' | 'confirmed' | 'cancelled'

export type PackagingMaterialLine = {
  lineId: string
  itemId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unitSnapshot: string
  quantity: number
  inputUnit?: string
  batchNo?: string
  expiryDate?: string
  batchOverrideReason?: string
}

export type PackagingWipLine = {
  lineId: string
  shiftReportId: string
  productionOrderId?: string
  semiFinishedItemId: string
  itemId: string
  receiptDocumentId?: string
  quantity: number
  remainingQty?: number
  unitSnapshot: string
  batchNo?: string
  expiryDate?: string
}

export type ProductionPackagingReport = {
  id: string
  number: string
  status: PackagingReportStatus
  productionOrderId: string
  lineId: ProductionLineId
  shiftDate: string
  shift: ProductionShift
  packagingLocationId: string
  finishedProductId: string
  warehouseItemId: string
  semiFinishedItemId: string
  materialLines: PackagingMaterialLine[]
  wipLines: PackagingWipLine[]
  outputM2: number
  rollCount: number
  palletCount: number
  m2PerRollSnapshot?: number
  rollsPerPalletSnapshot?: number
  conversionTolerancePct?: number
  conversionDeviationReason?: string
  batchNo: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  confirmedBy?: string
  confirmedByName?: string
  idempotencyKey: string
  finishedGoodsLotId?: string
  fgReceiptDocumentId?: string
  transactionGroupId?: string
  correctsReportId?: string
  correctionReason?: string
  /** G5.4 — BOM traceability from order snapshot at confirm */
  packagingBomId?: string
  packagingBomVersion?: number
  packagingBomContentHash?: string
  packagingComponentNorms?: import('@/lib/planner/g5PackagingBom').PackagingComponentNorm[]
  packagingExcessReason?: string
  packagingBomSnapshotAsOfDate?: string
  packagingBomSnapshot?: import('@/lib/planner/g5PackagingBom').PackagingBomSnapshot
}

export const PACK_FORBIDDEN = 'production.pack.errForbidden' as const
export const PACK_LINE_FORBIDDEN = 'production.pack.errLineForbidden' as const
export const PACK_NO_ORDER = 'production.pack.errNoOrder' as const
export const PACK_SETUP = 'production.pack.errSetup' as const
export const PACK_WIP_MISMATCH = 'production.pack.errWipMismatch' as const
export const PACK_WIP_INSUFFICIENT = 'production.pack.errWipInsufficient' as const
export const PACK_CONVERSION = 'production.pack.errConversion' as const
export const PACK_MATERIALS = 'production.pack.errMaterials' as const
export const PACK_IMMUTABLE = 'production.pack.errImmutable' as const
export const PACK_IDEMPOTENCY_CONFLICT = 'production.pack.errIdempotencyConflict' as const
export const PACK_SHIPPED_LOCK = 'production.pack.errBelowShipped' as const
export const PACK_BATCH_OVERRIDE_REASON_REQUIRED = BATCH_OVERRIDE_REASON_REQUIRED

export function isPackagingReportImmutable(report: Pick<ProductionPackagingReport, 'status'>): boolean {
  return report.status === 'confirmed' || report.status === 'cancelled'
}

export function canCreatePackagingReport(user: AppUser | null | undefined): boolean {
  if (!user?.active) return false
  if (user.roleId === 'warehouse_keeper') return false
  return (
    user.roleId === 'workshop_master' ||
    user.roleId === 'operations_director' ||
    user.roleId === 'sysadmin'
  )
}

export function canConfirmPackagingReport(
  store: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>,
  user: AppUser | null | undefined,
  lineId: string,
  access?: AccessStore | null,
  opts?: { emergencyReason?: string },
): boolean {
  if (!canCreatePackagingReport(user)) return false
  if (user?.roleId === 'sysadmin' && !opts?.emergencyReason?.trim()) return false
  const norm = normalizeProductionLineId(lineId)
  if (norm !== 'pack') return false
  return canMasterOperateLine(store, user, 'pack', access)
}

export function nextPackagingReportNumber(reports: ProductionPackagingReport[], date: string): string {
  const day = date.replace(/-/g, '')
  const prefix = `УП-${day}-`
  let max = 0
  for (const r of reports) {
    if (!r.number.startsWith(prefix)) continue
    const n = Number(r.number.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function loadExistingPackagingReport(
  production: ProductionStore,
  idempotencyKey: string,
): ProductionPackagingReport | undefined {
  return (production.packagingReports ?? []).find(
    (r) => r.idempotencyKey === idempotencyKey && r.status !== 'cancelled',
  )
}

function calcDeviationPct(actual: number, expected: number): number {
  if (Math.abs(expected) < 1e-9) return actual === 0 ? 0 : 100
  return ((actual - expected) / Math.abs(expected)) * 100
}

export function listAvailableWipAtPackaging(
  production: ProductionStore,
  warehouse: WarehouseStore,
  packagingLocationId: string,
): PackagingWipLine[] {
  const reports = new Map((production.shiftReports ?? []).map((r) => [r.id, r]))
  const docsById = new Map(warehouse.documents.map((d) => [d.id, d]))
  const rows: PackagingWipLine[] = []

  for (const doc of warehouse.documents) {
    const role = String(doc.docRole ?? '')
    const isWipReceipt =
      doc.purpose === 'production_wip_receipt' ||
      role === 'production_wip_receipt' ||
      role === 'wip_receipt' ||
      (doc.purpose === 'production_receipt' &&
        (doc as { isWip?: boolean }).isWip === true)
    if (
      doc.status !== 'posted' ||
      !isWipReceipt ||
      !doc.shiftReportId
    ) {
      continue
    }
    // Accept docs booked on production warehouse with pack location on lines,
    // or legacy docs where warehouseId itself is the packaging location id.
    const lineAtPack = doc.lines.some(
      (l) => String((l as { locationId?: string }).locationId ?? '') === packagingLocationId,
    )
    const warehouseIsPack = doc.warehouseId === packagingLocationId
    if (!lineAtPack && !warehouseIsPack) continue

    const shiftReport = reports.get(doc.shiftReportId)
    if (!shiftReport || shiftReport.status !== 'confirmed') continue

    for (const line of doc.lines) {
      const receivedQty = Math.max(0, line.quantity)
      if (receivedQty <= 0) continue
      const issueQty = warehouse.movements
        .filter(
          (m) =>
            m.warehouseId === packagingLocationId &&
            m.shiftReportId === doc.shiftReportId &&
            m.itemId === line.itemId &&
            m.type === 'issue' &&
            docsById.get(m.documentId ?? '')?.purpose === 'production_wip_pack_consumption',
        )
        .reduce((sum, m) => sum + Math.max(0, m.quantity), 0)
      const remainingQty = Math.max(0, receivedQty - issueQty)
      if (remainingQty <= 0) continue
      rows.push({
        lineId: line.lineId ?? doc.id,
        shiftReportId: doc.shiftReportId,
        productionOrderId:
          shiftReport.productionOrderId ||
          (shiftReport as { orderId?: string }).orderId ||
          '',
        semiFinishedItemId: line.itemId,
        itemId: line.itemId,
        receiptDocumentId: doc.id,
        quantity: remainingQty,
        remainingQty,
        unitSnapshot: line.unitSnapshot ?? 'm2',
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
      })
    }
  }

  return rows
}

export type ConfirmPackagingReportInput = {
  report: Omit<
    ProductionPackagingReport,
    | 'id'
    | 'number'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
    | 'confirmedAt'
    | 'confirmedBy'
    | 'confirmedByName'
    | 'fgReceiptDocumentId'
    | 'finishedGoodsLotId'
    | 'transactionGroupId'
  > & { id?: string; number?: string }
  actor: { id?: string; name?: string; roleId?: AccessRoleId }
  access?: AccessStore | null
  appScope: Pick<AppStore, 'brigades' | 'brigadiers' | 'employees'>
  idempotencyKey: string
  transactionGroupId?: string
  emergencyReason?: string
}

export type ConfirmPackagingReportResult = {
  ok: boolean
  error?: string
  idempotent?: boolean
  report?: ProductionPackagingReport
  lot?: FinishedGoodsLot
  warehouse?: PackagingReportWarehouseResult
}

function validateWipLines(
  production: ProductionStore,
  warehouse: WarehouseStore,
  report: Pick<
    ProductionPackagingReport,
    'productionOrderId' | 'packagingLocationId' | 'semiFinishedItemId' | 'wipLines'
  >,
): { ok: true; available: PackagingWipLine[] } | { ok: false; error: string } {
  const available = listAvailableWipAtPackaging(production, warehouse, report.packagingLocationId)
  const order = production.planner.orders.find((o) => o.id === report.productionOrderId)
  if (!order) return { ok: false, error: PACK_NO_ORDER }
  if (order.semiFinishedItemId && order.semiFinishedItemId !== report.semiFinishedItemId) {
    return { ok: false, error: PACK_WIP_MISMATCH }
  }

  for (const line of report.wipLines) {
    const match = available.find(
      (w) =>
        w.shiftReportId === line.shiftReportId &&
        w.semiFinishedItemId === line.semiFinishedItemId &&
        (!report.productionOrderId || w.productionOrderId === report.productionOrderId),
    )
    if (!match) return { ok: false, error: PACK_WIP_MISMATCH }
    if (line.quantity <= 0 || line.quantity > (match.remainingQty ?? match.quantity) + 1e-9) {
      return { ok: false, error: PACK_WIP_INSUFFICIENT }
    }
    if (match.productionOrderId !== report.productionOrderId) {
      return { ok: false, error: PACK_WIP_MISMATCH }
    }
  }

  return { ok: true, available }
}

function validateMaterialLines(
  warehouse: WarehouseStore,
  packagingLocationId: string,
  lines: PackagingMaterialLine[],
): { ok: true; normalized: PackagingMaterialLine[] } | { ok: false; error: string } {
  const normalized: PackagingMaterialLine[] = []

  for (const raw of lines) {
    if (!raw.itemId?.trim()) {
      return { ok: false, error: MISSING_ITEM_ID_ERROR }
    }
    const item = warehouse.items.find((i) => i.id === raw.itemId)
    if (!item) {
      return { ok: false, error: MISSING_ITEM_ID_ERROR }
    }
    const unitCheck = assertUnitCompatible(item.unit, raw.inputUnit, item.unitConversions)
    if (!unitCheck.ok) {
      return { ok: false, error: UNIT_MISMATCH_ERROR }
    }

    const qty = Math.max(0, raw.quantity)
    if (qty <= 0) continue

    let batchNo = raw.batchNo
    let expiryDate = raw.expiryDate
    if (batchNo) {
      const lots = buildBatchLotsFromMovements(warehouse.movements, raw.itemId, packagingLocationId)
      const auto = allocateBatchesFefoFifo(lots, qty)[0]
      if (auto && auto.batchNo !== batchNo && !raw.batchOverrideReason?.trim()) {
        return { ok: false, error: PACK_BATCH_OVERRIDE_REASON_REQUIRED }
      }
    } else {
      const lots = buildBatchLotsFromMovements(warehouse.movements, raw.itemId, packagingLocationId)
      const alloc = allocateBatchesFefoFifo(lots, qty)[0]
      batchNo = alloc?.batchNo
      expiryDate = alloc?.expiryDate
    }

    normalized.push({
      lineId: raw.lineId || crypto.randomUUID(),
      itemId: raw.itemId,
      itemCodeSnapshot: raw.itemCodeSnapshot ?? item.internalCode,
      itemNameSnapshot: raw.itemNameSnapshot ?? item.name,
      unitSnapshot: raw.unitSnapshot || item.unit,
      quantity: qty,
      inputUnit: raw.inputUnit,
      batchNo,
      expiryDate,
      batchOverrideReason: raw.batchOverrideReason,
    })
  }

  return { ok: true, normalized }
}

function validateConversion(
  report: Pick<
    ProductionPackagingReport,
    | 'outputM2'
    | 'rollCount'
    | 'palletCount'
    | 'm2PerRollSnapshot'
    | 'rollsPerPalletSnapshot'
    | 'conversionTolerancePct'
  >,
): string | null {
  const tol = report.conversionTolerancePct ?? 5
  if (report.m2PerRollSnapshot && report.rollCount > 0) {
    const expectedM2 = report.rollCount * report.m2PerRollSnapshot
    if (Math.abs(calcDeviationPct(report.outputM2, expectedM2)) > tol) {
      return PACK_CONVERSION
    }
  }
  if (report.rollsPerPalletSnapshot && report.palletCount > 0) {
    const expectedRolls = report.palletCount * report.rollsPerPalletSnapshot
    if (Math.abs(calcDeviationPct(report.rollCount, expectedRolls)) > tol) {
      return PACK_CONVERSION
    }
  }
  return null
}

export function confirmProductionPackagingReport(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ConfirmPackagingReportInput,
): { production: ProductionStore; warehouse: WarehouseStore; result: ConfirmPackagingReportResult } {
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
    return { production, warehouse, result: { ok: false, error: PACK_FORBIDDEN } }
  }

  if (!canConfirmPackagingReport(input.appScope, userLike, input.report.lineId, input.access, {
    emergencyReason: input.emergencyReason,
  })) {
    return { production, warehouse, result: { ok: false, error: PACK_LINE_FORBIDDEN } }
  }

  const existing = loadExistingPackagingReport(production, input.idempotencyKey)
  if (existing) {
    const same =
      existing.productionOrderId === input.report.productionOrderId &&
      existing.lineId === input.report.lineId &&
      existing.packagingLocationId === input.report.packagingLocationId &&
      existing.outputM2 === input.report.outputM2 &&
      existing.rollCount === input.report.rollCount &&
      existing.palletCount === input.report.palletCount &&
      existing.materialLines.length === input.report.materialLines.length &&
      existing.wipLines.length === input.report.wipLines.length
    if (!same) {
      return { production, warehouse, result: { ok: false, error: PACK_IDEMPOTENCY_CONFLICT } }
    }
    return {
      production,
      warehouse,
      result: { ok: true, idempotent: true, report: existing },
    }
  }

  const order = production.planner.orders.find((o) => o.id === input.report.productionOrderId)
  if (!order) {
    return { production, warehouse, result: { ok: false, error: PACK_NO_ORDER } }
  }
  if (order.semiFinishedItemId && order.semiFinishedItemId !== input.report.semiFinishedItemId) {
    return { production, warehouse, result: { ok: false, error: PACK_WIP_MISMATCH } }
  }
  if (normalizeProductionLineId(input.report.lineId) !== 'pack') {
    return { production, warehouse, result: { ok: false, error: PACK_LINE_FORBIDDEN } }
  }

  const packBinding = resolveProductionLineLocation(warehouse, 'pack')
  if (!packBinding.ok || packBinding.productionLocationId !== input.report.packagingLocationId) {
    return { production, warehouse, result: { ok: false, error: PACK_SETUP } }
  }

  const finishedProductId =
    input.report.finishedProductId || order.finishedProductId || order.warehouseItemId
  const warehouseItemId =
    input.report.warehouseItemId || order.warehouseItemId || order.finishedProductId
  if (!finishedProductId || !warehouseItemId) {
    return { production, warehouse, result: { ok: false, error: PACK_SETUP } }
  }

  const wipCheck = validateWipLines(production, warehouse, input.report)
  if (!wipCheck.ok) {
    return { production, warehouse, result: { ok: false, error: wipCheck.error } }
  }

  const materialsCheck = validateMaterialLines(
    warehouse,
    input.report.packagingLocationId,
    input.report.materialLines,
  )
  if (!materialsCheck.ok) {
    return { production, warehouse, result: { ok: false, error: materialsCheck.error } }
  }

  const conversionError = validateConversion(input.report)
  if (conversionError && !input.report.conversionDeviationReason?.trim()) {
    return { production, warehouse, result: { ok: false, error: conversionError } }
  }

  const now = new Date().toISOString()
  const reports = production.packagingReports ?? []
  const reportId = input.report.id ?? crypto.randomUUID()
  const existingDraft = reports.find((r) => r.id === reportId)
  const lotId = existingDraft?.finishedGoodsLotId ?? crypto.randomUUID()
  const reportNumber = input.report.number ?? nextPackagingReportNumber(reports, input.report.shiftDate)
  const lot: FinishedGoodsLot = {
    id: lotId,
    warehouseItemId,
    finishedProductId,
    batchNo: input.report.batchNo || reportNumber,
    productionOrderId: order.id,
    packagingReportId: reportId,
    sourceShiftReportIds: [...new Set(input.report.wipLines.map((w) => w.shiftReportId))],
    outputM2: Math.max(0, input.report.outputM2),
    rollCount: Math.max(0, input.report.rollCount),
    palletCount: Math.max(0, input.report.palletCount),
    m2PerRollSnapshot: input.report.m2PerRollSnapshot,
    rollsPerPalletSnapshot: input.report.rollsPerPalletSnapshot,
    productionDate: input.report.shiftDate,
    packagingDate: input.report.shiftDate,
    warehouseId: input.report.packagingLocationId,
    locationId: input.report.packagingLocationId,
    qcStatus: 'pending',
    quantityProduced: Math.max(0, input.report.outputM2),
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    conversionDeviationReason: input.report.conversionDeviationReason,
    createdAt: now,
    updatedAt: now,
    transactionGroupId: input.transactionGroupId ?? input.idempotencyKey,
  }

  const report: ProductionPackagingReport = {
    id: reportId,
    number: reportNumber,
    status: 'confirmed',
    productionOrderId: order.id,
    lineId: 'pack',
    shiftDate: input.report.shiftDate,
    shift: input.report.shift,
    packagingLocationId: input.report.packagingLocationId,
    finishedProductId,
    warehouseItemId,
    semiFinishedItemId: input.report.semiFinishedItemId,
    materialLines: materialsCheck.normalized,
    wipLines: input.report.wipLines.map((line) => ({
      ...line,
      lineId: line.lineId || crypto.randomUUID(),
      productionOrderId: order.id,
    })),
    outputM2: Math.max(0, input.report.outputM2),
    rollCount: Math.max(0, input.report.rollCount),
    palletCount: Math.max(0, input.report.palletCount),
    m2PerRollSnapshot: input.report.m2PerRollSnapshot,
    rollsPerPalletSnapshot: input.report.rollsPerPalletSnapshot,
    conversionTolerancePct: input.report.conversionTolerancePct ?? 5,
    conversionDeviationReason: input.report.conversionDeviationReason,
    batchNo: lot.batchNo,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: input.actor.id,
    confirmedByName: input.actor.name,
    idempotencyKey: input.idempotencyKey,
    finishedGoodsLotId: lot.id,
    transactionGroupId: input.transactionGroupId ?? input.idempotencyKey,
    correctsReportId: input.report.correctsReportId,
    correctionReason: input.report.correctionReason,
  }

  const whOut = postPackagingReportWarehouseEffects(warehouse, {
    report,
    actor: input.actor,
    transactionGroupId: report.transactionGroupId!,
  })
  if (!whOut.result.ok) {
    return { production, warehouse, result: { ok: false, error: whOut.result.error } }
  }

  const confirmedLot: FinishedGoodsLot = {
    ...lot,
    fgReceiptDocumentId: whOut.result.fgReceiptDocumentId,
  }

  const confirmedReport: ProductionPackagingReport = {
    ...report,
    fgReceiptDocumentId: whOut.result.fgReceiptDocumentId,
    finishedGoodsLotId: confirmedLot.id,
  }

  return {
    production: {
      ...production,
      packagingReports: [...reports, confirmedReport],
      finishedGoodsLots: [...(production.finishedGoodsLots ?? []), confirmedLot],
    },
    warehouse: whOut.store,
    result: {
      ok: true,
      report: confirmedReport,
      lot: confirmedLot,
      warehouse: whOut.result,
    },
  }
}

export function confirmPackagingReportCorrection(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ConfirmPackagingReportInput,
): { production: ProductionStore; warehouse: WarehouseStore; result: ConfirmPackagingReportResult } {
  const correctedReportId = input.report.correctsReportId
  if (!correctedReportId || !input.report.correctionReason?.trim()) {
    return { production, warehouse, result: { ok: false, error: PACK_IMMUTABLE } }
  }
  const originalReport = (production.packagingReports ?? []).find((r) => r.id === correctedReportId)
  if (!originalReport || originalReport.status !== 'confirmed') {
    return { production, warehouse, result: { ok: false, error: PACK_IMMUTABLE } }
  }
  const originalLot = (production.finishedGoodsLots ?? []).find(
    (lot) => lot.packagingReportId === originalReport.id || lot.id === originalReport.finishedGoodsLotId,
  )
  const shippedQty = Math.max(0, originalLot?.quantityShipped ?? 0)
  if (input.report.outputM2 < shippedQty) {
    return { production, warehouse, result: { ok: false, error: PACK_SHIPPED_LOCK } }
  }

  const reversed = reversePackagingReportWarehouseEffects(
    warehouse,
    originalReport.idempotencyKey,
    input.actor,
    input.transactionGroupId ?? input.idempotencyKey,
  )
  const confirmed = confirmProductionPackagingReport(
    production,
    reversed.store,
    {
      ...input,
      report: {
        ...input.report,
        correctsReportId: originalReport.id,
        correctionReason: input.report.correctionReason?.trim(),
      },
    },
  )
  if (!confirmed.result.ok) {
    // Fail closed: do not keep a half-applied correction (reversals without new confirm).
    return { production, warehouse, result: confirmed.result }
  }

  // If original lot was QC-released, force re-QC on the corrected lot.
  let nextProduction = confirmed.production
  if (originalLot?.qcStatus === 'released' && confirmed.result.lot) {
    const resetLot = {
      ...confirmed.result.lot,
      qcStatus: 'pending' as const,
      quantityQcReleased: 0,
      quantityRemaining: 0,
      releasedAt: undefined,
      releasedBy: undefined,
      releasedByName: undefined,
      updatedAt: new Date().toISOString(),
    }
    nextProduction = {
      ...nextProduction,
      finishedGoodsLots: (nextProduction.finishedGoodsLots ?? []).map((lot) =>
        lot.id === resetLot.id ? resetLot : lot,
      ),
    }
    return {
      production: nextProduction,
      warehouse: confirmed.warehouse,
      result: { ...confirmed.result, lot: resetLot },
    }
  }

  return {
    production: confirmed.production,
    warehouse: confirmed.warehouse,
    result: confirmed.result,
  }
}

