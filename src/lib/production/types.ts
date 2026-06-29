import type { PackagingPlan } from '@/lib/packaging/types'
import type { PlannerStore } from '@/lib/planner/types'

/** Линии: пропитка (RATL) 1 и 2, упаковка */
export type ProductionLineId = '1' | '2' | 'pack'

/** Категории как на бланке «Заявка на производство» */
export type ProductionCategoryKey =
  | 'ratl1'
  | 'ratl2'
  | 'cat4'
  | 'cat31'
  | 'cat32'
  | 'defect'

export type ProductionCategoryCell = {
  /** Количество, пог. м */
  qtyMp?: number
  /** Брак — дополнительно кг */
  qtyKg?: number
  note?: string
}

export type ProductionShift = 'day' | 'night'

/** Явка сотрудника бригады на смену */
export type ProductionRosterEntry = {
  employeeId: string
  present: boolean
  /** Добавлен вручную (другая линия / подмена), не из состава бригады */
  extra?: boolean
}

/** Секции бланка линии упаковки */
export type PackagingSectionKey = 'rolls' | 'boxes' | 'pallets'

/** Строка секции упаковки (как на бланке: наименование / цвет лого / план / выработка) */
export type PackagingRow = {
  id: string
  name: string
  colorLogo: string
  planQty?: number
  factQty?: number
  note?: string
}

/** Данные заявки линии упаковки */
export type PackagingRequestData = {
  /** Термоплёнка (термоусадочная) */
  thermoFilm: string
  /** Стрейч-плёнка */
  stretch: string
  rolls: PackagingRow[]
  boxes: PackagingRow[]
  pallets: PackagingRow[]
}

export const PACKAGING_SECTIONS: {
  key: PackagingSectionKey
  labelRu: string
  labelKa: string
}[] = [
  { key: 'rolls', labelRu: 'Рулоны', labelKa: 'რულონები' },
  { key: 'boxes', labelRu: 'Коробки', labelKa: 'ყუთები' },
  { key: 'pallets', labelRu: 'Паллеты', labelKa: 'პალეტები' },
]

export type ProductionFactRow = {
  id: string
  /** Рулонов на поддоне (как пишете в строке на бланке) */
  palletRollQty?: number
  /** Примечание к строке / поддону */
  rowNote?: string
  ratl1: ProductionCategoryCell
  ratl2: ProductionCategoryCell
  cat4: ProductionCategoryCell
  cat31: ProductionCategoryCell
  cat32: ProductionCategoryCell
  defect: ProductionCategoryCell
}

/** Один заказ в плане (за смену может быть несколько, если заказ сменился) */
export type ProductionPlanSegment = {
  id: string
  /** Связь сегмента с заказом планировщика */
  orderId?: string
  dayPlanId?: string
  orderNumber?: string
  customer: string
  productName: string
  colorLogo: string
  plannedQtyMp?: number
  /** С какого момента / комментарий, напр. «с 14:00» */
  note?: string
}

/** @deprecated — миграция в planSegments */
export type ProductionPlan = {
  customer: string
  productName: string
  colorLogo: string
  plannedQtyMp?: number
}

/** Заявка на производство за смену (день 9:00–21:00 или ночь 21:00–9:00) */
export type ProductionRequest = {
  id: string
  /** Связь с заказом планировщика (если один заказ на смену) */
  orderId?: string
  /** Заявка сформирована из планировщика */
  fromPlanner?: boolean
  /** Номера заказов для отображения, напр. «ЗП-2026-001» */
  plannerSourceNote?: string
  date: string
  lineId: ProductionLineId
  shift: ProductionShift
  foremanId?: string
  brigadeName: string
  /** Кто вышел на смену (по бригаде из табеля) */
  rosterAttendance?: ProductionRosterEntry[]
  /** Суровье из номенклатуры склада */
  rawMaterialItemId?: string
  /** к-во рулонов суровья */
  rawRollQty?: number
  /** № рулонов суровья (текст, несколько через запятую/с новой строки) */
  rawRollNumbers: string
  packagingRecipeId?: string
  /** Расчёт упаковки из планировщика */
  packagingPlan?: PackagingPlan
  /** Данные бланка линии упаковки (только для lineId='pack') */
  packaging?: PackagingRequestData
  planSegments: ProductionPlanSegment[]
  factRows: ProductionFactRow[]
  /** Причины выбраковки */
  defectReasons: string
  status: 'draft' | 'saved' | 'posted'
  /** Когда производство сохранило в журнал */
  savedAt?: string
  /** Когда кладовщик провёл на склад */
  postedAt?: string
  postedBy?: string
  createdAt: string
  updatedAt: string
}

export type ProductionStore = {
  requests: ProductionRequest[]
  planner: PlannerStore
}

export const PRODUCTION_LINES: {
  id: ProductionLineId
  labelRu: string
  labelKa: string
  shortRu: string
}[] = [
  {
    id: '1',
    labelRu: 'Линия 1 RATL',
    labelKa: 'ხაზი 1 RATL',
    shortRu: 'Линия 1',
  },
  {
    id: '2',
    labelRu: 'Линия 2',
    labelKa: 'ხაზი 2',
    shortRu: 'Линия 2',
  },
  {
    id: 'pack',
    labelRu: 'Линия упаковки',
    labelKa: 'შეფუთვის ხაზი',
    shortRu: 'Упаковка',
  },
]

export const PRODUCTION_CATEGORIES: {
  key: ProductionCategoryKey
  labelLine1Ru: string
  labelLine2Ru: string
  labelKa: string
  unitRu: string
}[] = [
  {
    key: 'ratl1',
    labelLine1Ru: 'РАТЛ 1 кат',
    labelLine2Ru: '1 кат',
    labelKa: '1 კატ',
    unitRu: 'п.м',
  },
  {
    key: 'ratl2',
    labelLine1Ru: 'РАТЛ 2 кат',
    labelLine2Ru: '2 кат',
    labelKa: '2 კატ',
    unitRu: 'п.м',
  },
  {
    key: 'cat4',
    labelLine1Ru: 'IV кат',
    labelLine2Ru: 'IV кат',
    labelKa: 'IV კატ',
    unitRu: 'п.м',
  },
  {
    key: 'cat31',
    labelLine1Ru: '3,1 кат',
    labelLine2Ru: '3,1 кат',
    labelKa: '3,1 კატ',
    unitRu: 'п.м',
  },
  {
    key: 'cat32',
    labelLine1Ru: '3,2 кат',
    labelLine2Ru: '3,2 кат',
    labelKa: '3,2 კატ',
    unitRu: 'п.м',
  },
  {
    key: 'defect',
    labelLine1Ru: 'Брак',
    labelLine2Ru: 'Брак',
    labelKa: 'ბრაკი',
    unitRu: 'п.м / кг',
  },
]

export function categoryLabel(
  key: ProductionCategoryKey,
  lineId: ProductionLineId,
  locale: 'ru' | 'ka',
): string {
  const cat = PRODUCTION_CATEGORIES.find((c) => c.key === key)!
  if (locale === 'ka') return cat.labelKa
  return lineId === '1' ? cat.labelLine1Ru : cat.labelLine2Ru
}
