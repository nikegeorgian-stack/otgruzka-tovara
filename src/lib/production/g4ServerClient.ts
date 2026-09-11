/**
 * PHASE G4 — web client for packaging / QC / shipment commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type G4CommandType =
  | 'packaging.domain.activate'
  | 'packaging.report.draft.save'
  | 'packaging.report.draft.delete'
  | 'packaging.report.confirm'
  | 'packaging.report.createCorrection'
  | 'packaging.report.confirmCorrection'
  | 'packaging.read'
  | 'qc.review.start'
  | 'qc.release'
  | 'qc.regrade'
  | 'qc.reject'
  | 'qc.scrap.writeoff'
  | 'shipment.draft.save'
  | 'shipment.draft.delete'
  | 'shipment.post'
  | 'shipment.cancel'

export type G4ProductionDomain = {
  recipeVersions?: unknown[]
  orders?: unknown[]
  shiftReports?: unknown[]
  wipBatches?: unknown[]
  wasteRecords?: unknown[]
  handoffs?: unknown[]
  auditLog?: unknown[]
  packagingReports?: unknown[]
  finishedGoodsLots?: unknown[]
  qcDecisions?: unknown[]
}

type G4AuthoritativeRow = Record<string, unknown>

export const G4_AUTHORITATIVE_STATE_INCOMPLETE = 'authoritative_g4_state_incomplete' as const

export type G4AuthoritativeProductionAdapterResult =
  | { ok: true; production: G4ProductionDomain }
  | {
      ok: false
      error: typeof G4_AUTHORITATIVE_STATE_INCOMPLETE
      reason: string
    }

function authoritativeRow(value: unknown): G4AuthoritativeRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
      ? (value as G4AuthoritativeRow)
      : null
  } catch {
    return null
  }
}

function strictAuthoritativeRows(value: unknown): G4AuthoritativeRow[] | null {
  if (!Array.isArray(value)) return null
  const result: G4AuthoritativeRow[] = []
  for (const entry of value) {
    const parsed = authoritativeRow(entry)
    if (!parsed) return null
    result.push(parsed)
  }
  return result
}

function authoritativeId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function rowsHaveUniqueIds(
  rows: G4AuthoritativeRow[],
  identity: (row: G4AuthoritativeRow) => string | undefined = (row) =>
    authoritativeId(row.id),
): boolean {
  const ids = rows.map(identity)
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function requiredRows(
  root: G4AuthoritativeRow,
  key: string,
): { ok: true; rows: G4AuthoritativeRow[] } | { ok: false; reason: string } {
  const parsed = strictAuthoritativeRows(root[key])
  if (!parsed) return { ok: false, reason: `${key}_shape_invalid` }
  if (!rowsHaveUniqueIds(parsed)) return { ok: false, reason: `${key}_ids_invalid` }
  return { ok: true, rows: parsed }
}

function requiredLineRows(
  owner: G4AuthoritativeRow,
  key: string,
  identity: (row: G4AuthoritativeRow) => string | undefined,
): G4AuthoritativeRow[] | null {
  const parsed = strictAuthoritativeRows(owner[key])
  return parsed && rowsHaveUniqueIds(parsed, identity) ? parsed : null
}

function authoritativeText(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function authoritativeNumber(value: unknown): number | undefined {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return undefined
  }
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : undefined
}

function exactAuthoritativeRowById(
  rows: G4AuthoritativeRow[],
  id: unknown,
): G4AuthoritativeRow | undefined {
  const normalized = authoritativeText(id)
  if (!normalized) return undefined
  const matches = rows.filter((row) => authoritativeText(row.id) === normalized)
  return matches.length === 1 ? matches[0] : undefined
}

function authoritativeUpdatedAt(row: G4AuthoritativeRow): string | undefined {
  return authoritativeText(
    row.updatedAt ??
      row.writtenOffAt ??
      row.rejectedAt ??
      row.regradedAt ??
      row.releasedAt ??
      row.reviewStartedAt ??
      row.correctedAt ??
      row.confirmedAt ??
      row.createdAt,
  )
}

function adaptAuthoritativePackagingWipLine(line: G4AuthoritativeRow): G4AuthoritativeRow {
  return {
    ...line,
    lineId: authoritativeText(line.lineId ?? line.id),
    semiFinishedItemId:
      authoritativeText(line.itemId) ?? authoritativeText(line.semiFinishedItemId),
    batchNo: authoritativeText(line.wipBatchId) ?? authoritativeText(line.batchNo),
  }
}

function adaptAuthoritativePackagingMaterialLine(
  line: G4AuthoritativeRow,
): G4AuthoritativeRow {
  return {
    ...line,
    lineId: authoritativeText(line.lineId ?? line.id),
  }
}

/**
 * One server-to-UI schema boundary for G4 packaging/QC state. Both the login pull
 * and every mutation mirror call this adapter, so pages never infer aliases from
 * partial ACKs. All aliases come from server-owned fields or exact stable-ID joins.
 */
