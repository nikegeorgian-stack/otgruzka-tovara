import type {
  EadCalculationRecord,
  EadControlRecord,
  ImpregnationQcRecord,
  IncomingControlRecord,
  RoomClimateRecord,
  ShiftHandoffAck,
  ShiftHandoffRecord,
  ShiftHandoffStatus,
  ShiftHandoffUrgency,
  TechnologistQcStore,
} from './types'

export function createDefaultTechnologistQc(): TechnologistQcStore {
  return {
    eadCalculations: [],
    eadControls: [],
    incomingControls: [],
    impregnationQc: [],
    roomClimateLog: [],
    shiftHandoffs: [],
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
    shiftHandoffs: Array.isArray((raw as TechnologistQcStore).shiftHandoffs)
      ? ((raw as TechnologistQcStore).shiftHandoffs ?? [])
          .map(normalizeShiftHandoff)
          .filter((h): h is ShiftHandoffRecord => h != null)
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

const URGENCIES = new Set<string>(['normal', 'urgent', 'critical'])
const HANDOFF_STATUSES = new Set<string>(['open', 'closed'])

function normalizeAck(raw: unknown): ShiftHandoffAck | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const userName = typeof o.userName === 'string' ? o.userName.trim() : ''
  if (!userName) return null
  return {
    userId: typeof o.userId === 'string' && o.userId ? o.userId : undefined,
    userName,
    at: typeof o.at === 'string' && o.at ? o.at : new Date().toISOString(),
  }
}

export function normalizeShiftHandoff(raw: unknown): ShiftHandoffRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const shiftDate =
    typeof o.shiftDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.shiftDate)
      ? o.shiftDate
      : typeof o.createdAt === 'string' && o.createdAt
        ? o.createdAt.slice(0, 10)
        : ''
  if (!shiftDate) return null
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  const body = typeof o.body === 'string' ? o.body : ''
  if (!title && !body.trim()) return null
  const now = new Date().toISOString()
  const urgency: ShiftHandoffUrgency =
    typeof o.urgency === 'string' && URGENCIES.has(o.urgency)
      ? (o.urgency as ShiftHandoffUrgency)
      : 'normal'
  const status: ShiftHandoffStatus =
    typeof o.status === 'string' && HANDOFF_STATUSES.has(o.status)
      ? (o.status as ShiftHandoffStatus)
      : 'open'
  const acknowledgements = Array.isArray(o.acknowledgements)
    ? o.acknowledgements.map(normalizeAck).filter((a): a is ShiftHandoffAck => a != null)
    : []
  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    shiftDate,
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : now,
    authorId: typeof o.authorId === 'string' ? o.authorId : undefined,
    authorName: typeof o.authorName === 'string' ? o.authorName : undefined,
    title: title || 'Пересменка',
    body,
    area: typeof o.area === 'string' && o.area.trim() ? o.area.trim() : undefined,
    urgency,
    status,
    acknowledgements,
  }
}
