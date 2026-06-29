import type {
  EadCalculationRecord,
  EadControlRecord,
  ImpregnationQcRecord,
  IncomingControlRecord,
  RoomClimateRecord,
  TechnologistQcStore,
} from './types'

export function createDefaultTechnologistQc(): TechnologistQcStore {
  return {
    eadCalculations: [],
    eadControls: [],
    incomingControls: [],
    impregnationQc: [],
    roomClimateLog: [],
    settings: { defaultNvTolerancePp: 5 },
  }
}

function emptyZones() {
  return {
    edgeLeft: {},
    middle: {},
    edgeRight: {},
  }
}

/** Приведение массива замеров к числам (защита от строк в legacy/import JSON) */
function toNums(arr: unknown): number[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((v) => Number(v))
    .filter((n): n is number => Number.isFinite(n))
}

/** Приведение m0/m1/m2 к числам или undefined */
function toGravimetric(g: { m0?: unknown; m1?: unknown; m2?: unknown } | undefined) {
  const pick = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined)
  return { m0: pick(g?.m0), m1: pick(g?.m1), m2: pick(g?.m2) }
}

export function normalizeTechnologistQc(
  raw: TechnologistQcStore | undefined,
): TechnologistQcStore {
  const d = createDefaultTechnologistQc()
  if (!raw) return d
  return {
    eadCalculations: Array.isArray(raw.eadCalculations)
      ? raw.eadCalculations.map(normalizeEadCalc)
      : [],
    eadControls: Array.isArray(raw.eadControls)
      ? raw.eadControls.map(normalizeEadControl)
      : [],
    incomingControls: Array.isArray(raw.incomingControls)
      ? raw.incomingControls.map(normalizeIncoming)
      : [],
    impregnationQc: Array.isArray(raw.impregnationQc)
      ? raw.impregnationQc.map(normalizeImpregQc)
      : [],
    roomClimateLog: Array.isArray(raw.roomClimateLog)
      ? raw.roomClimateLog.map(normalizeRoomClimate)
      : [],
    settings: {
      defaultNvTolerancePp:
        raw.settings?.defaultNvTolerancePp ?? d.settings.defaultNvTolerancePp,
    },
  }
}

function normalizeEadCalc(r: EadCalculationRecord): EadCalculationRecord {
  const baseZones = emptyZones()
  const zones = { ...baseZones, ...r.zones }
  return {
    ...r,
    cellSizeMode: r.cellSizeMode === 'manual' ? 'manual' : 'instrument',
    substrateCellWarp: toNums(r.substrateCellWarp),
    substrateCellWeft: toNums(r.substrateCellWeft),
    openCellWarp: toNums(r.openCellWarp),
    openCellWeft: toNums(r.openCellWeft),
    zones: {
      edgeLeft: toGravimetric(zones.edgeLeft),
      middle: toGravimetric(zones.middle),
      edgeRight: toGravimetric(zones.edgeRight),
    },
  }
}

function normalizeEadControl(r: EadControlRecord): EadControlRecord {
  return {
    ...r,
    leftReadings: toNums(r.leftReadings),
    rightReadings: toNums(r.rightReadings),
  }
}

function normalizeIncoming(r: IncomingControlRecord): IncomingControlRecord {
  return {
    ...r,
    kind: r.kind === 'fabric' || r.kind === 'other' ? r.kind : 'chemistry',
  }
}

function normalizeImpregQc(r: ImpregnationQcRecord): ImpregnationQcRecord {
  return {
    ...r,
    gravimetric: toGravimetric(r.gravimetric),
    nvTolerancePp: Number.isFinite(Number(r.nvTolerancePp)) ? Number(r.nvTolerancePp) : 5,
  }
}

function normalizeRoomClimate(r: RoomClimateRecord): RoomClimateRecord {
  return {
    id: r.id,
    measuredDate: r.measuredDate?.slice(0, 10) ?? '',
    measuredTime: r.measuredTime?.slice(0, 5) ?? '00:00',
    temperatureC: Number(r.temperatureC) || 0,
    humidityPct: Number(r.humidityPct) || 0,
    roomLabel: r.roomLabel?.trim() || undefined,
    recordedByName: r.recordedByName?.trim() || undefined,
    createdAt: r.createdAt || new Date().toISOString(),
  }
}
