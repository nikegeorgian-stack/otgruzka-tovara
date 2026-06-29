import type { UpsertLoadingShipmentInput } from './loadingShipments'
import type { LoadingShipmentLine } from './types'

const BOX_TARE_KG = 5
const PALLET_TARE_KG = 26
const STACK_NOTE = 'Палета → 2 коробки'

export type A2LineProductKey = '160' | '145' | '145light' | '75'

export type A2LineLineDef = {
  key: A2LineProductKey
  name: string
  gsm: number
  widthM: number
  rollsPerBox: number
  areaM2: number
  rolls: number
  boxes: number
  pallets: number
  color: string
  labelNote: string
}

export const A2LINE_PORTUGAL_LINES: A2LineLineDef[] = [
  {
    key: '160',
    name: '№ 160',
    gsm: 160,
    widthM: 1.6,
    rollsPerBox: 32,
    areaM2: 19200,
    rolls: 384,
    boxes: 12,
    pallets: 6,
    color: 'белая',
    labelNote:
      'без этикеток на рулонах, наша 1 этикетка Celloplex 160 только на коробке',
  },
  {
    key: '145',
    name: '№ 145',
    gsm: 145,
    widthM: 1.45,
    rollsPerBox: 32,
    areaM2: 19200,
    rolls: 384,
    boxes: 12,
    pallets: 6,
    color: 'белая',
    labelNote:
      'без этикеток на рулонах, наша 1 этикетка Celloplex 145 только на коробке',
  },
  {
    key: '145light',
    name: '№ 145light',
    gsm: 145,
    widthM: 1.45,
    rollsPerBox: 32,
    areaM2: 64000,
    rolls: 1280,
    boxes: 40,
    pallets: 20,
    color: 'белая',
    labelNote: 'этикетка заказчика',
  },
  {
    key: '75',
    name: '№ 75',
    gsm: 75,
    widthM: 0.75,
    rollsPerBox: 45,
    areaM2: 4500,
    rolls: 90,
    boxes: 2,
    pallets: 1,
    color: 'белая',
    labelNote:
      'без этикеток на рулонах, наша 1 этикетка Celloplex 75 только на коробке',
  },
]

export const A2LINE_ORDER_META = {
  date: '2026-05-01',
  counterpartyName: 'A2LINE',
  orderPlacedDate: '2026-05-01',
  clientDueDate: '2026-05-30',
  region: 'Португалия',
  logistics: 'CIF, 45ф конт',
  orderNotes: 'Денис',
  containerId: 'c45' as const,
}

function mkLine(def: A2LineLineDef, lineId?: string): LoadingShipmentLine {
  const areaPerRoll = def.areaM2 / def.rolls
  const rollLengthM = areaPerRoll / def.widthM
  const weightPerRollKg = (areaPerRoll * def.gsm) / 1000
  const rollsPerPallet = 2 * def.rollsPerBox

  return {
    id: lineId ?? crypto.randomUUID(),
    name: def.name,
    note: STACK_NOTE,
    rollLengthM: Math.round(rollLengthM * 1000) / 1000,
    grammageGsm: def.gsm,
    rollWidthM: def.widthM,
    rolls: def.rolls,
    weightPerRollKg: Math.round(weightPerRollKg * 1000) / 1000,
    areaPerRollM2: Math.round(areaPerRoll * 100) / 100,
    rollsPerBox: def.rollsPerBox,
    topRolls: 0,
    rollsPerPallet,
    palletLayers: 1,
    boxLayers: 2,
    palletTareKg: PALLET_TARE_KG,
    boxes: def.boxes,
    boxTareKg: BOX_TARE_KG,
    palletPlaces: def.pallets,
    color: def.color,
    labelNote: def.labelNote,
    logoNote: '---',
  }
}

/** Один документ погрузки — одна позиция A2LINE */
export function buildA2LineDocumentInput(
  warehouseId: string,
  productKey: A2LineProductKey,
  lineId?: string,
): UpsertLoadingShipmentInput | null {
  const def = A2LINE_PORTUGAL_LINES.find((l) => l.key === productKey)
  if (!def) return null

  const line = mkLine(def, lineId)

  return {
    date: A2LINE_ORDER_META.date,
    warehouseId,
    containerId: A2LINE_ORDER_META.containerId,
    payloadKg: 26500,
    palletPlacesLimit: def.pallets,
    counterpartyName: A2LINE_ORDER_META.counterpartyName,
    orderNo: def.name,
    orderPlacedDate: A2LINE_ORDER_META.orderPlacedDate,
    clientDueDate: A2LINE_ORDER_META.clientDueDate,
    region: A2LINE_ORDER_META.region,
    logistics: A2LINE_ORDER_META.logistics,
    orderNotes: A2LINE_ORDER_META.orderNotes,
    lines: [line],
  }
}

/** Все 4 документа A2LINE (для кнопки шаблона) */
export function buildA2LinePortugalMay2026Documents(warehouseId: string): UpsertLoadingShipmentInput[] {
  return A2LINE_PORTUGAL_LINES.map((def) => buildA2LineDocumentInput(warehouseId, def.key)!)
}

/** @deprecated совместимость — один документ со всеми строками */
export function buildA2LinePortugalMay2026Input(warehouseId: string): UpsertLoadingShipmentInput {
  return {
    date: A2LINE_ORDER_META.date,
    warehouseId,
    containerId: A2LINE_ORDER_META.containerId,
    payloadKg: 26500,
    palletPlacesLimit: 33,
    counterpartyName: A2LINE_ORDER_META.counterpartyName,
    orderNo: 'Portugal',
    orderPlacedDate: A2LINE_ORDER_META.orderPlacedDate,
    clientDueDate: A2LINE_ORDER_META.clientDueDate,
    region: A2LINE_ORDER_META.region,
    logistics: A2LINE_ORDER_META.logistics,
    orderNotes: A2LINE_ORDER_META.orderNotes,
    lines: A2LINE_PORTUGAL_LINES.map((def) => mkLine(def)),
  }
}

export const LOADING_PRESET_IDS = ['a2line-portugal-2026-05'] as const

export type LoadingPresetId = (typeof LOADING_PRESET_IDS)[number]

export function buildLoadingPresetInput(
  id: LoadingPresetId,
  warehouseId: string,
): UpsertLoadingShipmentInput | null {
  if (id === 'a2line-portugal-2026-05') {
    return buildA2LinePortugalMay2026Documents(warehouseId)[0] ?? null
  }
  return null
}
