/** Категория рецептуры (лист Excel / граммовка) */
export type FormulationCategory =
  | '75'
  | '130'
  | '145'
  | '145ultra'
  | '160'
  | '165ultra'
  | 'membrane'
  | 'ratl'
  | 'glasspaper'
  | 'logo'
  | 'other'

export type FormulationColorVariant =
  | 'white'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'blue'
  | 'green'
  | 'black'
  | 'grey'
  | 'other'

export type FormulationCurrency = 'EUR' | 'USD' | 'GEL'

export type FormulationComponent = {
  id: string
  name: string
  /** Вес сухой базы, кг (~800) */
  weightKg: number
  /** Вес в партии с водой, кг (~1000) */
  batchKg?: number
  sharePct?: number
  pricePerKg?: number
  costPerBatch?: number
  isWater?: boolean
  pigmentPasteId?: string
  /** Позиция склада (химия, пасты) */
  warehouseItemId?: string
}

/** Рецептура пропиточного состава (из Excel «Рецептуры») */
export type FormulationRecipe = {
  id: string
  /** РП-145/2 */
  code: string
  name: string
  category: FormulationCategory
  /** Код варианта: 145/2В, 130-90/1 */
  variantCode?: string
  colorVariant?: FormulationColorVariant
  grammageGsm?: number
  currency: FormulationCurrency
  dryBatchKg?: number
  totalBatchKg?: number
  totalCost?: number
  note?: string
  /** Текст для этикетки готовой пропитки */
  labelText?: string
  components: FormulationComponent[]
  /** Готовая пропитка в номенклатуре склада */
  outputWarehouseItemId?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type PigmentPaste = {
  id: string
  name: string
  colorIndex?: string
  pricePerKg?: number
  currency: FormulationCurrency
  active: boolean
}

export type FormulationStore = {
  recipes: FormulationRecipe[]
  pigmentPastes: PigmentPaste[]
  nextRecipeCode: number
  /** Журнал замесов (партий в кубе) */
  batchRuns: FormulationBatchRun[]
  /** Счётчик внутренних кодов готовой пропитки (штрихкод PM-NNNNNN) */
  nextInternalCode?: number
  /** Задания на замес (технолог → миксер) */
  mixTasks?: FormulationMixTask[]
  /** Расширяемая база граммовок (г/м²) для расчётов */
  grammageRegistry?: number[]
}

/** Статус задания на замес */
export type MixTaskStatus = 'open' | 'done' | 'cancelled'

/**
 * Задание на замес: технолог ставит миксеру что и сколько замесить.
 * Может быть создано из плана (планировщик) или вручную. После исполнения
 * связывается с конкретным замесом (`batchRunId`).
 */
export type FormulationMixTask = {
  id: string
  /** Номер задания ЗД-YYYYMMDD-NNN */
  taskNumber: string
  recipeId: string
  recipeCode: string
  recipeName: string
  colorVariant?: FormulationColorVariant
  grammageGsm?: number
  /** Плановый объём замеса, л */
  targetVolumeL: number
  /** Склад, куда оприходовать готовую пропитку (по умолчанию основной) */
  warehouseId?: string
  /** Плановая дата замеса (ISO YYYY-MM-DD) */
  plannedDate: string
  shift?: 'day' | 'night'
  /** Производственная линия-получатель (1 / 2) */
  lineId?: string
  brigade?: string
  /** Приоритет: меньше = срочнее */
  priority?: number
  status: MixTaskStatus
  /** Источник задания из планировщика */
  sourceOrderId?: string
  sourceDayPlanId?: string
  /** Исполнение */
  batchRunId?: string
  createdBy?: string
  createdByName?: string
  note?: string
  createdAt: string
  updatedAt: string
  doneAt?: string
  doneByName?: string
}

/**
 * Статус замеса:
 * - `pending` — куб замешан, ожидает подтверждения кладовщиком (склад НЕ затронут);
 * - `confirmed` — кладовщик подтвердил: проведено списание сырья и приход готовой пропитки;
 * - `rejected` — кладовщик отклонил заявку (склад не затронут).
 */
export type FormulationBatchStatus = 'pending' | 'confirmed' | 'rejected'

/** Проведённый/ожидающий замес пропиточного состава в кубе */
export type FormulationBatchRun = {
  id: string
  documentNumber: string
  /** Внутренний код готовой пропитки для штрихкода (PM-000123) */
  internalCode?: string
  status?: FormulationBatchStatus
  recipeId: string
  recipeCode: string
  recipeName: string
  variantCode?: string
  colorVariant?: FormulationColorVariant
  grammageGsm?: number
  /** Объём партии, л (≈ кг для водной смеси) */
  targetVolumeL: number
  scaleFactor: number
  lines: FormulationBatchLine[]
  outputWarehouseItemId: string
  outputKg: number
  warehouseId: string
  mixedAt: string
  mixedBy: string
  mixedByName: string
  shiftBrigade?: string
  shiftNote?: string
  comment?: string
  issueDocumentId?: string
  receiptDocumentId?: string
  /** Подтверждение кладовщиком */
  confirmedAt?: string
  confirmedBy?: string
  confirmedByName?: string
  /** Отклонение кладовщиком */
  rejectedAt?: string
  rejectedByName?: string
  rejectReason?: string
  /** Снимок для этикетки на момент замеса */
  labelSnapshot?: {
    productTitle: string
    labelText?: string
    colorLabel?: string
    grammageGsm?: number
    variantCode?: string
  }
  createdAt: string
}

export type FormulationBatchLine = {
  componentId: string
  name: string
  warehouseItemId: string
  consumeKg: number
}

export const FORMULATION_CATEGORIES: {
  id: FormulationCategory
  labelRu: string
  labelKa: string
}[] = [
  { id: '75', labelRu: '75 г/м² (Celloplex)', labelKa: '75 გ/მ²' },
  { id: '130', labelRu: '130 г/м²', labelKa: '130 გ/მ²' },
  { id: '145', labelRu: '145 г/м²', labelKa: '145 გ/მ²' },
  { id: '145ultra', labelRu: '145 Ultra', labelKa: '145 Ultra' },
  { id: '160', labelRu: '160 г/м²', labelKa: '160 გ/მ²' },
  { id: '165ultra', labelRu: '165 Ultra', labelKa: '165 Ultra' },
  { id: 'membrane', labelRu: 'Мембрана / ткань', labelKa: 'მემბრანა' },
  { id: 'ratl', labelRu: 'РАТЛ', labelKa: 'RATL' },
  { id: 'glasspaper', labelRu: 'Стеклообои', labelKa: 'შუშის ფონი' },
  { id: 'logo', labelRu: 'Лого / грунт', labelKa: 'ლოგო' },
  { id: 'other', labelRu: 'Прочее', labelKa: 'სხვა' },
]

export const FORMULATION_COLOR_VARIANTS: {
  id: FormulationColorVariant
  labelRu: string
  labelKa: string
}[] = [
  { id: 'white', labelRu: 'Белый / база', labelKa: 'თეთრი' },
  { id: 'yellow', labelRu: 'Жёлтый', labelKa: 'ყვითელი' },
  { id: 'orange', labelRu: 'Оранжевый', labelKa: 'ნარინჯისფერი' },
  { id: 'red', labelRu: 'Красный', labelKa: 'წითელი' },
  { id: 'blue', labelRu: 'Синий', labelKa: 'ლურჯი' },
  { id: 'green', labelRu: 'Зелёный', labelKa: 'მწვანე' },
  { id: 'black', labelRu: 'Чёрный', labelKa: 'შავი' },
  { id: 'grey', labelRu: 'Серый', labelKa: 'ნაცარი' },
  { id: 'other', labelRu: 'Другой', labelKa: 'სხვა' },
]

export function formulationCategoryLabel(
  cat: FormulationCategory,
  locale: 'ru' | 'ka',
): string {
  const row = FORMULATION_CATEGORIES.find((c) => c.id === cat)
  if (!row) return cat
  return locale === 'ka' ? row.labelKa : row.labelRu
}

export function formulationColorLabel(
  color: FormulationColorVariant | undefined,
  locale: 'ru' | 'ka',
): string {
  if (!color) return '—'
  const row = FORMULATION_COLOR_VARIANTS.find((c) => c.id === color)
  if (!row) return color
  return locale === 'ka' ? row.labelKa : row.labelRu
}
