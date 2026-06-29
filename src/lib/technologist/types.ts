/** Технолог · контроль качества (логика из Excel EAD / входной / пропитка) */

export type CellSizeInputMode = 'instrument' | 'manual'

/** m0 — чашка; m1 — с материалом; m2 — с сухим остатком */
export type GravimetricTriple = {
  m0?: number
  m1?: number
  m2?: number
}

export type EadZoneKey = 'edgeLeft' | 'middle' | 'edgeRight'

export type EadCalculationRecord = {
  id: string
  productType: string
  substrateName: string
  manufacturedAt?: string
  testedAt?: string
  cellSizeMode: CellSizeInputMode
  /** Средний размер ячейки суровья — основа / уток (3 замера) */
  substrateCellWarp: number[]
  substrateCellWeft: number[]
  /** Размер открытой ячейки — основа / уток */
  openCellWarp: number[]
  openCellWeft: number[]
  zones: Record<EadZoneKey, GravimetricTriple>
  /** Снимок расчёта на момент сохранения */
  computed: EadCalculationComputed
  note?: string
  createdAt: string
  createdByName?: string
}

export type EadCalculationComputed = {
  substrateCellWarpMm: number | null
  substrateCellWeftMm: number | null
  openCellWarpMm: number | null
  openCellWeftMm: number | null
  zoneH1: Record<EadZoneKey, number | null>
  avgOrganicContent: number | null
  avgResidualMoisture: number | null
}

export type EadControlRecord = {
  id: string
  productType: string
  substrateName: string
  lineId: string
  manufacturedAt?: string
  targetGsm: number
  note?: string
  /** «Л» — левый край (3 замера, ×0,1 г/м²) */
  leftReadings: number[]
  /** «П» — правый край */
  rightReadings: number[]
  computed: EadControlComputed
  createdAt: string
  createdByName?: string
}

export type EadControlComputed = {
  leftAvgGsm: number | null
  rightAvgGsm: number | null
  overallAvgGsm: number | null
  deviationGsm: number | null
  deviationPct: number | null
  status: QcPassStatus
}

export type IncomingMaterialKind = 'chemistry' | 'fabric' | 'other'

export type IncomingControlRecord = {
  id: string
  kind: IncomingMaterialKind
  supplier: string
  containerNo?: string
  itemName: string
  receiptDate?: string
  controlDate?: string
  batchNo?: string
  manufacturedAt?: string
  /** Химия */
  ph?: number
  phMin?: number
  phMax?: number
  drySolidsPct?: number
  passportDrySolidsPct?: number
  /** Суровьё */
  grammageGsm?: number
  cellWarpMm?: number
  cellWeftMm?: number
  strengthWarpN?: number
  strengthWeftN?: number
  resultText?: string
  controllerName?: string
  computed: IncomingControlComputed
  createdAt: string
}

export type IncomingControlComputed = {
  drySolidsDeviationPct: number | null
  phInRange: boolean | null
  status: QcPassStatus
  summary: string
}

export type ImpregnationQcRecord = {
  id: string
  recipeCode?: string
  recipeId?: string
  batchNumber?: string
  manufacturedAt?: string
  controlledAt?: string
  operators?: string
  visualOk?: boolean
  gravimetric: GravimetricTriple
  viscositySec?: number
  viscosityTempC?: number
  theoreticalNvPct?: number
  nvTolerancePp: number
  controllerName?: string
  note?: string
  computed: ImpregnationQcComputed
  createdAt: string
}

export type ImpregnationQcComputed = {
  nvPct: number | null
  absDeviationPp: number | null
  relDeviation: number | null
  status: QcPassStatus
}

export type QcPassStatus = 'pass' | 'fail' | 'pending'

export type TechnologistQcSettings = {
  defaultNvTolerancePp: number
}

/** Температура и влажность в помещении (журнал по дням). */
export type RoomClimateRecord = {
  id: string
  /** YYYY-MM-DD */
  measuredDate: string
  /** HH:mm */
  measuredTime: string
  temperatureC: number
  humidityPct: number
  roomLabel?: string
  recordedByName?: string
  createdAt: string
}

export type TechnologistQcStore = {
  eadCalculations: EadCalculationRecord[]
  eadControls: EadControlRecord[]
  incomingControls: IncomingControlRecord[]
  impregnationQc: ImpregnationQcRecord[]
  roomClimateLog: RoomClimateRecord[]
  settings: TechnologistQcSettings
}
