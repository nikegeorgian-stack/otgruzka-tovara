import { appendWarehouseAudit } from './audit'
import { computeLoadingTotals, LOADING_CONTAINERS, type LoadingLine } from './loading'
import type { LoadingShipment, LoadingShipmentLine, WarehouseStore } from './types'

export type UpsertLoadingShipmentInput = {
  id?: string
  date: string
  warehouseId: string
  containerId: string
  payloadKg: number
  palletPlacesLimit: number
  counterpartyId?: string
  counterpartyName: string
  orderNo: string
  orderPlacedDate?: string
  clientDueDate?: string
  plannedProductionDate?: string
  actualShipDate?: string
  region?: string
  logistics?: string
  orderNotes?: string
  salesOrderId?: string
  salesLineId?: string
  keeperId?: string
  keeperName?: string
  lines: LoadingShipmentLine[]
}

export type PostLoadingShipmentResult =
  | { ok: true; number: string }
  | { ok: false; error: string }

function suggestNumber(shipments: LoadingShipment[], date: string): string {
  const day = date.replace(/-/g, '')
  const prefix = `ПГ-${day}`
  const used = new Set(shipments.filter((s) => s.date === date).map((s) => s.number))
  if (!used.has(`${prefix}-01`)) return `${prefix}-01`
  for (let n = 2; n < 100; n++) {
    const num = `${prefix}-${String(n).padStart(2, '0')}`
    if (!used.has(num)) return num
  }
  return `${prefix}-${Date.now().toString(36).slice(-4)}`
}

function toLoadingLines(lines: LoadingShipmentLine[]): LoadingLine[] {
  return lines.map((l) => ({
    id: l.id,
    name: l.name,
    note: l.note,
    rollLengthM: l.rollLengthM ?? 0,
    grammageGsm: l.grammageGsm ?? 0,
    rollWidthM: l.rollWidthM ?? 0,
    rolls: l.rolls,
    weightPerRollKg: l.weightPerRollKg,
    areaPerRollM2: l.areaPerRollM2,
    rollsPerBox: l.rollsPerBox ?? 0,
    topRolls: l.topRolls ?? 0,
    rollsPerPallet: l.rollsPerPallet,
    palletLayers: l.palletLayers ?? 0,
    boxLayers: l.boxLayers ?? 0,
    palletTareKg: l.palletTareKg,
    boxes: l.boxes,
    boxTareKg: l.boxTareKg,
    palletPlaces: l.palletPlaces,
  }))
}

function computeTotals(lines: LoadingShipmentLine[]) {
  const t = computeLoadingTotals(toLoadingLines(lines))
  return {
    totalsRolls: t.rolls,
    totalsNetKg: t.netKg,
    totalsGrossKg: t.grossKg,
    totalsAreaM2: t.areaM2,
    totalsPalletPlaces: t.palletPlaces,
  }
}

export function listLoadingShipments(store: WarehouseStore): LoadingShipment[] {
  return [...(store.loadingShipments ?? [])].sort((a, b) =>
    `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`),
  )
}

function metaFromInput(input: UpsertLoadingShipmentInput) {
  return {
    orderPlacedDate: input.orderPlacedDate?.trim() || undefined,
    clientDueDate: input.clientDueDate?.trim() || undefined,
    plannedProductionDate: input.plannedProductionDate?.trim() || undefined,
    actualShipDate: input.actualShipDate?.trim() || undefined,
    region: input.region?.trim() || undefined,
    logistics: input.logistics?.trim() || undefined,
    orderNotes: input.orderNotes?.trim() || undefined,
    salesOrderId: input.salesOrderId || undefined,
    salesLineId: input.salesLineId || undefined,
  }
}

export function upsertLoadingShipment(
  store: WarehouseStore,
  input: UpsertLoadingShipmentInput,
): { store: WarehouseStore; shipment: LoadingShipment } {
  const now = new Date().toISOString()
  const shipments = store.loadingShipments ?? []
  const totals = computeTotals(input.lines)
  const validLines = input.lines.filter((l) => l.name.trim() || l.rolls > 0)

  if (input.id) {
    const idx = shipments.findIndex((s) => s.id === input.id && s.status === 'draft')
    if (idx >= 0) {
      const prev = shipments[idx]!
      const next: LoadingShipment = {
        ...prev,
        date: input.date,
        warehouseId: input.warehouseId,
        containerId: input.containerId,
        payloadKg: input.payloadKg,
        palletPlacesLimit: input.palletPlacesLimit,
        counterpartyId: input.counterpartyId,
        counterpartyName: input.counterpartyName.trim(),
        orderNo: input.orderNo.trim(),
        ...metaFromInput(input),
        salesOrderId: input.salesOrderId ?? prev.salesOrderId,
        salesLineId: input.salesLineId ?? prev.salesLineId,
        keeperId: input.keeperId ?? prev.keeperId,
        keeperName: input.keeperName ?? prev.keeperName,
        lines: validLines,
        ...totals,
        updatedAt: now,
      }
      const nextShipments = [...shipments]
      nextShipments[idx] = next
      return { store: { ...store, loadingShipments: nextShipments }, shipment: next }
    }
  }

  const shipment: LoadingShipment = {
    id: crypto.randomUUID(),
    number: suggestNumber(shipments, input.date),
    date: input.date,
    warehouseId: input.warehouseId,
    containerId: input.containerId,
    payloadKg: input.payloadKg,
    palletPlacesLimit: input.palletPlacesLimit,
    counterpartyId: input.counterpartyId,
    counterpartyName: input.counterpartyName.trim(),
    orderNo: input.orderNo.trim(),
    ...metaFromInput(input),
    salesOrderId: input.salesOrderId,
    salesLineId: input.salesLineId,
    keeperId: input.keeperId,
    keeperName: input.keeperName,
    lines: validLines,
    ...totals,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }

  return {
    store: { ...store, loadingShipments: [shipment, ...shipments] },
    shipment,
  }
}

