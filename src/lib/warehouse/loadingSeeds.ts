import { computeLoadingTotals } from './loading'
import {
  A2LINE_PORTUGAL_LINES,
  buildA2LineDocumentInput,
  type A2LineProductKey,
} from './loadingPresets'
import type { LoadingShipment, LoadingShipmentLine, WarehouseStore } from './types'

export const LEGACY_A2LINE_LOADING_ID = 'seed-a2line-portugal-2026-05'

const SEED_DOCS: {
  id: string
  number: string
  productKey: A2LineProductKey
  lineId: string
}[] = [
  { id: 'seed-a2line-loading-160', number: 'ПГ-20260501-01', productKey: '160', lineId: 'seed-a2line-line-160' },
  { id: 'seed-a2line-loading-145', number: 'ПГ-20260501-02', productKey: '145', lineId: 'seed-a2line-line-145' },
  {
    id: 'seed-a2line-loading-145light',
    number: 'ПГ-20260501-03',
    productKey: '145light',
    lineId: 'seed-a2line-line-145light',
  },
  { id: 'seed-a2line-loading-75', number: 'ПГ-20260501-04', productKey: '75', lineId: 'seed-a2line-line-75' },
]

function toLoadingLines(lines: LoadingShipmentLine[]) {
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

function computeShipmentTotals(lines: LoadingShipmentLine[]) {
  const t = computeLoadingTotals(toLoadingLines(lines))
  return {
    totalsRolls: t.rolls,
    totalsNetKg: t.netKg,
    totalsGrossKg: t.grossKg,
    totalsAreaM2: t.areaM2,
    totalsPalletPlaces: t.palletPlaces,
  }
}

function buildSeedShipment(
  whId: string,
  seed: (typeof SEED_DOCS)[number],
  counterpartyId: string | undefined,
  now: string,
): LoadingShipment | null {
  const input = buildA2LineDocumentInput(whId, seed.productKey, seed.lineId)
  if (!input || input.lines.length === 0) return null

  const lines = input.lines
  const totals = computeShipmentTotals(lines)
  const def = A2LINE_PORTUGAL_LINES.find((l) => l.key === seed.productKey)

  return {
    id: seed.id,
    number: seed.number,
    date: input.date,
    warehouseId: input.warehouseId,
    containerId: input.containerId,
    payloadKg: Math.max(input.payloadKg, Math.ceil(totals.totalsGrossKg * 1.02)),
    palletPlacesLimit: def?.pallets ?? input.palletPlacesLimit,
    counterpartyId,
    counterpartyName: input.counterpartyName,
    orderNo: input.orderNo,
    orderPlacedDate: input.orderPlacedDate,
    clientDueDate: input.clientDueDate,
    region: input.region,
    logistics: input.logistics,
    orderNotes: input.orderNotes,
    lines,
    ...totals,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

/** 4 черновика A2LINE · Португалия · май 2026 */
export function ensureLoadingSeeds(
  store: WarehouseStore,
  counterpartyId?: string,
): WarehouseStore {
  const shipments = store.loadingShipments ?? []
  const whId =
    store.locations.find((l) => l.kind !== 'office')?.id ?? store.locations[0]?.id
  if (!whId) return store

  const missing = SEED_DOCS.filter((seed) => !shipments.some((s) => s.id === seed.id))
  if (missing.length === 0) return store

  const now = new Date().toISOString()
  const withoutLegacy = shipments.filter((s) => s.id !== LEGACY_A2LINE_LOADING_ID)
  const created = missing
    .map((seed) => buildSeedShipment(whId, seed, counterpartyId, now))
    .filter((s): s is LoadingShipment => s != null)

  if (created.length === 0) return store

  return {
    ...store,
    loadingShipments: [...created, ...withoutLegacy],
  }
}

export function countA2LineSeedDocuments(store: WarehouseStore): number {
  return (store.loadingShipments ?? []).filter((s) =>
    SEED_DOCS.some((d) => d.id === s.id),
  ).length
}
