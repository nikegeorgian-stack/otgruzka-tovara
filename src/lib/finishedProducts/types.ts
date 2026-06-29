import type { PlannerOrderCategory } from '@/lib/planner/types'
import type { RawMaterialKind } from '@/lib/packaging/types'

/** Тип готовой продукции */
export type FinishedProductType = 'mesh' | 'ratl' | 'membrane'

export type FinishedProduct = {
  id: string
  /** Внутренний код ГП-000001 */
  code: string
  name: string
  /** Сетка / Ратл / Мембрана */
  productType?: FinishedProductType
  /** Граммовка, г/м² */
  grammageGsm?: number
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

export function finishedProductTypeLabel(
  type: FinishedProductType | undefined,
  locale: 'ru' | 'ka',
): string {
  if (!type) return '—'
  const row = FINISHED_PRODUCT_TYPES.find((t) => t.id === type)
  if (!row) return type
  return locale === 'ka' ? row.labelKa : row.labelRu
}

export function productTypeToRawKind(type: FinishedProductType): RawMaterialKind {
  return type
}