export function postLoadingShipment(
  store: WarehouseStore,
  shipmentId: string,
  args?: { keeperId?: string; keeperName?: string },
): { store: WarehouseStore; result: PostLoadingShipmentResult } {
  const shipments = store.loadingShipments ?? []
  const idx = shipments.findIndex((s) => s.id === shipmentId && s.status === 'draft')
  if (idx < 0) {
    return { store, result: { ok: false, error: 'warehouse.loading.errNotFound' } }
  }

  const prev = shipments[idx]!
  if (prev.lines.length === 0 || !prev.lines.some((l) => l.rolls > 0 && l.name.trim())) {
    return { store, result: { ok: false, error: 'warehouse.loading.errEmpty' } }
  }
  if (!prev.counterpartyName.trim()) {
    return { store, result: { ok: false, error: 'warehouse.loading.errCustomer' } }
  }

  const now = new Date().toISOString()
  const totals = computeTotals(prev.lines)
  const posted: LoadingShipment = {
    ...prev,
    ...totals,
    keeperId: args?.keeperId ?? prev.keeperId,
    keeperName: args?.keeperName ?? prev.keeperName,
    status: 'posted',
    updatedAt: now,
    postedAt: now,
  }

  const nextShipments = [...shipments]
  nextShipments[idx] = posted
  let next: WarehouseStore = { ...store, loadingShipments: nextShipments }
  next = appendWarehouseAudit(next, {
    action: 'loading_shipment',
    detail: `Погрузка ${posted.number} · ${posted.counterpartyName} · ${posted.lines.length} поз. · ${(posted.totalsGrossKg / 1000).toFixed(3)} т`,
    actorId: posted.keeperId,
    actorName: posted.keeperName,
  })

  return { store: next, result: { ok: true, number: posted.number } }
}

export function removeLoadingShipment(store: WarehouseStore, shipmentId: string): WarehouseStore {
  const shipments = store.loadingShipments ?? []
  return {
    ...store,
    loadingShipments: shipments.filter((s) => s.id !== shipmentId || s.status === 'posted'),
  }
}

function cloneLineForCombine(line: LoadingShipmentLine): LoadingShipmentLine {
  return { ...line, id: crypto.randomUUID() }
}

/** Объединить несколько калькуляций в один черновик (все строки + сводные лимиты) */
export function buildCombinedLoadingShipmentInput(
  sources: LoadingShipment[],
  opts?: { warehouseId?: string; keeperId?: string; keeperName?: string },
): UpsertLoadingShipmentInput | null {
  const drafts = sources.filter((s) => s.status === 'draft' && s.lines.some((l) => l.rolls > 0))
  if (drafts.length < 2) return null

  const first = drafts[0]!
  const lines = drafts.flatMap((s) => s.lines.filter((l) => l.name.trim() || l.rolls > 0).map(cloneLineForCombine))
  if (lines.length === 0) return null

  const totals = computeTotals(lines)
  const totalPlaces = totals.totalsPalletPlaces
  const totalGrossKg = totals.totalsGrossKg

  const containerId =
    drafts.find((s) => s.containerId && s.containerId !== 'custom')?.containerId ??
    (totalPlaces <= 33 ? 'c45' : totalPlaces <= 25 ? 'c40' : 'fura')
  const preset = LOADING_CONTAINERS.find((c) => c.id === containerId)
  const palletPlacesLimit = Math.max(totalPlaces, preset?.palletPlaces ?? totalPlaces)
  const payloadKg = Math.max(
    Math.ceil(totalGrossKg * 1.02),
    preset?.payloadKg ?? Math.ceil(totalGrossKg * 1.02),
  )

  const orderParts = [...new Set(drafts.map((s) => s.orderNo.trim()).filter(Boolean))]
  const orderNo =
    orderParts.length <= 3
      ? orderParts.join(' + ')
      : `${first.counterpartyName || 'Сводная'} · ${drafts.length} поз.`

  const sourceNumbers = drafts.map((s) => s.number).join(', ')

  return {
    date: first.date,
    warehouseId: opts?.warehouseId ?? first.warehouseId,
    containerId,
    payloadKg,
    palletPlacesLimit,
    counterpartyId: first.counterpartyId,
    counterpartyName: first.counterpartyName,
    orderNo,
    orderPlacedDate: first.orderPlacedDate,
    clientDueDate: first.clientDueDate,
    plannedProductionDate: first.plannedProductionDate,
    actualShipDate: first.actualShipDate,
    region: first.region,
    logistics: first.logistics,
    orderNotes: [first.orderNotes, `Объединено: ${sourceNumbers}`].filter(Boolean).join(' · '),
    keeperId: opts?.keeperId,
    keeperName: opts?.keeperName,
    lines,
  }
}

export function sumLoadingShipments(sources: LoadingShipment[]) {
  return {
    docs: sources.length,
    rolls: sources.reduce((n, s) => n + s.totalsRolls, 0),
    grossKg: sources.reduce((n, s) => n + s.totalsGrossKg, 0),
    palletPlaces: sources.reduce((n, s) => n + s.totalsPalletPlaces, 0),
    areaM2: sources.reduce((n, s) => n + s.totalsAreaM2, 0),
  }
}
