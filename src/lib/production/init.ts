import { createDefaultPlanner, normalizePlanner } from '@/lib/planner/init'
import { newId } from './files'
import type {
  PackagingRequestData,
  PackagingRow,
  ProductionCategoryCell,
  ProductionFactRow,
  ProductionPlanSegment,
  ProductionRequest,
  ProductionStore,
} from './types'

export function emptyCategoryCell(): ProductionCategoryCell {
  return {}
}

export function emptyFactRow(): ProductionFactRow {
  return {
    id: newId(),
    palletRollQty: undefined,
    rowNote: undefined,
    ratl1: emptyCategoryCell(),
    ratl2: emptyCategoryCell(),
    cat4: emptyCategoryCell(),
    cat31: emptyCategoryCell(),
    cat32: emptyCategoryCell(),
    defect: emptyCategoryCell(),
  }
}

export function emptyPackagingRow(): PackagingRow {
  return {
    id: newId(),
    name: '',
    colorLogo: '',
    planQty: undefined,
    factQty: undefined,
    note: undefined,
  }
}

export function emptyPackaging(): PackagingRequestData {
  return {
    thermoFilm: '',
    stretch: '',
    rolls: [emptyPackagingRow(), emptyPackagingRow(), emptyPackagingRow()],
    boxes: [emptyPackagingRow(), emptyPackagingRow()],
    pallets: [emptyPackagingRow(), emptyPackagingRow()],
  }
}

export function emptyPlanSegment(): ProductionPlanSegment {
  return {
    id: newId(),
    customer: '',
    productName: '',
    colorLogo: '',
    plannedQtyMp: undefined,
    note: '',
  }
}