export function adaptAuthoritativeG4ProductionDomain(
  criticalProduction: G4ProductionDomain,
): G4AuthoritativeProductionAdapterResult {
  const root = authoritativeRow(criticalProduction)
  if (!root) {
    return {
      ok: false,
      error: G4_AUTHORITATIVE_STATE_INCOMPLETE,
      reason: 'production_shape_invalid',
    }
  }
  const required = {
    orders: requiredRows(root, 'orders'),
    packagingReports: requiredRows(root, 'packagingReports'),
    finishedGoodsLots: requiredRows(root, 'finishedGoodsLots'),
    qcDecisions: requiredRows(root, 'qcDecisions'),
  }
  for (const [key, value] of Object.entries(required)) {
    if (!value.ok) {
      return {
        ok: false,
        error: G4_AUTHORITATIVE_STATE_INCOMPLETE,
        reason: `${key}:${value.reason}`,
      }
    }
  }
  const orders = required.orders.ok ? required.orders.rows : []
  const rawReports = required.packagingReports.ok ? required.packagingReports.rows : []
  const rawLots = required.finishedGoodsLots.ok ? required.finishedGoodsLots.rows : []
  const decisions = required.qcDecisions.ok ? required.qcDecisions.rows : []

  const reportLines = new Map<
    string,
    { wipLines: G4AuthoritativeRow[]; materialLines: G4AuthoritativeRow[] }
  >()
  for (const report of rawReports) {
    const wipLines = requiredLineRows(
      report,
      'wipLines',
      (line) => authoritativeId(line.lineId ?? line.id),
    )
    const materialLines = requiredLineRows(
      report,
      'materialLines',
      (line) => authoritativeId(line.lineId ?? line.id),
    )
    if (!wipLines || !materialLines) {
      return {
        ok: false,
        error: G4_AUTHORITATIVE_STATE_INCOMPLETE,
        reason: `packaging_report_lines_invalid:${authoritativeId(report.id) ?? 'unknown'}`,
      }
    }
    reportLines.set(authoritativeId(report.id)!, { wipLines, materialLines })
  }

  const reports = rawReports.map((raw) => {
    const linkedLots = rawLots.filter(
      (lot) =>
        authoritativeText(lot.packagingReportId) === authoritativeText(raw.id) &&
        (!authoritativeText(raw.finishedGoodsLotId) ||
          authoritativeText(lot.id) === authoritativeText(raw.finishedGoodsLotId)),
    )
    const linkedLot = linkedLots.length === 1 ? linkedLots[0] : undefined
    const linkedOrder = exactAuthoritativeRowById(orders, raw.productionOrderId)
    const lines = reportLines.get(authoritativeId(raw.id)!)!
    const rawShift = raw.shiftSlot ?? raw.shift
    return {
      ...raw,
      shiftDate: authoritativeText(raw.reportDate) ?? authoritativeText(raw.shiftDate),
      shift:
        rawShift === 'day' || rawShift === 'night' ? rawShift : undefined,
      semiFinishedItemId:
        authoritativeText(raw.semiFinishedItemId) ??
        authoritativeText(linkedOrder?.semiFinishedItemId),
      rollCount: authoritativeNumber(raw.outputRolls) ?? authoritativeNumber(raw.rollCount),
      palletCount:
        authoritativeNumber(raw.outputPallets) ?? authoritativeNumber(raw.palletCount),
      batchNo:
        authoritativeText(raw.lotNumber) ??
        authoritativeText(raw.batchNo) ??
        authoritativeText(linkedLot?.lotNumber),
      wipLines: lines.wipLines.map(adaptAuthoritativePackagingWipLine),
      materialLines: lines.materialLines.map(adaptAuthoritativePackagingMaterialLine),
      updatedAt: authoritativeUpdatedAt(raw),
    }
  })

  const lots = rawLots.map((raw) => {
    const linkedReports = rawReports.filter(
      (report) =>
        authoritativeText(report.id) === authoritativeText(raw.packagingReportId) &&
        (!authoritativeText(report.finishedGoodsLotId) ||
          authoritativeText(report.finishedGoodsLotId) === authoritativeText(raw.id)),
    )
    const linkedReport = linkedReports.length === 1 ? linkedReports[0] : undefined
    const decision = exactAuthoritativeRowById(decisions, raw.currentDecisionId)
    const decisionMatchesLot =
      Boolean(decision) &&
      authoritativeText(decision?.lotId ?? decision?.finishedGoodsLotId) ===
        authoritativeText(raw.id) &&
      authoritativeNumber(decision?.lotRevision) === authoritativeNumber(raw.lotRevision)
    const decisionStatus = decisionMatchesLot
      ? authoritativeText(decision?.status)
      : undefined
    const lotStatus = authoritativeText(raw.qcStatus)
    const serverQcDecisionStatus =
      lotStatus === 'released'
        ? decisionStatus === 'released'
          ? 'released'
          : 'authoritative_decision_mismatch'
        : (decisionStatus ?? lotStatus ?? 'authoritative_status_missing')

    return {
      ...raw,
      batchNo: authoritativeText(raw.lotNumber) ?? authoritativeText(raw.batchNo),
      outputM2:
        authoritativeNumber(raw.quantityProduced) ?? authoritativeNumber(raw.outputM2),
      rollCount:
        authoritativeNumber(raw.outputRolls) ??
        authoritativeNumber(raw.rollCount) ??
        authoritativeNumber(linkedReport?.outputRolls),
      palletCount:
        authoritativeNumber(raw.outputPallets) ??
        authoritativeNumber(raw.palletCount) ??
        authoritativeNumber(linkedReport?.outputPallets),
      productionDate:
        authoritativeText(raw.producedAt) ?? authoritativeText(raw.productionDate),
      packagingDate:
        authoritativeText(raw.producedAt) ??
        authoritativeText(raw.packagingDate) ??
        authoritativeText(raw.productionDate),
      updatedAt: authoritativeUpdatedAt(raw),
      serverQcDecisionId: decisionMatchesLot ? authoritativeText(decision?.id) : undefined,
      serverQcDecisionStatus,
      serverQcDecisionRevision: decisionMatchesLot
        ? authoritativeNumber(decision?.lotRevision)
        : undefined,
    }
  })

  return {
    ok: true,
    production: {
      ...criticalProduction,
      orders,
      packagingReports: reports,
      finishedGoodsLots: lots,
      qcDecisions: decisions,
    },
  }
}

