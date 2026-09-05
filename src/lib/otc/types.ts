/** ОТК — отдел технического контроля (лаборатория + цех) */

export type OtcProductKind = 'mesh' | 'rooflex' | 'membrane'

export type OtcTestKind =
  | 'alkali_resistance'
  | 'tensile_strength'
  | 'mass_per_area'
  | 'mesh_size'
  | 'loss_on_ignition'
  | 'fabric_width'
  | 'threads_per_10cm'
  | 'water_resistance_w1'

export type OtcPassStatus = 'pass' | 'fail' | 'pending'

export type OtcQualityGrade = 'cat1' | 'cat2' | 'cat3' | 'scrap'

export type OtcDefectStatus = 'open' | 'in_progress' | 'closed'

export type OtcDefectStage = 'greige' | 'finished' | 'other'

export type OtcAlkaliPhase = 'before' | 'soaking' | 'after' | 'closed'

/** Норматив по виду продукции и типу испытания */
export type OtcNorm = {
  id: string
  productKind: OtcProductKind
  testKind: OtcTestKind
  labelRu: string
  labelKa?: string
  unit: string
  min?: number
  max?: number
  /** Для щёлочи: мин. остаточная прочность, % */
  residualMinPct?: number
  active: boolean
  note?: string
}

export type OtcLabTestComputed = {
  status: OtcPassStatus
  summary: string
  residualPct?: number | null
}

/** Обычное лабораторное испытание (дата + результат + норма → заключение) */
export type OtcLabTest = {
  id: string
  productKind: OtcProductKind
  testKind: OtcTestKind
  testedAt: string
  batchNo?: string
  productName: string
  finishedProductId?: string
  /** Основной результат */
  value?: number
  /** Второй замер (основа / уток и т.п.) */
  valueSecondary?: number
  unit: string
  normId?: string
  normMin?: number
  normMax?: number
  controllerName?: string
  note?: string
  computed: OtcLabTestComputed
  createdAt: string
  updatedAt?: string
}

/**
 * Серия щёлочестойкости: до → закладка (+28 сут) → после → % остаточной прочности.
 */
export type OtcAlkaliSeries = {
  id: string
  productName: string
  finishedProductId?: string
  batchNo?: string
  sampleLabel?: string
  /** Дата закладки в раствор (YYYY-MM-DD) */
  soakDate?: string
  /** dueDate = soakDate + 28 */
  dueDate?: string
  strengthBefore?: number
  strengthBeforeSecondary?: number
  strengthAfter?: number
  strengthAfterSecondary?: number
  residualMinPct: number
  phase: OtcAlkaliPhase
  controllerName?: string
  note?: string
  computed: OtcLabTestComputed
  createdAt: string
  updatedAt?: string
}

/** Сортировка готовой продукции в цехе */
export type OtcSortingRecord = {
  id: string
  sortedAt: string
  shiftLabel?: string
  batchNo?: string
  productName: string
  finishedProductId?: string
  qtyCat1: number
  qtyCat2: number
  qtyCat3: number
  qtyScrap: number
  unit: 'rolls' | 'mp'
  visualOk?: boolean
  /** Ручная проверка: тянется ли сетка */
  handStretchOk?: boolean
  sorterName?: string
  note?: string
  createdAt: string
}

export type OtcDefectPhoto = {
  id: string
  dataUrl: string
  caption?: string
  createdAt: string
}

/** Кейс дефекта (фото в программе, без Telegram) */
export type OtcDefectCase = {
  id: string
  foundAt: string
  stage: OtcDefectStage
  batchNo?: string
  productName: string
  description: string
  photos: OtcDefectPhoto[]
  status: OtcDefectStatus
  assigneeName?: string
  resolution?: string
  createdByName?: string
  createdAt: string
  updatedAt?: string
}

export type OtcStore = {
  norms: OtcNorm[]
  labTests: OtcLabTest[]
  alkaliSeries: OtcAlkaliSeries[]
  sorting: OtcSortingRecord[]
  defects: OtcDefectCase[]
}