export function emptyProductionRequest(
  date: string,
  lineId: ProductionRequest['lineId'] = '1',
  shift: ProductionRequest['shift'] = 'day',
  brigadeName = '',
): ProductionRequest {
  const now = new Date().toISOString()
  return {
    id: newId(),
    date,
    lineId,
    shift,
    brigadeName,
    rawRollNumbers: '',
    planSegments: [emptyPlanSegment()],
    factRows: [emptyFactRow(), emptyFactRow(), emptyFactRow()],
    packaging: lineId === 'pack' ? emptyPackaging() : undefined,
    defectReasons: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeCell(c: ProductionCategoryCell | undefined): ProductionCategoryCell {
  return {
    qtyMp: c?.qtyMp,
    qtyKg: c?.qtyKg,
    note: c?.note?.trim() || undefined,
  }
}

function normalizeFactRow(row: ProductionFactRow): ProductionFactRow {
  return {
    id: row.id || newId(),
    palletRollQty: row.palletRollQty,
    rowNote: row.rowNote?.trim() || undefined,
    ratl1: normalizeCell(row.ratl1),
    ratl2: normalizeCell(row.ratl2),
    cat4: normalizeCell(row.cat4),
    cat31: normalizeCell(row.cat31),
    cat32: normalizeCell(row.cat32),
    defect: normalizeCell(row.defect),
  }
}

function normalizePlanSegment(seg: ProductionPlanSegment): ProductionPlanSegment {
  return {
    id: seg.id || newId(),
    orderId: seg.orderId || undefined,
    dayPlanId: seg.dayPlanId || undefined,
    orderNumber: seg.orderNumber?.trim() || undefined,
    customer: seg.customer?.trim() ?? '',
    productName: seg.productName?.trim() ?? '',
    colorLogo: seg.colorLogo?.trim() ?? '',
    plannedQtyMp: seg.plannedQtyMp,
    note: seg.note?.trim() || undefined,
  }
}

function planFromLegacy(entry: Record<string, unknown>): ProductionPlanSegment[] {
  const plan = entry.plan as
    | {
        customer?: string
        productName?: string
        colorLogo?: string
        plannedQtyMp?: number
      }
    | undefined
  if (plan && (plan.customer || plan.productName)) {
    return [
      normalizePlanSegment({
        id: newId(),
        customer: plan.customer ?? '',
        productName: plan.productName ?? '',
        colorLogo: plan.colorLogo ?? '',
        plannedQtyMp: plan.plannedQtyMp,
        note: '',
      }),
    ]
  }
  const segments = entry.planSegments as ProductionPlanSegment[] | undefined
  if (segments?.length) return segments.map(normalizePlanSegment)
  return [emptyPlanSegment()]
}

function sumSlots(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  const s = (a ?? 0) + (b ?? 0)
  return s > 0 ? s : undefined
}

function migrateLegacyDay(raw: Record<string, unknown>): ProductionRequest | null {
  if (!raw.date || !raw.lineId) return null
  const output = raw.output as Record<string, unknown> | undefined
  if (!output) return null

  const row = emptyFactRow()
  const sumBrigade = (cat: unknown) => {
    if (!cat || typeof cat !== 'object') return undefined
    const o = cat as Record<string, number>
    return sumSlots(o['1.1'], o['1.2'])
  }

  row.ratl1.qtyMp = sumBrigade(output.c75)
  row.ratl2.qtyMp = sumBrigade(output.c145)
  row.cat4.qtyMp = sumBrigade(output.c160)
  if (typeof output.c31Rolls === 'number') row.cat31.qtyMp = output.c31Rolls
  if (typeof output.c31M2 === 'number') row.cat31.note = `${output.c31M2} м²`
  if (typeof output.defectKg === 'number') row.defect.qtyKg = output.defectKg

  const rawLines = (raw.rawLines as { label?: string; qtyRolls?: number }[]) ?? []
  return {
    id: String(raw.id || newId()),
    date: String(raw.date),
    lineId: raw.lineId === '2' ? '2' : '1',
    shift: raw.shift === 'night' ? 'night' : 'day',
    foremanId: raw.foremanId as string | undefined,
    brigadeName: String(raw.brigadeName ?? ''),
    rawRollQty: rawLines.reduce((s, l) => s + (l.qtyRolls ?? 0), 0) || undefined,
    rawRollNumbers: rawLines.map((l) => l.label).filter(Boolean).join(', '),
    planSegments: planFromLegacy(raw),
    factRows: [row],
    defectReasons: String(raw.note ?? ''),
    status:
      raw.status === 'posted'
        ? 'posted'
        : raw.status === 'saved'
          ? 'saved'
          : 'draft',
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  }
}

function normalizePackagingRow(row: PackagingRow): PackagingRow {
  return {
    id: row.id || newId(),
    name: row.name?.trim() ?? '',
    colorLogo: row.colorLogo?.trim() ?? '',
    planQty: row.planQty,
    factQty: row.factQty,
    note: row.note?.trim() || undefined,
  }
}

function normalizePackaging(
  raw: PackagingRequestData | undefined,
): PackagingRequestData {
  return {
    thermoFilm: raw?.thermoFilm?.trim() ?? '',
    stretch: raw?.stretch?.trim() ?? '',
    rolls: raw?.rolls?.length
      ? raw.rolls.map(normalizePackagingRow)
      : [emptyPackagingRow()],
    boxes: raw?.boxes?.length
      ? raw.boxes.map(normalizePackagingRow)
      : [emptyPackagingRow()],
    pallets: raw?.pallets?.length
      ? raw.pallets.map(normalizePackagingRow)
      : [emptyPackagingRow()],
  }
}

export function normalizeProductionRequest(entry: ProductionRequest): ProductionRequest {
  const raw = entry as ProductionRequest & { plan?: ProductionPlanSegment }
  const planSegments =
    raw.planSegments?.length
      ? raw.planSegments.map(normalizePlanSegment)
      : planFromLegacy(raw as unknown as Record<string, unknown>)

  const lineId =
    entry.lineId === 'pack' ? 'pack' : entry.lineId === '2' ? '2' : '1'

  return {
    ...entry,
    lineId,
    packaging: lineId === 'pack' ? normalizePackaging(entry.packaging) : undefined,
    shift: entry.shift === 'night' ? 'night' : 'day',
    brigadeName: entry.brigadeName?.trim() ?? '',
    rosterAttendance: Array.isArray(entry.rosterAttendance)
      ? entry.rosterAttendance
          .filter((r) => r?.employeeId)
          .map((r) => ({
            employeeId: String(r.employeeId),
            present: r.present !== false,
            extra: r.extra === true,
          }))
      : undefined,
    rawRollNumbers: entry.rawRollNumbers ?? '',
    planSegments: planSegments.length ? planSegments : [emptyPlanSegment()],
    factRows: (entry.factRows?.length ? entry.factRows : [emptyFactRow()]).map(
      normalizeFactRow,
    ),
    defectReasons: entry.defectReasons ?? '',
    status:
      entry.status === 'posted'
        ? 'posted'
        : entry.status === 'saved'
          ? 'saved'
          : 'draft',
    savedAt: entry.savedAt,
    postedAt: entry.postedAt,
    postedBy: entry.postedBy,
    orderId: entry.orderId || undefined,
    fromPlanner: entry.fromPlanner === true,
    plannerSourceNote: entry.plannerSourceNote?.trim() || undefined,
    rawMaterialItemId: entry.rawMaterialItemId || undefined,
    packagingRecipeId: entry.packagingRecipeId || undefined,
    packagingPlan: entry.packagingPlan,
  }
}

export function createDefaultProduction(): ProductionStore {
  return { requests: [], planner: createDefaultPlanner() }
}

export function normalizeProduction(raw: ProductionStore | undefined): ProductionStore {
  const legacy = (raw as { impregnationDays?: unknown[] } | undefined)?.impregnationDays
  const incoming = raw?.requests ?? []

  const requests: ProductionRequest[] = []

  for (const item of incoming) {
    requests.push(normalizeProductionRequest(item as ProductionRequest))
  }

  if (requests.length === 0 && legacy?.length) {
    for (const old of legacy) {
      const migrated = migrateLegacyDay(old as Record<string, unknown>)
      if (migrated) requests.push(normalizeProductionRequest(migrated))
    }
  }

  return {
    requests,
    planner: normalizePlanner(raw?.planner),
  }
}