function validateAuthoritativeG4Warehouse(
  criticalWarehouse: unknown,
): { ok: true } | { ok: false; reason: string } {
  const root = authoritativeRow(criticalWarehouse)
  if (!root) return { ok: false, reason: 'warehouse_shape_invalid' }
  for (const key of ['documents', 'movements', 'loadingShipments'] as const) {
    const parsed = requiredRows(root, key)
    if (!parsed.ok) return { ok: false, reason: `warehouse.${key}:${parsed.reason}` }
    if (key === 'documents') {
      for (const document of parsed.rows) {
        if (
          !requiredLineRows(document, 'lines', (line) => authoritativeId(line.lineId))
        ) {
          return {
            ok: false,
            reason: `warehouse.document_lines_invalid:${authoritativeId(document.id) ?? 'unknown'}`,
          }
        }
      }
    }
    if (key === 'loadingShipments') {
      for (const shipment of parsed.rows) {
        if (
          shipment.lines !== undefined &&
          !requiredLineRows(shipment, 'lines', (line) =>
            authoritativeId(line.id ?? line.lineId),
          )
        ) {
          return {
            ok: false,
            reason: `warehouse.shipment_lines_invalid:${authoritativeId(shipment.id) ?? 'unknown'}`,
          }
        }
      }
    }
  }
  for (const key of ['locations', 'productionLineBindings', 'auditLog'] as const) {
    if (root[key] === undefined) continue
    const parsed = requiredRows(root, key)
    if (!parsed.ok) return { ok: false, reason: `warehouse.${key}:${parsed.reason}` }
  }
  if (root.closedMonths !== undefined) {
    if (
      !Array.isArray(root.closedMonths) ||
      !root.closedMonths.every((month) => typeof month === 'string' && month.trim())
    ) {
      return { ok: false, reason: 'warehouse.closedMonths_shape_invalid' }
    }
  }
  return { ok: true }
}

