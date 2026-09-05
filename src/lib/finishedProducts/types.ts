import type { PlannerOrderCategory } from '@/lib/planner/types'
import type { RawMaterialKind } from '@/lib/packaging/types'

/** Встроенные типы готовой продукции */
export type FinishedProductType = 'mesh' | 'ratl' | 'membrane'

/** Расширяемый тип (встроенный id или свой из реестра) */
export type FinishedProductTypeId = FinishedProductType | (string & {})

export type FinishedProductTypeDef = {
  id: string
  labelRu: string
  labelKa?: string
  labelEn?: string
}

export type FinishedProduct = {
  id: string
  /** Внутренний код ГП-000001 */
  code: string
  name: string
  /** Наименование на грузинском (черновик из русского). Аддитивно. */
  nameKa?: string
  /** Наименование на английском (черновик из русского). Аддитивно. */
  nameEn?: string
  /** Сетка / Ратл / Мембрана / свой тип из справочника */
  productType?: FinishedProductTypeId
  /** Граммовка / плотность, г/м² */
  grammageGsm?: number
  /** Размер ячейки сетки: 4x4, 4x5, 5x5… */
  meshCellSize?: string
  /** Категория выработки (75 / 145 / 160…) */
  category: PlannerOrderCategory
  colorLogo?: string
  /** Цвет готовой продукции (#hex) */
  productColor?: string
  /** Позиция склада для учёта остатков ГП */
  warehouseItemId?: string
  /** Фото этикетки заказчика (data URL) */
  labelPhotoDataUrl?: string
  labelPhotoName?: string
  /** Единица учёта */
  unit: 'mp'
  /** Связь с контрагентом-заказчиком по умолчанию */
  defaultCounterpartyId?: string
  rawMaterialKind?: RawMaterialKind
  defaultRawMaterialItemId?: string
  defaultPackagingRecipeId?: string
  /** Рецепт коробки (сколько рулонов / какая коробка) */
  defaultBoxRecipeId?: string
  /** Рецептура пропиточного состава по умолчанию */
  defaultFormulationRecipeId?: string
  /** п.м в одном рулоне суровья */
  metersPerRoll?: number
  /** Ширина рулона, м (для расчёта веса и площади в погрузке) */
  rollWidthM?: number
  note?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type FinishedProductStore = {
  items: FinishedProduct[]
  nextCode: number
  /** Доп. типы продукции (кроме mesh/ratl/membrane) */
  productTypeRegistry?: FinishedProductTypeDef[]
  /** Доп. граммовки, г/м² */
  grammageRegistry?: number[]
  /** Доп. ширины рулона, м */
  rollWidthRegistry?: number[]
  /** Доп. размеры ячейки сетки */
  meshCellRegistry?: string[]
}

export const FINISHED_PRODUCT_TYPES: {
  id: FinishedProductType
  labelRu: string
  labelKa: string
}[] = [
  { id: 'mesh', labelRu: 'Сетка', labelKa: 'ბადე' },
  { id: 'ratl', labelRu: 'Ратл', labelKa: 'RATL' },
  { id: 'membrane', labelRu: 'Мембрана', labelKa: 'მემბრანა' },
]

import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'

export function finishedProductTypeLabel(
  type: FinishedProductTypeId | undefined,
  locale: Locale,
  store?: FinishedProductStore,
): string {
  if (!type) return '—'
  const builtIn = FINISHED_PRODUCT_TYPES.find((t) => t.id === type)
  if (builtIn) return labelRuKa(locale, builtIn.labelRu, builtIn.labelKa)
  const custom = store?.productTypeRegistry?.find((t) => t.id === type)
  if (custom) {
    return labelRuKa(locale, custom.labelRu, custom.labelKa ?? custom.labelRu)
  }
  return type
}

export function productTypeToRawKind(
  type: FinishedProductTypeId | undefined,
): RawMaterialKind | undefined {
  if (type === 'mesh') return 'mesh'
  if (type === 'ratl') return 'ratl'
  if (type === 'membrane') return 'membrane'
  return undefined
}