export type G4ServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

async function bearerToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

async function g4Fetch<T>(body: Record<string, unknown>): Promise<G4ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G4 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }
  try {
    const res = await fetch(fstApiUrl('/api/fst/g4-production-command'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as
      | ({ error?: string; message?: string } & T)
      | null
    if (res.ok && payload && payload.error === undefined) {
      return { ok: true, data: payload as T }
    }
    return {
      ok: false,
      error: payload?.error || String(res.status),
      message: payload?.message || payload?.error || 'G4 server error',
    }
  } catch {
    return { ok: false, error: 'network', message: 'G4 server unavailable' }
  }
}

export async function g4ProductionCommand(input: {
  storeId?: string
  idempotencyKey: string
  commandType: G4CommandType
  command: Record<string, unknown>
}) {
  return g4Fetch<{
    ok: true
    criticalRevision: number
    warehouse?: Partial<WarehouseStore>
    production?: G4ProductionDomain
    packagingQcActive?: boolean
    productionActive?: boolean
    idempotent?: boolean
    idempotencyFingerprint?: string
    commandFingerprint?: string
    touchesWarehouse?: boolean
    finishedGoodsLotId?: string
    newFinishedGoodsLotId?: string
    reportId?: string
    lotNumber?: string
    quantityProduced?: number
    reportNumber?: string
    status?: string
    correctsReportId?: string
    shipmentId?: string
    decisionId?: string
    documentId?: string
    documentIds?: string[]
    movementId?: string
    movementIds?: string[]
    reversalDocumentIds?: string[]
    reversalMovementIds?: string[]
    quantity?: number
    quantityShipped?: number
    quantityRemaining?: number
    qcStatus?: string
    passportAttachmentId?: string
    protocolAttachmentId?: string
  }>({
    storeId: input.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: input.idempotencyKey,
    commandType: input.commandType,
    command: input.command,
  })
}

/**
 * Overlay packaging/FG/QC only when packagingQc feature is explicitly active.
 * Production core active alone must NOT hide legacy packaging data.
 */
export function resolveAuthoritativePackagingOverlay(input: {
  legacyProduction: Record<string, unknown>
  criticalProduction: G4ProductionDomain | null | undefined
  criticalWarehouse?: Partial<WarehouseStore> | null
  legacyWarehouse?: WarehouseStore
  criticalRevision: number
  packagingQcActive?: boolean
  productionActive?: boolean
  fetchFailed?: boolean
}): {
  production: Record<string, unknown>
  warehouse?: WarehouseStore
  source:
    | 'fst_critical_store'
    | 'legacy_fst_store_not_authoritative'
    | 'fetch_error_block_legacy'
    | 'authoritative_g4_state_incomplete'
  packagingQcActive: boolean
  authoritativeBlocked?: boolean
} {
  const packagingQcActive = input.packagingQcActive === true
  const productionActive = input.productionActive === true
  const blockedProduction = {
    ...input.legacyProduction,
    packagingReports: [],
    finishedGoodsLots: [],
    qcDecisions: [],
    g4PackagingReports: [],
    g4FinishedGoodsLots: [],
    g4QcDecisions: [],
    g4CriticalRevision: input.criticalRevision,
    g4PackagingQcActive: false,
    g3ProductionDomainActive: productionActive,
    g4AuthoritativeBlocked: true,
  }
  if (input.fetchFailed && packagingQcActive) {
    return {
      production: blockedProduction,
      warehouse: undefined,
      source: 'fetch_error_block_legacy',
      packagingQcActive: false,
      authoritativeBlocked: true,
    }
  }
  if (
    packagingQcActive &&
    productionActive &&
    input.criticalProduction &&
    input.criticalWarehouse
  ) {
    const adapted = adaptAuthoritativeG4ProductionDomain(input.criticalProduction)
    const warehouseShape = validateAuthoritativeG4Warehouse(input.criticalWarehouse)
    if (!adapted.ok || !warehouseShape.ok) {
      return {
        production: blockedProduction,
        warehouse: undefined,
        source: G4_AUTHORITATIVE_STATE_INCOMPLETE,
        packagingQcActive: false,
        authoritativeBlocked: true,
      }
    }
    const reports = adapted.production.packagingReports ?? []
    const lots = adapted.production.finishedGoodsLots ?? []
    const decisions = adapted.production.qcDecisions ?? []
    const nextProduction = {
      ...input.legacyProduction,
      packagingReports: reports,
      finishedGoodsLots: lots,
      qcDecisions: decisions,
      g4PackagingReports: reports,
      g4FinishedGoodsLots: lots,
      g4QcDecisions: decisions,
      g4CriticalRevision: input.criticalRevision,
      g4PackagingQcActive: true,
      g3ProductionDomainActive: true,
      g4AuthoritativeBlocked: false,
    }
    let nextWarehouse = input.legacyWarehouse
    if (input.legacyWarehouse && input.criticalWarehouse) {
      const criticalLoading = (
        input.criticalWarehouse as Partial<WarehouseStore> & {
          loadingShipments?: WarehouseStore['loadingShipments']
        }
      ).loadingShipments
      nextWarehouse = {
        ...input.legacyWarehouse,
        documents: input.criticalWarehouse.documents ?? [],
        movements: input.criticalWarehouse.movements ?? [],
        loadingShipments: criticalLoading ?? [],
        locations: input.criticalWarehouse.locations?.length
          ? input.criticalWarehouse.locations
          : input.legacyWarehouse.locations,
        productionLineBindings: input.criticalWarehouse.productionLineBindings ?? [],
        auditLog: input.criticalWarehouse.auditLog ?? [],
        closedMonths: input.criticalWarehouse.closedMonths ?? [],
        scrapLocationId: input.criticalWarehouse.scrapLocationId,
      }
    }
    return {
      production: nextProduction,
      warehouse: nextWarehouse,
      source: 'fst_critical_store',
      packagingQcActive: true,
    }
  }
  const hasIncompleteAuthoritativeClaim =
    packagingQcActive ||
    input.packagingQcActive === undefined ||
    (input.productionActive === undefined && input.criticalProduction != null)
  if (hasIncompleteAuthoritativeClaim) {
    return {
      production: blockedProduction,
      warehouse: undefined,
      source: 'authoritative_g4_state_incomplete',
      packagingQcActive: false,
      authoritativeBlocked: true,
    }
  }
  return {
    production: {
      ...input.legacyProduction,
      g4PackagingQcActive: false,
    },
    warehouse: input.legacyWarehouse,
    source: 'legacy_fst_store_not_authoritative',
    packagingQcActive: false,
  }
}

export function isG4WebAuthoritativePath(): boolean {
  return import.meta.env.VITE_FST_WEB === 'true'
}

export function isG4PackagingQcActive(production: Record<string, unknown> | null | undefined): boolean {
  return production?.g4PackagingQcActive === true
}

export function mirrorG4Ack(
  warehouse: WarehouseStore,
  production: Record<string, unknown>,
  server: {
    warehouse?: Partial<WarehouseStore>
    production?: G4ProductionDomain
    criticalRevision?: number
    packagingQcActive?: boolean
    productionActive?: boolean
  },
): {
  warehouse: WarehouseStore
  production: Record<string, unknown>
  source: ReturnType<typeof resolveAuthoritativePackagingOverlay>['source']
  authoritativeBlocked: boolean
} {
  const overlay = resolveAuthoritativePackagingOverlay({
    legacyProduction: production,
    criticalProduction: server.production,
    criticalWarehouse: server.warehouse,
    legacyWarehouse: warehouse,
    criticalRevision: Number(server.criticalRevision ?? 0),
    packagingQcActive: server.packagingQcActive,
    productionActive: server.productionActive,
  })
  return {
    warehouse: overlay.warehouse ?? warehouse,
    production: overlay.production,
    source: overlay.source,
    authoritativeBlocked: overlay.authoritativeBlocked === true,
  }
}
